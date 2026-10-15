/**
 * O SOM DA EDICAO RAPIDA, MEDIDO (agente A, 14/10). Sem app, sem Remotion, sem
 * IA e sem credito: o audio e a narracao JA PAGA do S4-37 (o .wav do projeto
 * montado numa rodada anterior, so lido), a pasta de musicas do Levi (so
 * leitura) e os SFX que vem com o app.
 *
 *  1. a conta de loudness em JS (shared/loudness.ts) contra o ebur128 do ffmpeg;
 *  2. musica SEM REPETIR (historico numa pasta de teste, nunca na de musicas);
 *  3. o filtro do envelope do ffmpeg (som/mix.ts) contra ganhoDoEnvelope (a
 *     conta do preview): um tom de 1 kHz passando pelo filtro, medido;
 *  4. um SHORT SINTETICO (~25 s): pedacos da narracao real com duas pausas de
 *     verdade (1,6 s e 2,0 s), partes gancho > contexto > climax, os cortes do
 *     projeto real. planejarSom + trilhasDoPlanoDeSom + trilhaParaMixar + o
 *     MESMO muxWithNormalizedAudio do render, em 5 versoes (mix, so voz, so
 *     musica com ducking, so musica sem ducking, so SFX). Medido:
 *       - LUFS integrado do mix e da voz sozinha;
 *       - a musica na fala x nas pausas (ducking em dB, pela razao entre a
 *         versao com e sem ducking, e o nivel em LUFS);
 *       - cada SFX em LUFS momentaneo contra a voz (integrada e no instante);
 *       - pico VERDADEIRO do mix (ebur128 peak=true) e pico de amostra (astats);
 *  5. o S4-37 inteiro (64 s, pausas cortadas): os mesmos numeros.
 *
 * Escreve so em scratchpad/edicao-rapida/som-mix. Rodar da raiz:
 *   npx esbuild scripts/teste/v-som-mix.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json --outfile=out/teste/v-som-mix.cjs && node out/teste/v-som-mix.cjs
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  envelopeDeDucking,
  faixasDaEdicaoRapida,
  ganhoDoEnvelope,
  REGRAS_DE_SOM_PADRAO,
  secoesDoTake,
  secoesParaSom,
  trilhaParaMixar,
  trilhasDoPlanoDeSom,
  type PlanoDeSom,
  type SecaoParaSom,
} from '../../shared/edicao-rapida'
import { EnergiaK, lufsDaPotencia, medirLoudness } from '../../shared/loudness'
import type { Word } from '../../shared/contract'
import { lerRascunho, roteiroAtual } from '../../shared/roteiro'
import { takeAtual } from '../../shared/voz'
import { ffmpegPath } from '../../electron/services/ffmpeg-path'
import { configureSettings } from '../../electron/services/settings'
import { configureSfx, ensureSfxDir } from '../../electron/services/sfx'
import { configurarSom, medirSomDetalhado } from '../../electron/services/som/medir'
import { escolherMusica, lerHistoricoDeMusicas, listarMusicas, registrarMusicaUsada, usarPastaDeMusicasNoTeste } from '../../electron/services/som/musicas'
import { planejarSom } from '../../electron/services/som/planejar'
import { filtroDoEnvelope } from '../../electron/services/som/mix'
import { muxWithNormalizedAudio } from '../../electron/services/render'

let falhas = 0
let total = 0
function ok(nome: string, cond: boolean, detalhe = ''): void {
  total++
  if (cond) console.log(`  ok   ${nome}${detalhe ? `  (${detalhe})` : ''}`)
  else {
    falhas++
    console.log(`  FALHA ${nome}${detalhe ? `\n        ${detalhe}` : ''}`)
  }
}
const secao = (s: string): void => console.log(`\n== ${s}`)
const f1 = (x: number | null | undefined): string => (x === null || x === undefined || !Number.isFinite(x) ? '-inf' : x.toFixed(1))
const f2 = (x: number): string => x.toFixed(2)

const SCRATCH = 'C:/Users/levic/AppData/Local/Temp/claude/G--ClaudeEditor/ea8ba0e5-233c-49c4-9613-b7db2f0cff9f/scratchpad'
const OUT = join(SCRATCH, 'edicao-rapida', 'som-mix')
const PROJ_DIR = join(SCRATCH, 'f1p4', 'reaud', 'bib', '_projetos', 'Dr. Stone S04E37 - 2026-10-14 18h00')
const PROJETO = join(PROJ_DIR, 'Dr. Stone S04E37.anirecap')
const NARRACAO = join(PROJ_DIR, 'Dr. Stone S04E37.wav')
const RECAPS = join(SCRATCH, 'f1p4', 'reaud', 'ud', 'recaps')
const MUSICAS = 'G:/App Resumo/music'
const SFX_DO_APP = join(process.cwd(), 'assets', 'sfx')

// ------------------------------------------------------------------ ffmpeg
function ff(args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const c = spawn(ffmpegPath, ['-nostdin', '-hide_banner', ...args], { windowsHide: true })
    let err = ''
    c.stderr.on('data', (d: Buffer) => (err += d.toString()))
    c.on('error', reject)
    c.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(`ffmpeg ${code}: ${err.slice(-600)}`))))
  })
}

interface Ebur {
  I: number
  TPK: number
  LRA: number
  /** [t (fim da janela), M] a cada 100 ms. */
  M: [number, number][]
}
async function ebur128(path: string, extra = ''): Promise<Ebur> {
  const err = await ff(['-nostats', '-i', path, '-vn', '-af', `${extra}ebur128=peak=true`, '-f', 'null', '-'])
  const M: [number, number][] = []
  for (const m of err.matchAll(/t:\s*([\d.]+)\s+TARGET:[^M]*M:\s*(-?[\d.]+|-inf)/g)) M.push([Number(m[1]), Number(m[2])])
  const resumo = err.slice(err.lastIndexOf('Summary:'))
  const num = (re: RegExp): number => Number(re.exec(resumo)?.[1] ?? NaN)
  return { I: num(/I:\s*(-?[\d.]+) LUFS/), TPK: num(/Peak:\s*(-?[\d.]+) dBFS/), LRA: num(/LRA:\s*(-?[\d.]+) LU/), M }
}

async function picoDeAmostra(path: string): Promise<number> {
  const err = await ff(['-nostats', '-i', path, '-vn', '-af', 'astats=measure_perchannel=none:measure_overall=Peak_level', '-f', 'null', '-'])
  return Number(/Peak level dB:\s*(-?[\d.]+|-inf)/.exec(err)?.[1] ?? NaN)
}

/** Energia K-ponderada a cada 10 ms (estereo 48 kHz), pelo mesmo acumulador do app. */
function energia(path: string): Promise<{ e: Float64Array; h: number }> {
  return new Promise((resolve, reject) => {
    const c = spawn(ffmpegPath, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', path, '-vn', '-ac', '2', '-ar', '48000', '-f', 'f32le', '-'], {
      windowsHide: true,
    })
    const acc = new EnergiaK(48000, 2)
    let resto: Buffer | null = null
    c.stdout.on('data', (p: Buffer) => {
      const buf = resto ? Buffer.concat([resto, p]) : p
      const util = buf.length - (buf.length % 8)
      resto = util < buf.length ? Buffer.from(buf.subarray(util)) : null
      const f = new Float32Array(util / 4)
      Buffer.from(f.buffer).set(buf.subarray(0, util))
      acc.intercalado(f)
    })
    c.on('error', reject)
    c.on('close', (code) => (code === 0 ? resolve({ e: acc.subBlocos().slice(), h: acc.h }) : reject(new Error(`ffmpeg ${code}`))))
  })
}

/** "LUFS" de um conjunto de sub-blocos de 10 ms (potencia media K-ponderada, sem porta). */
function lufsDe(e: Float64Array, h: number, sel: (t: number) => boolean): number {
  let s = 0
  let n = 0
  for (let j = 0; j < e.length; j++) {
    if (!sel((j + 0.5) * 0.01)) continue
    s += e[j]!
    n++
  }
  return n > 0 ? lufsDaPotencia(s / (n * h)) : Number.NEGATIVE_INFINITY
}

/** Momentaneo (400 ms, passo 10 ms) maximo dentro de [a, b] (fim da janela dentro). */
function momentaneoMax(e: Float64Array, h: number, a: number, b: number): { lufs: number; t: number } {
  let melhor = -Infinity
  let tm = a
  for (let fim = Math.max(40, Math.round(a * 100)); fim <= Math.min(e.length, Math.round(b * 100)); fim++) {
    let s = 0
    for (let j = fim - 40; j < fim; j++) s += e[j]!
    const l = lufsDaPotencia(s / (40 * h))
    if (l > melhor) {
      melhor = l
      tm = fim / 100 - 0.2
    }
  }
  return { lufs: melhor, t: tm }
}

/** Momentaneo centrado em t (janela [t-0,2 ; t+0,2]). */
function momentaneoEm(e: Float64Array, h: number, t: number): number {
  const a = Math.max(0, Math.round((t - 0.2) * 100))
  let s = 0
  for (let j = a; j < Math.min(a + 40, e.length); j++) s += e[j]!
  return lufsDaPotencia(s / (40 * h))
}

// ---------------------------------------------------------------- preparo
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const UD = join(OUT, 'ud')
mkdirSync(UD, { recursive: true })
configureSettings(UD)
configureSfx({ userDir: join(UD, 'sfx'), bundledDir: SFX_DO_APP })
ensureSfxDir()
configurarSom({ userData: UD, reservaDeSfx: SFX_DO_APP })
usarPastaDeMusicasNoTeste(MUSICAS)

const relatorio: string[] = []
const anota = (s: string): void => {
  relatorio.push(s)
  console.log(`     ${s}`)
}

async function main(): Promise<void> {
  // ======================================================== 1. loudness JS
  secao('1. Loudness em JS (shared/loudness.ts) x ebur128 do ffmpeg')
  const musicas = (await listarMusicas()).map((m) => m.path)
  const arquivos = [NARRACAO, join(SFX_DO_APP, 'whoosh.mp3'), join(SFX_DO_APP, 'impact.mp3'), ...musicas]
  for (const p of arquivos) {
    const nosso = await medirSomDetalhado(p)
    const deles = await ebur128(p)
    const mMaxFf = Math.max(...deles.M.map(([, m]) => m))
    const dI = nosso.lufsIntegrado === null ? NaN : Math.abs(nosso.lufsIntegrado - deles.I)
    const nome = p.split(/[\\/]/).pop()!
    ok(
      `integrado de ${nome.slice(0, 40)}`,
      dI <= 0.3,
      `JS ${f1(nosso.lufsIntegrado)} x ffmpeg ${f1(deles.I)} LUFS; M max JS ${f1(nosso.lufsMomentaneoMax)} (passo 10 ms) x ffmpeg ${f1(mMaxFf)} (100 ms); ${nosso.canais ?? '?'} canal(is); ${f2(nosso.durationSec)} s; pico ${f2(nosso.picoSec)} s, audivel ${f2(nosso.inicioSomSec)}-${f2(nosso.fimSomSec)} s`,
    )
    ok(`momentaneo max de ${nome.slice(0, 40)} >= o do ffmpeg (passo mais fino)`, (nosso.lufsMomentaneoMax ?? -99) >= mMaxFf - 0.3)
    anota(`${nome}: I ${f1(nosso.lufsIntegrado)} LUFS, M max ${f1(nosso.lufsMomentaneoMax)}, ${nosso.canais ?? '?'} canal(is), ${f2(nosso.durationSec)} s`)
  }
  const narr = await medirSomDetalhado(NARRACAO)
  ok('narracao do Studio e mono (o preview soma +3 dB)', narr.canais === 1)
  ok('cache de medidas no userData de teste', existsSync(join(UD, 'som', 'medidas.json')))

  // ===================================================== 2. sem repetir
  secao('2. Musica sem repetir (historico no userData, nunca na pasta)')
  const antesDaPasta = readdirSync(MUSICAS).map((n) => `${n}:${statSync(join(MUSICAS, n)).mtimeMs}`).join('|')
  ok(`${musicas.length} musicas na pasta`, musicas.length >= 2, musicas.map((m) => m.split(/[\\/]/).pop()).join(' | '))
  const m1 = await escolherMusica()
  await registrarMusicaUsada(m1!.path, 'teste-1')
  const m2 = await escolherMusica()
  await registrarMusicaUsada(m2!.path, 'teste-2')
  const m3 = await escolherMusica()
  ok('a 2a escolha e outra faixa', m1 !== null && m2 !== null && m1.path !== m2.path, `${m1?.fileName} > ${m2?.fileName}`)
  ok('com as duas usadas, volta a usada ha mais tempo', m3?.path === m1?.path, String(m3?.fileName))
  ok('evitar pula a da vez', (await escolherMusica([m3!.path]))?.path !== m3?.path)
  ok('a escolha vem medida', m1!.durationSec !== null && m1!.lufsIntegrado !== null, `${f2(m1!.durationSec!)} s, ${f1(m1!.lufsIntegrado)} LUFS`)
  ok('historico em <userData>/som/musicas-usadas.json', existsSync(join(UD, 'som', 'musicas-usadas.json')))
  // Uma entrada POR PROJETO (avaliacao de 14/10): o historico guarda a musica
  // que cada projeto TEM, e nao cada troca experimentada.
  await registrarMusicaUsada(m2!.path, 'teste-1')
  const h1 = lerHistoricoDeMusicas()
  ok('trocar a musica de um projeto sobrescreve a entrada dele', h1.usadas.filter((u) => u.projeto === 'teste-1').length === 1 && h1.usadas.find((u) => u.projeto === 'teste-1')!.path === m2!.path)
  ok('e a musica que ele largou volta a ser a da vez', (await escolherMusica())?.path === m1!.path)
  const em2 = h1.usadas.find((u) => u.projeto === 'teste-2')!.em
  await registrarMusicaUsada(m2!.path, 'teste-2')
  ok('salvar de novo com a mesma musica nao muda a data', lerHistoricoDeMusicas().usadas.find((u) => u.projeto === 'teste-2')!.em === em2)
  await registrarMusicaUsada(null, 'teste-1')
  ok('projeto que ficou sem musica: a entrada dele sai', !lerHistoricoDeMusicas().usadas.some((u) => u.projeto === 'teste-1'))
  const depoisDaPasta = readdirSync(MUSICAS).map((n) => `${n}:${statSync(join(MUSICAS, n)).mtimeMs}`).join('|')
  ok('a pasta de musicas nao mudou (so leitura)', antesDaPasta === depoisDaPasta)

  // ================================================ 3. envelope no ffmpeg
  secao('3. O envelope do ffmpeg (som/mix.ts) = ganhoDoEnvelope (o do preview)')
  {
    const pontos = [
      { t: 10.0, db: -6 },
      { t: 10.5, db: -6 },
      { t: 10.62, db: -3.2 },
      { t: 10.74, db: -6 },
      { t: 11.5, db: -6 },
      { t: 11.85, db: 0 },
      { t: 12.6, db: 0 },
      { t: 12.72, db: -6 },
    ]
    const at = 10
    const filtro = filtroDoEnvelope(pontos, at)!
    const wav = join(OUT, 'envelope.wav')
    await ff(['-y', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=3.5', '-af', `volume=0.5,${filtro}`, '-c:a', 'pcm_f32le', wav])
    const { e, h } = await energia(wav)
    // Referencia: o mesmo tom sem envelope.
    const ref = join(OUT, 'envelope-ref.wav')
    await ff(['-y', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=3.5', '-af', 'volume=0.5', '-c:a', 'pcm_f32le', ref])
    const r = await energia(ref)
    let erroMax = 0
    for (let j = 2; j < Math.min(e.length, r.e.length) - 2; j++) {
      const medido = 10 * Math.log10(e[j]! / r.e[j]!)
      // O sub-bloco de 10 ms tem 2 quadros de 256 amostras: compara com a media do envelope nele.
      let esperado = 0
      for (let k = 0; k < 10; k++) esperado += 10 ** (ganhoDoEnvelope(pontos, at + j * 0.01 + (k + 0.5) * 0.001) / 10)
      esperado = 10 * Math.log10(esperado / 10)
      erroMax = Math.max(erroMax, Math.abs(medido - esperado))
    }
    ok('envelope medido no tom = ganhoDoEnvelope', erroMax < 0.35, `erro max ${erroMax.toFixed(2)} dB em sub-blocos de 10 ms`)
    ok('sem envelope (tudo 0 dB) = sem filtro', filtroDoEnvelope([{ t: 0, db: 0 }, { t: 5, db: 0 }], 0) === null && filtroDoEnvelope(undefined, 0) === null)
    // Video longo: 400 pausas cabem no grafo (soma, sem if aninhado).
    const longo = Array.from({ length: 1600 }, (_, k) => ({ t: k * 0.4, db: k % 4 === 0 ? 0 : -6 }))
    const filtroLongo = filtroDoEnvelope(longo, 0)!
    const wavLongo = join(OUT, 'envelope-longo.wav')
    const script = join(OUT, 'envelope-longo.txt')
    writeFileSync(script, `[0:a]${filtroLongo}[o]`)
    await ff(['-y', '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=48000:duration=20', '-filter_complex_script', script, '-map', '[o]', '-c:a', 'pcm_s16le', wavLongo])
    ok('envelope de 1600 pontos passa no ffmpeg (grafo por arquivo)', existsSync(wavLongo), `${(filtroLongo.length / 1024).toFixed(0)} KB de expressao`)
  }

  // ================================================ 4/5. os dois videos
  const projeto = JSON.parse(readFileSync(PROJETO, 'utf8')) as {
    transcript: { words: Word[] }
    plan: { scenes: { start: number }[] }
  }
  const palavras = projeto.transcript.words
  const cortesReais = projeto.plan.scenes.map((s) => s.start)
  const nomeRasc = readdirSync(RECAPS).find((n) => /^rc_25d63d4babd6_.*\.json$/.test(n) && statSync(join(RECAPS, n)).size > 200_000)!
  const rasc = lerRascunho(JSON.parse(readFileSync(join(RECAPS, nomeRasc), 'utf8')))
  const secoesReais = secoesParaSom({ studio: { secoes: secoesDoTake(roteiroAtual(rasc)!, takeAtual(rasc)!, rasc.eventos) }, duracaoSec: 64.38 })

  // ---- o short sintetico: gancho [0-6,70] + 1,6 s + contexto [6,70-13,84] + 2,0 s + climax [50,78-57,45] + 0,6 s
  const pedacos = [
    { de: 0, ate: 6.7, pausa: 1.6, papel: 'gancho' as const },
    { de: 6.7, ate: 13.84, pausa: 2.0, papel: 'contexto' as const },
    { de: 50.78, ate: 57.45, pausa: 0.6, papel: 'climax' as const },
  ]
  const dirSint = join(OUT, 'sintetico')
  mkdirSync(dirSint, { recursive: true })
  const narrSint = join(dirSint, 'narracao.wav')
  {
    const partes = pedacos.map((p, k) => `[0:a]atrim=${p.de}:${p.ate},asetpts=PTS-STARTPTS[v${k}];aevalsrc=0:s=24000:d=${p.pausa}[p${k}]`)
    const juntar = pedacos.map((_, k) => `[v${k}][p${k}]`).join('') + `concat=n=${pedacos.length * 2}:v=0:a=1[o]`
    await ff(['-y', '-i', NARRACAO, '-filter_complex', [...partes, juntar].join(';'), '-map', '[o]', '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', narrSint])
  }
  const wordsSint: Word[] = []
  const secoesSint: SecaoParaSom[] = []
  const cortesSint: number[] = []
  {
    let off = 0
    for (const p of pedacos) {
      const desloca = off - p.de
      for (const w of palavras) {
        if (w.start >= p.de - 0.01 && w.end <= p.ate + 0.01) wordsSint.push({ ...w, start: w.start + desloca, end: w.end + desloca })
      }
      for (const c of cortesReais) if (c >= p.de - 0.01 && c < p.ate - 0.3) cortesSint.push(Math.max(c + desloca, 0))
      secoesSint.push({ papel: p.papel, inicio: off, fim: off + p.ate - p.de + p.pausa })
      off += p.ate - p.de + p.pausa
    }
  }
  const duracaoSint = (await medirSomDetalhado(narrSint)).durationSec

  const casos = [
    { nome: 'sintetico', dir: dirSint, narracao: narrSint, words: wordsSint, cortes: cortesSint, secoes: secoesSint, duracao: duracaoSint },
    { nome: 'S4-37', dir: join(OUT, 's437'), narracao: NARRACAO, words: palavras, cortes: cortesReais, secoes: secoesReais, duracao: narr.durationSec },
  ]

  for (const caso of casos) {
    secao(`${caso.nome === 'sintetico' ? '4' : '5'}. ${caso.nome}: ${f2(caso.duracao)} s, ${caso.words.length} palavras, ${caso.secoes.length} partes, ${caso.cortes.length} cortes`)
    anota(`--- ${caso.nome} (${f2(caso.duracao)} s) ---`)
    mkdirSync(caso.dir, { recursive: true })

    // O plano, pelo mesmo caminho do app (forca a musica: o caso nao depende do historico).
    const plano: PlanoDeSom = await planejarSom({
      sfx: true,
      musica: true,
      duracaoSec: caso.duracao,
      cortes: caso.cortes,
      secoes: caso.secoes,
      evitarMusicas: [],
      musicaForcada: musicas.find((m) => /Konoha/i.test(m)) ?? musicas[0]!,
      // Como o app: cada SFX tambem abaixo da voz NAQUELE instante.
      vozPath: caso.narracao,
    })
    for (const s of plano.sfx) anota(`SFX ${s.tipo.padEnd(7)} marca ${f2(s.marcaSec)} s  entra ${f2(s.at)} s  [${f2(s.inSec)}-${f2(s.outSec)}] de ${f2(s.durationSec)} s  ${s.ganhoDb} dB  (${s.motivo})`)
    anota(`musica ${plano.musica?.arquivo.split(/[\\/]/).pop()}  ${plano.musica?.ganhoDb} dB (trecho ${f1(plano.musica?.lufsIntegrado)} LUFS)  avisos: ${plano.avisos.join(' | ') || '-'}`)

    const whoosh = plano.sfx.filter((s) => s.tipo === 'whoosh')
    const impactos = plano.sfx.filter((s) => s.tipo === 'impacto')
    const viradas = caso.secoes.length - 1
    ok('whoosh so nas viradas de parte', whoosh.length <= viradas && whoosh.length >= Math.min(viradas, 2), `${whoosh.length} whoosh / ${viradas} viradas`)
    ok('impacto so no gancho e no climax', impactos.length === caso.secoes.filter((s, k) => (s.papel === 'gancho' || s.papel === 'climax') && (k === 0 || caso.secoes[k - 1]!.papel !== s.papel)).length, `${impactos.length} impactos`)
    const marcas = new Set(plano.sfx.map((s) => s.marcaSec.toFixed(3)))
    const inicios = caso.secoes.map((s) => s.inicio)
    ok(
      'NAO ha som em todo corte: so nas viradas de parte (e no 0)',
      [...marcas].every((m) => Number(m) === 0 || inicios.some((i) => Math.abs(i - Number(m)) <= REGRAS_DE_SOM_PADRAO.imaDoCorteSec + 1e-3)),
      `${marcas.size} cortes com som / ${caso.cortes.length} cortes`,
    )
    const picos = new Map<string, number>()
    for (const s of whoosh) picos.set(s.arquivo, (await medirSomDetalhado(s.arquivo)).picoSec)
    ok(
      'o pico do whoosh cai 40 ms antes da virada',
      whoosh.every((s) => Math.abs(s.at + picos.get(s.arquivo)! - s.inSec - (s.marcaSec - REGRAS_DE_SOM_PADRAO.whooshAntesDoCorteSec)) < 0.011),
    )
    ok('a virada gruda num corte de bloco', whoosh.every((s) => caso.cortes.some((c) => Math.abs(c - s.marcaSec) < 1e-3)))
    ok('sobra: o trecho guarda o arquivo inteiro', plano.sfx.every((s) => s.durationSec >= s.outSec && s.outSec > s.inSec))
    ok('musica com fades e ducking', plano.musica !== null && plano.musica.fadeInSec > 0 && plano.musica.fadeOutSec > 0 && plano.musica.ducking.abaixoDb > 0)

    const trilhas = trilhasDoPlanoDeSom(plano, { duracaoSec: caso.duracao, faixas: faixasDaEdicaoRapida([]), prefixoId: 'er' })
    const mixar = trilhas.map((t) => trilhaParaMixar(t, caso.words, caso.duracao))
    const musicaMix = mixar.filter((_, k) => trilhas[k]!.papel === 'musica')
    const sfxMix = mixar.filter((_, k) => trilhas[k]!.papel !== 'musica')
    ok('a musica vai para o mix com envelope', musicaMix.length > 0 && musicaMix.every((t) => (t.envelope?.length ?? 0) > 2), `${musicaMix[0]?.envelope?.length ?? 0} pontos`)

    // Video mudo do tamanho certo (o mux copia o video).
    const video = join(caso.dir, 'video.mp4')
    await ff(['-y', '-f', 'lavfi', '-i', `color=c=black:s=180x320:r=30:d=${caso.duracao.toFixed(3)}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video])
    const silencio = join(caso.dir, 'silencio.wav')
    await ff(['-y', '-f', 'lavfi', '-i', `anullsrc=r=24000:cl=mono`, '-t', caso.duracao.toFixed(3), '-c:a', 'pcm_s16le', silencio])

    const versao = async (nome: string, narracao: string, lista: typeof mixar): Promise<string> => {
      const dir = join(caso.dir, nome)
      mkdirSync(dir, { recursive: true })
      const v = join(dir, 'video.mp4')
      writeFileSync(v, readFileSync(video))
      const saida = join(caso.dir, `${nome}.mp4`)
      await muxWithNormalizedAudio(v, narracao, saida, [], null, lista, caso.duracao)
      return saida
    }
    const tMix = Date.now()
    const mix = await versao('mix', caso.narracao, mixar)
    const msMix = Date.now() - tMix
    const soVoz = await versao('so-voz', caso.narracao, [])
    const soMusica = await versao('so-musica', silencio, musicaMix)
    const soMusicaPlana = await versao('so-musica-plana', silencio, musicaMix.map(({ envelope: _e, ...t }) => t))
    const soSfx = await versao('so-sfx', silencio, sfxMix)
    ok('o mix completo renderiza', existsSync(mix), `${msMix} ms`)

    // ---- LUFS integrado e pico
    const eMix = await ebur128(mix)
    const eVoz = await ebur128(soVoz)
    const eMus = await ebur128(soMusica)
    const pAmostra = await picoDeAmostra(mix)
    anota(`mix: I ${f1(eMix.I)} LUFS, LRA ${f1(eMix.LRA)} LU, pico verdadeiro ${f1(eMix.TPK)} dBTP, pico de amostra ${f1(pAmostra)} dBFS`)
    anota(`so a voz: I ${f1(eVoz.I)} LUFS (pico ${f1(eVoz.TPK)} dBTP) -- o render de sempre`)
    anota(`so a musica: I ${f1(eMus.I)} LUFS (pico ${f1(eMus.TPK)} dBTP)`)
    ok('voz sozinha perto de -14 LUFS integrado', Math.abs(eVoz.I + 14) <= 0.8, `${f1(eVoz.I)} LUFS`)
    ok('mix perto de -14 LUFS integrado (a voz manda)', Math.abs(eMix.I + 14) <= 0.8 && eMix.I - eVoz.I < 0.6, `${f1(eMix.I)} LUFS, +${f2(eMix.I - eVoz.I)} LU sobre a voz`)
    ok('pico verdadeiro do mix <= -1 dBTP', eMix.TPK <= -1.0, `${f1(eMix.TPK)} dBTP`)
    ok('sem clipar (pico de amostra < 0 dBFS)', pAmostra < 0, `${f1(pAmostra)} dBFS`)
    ok('musica bem abaixo da voz', eVoz.I - eMus.I >= 14, `${f1(eVoz.I - eMus.I)} LU abaixo`)

    // ---- ducking: a razao com/sem envelope, por sub-bloco de 10 ms
    const env = envelopeDeDucking(caso.words, caso.duracao, plano.musica!.ducking)
    const dComDuck = await energia(soMusica)
    const dPlana = await energia(soMusicaPlana)
    const fadeIn = plano.musica!.fadeInSec
    const fadeOut = plano.musica!.fadeOutSec
    const util = (t: number): boolean => t > fadeIn + 0.05 && t < caso.duracao - fadeOut - 0.05
    const naFala = (t: number): boolean => util(t) && ganhoDoEnvelope(env, t) <= -plano.musica!.ducking.abaixoDb + 0.01
    const naPausa = (t: number): boolean => util(t) && ganhoDoEnvelope(env, t) >= -0.01
    const ganhoMedido = (sel: (t: number) => boolean): number => lufsDe(dComDuck.e, dComDuck.h, sel) - lufsDe(dPlana.e, dPlana.h, sel)
    const duckFala = ganhoMedido(naFala)
    const duckPausa = ganhoMedido(naPausa)
    // Os respiros (fim de frase): o topo de cada "lombada" do envelope entre falas.
    const topos: number[] = []
    for (let i = 1; i + 1 < env.length; i++) {
      const p = env[i]!
      if (p.db > env[i - 1]!.db && p.db > env[i + 1]!.db && p.db < -0.01 && util(p.t)) topos.push(p.t)
    }
    const subidaRespiro = topos.length > 0 ? topos.map((t) => ganhoMedido((x) => Math.abs(x - t) < 0.025)).reduce((a, b) => a + b, 0) / topos.length : NaN
    // Janelas de 50 ms com musica audivel: o AAC das duas versoes espalha
    // transiente diferente em 10 ms, e em trecho quase mudo a razao e ruido.
    let erroEnv = 0
    let tErro = 0
    {
      const J = Math.min(dComDuck.e.length, dPlana.e.length)
      let eMaxPlana = 0
      for (let j = 0; j + 5 <= J; j += 5) {
        let s = 0
        for (let k = j; k < j + 5; k++) s += dPlana.e[k]!
        eMaxPlana = Math.max(eMaxPlana, s)
      }
      for (let j = 0; j + 5 <= J; j += 5) {
        let a = 0
        let b = 0
        let esperado = 0
        for (let k = j; k < j + 5; k++) {
          a += dComDuck.e[k]!
          b += dPlana.e[k]!
          esperado += dPlana.e[k]! * 10 ** (ganhoDoEnvelope(env, (k + 0.5) * 0.01) / 10)
        }
        const t = (j + 2.5) * 0.01
        if (!util(t) || b < eMaxPlana * 10 ** (-35 / 10)) continue
        const erro = Math.abs(10 * Math.log10(a / esperado))
        if (erro > erroEnv) {
          erroEnv = erro
          tErro = t
        }
      }
    }
    const lufsFala = lufsDe(dComDuck.e, dComDuck.h, naFala)
    const lufsPausa = lufsDe(dComDuck.e, dComDuck.h, naPausa)
    const tempoPausa = Array.from({ length: Math.round(caso.duracao * 100) }, (_, j) => (j + 0.5) * 0.01).filter(naPausa).length / 100
    anota(`ducking medido (com/sem envelope): ${f2(duckFala)} dB na fala, ${f2(duckPausa)} dB nas pausas (${f2(tempoPausa)} s de pausa), ${topos.length} respiros de fim de frase subindo ${f2(subidaRespiro + plano.musica!.ducking.abaixoDb)} dB; erro max x envelope ${f2(erroEnv)} dB (em ${f2(tErro)} s, janelas de 50 ms)`)
    anota(`musica no mix: ${f1(lufsFala)} LUFS sob a fala, ${f1(lufsPausa)} LUFS nas pausas (voz ${f1(eVoz.I)})`)
    ok('ducking: a musica desce o abaixoDb inteiro na fala', Math.abs(duckFala + plano.musica!.ducking.abaixoDb) < 0.3, `${f2(duckFala)} dB`)
    if (tempoPausa > 0.5) ok('ducking: nas pausas longas ela volta a 0 dB', Math.abs(duckPausa) < 0.3, `${f2(duckPausa)} dB`)
    if (topos.length > 0) ok('ducking: sobe um pouco nos fins de frase', subidaRespiro > -plano.musica!.ducking.abaixoDb + 1, `+${f2(subidaRespiro + plano.musica!.ducking.abaixoDb)} dB`)
    ok('ducking do render = envelope do preview (ganhoDoEnvelope)', erroEnv < 0.5, `erro max ${f2(erroEnv)} dB em ${f2(tErro)} s (janela de 50 ms, depois do AAC)`)

    // ---- SFX em momentaneo contra a voz
    const dSfx = await energia(soSfx)
    const dVoz = await energia(soVoz)
    // Uma medida por MARCA: whoosh + impacto na mesma virada soam juntos.
    const porMarca = new Map<string, typeof plano.sfx>()
    for (const s of plano.sfx) {
      const k = s.marcaSec.toFixed(2)
      porMarca.set(k, [...(porMarca.get(k) ?? []), s])
    }
    for (const grupo of porMarca.values()) {
      const de = Math.min(...grupo.map((s) => s.at))
      const ate = Math.max(...grupo.map((s) => s.at + s.outSec - s.inSec))
      const m = momentaneoMax(dSfx.e, dSfx.h, de, ate + 0.4)
      const vozAli = momentaneoEm(dVoz.e, dVoz.h, m.t)
      const nome = grupo.map((s) => s.tipo).join('+')
      anota(
        `${nome.padEnd(14)} em ${f2(grupo[0]!.marcaSec)} s: M max ${f1(m.lufs)} LUFS = ${f1(eVoz.I - m.lufs)} LU abaixo da voz integrada, ${f1(vozAli - m.lufs)} LU abaixo da voz naquele instante (${f1(vozAli)})`,
      )
      // O alvo de cada um, dividido em potencia entre os da mesma marca, somado.
      const n = grupo.length
      const alvo = 10 * Math.log10(grupo.reduce((acc, s) => acc + 10 ** ((REGRAS_DE_SOM_PADRAO.vozLufs - REGRAS_DE_SOM_PADRAO.abaixoDaVozLu[s.tipo] - 10 * Math.log10(n)) / 10), 0))
      // A voz NAQUELE instante so abaixa o SFX (avaliacao de 14/10: a virada no
      // fim baixo de uma frase deixava o whoosh 3 LU abaixo da voz ali).
      const abaixoAli = vozAli - m.lufs
      ok(`${nome} em ${f2(grupo[0]!.marcaSec)} s nunca acima do alvo (${f1(alvo)} LUFS momentaneo)`, m.lufs <= alvo + 1.0, `${f1(m.lufs)} LUFS`)
      ok(
        `${nome} em ${f2(grupo[0]!.marcaSec)} s no alvo, ou abaixado pela voz daquele instante`,
        Math.abs(m.lufs - alvo) <= 1.0 || abaixoAli >= Math.min(...grupo.map((x) => REGRAS_DE_SOM_PADRAO.abaixoDaVozLu[x.tipo])) - 2.5,
        `${f1(m.lufs)} LUFS, ${f1(abaixoAli)} LU abaixo da voz ali`,
      )
      ok(`${nome} em ${f2(grupo[0]!.marcaSec)} s BEM BAIXO (>= 10 LU abaixo da voz integrada)`, eVoz.I - m.lufs >= 10, `${f1(eVoz.I - m.lufs)} LU`)
      ok(`${nome} em ${f2(grupo[0]!.marcaSec)} s BEM BAIXO tambem ali (>= 10 LU abaixo da voz naquele instante)`, abaixoAli >= 10, `${f1(abaixoAli)} LU`)
    }
  }

  // ================================ 5c. a voz NAQUELE instante (2 whoosh)
  // Avaliacao de 14/10: com o whoosh nas 5 viradas, o da virada climax >
  // fechamento (61,47 s) caia no fim baixo de "Stone." e ficava so 3-4,5 LU
  // abaixo da voz ali. Com 2 arquivos de whoosh as 5 viradas voltam (rodizio),
  // e o mesmo S4-37 e medido com e sem a narracao no plano (vozPath).
  secao('5c. S4-37 com 2 whoosh (as 5 viradas): o SFX contra a voz NAQUELE instante')
  {
    const dir = join(OUT, 'voz-local')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(UD, 'sfx', 'whoosh-b.mp3'), readFileSync(join(SFX_DO_APP, 'whoosh.mp3')))
    const duracao = narr.durationSec
    const video = join(dir, 'video.mp4')
    await ff(['-y', '-f', 'lavfi', '-i', `color=c=black:s=180x320:r=30:d=${duracao.toFixed(3)}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video])
    const silencio = join(dir, 'silencio.wav')
    await ff(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', duracao.toFixed(3), '-c:a', 'pcm_s16le', silencio])
    const soVoz = join(dir, 'so-voz.mp4')
    await muxWithNormalizedAudio(video, NARRACAO, soVoz, [], null, [], duracao)
    const dVoz = await energia(soVoz)
    const medirPlano = async (nome: string, vozPath: string | null): Promise<{ marca: number; abaixoAli: number; m: number }[]> => {
      const plano = await planejarSom({ sfx: true, musica: false, duracaoSec: duracao, cortes: cortesReais, secoes: secoesReais, evitarMusicas: [], musicaForcada: null, vozPath })
      const trilhas = trilhasDoPlanoDeSom(plano, { duracaoSec: duracao, faixas: faixasDaEdicaoRapida([]), prefixoId: 'er' }).map((t) => trilhaParaMixar(t, palavras, duracao))
      const v = join(dir, `${nome}-video.mp4`)
      writeFileSync(v, readFileSync(video))
      const saida = join(dir, `${nome}-so-sfx.mp4`)
      await muxWithNormalizedAudio(v, silencio, saida, [], null, trilhas, duracao)
      const dSfx = await energia(saida)
      const porMarca = new Map<string, typeof plano.sfx>()
      for (const x of plano.sfx) porMarca.set(x.marcaSec.toFixed(2), [...(porMarca.get(x.marcaSec.toFixed(2)) ?? []), x])
      const lista: { marca: number; abaixoAli: number; m: number }[] = []
      for (const grupo of porMarca.values()) {
        const de = Math.min(...grupo.map((x) => x.at))
        const ate = Math.max(...grupo.map((x) => x.at + x.outSec - x.inSec))
        const m = momentaneoMax(dSfx.e, dSfx.h, de, ate + 0.4)
        // A voz no instante do maximo do SFX (como a avaliacao mediu: 61,80 e
        // 61,86 s) e o pior das janelas a 60 ms dele.
        const vozAli = momentaneoEm(dVoz.e, dVoz.h, m.t)
        let pior = Number.POSITIVE_INFINITY
        for (let dt = -0.06; dt <= 0.0601; dt += 0.03) pior = Math.min(pior, momentaneoEm(dVoz.e, dVoz.h, m.t + dt))
        lista.push({ marca: grupo[0]!.marcaSec, abaixoAli: vozAli - m.lufs, m: m.lufs })
        anota(
          `${nome.padEnd(9)} ${grupo.map((x) => `${x.tipo} ${x.ganhoDb} dB`).join(' + ').padEnd(28)} em ${f2(grupo[0]!.marcaSec)} s: M max ${f1(m.lufs)} LUFS, ${f1(vozAli - m.lufs)} LU abaixo da voz ali (${f1(vozAli)}; pior janela a 60 ms: ${f1(pior - m.lufs)} LU)`,
        )
      }
      return lista
    }
    const sem = await medirPlano('sem-voz', null)
    const com = await medirPlano('com-voz', NARRACAO)
    ok('com 2 whoosh, as 5 viradas tem whoosh (rodizio)', com.length >= 6, `${com.length} marcas`)
    const fechamentoSem = sem.find((x) => Math.abs(x.marca - 61.5) < 0.6)
    const fechamentoCom = com.find((x) => Math.abs(x.marca - 61.5) < 0.6)
    ok(
      'sem a voz no plano reproduz a avaliacao: o whoosh do fechamento fica perto da voz ali',
      fechamentoSem !== undefined && fechamentoSem.abaixoAli < 8,
      `${f1(fechamentoSem?.abaixoAli ?? NaN)} LU`,
    )
    ok(
      'com a voz no plano: o whoosh do fechamento fica >= 10 LU abaixo da voz ali',
      fechamentoCom !== undefined && fechamentoCom.abaixoAli >= 10,
      `${f1(fechamentoCom?.abaixoAli ?? NaN)} LU`,
    )
    ok('com a voz no plano: TODO SFX >= 10 LU abaixo da voz ali', com.every((x) => x.abaixoAli >= 10), com.map((x) => f1(x.abaixoAli)).join(' / '))
    ok('o do fechamento deixa de ser o ponto fora da curva (no maximo 3 LU pior que a mediana dos outros)', (() => {
      const outros = com.filter((x) => x !== fechamentoCom).map((x) => x.abaixoAli).sort((a, b) => a - b)
      const mediana = outros[Math.floor(outros.length / 2)] ?? 0
      return fechamentoCom !== undefined && fechamentoCom.abaixoAli >= mediana - 3
    })())
    ok(
      'o do fechamento desce mais que todos (a frase em volta e baixa); os outros, no maximo 3 LU',
      fechamentoCom !== undefined &&
        fechamentoSem !== undefined &&
        fechamentoSem.m - fechamentoCom.m >= 5 &&
        com.filter((x) => x !== fechamentoCom).every((x) => sem.some((y) => Math.abs(y.marca - x.marca) < 0.01 && y.m - x.m < 3 && y.m - x.m > -0.6)),
      com.map((x) => `${f2(x.marca)}: -${f1((sem.find((y) => Math.abs(y.marca - x.marca) < 0.01)?.m ?? NaN) - x.m)} LU`).join(' / '),
    )
    rmSync(join(UD, 'sfx', 'whoosh-b.mp3'), { force: true })
  }

  // ============================================ 5b. a outra musica (phonk)
  secao('5b. A outra musica (phonk, -6,4 LUFS no arquivo): mesmo nivel no mix?')
  {
    const phonk = musicas.find((m) => /GALACTICO/i.test(m))
    if (phonk) {
      const dir = join(OUT, 'phonk')
      mkdirSync(dir, { recursive: true })
      const plano = await planejarSom({ sfx: false, musica: true, duracaoSec: duracaoSint, cortes: cortesSint, secoes: secoesSint, evitarMusicas: [], musicaForcada: phonk })
      const trilhas = trilhasDoPlanoDeSom(plano, { duracaoSec: duracaoSint, faixas: faixasDaEdicaoRapida([]), prefixoId: 'er' }).map((t) =>
        trilhaParaMixar(t, wordsSint, duracaoSint),
      )
      const video = join(dir, 'video.mp4')
      await ff(['-y', '-f', 'lavfi', '-i', `color=c=black:s=180x320:r=30:d=${duracaoSint.toFixed(3)}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video])
      const silencio = join(dir, 'silencio.wav')
      await ff(['-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', duracaoSint.toFixed(3), '-c:a', 'pcm_s16le', silencio])
      const saida = join(OUT, 'phonk-so-musica.mp4')
      await muxWithNormalizedAudio(video, silencio, saida, [], null, trilhas, duracaoSint)
      const env = envelopeDeDucking(wordsSint, duracaoSint, plano.musica!.ducking)
      const d = await energia(saida)
      const util = (t: number): boolean => t > plano.musica!.fadeInSec + 0.05 && t < duracaoSint - plano.musica!.fadeOutSec - 0.05
      const fala = lufsDe(d.e, d.h, (t) => util(t) && ganhoDoEnvelope(env, t) <= -plano.musica!.ducking.abaixoDb + 0.01)
      const pausa = lufsDe(d.e, d.h, (t) => util(t) && ganhoDoEnvelope(env, t) >= -0.01)
      anota(`phonk: ${plano.musica!.ganhoDb} dB (trecho ${f1(plano.musica!.lufsIntegrado)} LUFS) -> ${f1(fala)} LUFS sob a fala, ${f1(pausa)} LUFS nas pausas`)
      ok('a phonk cai no mesmo alvo (nivel pelo LUFS do trecho)', Math.abs(pausa - (REGRAS_DE_SOM_PADRAO.vozLufs - REGRAS_DE_SOM_PADRAO.musica.abaixoDaVozLu)) <= 2.5, `${f1(pausa)} LUFS nas pausas`)
    }
  }

  // ======================================================= 6. limitador
  secao('6. Sem clipar: uma faixa alta DE PROPOSITO (a phonk a 0 dB, pico +5,5 dBTP no arquivo)')
  {
    const alta = musicas.find((m) => /GALACTICO/i.test(m)) ?? musicas[0]!
    const dir = join(OUT, 'limitador')
    mkdirSync(dir, { recursive: true })
    const video = join(dir, 'video.mp4')
    await ff(['-y', '-f', 'lavfi', '-i', `color=c=black:s=180x320:r=30:d=${duracaoSint.toFixed(3)}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video])
    const saida = join(OUT, 'limitador.mp4')
    const trecho = { path: alta, at: 0, inicioSec: 20, duracaoSec: duracaoSint, gainDb: 0, fadeInSec: 0, fadeOutSec: 0 }
    await muxWithNormalizedAudio(video, narrSint, saida, [], null, [trecho], duracaoSint)
    const e = await ebur128(saida)
    const pa = await picoDeAmostra(saida)
    anota(`limitador: phonk a 0 dB por baixo da voz -> I ${f1(e.I)} LUFS, pico verdadeiro ${f1(e.TPK)} dBTP, pico de amostra ${f1(pa)} dBFS`)
    ok('com a soma passando de 0 dBFS, o mix fica <= -1 dBTP', e.TPK <= -1.0, `${f1(e.TPK)} dBTP`)
    ok('e sem amostra clipada', pa < -0.5, `${f1(pa)} dBFS`)
  }

  writeFileSync(join(OUT, 'medidas.txt'), `${relatorio.join('\n')}\n`)
  console.log(`\n${total - falhas}/${total} ok${falhas ? ` -- ${falhas} FALHA(S)` : ''}`)
  console.log(`relatorio: ${join(OUT, 'medidas.txt')}`)
  process.exitCode = falhas ? 1 : 0
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
