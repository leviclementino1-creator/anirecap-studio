/**
 * O projeto montado ABERTO NO APP DE VERDADE, por CDP: o caminho normal do
 * Dangai (openProject -> applyProjectFile -> importImages com o foco salvo ->
 * legendas refeitas), a guarda de reanalise no store real e o startRender do
 * store (o mesmo botao "Renderizar").
 *
 * Use a SUA instancia (perfil temporario, porta livre):
 *   npx electron-vite dev -- --remote-debugging-port=9347 --user-data-dir=<pasta temporaria>
 *   node scripts/teste/v-montar-app.mjs "<...>/Dr. Stone S04E37.anirecap" [pasta de saida]
 * PORTA=9347 por padrao. Grava so os prints na pasta de saida (e o render, ao
 * lado da narracao do projeto, como o app faz).
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

const PORTA = process.env.PORTA ?? '9347'
const PROJETO = process.argv[2]
const SAIDA = process.argv[3] ?? dirname(PROJETO)
if (!PROJETO) throw new Error('Passe o caminho do .anirecap')

const alvos = await (await fetch(`http://127.0.0.1:${PORTA}/json/list`)).json()
const pagina = alvos.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'))
if (!pagina) throw new Error('Janela do app nao encontrada')
const ws = new WebSocket(pagina.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let seq = 0
const pendentes = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  pendentes.get(m.id)?.(m)
  pendentes.delete(m.id)
})
const enviar = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq
    pendentes.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
async function avaliar(expr) {
  const r = await enviar('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'erro no app')
  return r.result?.result?.value
}
async function print(nome) {
  const r = await enviar('Page.captureScreenshot', { format: 'png' })
  const caminho = join(SAIDA, nome)
  writeFileSync(caminho, Buffer.from(r.result.data, 'base64'))
  return caminho
}

let falhas = 0
const confere = (ok, msg) => {
  if (!ok) falhas += 1
  console.log(`  ${ok ? 'ok' : 'FALHOU'}  ${msg}`)
}

for (let i = 0; i < 60; i++) {
  if (await avaliar(`return typeof window.dangaiStore === 'function'`)) break
  await new Promise((r) => setTimeout(r, 1000))
}

// Com RASCUNHO (o rascunho esta no perfil desta instancia): monta pelo IPC
// de verdade (window.dangai.montarProjeto -> main) na pasta pedida, e abre o
// que ele devolveu. Sem RASCUNHO: abre o .anirecap passado.
let projeto = PROJETO
if (process.env.RASCUNHO) {
  console.log('0. montarProjeto pelo IPC')
  const tm = Date.now()
  const r = await avaliar(`return await window.dangai.montarProjeto(${JSON.stringify(process.env.RASCUNHO)}, { pasta: ${JSON.stringify(PROJETO)} })`)
  confere(r?.ok === true, `montado em ${((Date.now() - tm) / 1000).toFixed(1)} s: ${r?.ok ? r.value.projetoPath : r?.error}`)
  if (r?.ok) projeto = r.value.projetoPath
}

console.log('1. openProject (o caminho do Dangai)')
const t0 = Date.now()
await avaliar(`await window.dangaiStore.getState().openProject(${JSON.stringify(projeto)}); return true`)
const estado = await avaliar(`
  const s = window.dangaiStore.getState()
  return {
    erro: s.error, busy: s.busy, studio: s.studio, blocos: s.plan?.scenes.length ?? 0, imagens: s.images.length,
    // O import de clipe com foco salvo nao guarda a marca focusAuto (regra do
    // Dangai); o que conta e o enquadramento que voltou.
    videos: s.images.filter((i) => i.kind === 'video').length, rostos: s.images.filter((i) => i.focusX !== 0.5 || i.focusY !== 0.5).length,
    fonte: s.transcript?.source, alinhado: s.transcript?.alinhado, palavras: s.transcript?.words.length,
    legendas: s.captions.length, ligadas: s.captionsEnabled, gancho: s.hookText, audio: s.audio?.fileName,
    duracao: s.audio?.durationSec, sourceStarts: s.plan?.scenes.slice(0, 4).map((c) => c.sourceStart),
  }`)
console.log(`  aberto em ${((Date.now() - t0) / 1000).toFixed(1)} s`)
confere(estado.erro === null, `sem erro (${estado.erro ?? 'nenhum'}); busy: ${estado.busy ?? 'livre'}`)
confere(estado.studio?.vozAlinhada === true, `studio no estado: take ${estado.studio?.takeId}, rascunho ${estado.studio?.rascunhoId}`)
confere(estado.blocos > 0 && estado.blocos === estado.imagens && estado.videos === estado.imagens, `${estado.blocos} blocos, ${estado.videos} clipes (kind video), ${estado.rostos} enquadrados pelo rosto`)
confere(estado.fonte === 'script' && estado.alinhado === true, `transcript ${estado.fonte}, alinhado, ${estado.palavras} palavras`)
confere(estado.legendas > 0 && estado.ligadas, `${estado.legendas} legendas refeitas pelo editor, ligadas`)
console.log(`  gancho "${estado.gancho}", audio ${estado.audio} (${estado.duracao?.toFixed(2)} s), sourceStart ${estado.sourceStarts?.map((v) => v.toFixed(2)).join(', ')}`)
console.log(`  print: ${await print('app-editor.png')}`)

console.log('2. guarda de reanalise no store real')
const antes = await avaliar(`return JSON.stringify(window.dangaiStore.getState().transcript.words.map((w) => w.start))`)
await avaliar(`const s = window.dangaiStore.getState(); await s.setScript(s.script); return true`)
const depois = await avaliar(`
  const s = window.dangaiStore.getState()
  return { starts: JSON.stringify(s.transcript.words.map((w) => w.start)), fonte: s.transcript.source, busy: s.busy, blocos: s.plan.scenes.length }`)
confere(depois.starts === antes && depois.fonte === 'script' && depois.blocos === estado.blocos, 'setScript: o transcript da voz ficou (sem Whisper), plano intacto')

console.log('3. startRender (o botao Renderizar)')
const t1 = Date.now()
const saida = await avaliar(`return await window.dangaiStore.getState().startRender()`)
const fim = await avaliar(`const s = window.dangaiStore.getState(); return { erro: s.error, ultimo: s.lastOutput }`)
console.log(`  ${saida} em ${((Date.now() - t1) / 1000).toFixed(0)} s`)
confere(typeof saida === 'string' && saida.endsWith('.mp4') && fim.erro === null, `render pronto (${fim.erro ?? 'sem erro'})`)
console.log(`  print: ${await print('app-depois-do-render.png')}`)
if (typeof saida === 'string') {
  const sonda = JSON.parse(
    spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate,nb_frames:format=duration', '-of', 'json', saida], { encoding: 'utf8' }).stdout,
  )
  const v = sonda.streams.find((s) => s.codec_type === 'video')
  const quadros = Math.ceil(estado.duracao * (24000 / 1001))
  confere(v.width === 1080 && v.height === 1920 && v.r_frame_rate === '24000/1001', `${v.width}x${v.height} a ${v.r_frame_rate}`)
  confere(Math.abs(Number(v.nb_frames) - quadros) <= 1, `${v.nb_frames} quadros = a voz (${quadros})`)
  const ebur = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', saida, '-map', '0:a', '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' }).stderr
  const lufs = Number(/Integrated loudness:\s+I:\s+(-?[\d.]+) LUFS/.exec(ebur)?.[1])
  confere(Math.abs(lufs + 14) <= 1, `${lufs} LUFS (alvo -14)`)
}

ws.close()
console.log(falhas === 0 ? '\nTUDO CERTO' : `\n${falhas} FALHA(S)`)
process.exitCode = falhas === 0 ? 0 : 1
