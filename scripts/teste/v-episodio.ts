/**
 * O passo 1 do "Gerar recap" (Episodio) sem interface, com os episodios REAIS
 * da maquina do Levi, so lendo:
 *
 * - ACHADO: [SubsPlease] Dr. Stone S4 - 37, que o Corte Cenas ja cortou em
 *   G:/App Corte Cenas/Output/Dr. Stone/S04E37 (shot_bounds.json.source = ele);
 * - NOVO: Dr.STONE.S04E24 VARYG (Netflix), que nao esta em biblioteca nenhuma;
 * - S4 - 36 (SubsPlease), so para a marcacao de OP/ED por serie.
 *
 * O que confere:
 * 1. sondar os dois (medidas, faixas, legenda sugerida, capitulos, palpite);
 * 2. tirar e ler a legenda (falas, falantes mais frequentes, ultimo cue);
 * 3. procurar o ACHADO (tem que achar o Corte Cenas pelo source) e o NOVO (nada);
 * 4. indexar o ACHADO e conferir 5 falas sorteadas QUADRO A QUADRO: o quadro do
 *    .mkv no meio da fala tem que ser o mesmo do mp4 da cena que contem a
 *    fala, no mesmo instante -- e diferente do de outra cena;
 *    depois reaproveitar o indice, salvar exclusoes, refazer (herda as
 *    confirmadas e guarda o anterior) e a marcacao da serie no S4 - 36;
 * 5. sugerir OP/ED nos dois;
 * 6. Biblioteca do editor com a raiz do Studio (sintetica, numa pasta temporaria);
 * 7. G:/App Corte Cenas e %LOCALAPPDATA%/CorteCenas nao mudaram: listagem com
 *    tamanho e mtime antes e depois.
 *
 * Tudo que o teste grava vai para uma pasta temporaria (userData e biblioteca
 * do Studio falsos). Rodar da raiz do projeto:
 *   npx esbuild scripts/teste/v-episodio.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json | node
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { lerIndice, resumirIndice, type Cue, type EpisodeIndex } from '../../shared/episodio'
import { sugerirOpEd } from '../../shared/oped'
import { ffmpegPath } from '../../electron/services/ffmpeg-path'
import { configureLibrary, scanLibrary } from '../../electron/services/library'
import { configureSettings, getSettings, saveSettings, type Cofre } from '../../electron/services/settings'
import { escanearBibliotecaDoEditor } from '../../electron/services/episodio/biblioteca-editor'
import { configurarEpisodios, indexarEpisodio, salvarExclusoes } from '../../electron/services/episodio/indice'
import { lerFaixa } from '../../electron/services/episodio/legenda'
import { procurarEpisodio, raizesDeBiblioteca } from '../../electron/services/episodio/procurar'
import { sondarArquivo, sondarEpisodio } from '../../electron/services/episodio/sondar'

const ACHADO = 'C:/Users/levic/Downloads/[SubsPlease] Dr. Stone S4 - 37 (1080p) [477E9A74].mkv'
const NOVO = 'C:/Users/levic/Downloads/Dr.STONE.S04E24.Whole.New.World.1080p.NF.WEB-DL.AAC2.0.H.264-VARYG.mkv'
const SERIE = 'C:/Users/levic/Downloads/[SubsPlease] Dr. Stone S4 - 36 (1080p) [999A00BE].mkv'
const PASTA_DO_CORTE_CENAS = 'G:\\App Corte Cenas\\Output\\Dr. Stone\\S04E37'
const PROTEGIDAS = ['G:\\App Corte Cenas', join(process.env['LOCALAPPDATA'] ?? '', 'CorteCenas')]

let falhas = 0
function confere(ok: boolean, mensagem: string): void {
  if (ok) console.log(`  ok  ${mensagem}`)
  else {
    falhas += 1
    console.log(`  FALHOU  ${mensagem}`)
  }
}
function secao(titulo: string): void {
  console.log(`\n== ${titulo}`)
}
const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

// ------------------------------------------------------------ fotografia do disco

/** Cada arquivo e pasta com tamanho e mtime. So le (readdir + stat). */
function fotografar(raiz: string): Map<string, string> {
  const mapa = new Map<string, string>()
  const andar = (pasta: string): void => {
    let entradas: import('node:fs').Dirent[]
    try {
      entradas = readdirSync(pasta, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entradas) {
      const caminho = join(pasta, e.name)
      try {
        const s = statSync(caminho)
        mapa.set(caminho, `${e.isDirectory() ? 'd' : s.size}|${s.mtimeMs}`)
      } catch {
        mapa.set(caminho, 'sumiu')
      }
      if (e.isDirectory()) andar(caminho)
    }
  }
  andar(raiz)
  return mapa
}

function diferencas(antes: Map<string, string>, depois: Map<string, string>): string[] {
  const saida: string[] = []
  for (const [k, v] of antes) if (depois.get(k) !== v) saida.push(`${depois.has(k) ? 'mudou' : 'sumiu'}: ${k}`)
  for (const k of depois.keys()) if (!antes.has(k)) saida.push(`novo: ${k}`)
  return saida
}

// ------------------------------------------------------------------ quadros

/** Um quadro em 48x27 cinza, no instante `t` do arquivo. */
function quadro(arquivo: string, t: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const filho = spawn(
      ffmpegPath,
      ['-v', 'error', '-ss', t.toFixed(3), '-i', arquivo, '-frames:v', '1', '-vf', 'scale=48:27,format=gray', '-f', 'rawvideo', '-'],
      { windowsHide: true },
    )
    const partes: Buffer[] = []
    filho.stdout.on('data', (c: Buffer) => partes.push(c))
    filho.on('error', reject)
    filho.on('close', () => resolve(Buffer.concat(partes)))
  })
}

/** Diferenca media por pixel (0 a 255). */
function diferenca(a: Buffer, b: Buffer): number {
  const n = Math.min(a.length, b.length)
  if (n === 0) return 255
  let soma = 0
  for (let i = 0; i < n; i += 1) soma += Math.abs(a[i]! - b[i]!)
  return soma / n
}

/** Sorteio repetivel (LCG), para o teste escolher as mesmas falas toda vez. */
function sorteador(semente: number): () => number {
  let s = semente >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

// ------------------------------------------------------------- biblioteca falsa

/** Um episodio sintetico no formato do AnCut: 2 cenas de 1 s, keyframes e shots.json. */
function episodioSintetico(pasta: string, anime: string, inicio = 0): void {
  mkdirSync(join(pasta, 'shots'), { recursive: true })
  mkdirSync(join(pasta, 'keyframes'), { recursive: true })
  mkdirSync(join(pasta, 'metadata'), { recursive: true })
  const linhas = []
  for (const [i, cor] of [['0001', 'red'], ['0002', 'blue']] as const) {
    const mp4 = join(pasta, 'shots', `${i}.mp4`)
    spawnSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${cor}:s=64x36:d=1`, '-pix_fmt', 'yuv420p', mp4])
    spawnSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${cor}:s=64x36:d=1`, '-frames:v', '1', join(pasta, 'keyframes', `${i}_1.jpg`)])
    const n = Number(i) - 1
    linhas.push({
      shot_id: i,
      file: `shots/${i}.mp4`,
      keyframe: `keyframes/${i}_1.jpg`,
      start: inicio + n,
      end: inicio + n + 1,
      duration: 1,
      characters: n === 0 ? [{ name: 'Senku', confidence: 0.9 }] : [],
      anime,
      season: 4,
      episode: 37,
    })
  }
  writeFileSync(join(pasta, 'metadata', 'shots.json'), JSON.stringify(linhas, null, 2))
}

// ======================================================================= main

async function main(): Promise<void> {
  const t0 = Date.now()
  console.log('Fotografando as pastas protegidas (antes)...')
  const antes = PROTEGIDAS.map(fotografar)
  console.log(`  ${antes.map((m) => m.size).join(' + ')} entradas em ${((Date.now() - t0) / 1000).toFixed(1)} s`)

  const temp = mkdtempSync(join(tmpdir(), 'v-episodio-'))
  const userData = join(temp, 'userData')
  const bibliotecaStudio = join(temp, 'Biblioteca')
  mkdirSync(userData, { recursive: true })
  const cofreFalso: Cofre = {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.alloc(0),
    decryptString: () => '',
  }
  configureSettings(userData, cofreFalso)
  saveSettings({ bibliotecaStudio, libraryDir: '' })
  configurarEpisodios(userData)
  configureLibrary(userData)

  try {
    // ------------------------------------------------------------- 1. sondar
    secao('1. Sondar os dois episodios reais')
    for (const arquivo of [ACHADO, NOVO]) {
      const t = Date.now()
      const s = await sondarEpisodio(arquivo)
      const ms = Date.now() - t
      console.log(`  ${basename(arquivo)}  (${ms} ms)`)
      console.log(`    id ${s.id}`)
      console.log(
        `    ${s.largura}x${s.altura} ${s.codec} ${s.fps.toFixed(3)} fps, ${s.duracaoSec}s, start ${s.startTimeSec}, hdr ${s.hdr}`,
      )
      console.log(`    palpite (${s.palpiteOrigem}): ${s.palpite.anime} S${s.palpite.temporada}E${s.palpite.episodio}${s.palpite.kind}`)
      console.log(
        `    legendas: ${s.legendas.map((f) => `${f.index}:${f.codec}:${f.idioma}${f.nome ? `:${f.nome}` : ''}${f.default ? ':D' : ''}${f.forced ? ':F' : ''}`).join('  ')}`,
      )
      console.log(`    sugerida: ${s.legendaSugerida}   capitulos: ${s.capitulos.map((c) => `${c.titulo}@${mmss(c.start)}`).join(', ') || '(nenhum)'}`)
      confere(/^ep_[0-9a-f]{40}$/.test(s.id), 'impressao no formato ep_<sha1>')
      confere(s.palpite.anime.toLowerCase().replace(/[^a-z]/g, '') === 'drstone' && s.palpite.temporada === 4, 'palpite Dr Stone S4')
      const de = await sondarArquivo(arquivo)
      confere(de.id === s.id, 'a impressao se repete (mesmo arquivo, mesmo id)')
    }

    // ------------------------------------------------------------- 2. legenda
    secao('2. Tirar e ler a legenda')
    const cuesPorArquivo = new Map<string, { cues: Cue[]; duracao: number; capitulos: Awaited<ReturnType<typeof sondarArquivo>>['capitulos'] }>()
    for (const arquivo of [ACHADO, NOVO, SERIE]) {
      const s = await sondarArquivo(arquivo)
      const faixa = s.legendas.find((f) => f.index === s.legendaSugerida)!
      const t = Date.now()
      const { cues, formato } = await lerFaixa(arquivo, s.id, faixa, s.startTimeSec)
      const falas = cues.filter((c) => c.tipo === 'fala')
      const porFalante = new Map<string, number>()
      for (const c of falas) if (c.falante) porFalante.set(c.falante, (porFalante.get(c.falante) ?? 0) + 1)
      const top = [...porFalante.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
      const tipos = { fala: 0, placa: 0, musica: 0 }
      for (const c of cues) tipos[c.tipo] += 1
      console.log(`  ${basename(arquivo)}  faixa ${faixa.index} (${formato}), ${Date.now() - t} ms`)
      console.log(`    ${cues.length} cues: ${tipos.fala} falas, ${tipos.placa} placas, ${tipos.musica} musica`)
      console.log(`    falantes: ${top.map(([n, q]) => `${n} ${q}`).join(', ') || '(nenhum: .srt)'}`)
      const ultima = cues[cues.length - 1]!
      console.log(`    ultima: ${ultima.id} ${mmss(ultima.start)} "${ultima.texto.slice(0, 60)}"`)
      confere(cues.every((c, i) => c.id === `c${String(i + 1).padStart(4, '0')}`), 'ids c0001... em ordem')
      confere(cues.every((c, i) => i === 0 || c.start >= cues[i - 1]!.start), 'cues em ordem de inicio')
      cuesPorArquivo.set(arquivo, { cues, duracao: s.duracaoSec, capitulos: s.capitulos })
    }
    const e37 = cuesPorArquivo.get(ACHADO)!.cues
    confere(e37.filter((c) => c.tipo === 'fala' && c.falante === 'Senku').length >= 30, 'S4-37: Senku com 30+ falas pelo campo Name')
    confere(e37.some((c) => c.tipo === 'placa' && c.texto === 'Ushers of an Exhilarating Future'), 'S4-37: titulo do episodio (Name Text) vira placa')
    const e24 = cuesPorArquivo.get(NOVO)!.cues
    confere(e24[e24.length - 1]!.texto.includes('Silvia Tomey'), 'S04E24 (.srt sem linha em branco no fim): o ultimo cue nao se perde')

    // ------------------------------------------------------------- 3. procurar
    secao('3. Procurar nas bibliotecas')
    console.log(`  raizes: ${raizesDeBiblioteca().map((r) => `${r.origem}=${r.pasta}`).join('  ')}`)
    const sAchado = await sondarEpisodio(ACHADO)
    let t = Date.now()
    const achados = await procurarEpisodio(ACHADO, sAchado.palpite)
    console.log(`  ACHADO: ${achados.length} resultado(s) em ${Date.now() - t} ms`)
    for (const a of achados) {
      console.log(
        `    ${a.comoAchou} | ${a.origem} | ${a.pasta} | ${a.totalCenas} cenas | ${a.personagens.slice(0, 5).map((p) => `${p.nome} ${p.cenas}`).join(', ')}`,
      )
    }
    const doCorteCenas = achados[0]
    confere(
      !!doCorteCenas && doCorteCenas.comoAchou === 'source' && doCorteCenas.origem === 'cortecenas' &&
        doCorteCenas.pasta.toLowerCase() === PASTA_DO_CORTE_CENAS.toLowerCase(),
      'achou o Corte Cenas pelo source, em primeiro',
    )
    const mp4s = readdirSync(join(PASTA_DO_CORTE_CENAS, 'shots')).filter((n) => n.endsWith('.mp4')).length
    confere(doCorteCenas?.totalCenas === mp4s, `totalCenas = mp4 que existem em shots/ (${mp4s})`)
    confere((doCorteCenas?.personagens.length ?? 0) > 0, 'personagens contados do shots.json')

    const sNovo = await sondarEpisodio(NOVO)
    t = Date.now()
    const novos = await procurarEpisodio(NOVO, sNovo.palpite)
    console.log(`  NOVO: ${novos.length} resultado(s) em ${Date.now() - t} ms`)
    confere(novos.length === 0, 'o NOVO nao esta em biblioteca nenhuma')

    // ------------------------------------------------------------- 4. indexar
    secao('4. Indexar o ACHADO (biblioteca externa, indice na do Studio)')
    const progresso: string[] = []
    t = Date.now()
    const indice = await indexarEpisodio(
      { path: ACHADO, pastaDoEpisodio: doCorteCenas!.pasta, origem: doCorteCenas!.origem, palpite: sAchado.palpite },
      (m) => progresso.push(m),
    )
    console.log(`  ${Date.now() - t} ms: ${progresso.join(' > ')}`)
    const caminhoDoIndice = join(bibliotecaStudio, '_indices', indice.id, 'episodio.json')
    confere(existsSync(caminhoDoIndice), `gravado em <bibliotecaStudio>/_indices/${indice.id.slice(0, 11)}.../episodio.json`)
    confere(!existsSync(join(PASTA_DO_CORTE_CENAS, 'episodio.json')), 'nada gravado na pasta do Corte Cenas')
    lerIndice(JSON.parse(readFileSync(caminhoDoIndice, 'utf8')))
    confere(true, 'o arquivo gravado passa no episodeIndexSchema')
    const resumo = resumirIndice(indice)
    console.log(
      `  ${resumo.totalCenas} cenas (${resumo.cenasComFala} com fala), ${resumo.totalFalas} falas, reconhecimento ${indice.reconhecimento}`,
    )
    console.log(`  falantes: ${resumo.falantes.slice(0, 5).map((f) => `${f.nome} ${f.falas}`).join(', ')}`)
    console.log(`  personagens: ${resumo.personagens.slice(0, 5).map((p) => `${p.nome} ${p.cenas}`).join(', ')}`)
    console.log(`  avisos: ${indice.avisos.join(' | ') || '(nenhum)'}`)
    for (const e of indice.exclusoes) console.log(`  exclusao ${e.motivo} ${mmss(e.start)}-${mmss(e.end)} (${e.origem}): ${e.porque}`)

    // 5 falas sorteadas, conferidas quadro a quadro
    const sorteio = sorteador(37)
    const elegiveis = indice.cues.filter((c) => {
      if (c.tipo !== 'fala') return false
      const meio = (c.start + c.end) / 2
      return indice.planos.some((p) => p.start + 0.3 <= meio && meio < p.end - 0.3)
    })
    const escolhidas: Cue[] = []
    while (escolhidas.length < 5 && elegiveis.length > 0) {
      const c = elegiveis.splice(Math.floor(sorteio() * elegiveis.length), 1)[0]!
      escolhidas.push(c)
    }
    console.log('  conferencia de tempo (diferenca media por pixel, 0-255):')
    for (const cue of escolhidas) {
      const meio = (cue.start + cue.end) / 2
      const i = indice.planos.findIndex((p) => p.start <= meio && meio < p.end)
      const plano = indice.planos[i]!
      const outro = indice.planos[i + 4] ?? indice.planos[i - 4]!
      const doMkv = await quadro(ACHADO, meio)
      const daCena = await quadro(plano.arquivo, meio - plano.start)
      const deOutra = await quadro(outro.arquivo, (outro.end - outro.start) / 2)
      const dCena = diferenca(doMkv, daCena)
      const dOutra = diferenca(doMkv, deOutra)
      console.log(
        `    ${cue.id} ${mmss(cue.start)} (${cue.falante ?? '-'}) "${cue.texto.slice(0, 40)}" -> cena ${plano.id} [${plano.start.toFixed(2)}-${plano.end.toFixed(2)}]: mesma ${dCena.toFixed(1)}, outra(${outro.id}) ${dOutra.toFixed(1)}`,
      )
      confere(plano.cueIds.includes(cue.id), `${cue.id} esta nos cueIds da cena ${plano.id}`)
      confere(dCena < 12 && dCena * 2 < dOutra, `${cue.id}: o quadro da cena ${plano.id} e o do .mkv no tempo da fala`)
    }

    // reaproveitar
    const deNovo = await indexarEpisodio(
      { path: ACHADO, pastaDoEpisodio: doCorteCenas!.pasta, origem: doCorteCenas!.origem, palpite: sAchado.palpite },
      () => {},
    )
    confere(deNovo.criadoEm === indice.criadoEm, 'segunda vez: reaproveita o indice salvo (mesmo criadoEm)')

    // procurar de novo: agora o Corte Cenas aponta para o indice do Studio
    const comIndice = await procurarEpisodio(ACHADO, sAchado.palpite)
    confere(comIndice[0]?.indice === caminhoDoIndice, 'a busca mostra o indice do Studio que aponta para a pasta')

    // salvar exclusoes: confirma a OP sugerida e marca um trecho manual
    const op = indice.exclusoes.find((e) => e.motivo === 'op')!
    const ed = indice.exclusoes.find((e) => e.motivo === 'ed')!
    const salvo = await salvarExclusoes(indice.id, [
      { ...op, confirmada: true },
      { ...ed, start: ed.start + 2, origem: 'usuario', confirmada: true },
      { start: 600, end: 610, motivo: 'manual', origem: 'usuario', confirmada: true, porque: '' },
    ])
    confere(salvo.exclusoes.length === 3 && salvo.exclusoes.every((e) => e.confirmada), 'salvarExclusoes troca a lista e grava')
    confere(salvo.atualizadoEm !== indice.atualizadoEm, 'atualizadoEm muda')
    const series = JSON.parse(readFileSync(join(userData, 'episodios', 'series.json'), 'utf8')) as { series: Record<string, unknown> }
    confere(Object.keys(series.series).some((k) => k.startsWith('dr stone|s4')), 'OP/ED confirmadas guardadas como marcacao da serie')

    // refazer: herda as confirmadas, guarda o anterior
    const refeito = await indexarEpisodio(
      { path: ACHADO, pastaDoEpisodio: doCorteCenas!.pasta, origem: doCorteCenas!.origem, palpite: sAchado.palpite, refazer: true },
      () => {},
    )
    const backups = readdirSync(join(bibliotecaStudio, '_indices', indice.id)).filter((n) => /^episodio\.\d{8}-\d{6}(-\d+)?\.json$/.test(n))
    confere(backups.length === 1, `refazer guarda o anterior (${backups.join(', ')})`)
    confere(
      refeito.exclusoes.filter((e) => e.confirmada).length === 3 && refeito.exclusoes.every((e) => e.confirmada),
      'refazer herda as 3 confirmadas e nao repete a sugestao que cai em cima delas',
    )

    // o mesmo .mkv cortado pelo Studio (pasta sintetica): o indice mora ao
    // lado de shots/ e as confirmadas do indice externo vem junto
    const pastaDoStudio = join(bibliotecaStudio, 'Dr Stone', 'S04E37')
    episodioSintetico(pastaDoStudio, 'Dr. STONE', 300)
    const doStudio = await indexarEpisodio(
      { path: ACHADO, pastaDoEpisodio: pastaDoStudio, origem: 'studio', palpite: sAchado.palpite },
      () => {},
    )
    confere(existsSync(join(pastaDoStudio, 'episodio.json')), 'origem studio: episodio.json ao lado de shots/')
    confere(
      doStudio.exclusoes.filter((e) => e.confirmada).length === 3,
      'o Studio herda as confirmadas do indice que o mesmo .mkv tinha no Corte Cenas',
    )
    let recusou = ''
    try {
      await indexarEpisodio(
        { path: ACHADO, pastaDoEpisodio: PASTA_DO_CORTE_CENAS, origem: 'studio', palpite: sAchado.palpite },
        () => {},
      )
    } catch (e) {
      recusou = (e as Error).message
    }
    confere(recusou.startsWith('O Studio nao grava em'), 'origem studio apontando para o Corte Cenas: recusado antes de gravar')
    rmSync(pastaDoStudio, { recursive: true, force: true })

    // ------------------------------------------------------------- 5. OP/ED
    secao('5. OP/ED sugeridas')
    for (const arquivo of [ACHADO, NOVO]) {
      const { cues, duracao, capitulos } = cuesPorArquivo.get(arquivo)!
      const sugestoes = sugerirOpEd({ duracaoSec: duracao, capitulos, cues })
      console.log(`  ${basename(arquivo)}:`)
      for (const s of sugestoes) console.log(`    ${s.motivo} ${mmss(s.start)}-${mmss(s.end)} [${s.origem}] ${s.porque}`)
      confere(sugestoes.some((s) => s.motivo === 'op') && sugestoes.some((s) => s.motivo === 'ed'), 'sugere uma OP e um ED')
      confere(sugestoes.every((s) => /^[\x20-\x7e]*$/.test(s.porque)), 'porque em ASCII')
    }
    const opE37 = sugerirOpEd({ duracaoSec: cuesPorArquivo.get(ACHADO)!.duracao, capitulos: [], cues: e37 }).find((s) => s.motivo === 'op')!
    confere(opE37.start > 120 && opE37.start < 160 && opE37.end > 220 && opE37.end < 250, 'S4-37 (SubsPlease, sem capitulo): OP pelo vao depois do prologo')
    const vary = sugerirOpEd({ duracaoSec: cuesPorArquivo.get(NOVO)!.duracao, capitulos: cuesPorArquivo.get(NOVO)!.capitulos, cues: e24 })
    confere(vary.find((s) => s.motivo === 'op')?.origem === 'capitulo', 'S04E24 (Netflix): OP pelo capitulo "Intro"')

    // a marcacao da serie no episodio 36
    const s36 = await sondarArquivo(SERIE)
    const indice36Serie = sugerirOpEd({
      duracaoSec: s36.duracaoSec,
      capitulos: s36.capitulos,
      cues: cuesPorArquivo.get(SERIE)!.cues,
      serie: {
        episodio: 'S04E37',
        duracaoSec: indice.fonte.duracaoSec,
        exclusoes: salvo.exclusoes.filter((e) => e.motivo !== 'manual'),
      },
    })
    console.log('  [SubsPlease] Dr. Stone S4 - 36, com a marcacao confirmada no S04E37:')
    for (const s of indice36Serie) console.log(`    ${s.motivo} ${mmss(s.start)}-${mmss(s.end)} [${s.origem}] ${s.porque}`)
    confere(indice36Serie.some((s) => s.porque.includes('S04E37')), 'a marcacao da serie entra na sugestao do episodio seguinte')

    // ------------------------------------------------------------- 6. Biblioteca do editor
    secao('6. Biblioteca do editor com a raiz do Studio')
    const usuario = join(temp, 'BibliotecaDoUsuario')
    episodioSintetico(join(usuario, 'Dr. Stone', 'S04E37'), 'Dr. STONE')
    const publicar = (p: string): string => `media://${p}`

    // so a do usuario (studio vazio): igual ao scanLibrary de sempre
    saveSettings({ libraryDir: usuario })
    const soUsuario = await escanearBibliotecaDoEditor(publicar, () => {})
    const direto = await scanLibrary(usuario, publicar, () => {})
    confere(
      JSON.stringify(soUsuario.clips.map((c) => c.id)) === JSON.stringify(direto.clips.map((c) => c.id)) &&
        soUsuario.clips.every((c) => !c.id.startsWith('studio:')),
      'Studio vazio: o mesmo resultado do Dangai, ids sem prefixo',
    )

    // as duas
    episodioSintetico(join(bibliotecaStudio, 'Dr Stone', 'S04E24'), 'Dr. STONE', 100)
    episodioSintetico(join(bibliotecaStudio, 'Dr. Stone', 'S04E37'), 'Dr. STONE')
    const juntas = await escanearBibliotecaDoEditor(publicar, () => {})
    const ids = juntas.clips.map((c) => c.id)
    console.log(`  ${juntas.clips.length} cenas, ${juntas.episodes} episodios: ${ids.join(', ')}`)
    confere(ids.includes('Dr. Stone/S04E37/0001') && ids.includes('studio:Dr. Stone/S04E37/0001'), 'o mesmo id relativo nas duas raizes nao colide (studio: na frente)')
    confere(new Set(ids).size === ids.length, 'nenhum id repetido')
    confere(!ids.some((i) => i.includes('_indices')), 'a pasta _indices nao aparece na Biblioteca')
    const cache = JSON.parse(readFileSync(join(userData, 'library-cache.json'), 'utf8')) as { episodes: Record<string, unknown> }
    const chaves = Object.keys(cache.episodes)
    confere(chaves.some((k) => k.startsWith(usuario)) && chaves.some((k) => k.startsWith(bibliotecaStudio)), 'o library-cache.json guarda as duas raizes')
    // uma varredura so da do usuario (como o etiquetador faz) nao apaga a do Studio
    await scanLibrary(usuario, publicar, () => {})
    const cache2 = JSON.parse(readFileSync(join(userData, 'library-cache.json'), 'utf8')) as { episodes: Record<string, unknown> }
    confere(Object.keys(cache2.episodes).some((k) => k.startsWith(bibliotecaStudio)), 'varrer so a libraryDir mantem o cache do Studio')

    // so a do Studio
    saveSettings({ libraryDir: '' })
    const soStudio = await escanearBibliotecaDoEditor(publicar, () => {})
    // dois episodios sinteticos de 2 cenas cada
    confere(soStudio.clips.length === 4 && soStudio.clips.every((c) => c.id.startsWith('studio:')), 'sem libraryDir: so a do Studio')

    // nenhuma das duas: o erro de sempre
    saveSettings({ bibliotecaStudio: join(temp, 'vazia') })
    let erro = ''
    try {
      await escanearBibliotecaDoEditor(publicar, () => {})
    } catch (e) {
      erro = (e as Error).message
    }
    confere(erro.startsWith('Nenhuma biblioteca escolhida.'), 'sem nenhuma das duas: o mesmo erro do Dangai')
    saveSettings({ bibliotecaStudio })
    void getSettings
  } finally {
    // ----------------------------------------------------------- 7. protegidas
    secao('7. As pastas protegidas nao mudaram')
    const depois = PROTEGIDAS.map(fotografar)
    for (const [i, raiz] of PROTEGIDAS.entries()) {
      const dif = diferencas(antes[i]!, depois[i]!)
      for (const d of dif.slice(0, 10)) console.log(`    ${d}`)
      confere(dif.length === 0, `${raiz}: ${antes[i]!.size} entradas, nenhuma mudou (tamanho e mtime)`)
    }
    rmSync(temp, { recursive: true, force: true })
  }

  console.log(`\n${falhas === 0 ? 'tudo certo' : `${falhas} falha(s)`} em ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  if (falhas > 0) process.exit(1)
}

void (async () => {
  try {
    await main()
  } catch (e) {
    console.error(e)
    process.exit(1)
  }
})()

export type { EpisodeIndex }
