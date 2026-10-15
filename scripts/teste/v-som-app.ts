/**
 * O SOM DA EDICAO RAPIDA NO APP DE VERDADE (agente A, 14/10), por CDP:
 *
 *  1. monta uma COPIA do .anirecap do S4-37 com as trilhas da Edicao rapida
 *     (planejarSom + trilhasDoPlanoDeSom, como a montagem faz), narracao
 *     copiada para a pasta de saida (o render grava ao lado dela);
 *  2. abre no app (openProject, o caminho do Dangai) e confere que as trilhas
 *     chegaram com papel e ducking;
 *  3. toca o PREVIEW e amostra o volume do <audio> da musica: tem que seguir
 *     ganho + desconto da voz + envelope (o mesmo ganhoDoEnvelope do render);
 *  4. RENDERIZA pelo startRender do store (o botao Renderizar) e mede o MP4:
 *     integrado, pico verdadeiro, musica sob a fala.
 *
 * Use a SUA instancia (perfil temporario, porta livre):
 *   npx electron-vite dev -- --remote-debugging-port=9361 --user-data-dir=<pasta temporaria>
 *   npx esbuild scripts/teste/v-som-app.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json --outfile=out/teste/v-som-app.cjs && node out/teste/v-som-app.cjs
 * PORTA=9361 por padrao. RENDER=0 pula o render. Escreve so em
 * scratchpad/edicao-rapida/som-app.
 */
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  envelopeDeDucking,
  faixasDaEdicaoRapida,
  ganhoDoEnvelope,
  secoesDoTake,
  secoesParaSom,
  trilhasDoPlanoDeSom,
} from '../../shared/edicao-rapida'
import { duracaoDoTrecho, type Word } from '../../shared/contract'
import { monoEmDoisCanais } from '../../shared/loudness'
import { lerRascunho, roteiroAtual } from '../../shared/roteiro'
import { takeAtual } from '../../shared/voz'
import { ffmpegPath } from '../../electron/services/ffmpeg-path'
import { configureSettings } from '../../electron/services/settings'
import { configureSfx, ensureSfxDir } from '../../electron/services/sfx'
import { configurarSom, medirSomDetalhado } from '../../electron/services/som/medir'
import { usarPastaDeMusicasNoTeste } from '../../electron/services/som/musicas'
import { planejarSom } from '../../electron/services/som/planejar'
import { readdirSync, statSync } from 'node:fs'

const PORTA = process.env['PORTA'] ?? '9361'
const SCRATCH = 'C:/Users/levic/AppData/Local/Temp/claude/G--ClaudeEditor/ea8ba0e5-233c-49c4-9613-b7db2f0cff9f/scratchpad'
const OUT = join(SCRATCH, 'edicao-rapida', 'som-app')
const PROJ_DIR = join(SCRATCH, 'f1p4', 'reaud', 'bib', '_projetos', 'Dr. Stone S04E37 - 2026-10-14 18h00')
const RECAPS = join(SCRATCH, 'f1p4', 'reaud', 'ud', 'recaps')
const SFX_DO_APP = join(process.cwd(), 'assets', 'sfx')

let falhas = 0
const ok = (nome: string, cond: boolean, detalhe = ''): void => {
  if (!cond) falhas++
  console.log(`  ${cond ? 'ok  ' : 'FALHA'} ${nome}${detalhe ? `  (${detalhe})` : ''}`)
}

function ff(args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const c = spawn(ffmpegPath, ['-nostdin', '-hide_banner', ...args], { windowsHide: true })
    let err = ''
    c.stderr.on('data', (d: Buffer) => (err += d.toString()))
    c.on('error', reject)
    c.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(err.slice(-400)))))
  })
}

// ------------------------------------------------------------------- CDP
let ws: WebSocket
let seq = 0
const pendentes = new Map<number, (m: { result?: { result?: { value?: unknown }; exceptionDetails?: { exception?: { description?: string } } } }) => void>()
async function conectar(): Promise<void> {
  const alvos = (await (await fetch(`http://127.0.0.1:${PORTA}/json/list`)).json()) as { type: string; url: string; webSocketDebuggerUrl: string }[]
  const pagina = alvos.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
  if (!pagina) throw new Error('Janela do app nao encontrada')
  ws = new WebSocket(pagina.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(String(e.data)) as { id: number }
    pendentes.get(m.id)?.(m as never)
    pendentes.delete(m.id)
  })
}
function enviar(method: string, params: object = {}): Promise<{ result?: { result?: { value?: unknown }; exceptionDetails?: { exception?: { description?: string } }; data?: string } }> {
  return new Promise((resolve) => {
    const id = ++seq
    pendentes.set(id, resolve as never)
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function avaliar<T>(expr: string): Promise<T> {
  const r = await enviar('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'erro no app')
  return r.result?.result?.value as T
}
async function print(nome: string): Promise<string> {
  const r = await enviar('Page.captureScreenshot', { format: 'png' })
  const caminho = join(OUT, nome)
  writeFileSync(caminho, Buffer.from((r.result as { data: string }).data, 'base64'))
  return caminho
}
const espera = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  // ------------------------------------------------ 1. a copia com trilhas
  console.log('1. Copia do S4-37 com as trilhas da Edicao rapida')
  const UD = join(OUT, 'ud-node')
  mkdirSync(UD, { recursive: true })
  configureSettings(UD)
  configureSfx({ userDir: join(UD, 'sfx'), bundledDir: SFX_DO_APP })
  ensureSfxDir()
  configurarSom({ userData: UD, reservaDeSfx: SFX_DO_APP })
  usarPastaDeMusicasNoTeste('G:/App Resumo/music')

  const original = JSON.parse(readFileSync(join(PROJ_DIR, 'Dr. Stone S04E37.anirecap'), 'utf8')) as Record<string, unknown> & {
    audio: { path: string; rel: string | null; fileName: string }
    transcript: { words: Word[] }
    plan: { scenes: { start: number }[] }
  }
  const wav = join(OUT, 'Dr. Stone S04E37.wav')
  if (!existsSync(wav)) copyFileSync(join(PROJ_DIR, 'Dr. Stone S04E37.wav'), wav)
  const voz = await medirSomDetalhado(wav)
  const nomeRasc = readdirSync(RECAPS).find((n) => /^rc_25d63d4babd6_.*\.json$/.test(n) && statSync(join(RECAPS, n)).size > 200_000)!
  const rasc = lerRascunho(JSON.parse(readFileSync(join(RECAPS, nomeRasc), 'utf8')))
  const secoesStudio = secoesDoTake(roteiroAtual(rasc)!, takeAtual(rasc)!, rasc.eventos)
  const plano = await planejarSom({
    sfx: true,
    musica: true,
    duracaoSec: voz.durationSec,
    cortes: original.plan.scenes.map((s) => s.start),
    secoes: secoesParaSom({ studio: { secoes: secoesStudio }, duracaoSec: voz.durationSec }),
    evitarMusicas: [],
    musicaForcada: 'G:/App Resumo/music/Naruto - Afternoon of Konoha.mp3',
  })
  const trilhas = trilhasDoPlanoDeSom(plano, { duracaoSec: voz.durationSec, faixas: faixasDaEdicaoRapida([]), prefixoId: 'er' })
  const projeto = join(OUT, 'S4-37 som.anirecap')
  writeFileSync(
    projeto,
    JSON.stringify({
      ...original,
      audio: { path: wav, rel: null, fileName: 'Dr. Stone S04E37.wav' },
      trilhas,
      studio: { ...(original['studio'] as object), secoes: secoesStudio },
    }),
  )
  ok('projeto com trilhas', trilhas.length > 0, `${trilhas.filter((t) => t.papel === 'musica').length} musica, ${trilhas.filter((t) => t.papel !== 'musica').length} SFX`)

  // ------------------------------------------------ 2. abre no app
  console.log('2. openProject no app')
  await conectar()
  for (let i = 0; i < 60; i++) {
    if (await avaliar<boolean>(`return typeof window.dangaiStore === 'function'`)) break
    await espera(1000)
  }
  await avaliar(`await window.dangaiStore.getState().openProject(${JSON.stringify(projeto)}); return true`)
  for (let i = 0; i < 60; i++) {
    const pronto = await avaliar<boolean>(`const s = window.dangaiStore.getState(); return !!s.audio && s.images.length > 0 && s.trilhas.every((t) => !!t.url)`)
    if (pronto) break
    await espera(1000)
  }
  const noApp = await avaliar<{ papel?: string; ducking?: unknown; url: string; gainDb: number }[]>(
    `return window.dangaiStore.getState().trilhas.map((t) => ({ papel: t.papel, ducking: t.ducking ?? null, url: t.url, gainDb: t.gainDb }))`,
  )
  ok('as trilhas chegaram no store com papel', noApp.length === trilhas.length && noApp.every((t) => !!t.papel))
  ok('a musica com ducking', noApp.filter((t) => t.papel === 'musica').every((t) => t.ducking !== null))
  const medidaApp = await avaliar<{ ok: boolean; value?: { lufsIntegrado: number; canais?: number } }>(`return await window.dangai.medirSom(${JSON.stringify(wav)})`)
  ok('medirSom pelo IPC: narracao mono em -23', medidaApp.ok && medidaApp.value?.canais === 1 && Math.abs((medidaApp.value?.lufsIntegrado ?? 0) + 23) < 0.2, JSON.stringify(medidaApp.value ?? medidaApp))
  await espera(1500)
  console.log(`     print: ${await print('editor-com-trilhas.png')}`)

  // ------------------------------------------------ 3. preview
  console.log('3. Preview: o volume do <audio> da musica segue ganho + desconto + envelope')
  const musica = trilhas.find((t) => t.papel === 'musica')!
  const urlMusica = noApp.find((t) => t.papel === 'musica')!.url
  const vozDb = voz.lufsIntegrado! + monoEmDoisCanais(voz.canais ?? 2) - -14
  const env = envelopeDeDucking(original.transcript.words, voz.durationSec, musica.ducking!)
  await avaliar(`const s = window.dangaiStore.getState(); s.setPlayhead?.(0); s.setPlaying(true); return true`)
  const amostras: { t: number; v: number }[] = []
  const t0 = Date.now()
  while (Date.now() - t0 < 9000) {
    const a = await avaliar<{ t: number; v: number; pausado: boolean } | null>(
      `const el = [...document.querySelectorAll('audio')].find((x) => x.src === ${JSON.stringify(urlMusica)}); return el ? { t: el.currentTime, v: el.volume, pausado: el.paused } : null`,
    )
    if (a && !a.pausado) amostras.push({ t: a.t, v: a.v })
    await espera(30)
  }
  await avaliar(`window.dangaiStore.getState().setPlaying(false); return true`)
  const esperado = (local: number): number => {
    const toca = duracaoDoTrecho(musica)
    let fade = 1
    if (musica.fadeInSec > 0 && local < musica.fadeInSec) fade = Math.max(0, local / musica.fadeInSec)
    if (musica.fadeOutSec > 0 && local > toca - musica.fadeOutSec) fade = Math.min(fade, (toca - local) / musica.fadeOutSec)
    return Math.min(1, 10 ** ((musica.gainDb + vozDb + ganhoDoEnvelope(env, musica.at + local)) / 20) * fade)
  }
  // O volume e escrito a cada 40 ms: o valor lido pode ser de ate ~70 ms antes.
  const erros = amostras
    .filter((a) => a.t - musica.inicioSec > musica.fadeInSec + 0.1)
    .map((a) => {
      const local = a.t - musica.inicioSec
      let melhor = Infinity
      for (let lag = 0; lag <= 0.08; lag += 0.005) melhor = Math.min(melhor, Math.abs(20 * Math.log10(a.v / esperado(local - lag))))
      return melhor
    })
    .sort((a, b) => a - b)
  const p50 = erros[Math.floor(erros.length / 2)] ?? NaN
  const p95 = erros[Math.floor(erros.length * 0.95)] ?? NaN
  ok('o preview tocou a musica', amostras.length > 30, `${amostras.length} amostras em 9 s`)
  ok('volume do preview = ganho + desconto da voz + envelope', p95 < 0.6, `erro mediano ${p50.toFixed(2)} dB, p95 ${p95.toFixed(2)} dB; desconto da voz ${vozDb.toFixed(1)} dB`)
  // Depois do fade de entrada: o que muda ai e so o ducking.
  const faixa = amostras.filter((a) => a.t - musica.inicioSec > musica.fadeInSec + 0.1 && a.v > 0).map((a) => 20 * Math.log10(a.v))
  ok('a musica desce e sobe (ducking audivel no preview)', Math.max(...faixa) - Math.min(...faixa) > 1.5, `volume do <audio> entre ${Math.min(...faixa).toFixed(1)} e ${Math.max(...faixa).toFixed(1)} dB`)
  writeFileSync(join(OUT, 'preview-amostras.json'), JSON.stringify(amostras))

  // ------------------------------------------------ 4. render
  if (process.env['RENDER'] !== '0') {
    console.log('4. startRender (o botao Renderizar)')
    const tr = Date.now()
    const saida = await avaliar<string | null>(`return await window.dangaiStore.getState().startRender()`)
    const erro = await avaliar<string | null>(`return window.dangaiStore.getState().error ?? null`)
    ok('render terminou', typeof saida === 'string' && existsSync(saida), `${((Date.now() - tr) / 1000).toFixed(0)} s: ${saida ?? erro}`)
    if (saida) {
      const err = await ff(['-nostats', '-i', saida, '-vn', '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'])
      const I = Number(/I:\s*(-?[\d.]+) LUFS/.exec(err.slice(err.lastIndexOf('Summary')))?.[1])
      const TP = Number(/True peak:\s*[\r\n]+\s*Peak:\s*(-?[\d.]+)/.exec(err)?.[1])
      console.log(`     MP4 do app: I ${I.toFixed(1)} LUFS, pico verdadeiro ${TP.toFixed(1)} dBTP`)
      ok('MP4 do app: voz manda em -14 LUFS', Math.abs(I + 14) < 0.8, `${I.toFixed(1)} LUFS`)
      ok('MP4 do app: pico verdadeiro <= -1 dBTP', TP <= -1, `${TP.toFixed(1)} dBTP`)
    }
  }

  ws.close()
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO OK')
  process.exitCode = falhas ? 1 : 0
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
  try {
    ws?.close()
  } catch {
    /* ja fechado */
  }
})
