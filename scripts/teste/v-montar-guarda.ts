/**
 * A GUARDA DE REANALISE do store (src/store/project.ts + guarda-do-studio.ts),
 * no store DE VERDADE, com um window.dangai falso que anota as chamadas:
 *
 * Projeto do Gerar recap (`studio.vozAlinhada`, transcript alinhado):
 *   1. removeImage: nenhum analyze; o transcript e o MESMO objeto; o bloco sai
 *      e o tempo vai para o vizinho (sem plano provisorio);
 *   2. insertImages sem plano: nenhum analyze, transcript intacto;
 *   3. ingest de imagem: nenhum analyze; entra na agulha, os outros blocos
 *      ficam onde estavam;
 *   4. ingest de roteiro e setScript: "reescrever frases" -- texto novo com os
 *      tempos da voz, legendas refeitas, nenhum analyze; roteiro que nao bate
 *      fica de fora com aviso;
 *   5. toProjectFile leva o `studio` e passa no zod; openProject traz de volta;
 *   6. narracao nova no ingest desliga a guarda (vozAlinhada false) e o
 *      analyze do Dangai roda;
 *   8. tirar TODAS as cenas (o painel "Montar recap" aparece) e montar: o
 *      pedido leva o transcript do take, e o do estado continua o mesmo.
 * Projeto do Dangai (sem `studio`): removeImage e setScript chamam o analyze
 * como sempre, e o arquivo sai sem o campo.
 *
 * Nao escreve nada. Rodar da raiz do projeto:
 *   npx esbuild scripts/teste/v-montar-guarda.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.web.json | node
 */
import { chamadas, imagemFalsa, quantas, respostas, TRANSCRIPT_DO_WHISPER } from './v-montar-guarda-janela'
import type { AudioAnalysis, ScenePlan, Transcript } from '../../shared/contract'
import { buildCaptions } from '../../shared/plan'
import { projectFileSchema, type OrigemDoStudio } from '../../shared/project-file'
import { useProject } from '../../src/store/project'

let falhas = 0
function confere(ok: boolean, mensagem: string): void {
  if (ok) console.log(`  ok  ${mensagem}`)
  else {
    falhas += 1
    console.log(`  FALHOU  ${mensagem}`)
  }
}

const ROTEIRO = 'Senku liga o radio. Todos ouvem a voz.\n\nO reino da ciencia responde.'
const palavras = ['Senku', 'liga', 'o', 'radio.', 'Todos', 'ouvem', 'a', 'voz.', 'O', 'reino', 'da', 'ciencia', 'responde.']
const DA_VOZ: Transcript = {
  source: 'script',
  words: palavras.map((text, i) => ({ text, start: 0.2 + i * 0.85, end: 0.2 + i * 0.85 + 0.7, ...(i === 7 ? { paragraph: true } : {}) })),
  segments: [
    { text: 'Senku liga o radio.', start: 0.2, end: 3.45 },
    { text: 'Todos ouvem a voz.', start: 3.6, end: 6.85 },
    { text: 'O reino da ciencia responde.', start: 7, end: 11.1 },
  ],
  text: palavras.join(' '),
  cutCandidates: [],
  alinhado: true,
}
const ORIGEM: OrigemDoStudio = {
  rascunhoId: 'rc_25d63d4babd6_mv7cxp1z',
  episodioId: `ep_${'2'.repeat(40)}`,
  takeId: 't1',
  roteiroVersao: 3,
  vozAlinhada: true,
  geradoEm: '2026-10-14T18:00:00.000Z',
}
const AUDIO: AudioAnalysis = { path: 'C:/proj/narracao/narracao-0123456789abcdef.wav', fileName: 'narracao-0123456789abcdef.wav', url: 'http://x', durationSec: 12, peaks: [0.1] }

function cena(i: number, start: number, end: number): ScenePlan['scenes'][number] {
  return {
    imageIndex: i,
    imageIndexB: null,
    start,
    end,
    effect: 'zoom-in',
    intensity: 0.1,
    effectB: null,
    intensityB: null,
    curve: 'linear',
    curvePoints: null,
    camera: null,
    sourceStart: 1.5,
    sourceStartB: 0,
    rotation: 0,
    transitionIn: 'cut',
  }
}

/** Um projeto montado: 3 blocos, cortes nas fronteiras de frase. */
function abrirProjeto(studio: OrigemDoStudio | null): void {
  useProject.getState().reset()
  useProject.setState({
    audio: AUDIO,
    images: ['a.mp4', 'b.mp4', 'c.mp4'].map((p) => imagemFalsa(`C:/shots/${p}`)),
    plan: { scenes: [cena(0, 0, 3.52), cena(1, 3.52, 6.92), cena(2, 6.92, 12)] },
    planOrigin: 'auto',
    planEdited: true,
    transcript: DA_VOZ,
    captions: buildCaptions(DA_VOZ),
    captionsEdited: false,
    captionsEnabled: true,
    script: ROTEIRO,
    studio,
    playhead: 0,
  })
  chamadas.length = 0
}

const s = () => useProject.getState()

async function main(): Promise<void> {
  console.log('1. removeImage (Studio)')
  abrirProjeto(ORIGEM)
  const meio = s().images[1]!.id
  s().removeImage(meio)
  confere(quantas('analyze') === 0, 'nenhum analyze')
  confere(s().transcript === DA_VOZ, 'o transcript e o mesmo objeto (o da voz)')
  const p1 = s().plan
  confere(
    s().images.length === 2 && p1?.scenes.length === 2 && p1.scenes[0]!.end === 6.92 && p1.scenes[1]!.start === 6.92 && p1.scenes[1]!.imageIndex === 1,
    `o bloco saiu e o tempo foi para o vizinho: ${p1?.scenes.map((c) => `[${c.start}-${c.end}]#${c.imageIndex}`).join(' ')}`,
  )
  confere(p1?.scenes.every((c) => c.sourceStart === 1.5) === true && s().planOrigin === 'auto', 'sem plano provisorio: os ajustes dos blocos ficaram')

  console.log('2. insertImages sem plano (Studio)')
  abrirProjeto(ORIGEM)
  useProject.setState({ plan: null })
  await s().insertImages(['C:/novas/x.png'], 0)
  confere(quantas('analyze') === 0 && s().transcript === DA_VOZ, 'nenhum analyze, transcript intacto')
  confere(s().images.length === 4 && s().plan?.scenes.length === 4, 'a imagem entrou e o plano provisorio cobre as 4')

  console.log('3. ingest de imagem (Studio)')
  abrirProjeto(ORIGEM)
  useProject.setState({ playhead: 5 })
  await s().ingest(['C:/novas/y.png'])
  confere(quantas('analyze') === 0 && s().transcript === DA_VOZ, 'nenhum analyze, transcript intacto')
  const p3 = s().plan!
  confere(
    s().images.length === 4 && p3.scenes.length === 4 && p3.scenes[0]!.end === 3.52 && p3.scenes[3]!.start === 6.92 && p3.scenes[2]!.imageIndex === 2,
    `entrou na agulha (5 s), o resto no lugar: ${p3.scenes.map((c) => `[${c.start.toFixed(2)}-${c.end.toFixed(2)}]#${c.imageIndex}`).join(' ')}`,
  )

  console.log('4. roteiro novo (Studio): reescrever frases')
  abrirProjeto(ORIGEM)
  respostas.roteiro = ROTEIRO.replace('radio', 'radinho')
  await s().ingest(['C:/novas/roteiro.txt'])
  const t4 = s().transcript!
  confere(quantas('analyze') === 0, 'ingest de roteiro: nenhum analyze')
  confere(
    t4.words[3]!.text === 'radinho.' && t4.words[3]!.start === DA_VOZ.words[3]!.start && t4.words.length === DA_VOZ.words.length && t4.alinhado === true,
    `texto novo com o tempo da voz: "${t4.words[3]!.text}" em ${t4.words[3]!.start}`,
  )
  confere(s().captions.some((c) => c.words.some((w) => w.text === 'radinho.')), 'as legendas seguem o texto novo')
  await s().setScript(ROTEIRO.replace('ciencia', 'Ciencia'))
  confere(quantas('analyze') === 0 && s().transcript!.words[11]!.text === 'Ciencia' && s().scriptNote === null, 'setScript: nenhum analyze, texto novo, sem aviso')
  const antes = s().transcript
  await s().setScript('Um texto que nao tem nada a ver com a narracao deste video aqui.')
  confere(quantas('analyze') === 0 && s().transcript === antes && s().scriptNote !== null, `roteiro que nao bate: transcript fica, aviso "${s().scriptNote}"`)

  console.log('5. arquivo do projeto')
  abrirProjeto(ORIGEM)
  const arquivo = s().toProjectFile()
  const conferido = projectFileSchema.safeParse(arquivo)
  confere(conferido.success && JSON.stringify(conferido.data.studio) === JSON.stringify(ORIGEM), 'toProjectFile leva o studio e passa no zod')
  const doDangai = (() => {
    abrirProjeto(null)
    return s().toProjectFile()
  })()
  confere(doDangai !== null && !('studio' in doDangai), 'projeto do Dangai: o campo nem aparece')
  // openProject (applyProjectFile) com um arquivo do Studio traz a origem.
  respostas.duracaoDoAudio = 12
  const comStudio = projectFileSchema.parse({ ...arquivo, savedAt: 'x' })
  const original = (globalThis as { window: { dangai: Record<string, unknown> } }).window.dangai
  ;(globalThis as { window: { dangai: unknown } }).window.dangai = new Proxy(original, {
    get(alvo, nome) {
      if (nome === 'openProject') return async () => ({ ok: true, value: { path: 'C:/proj/x.anirecap', file: comStudio } })
      return Reflect.get(alvo, nome)
    },
  })
  useProject.getState().reset()
  confere(s().studio === null, 'reset zera a origem')
  await s().openProject('C:/proj/x.anirecap')
  confere(JSON.stringify(s().studio) === JSON.stringify(ORIGEM) && s().transcript?.alinhado === true, 'openProject traz a origem de volta')
  chamadas.length = 0
  await s().setScript(ROTEIRO)
  confere(quantas('analyze') === 0, 'aberto do disco, a guarda continua ligada')
  ;(globalThis as { window: { dangai: unknown } }).window.dangai = original

  console.log('6. narracao nova desliga a guarda')
  abrirProjeto(ORIGEM)
  await s().ingest(['C:/novas/outra.wav'])
  confere(s().studio?.vozAlinhada === false && s().studio?.rascunhoId === ORIGEM.rascunhoId, 'vozAlinhada false, a origem fica')
  confere(quantas('analyze') === 1 && s().transcript === TRANSCRIPT_DO_WHISPER, 'o analyze do Dangai rodou e trocou o transcript (como deve)')

  console.log('7. projeto do Dangai: nada muda')
  abrirProjeto(null)
  s().removeImage(s().images[1]!.id)
  await new Promise((r) => setTimeout(r, 0))
  confere(quantas('analyze') === 1 && s().transcript === TRANSCRIPT_DO_WHISPER, 'removeImage chama o analyze (Dangai)')
  abrirProjeto(null)
  await s().setScript(ROTEIRO)
  confere(quantas('analyze') === 1, 'setScript chama o analyze (Dangai)')
  abrirProjeto({ ...ORIGEM, vozAlinhada: false })
  await s().setScript(ROTEIRO)
  confere(quantas('analyze') === 1, 'Studio sem voz alinhada: analyze normal')

  console.log('8. tirar todas as cenas e "Montar recap" (Studio)')
  abrirProjeto(ORIGEM)
  for (const img of [...s().images]) s().removeImage(img.id)
  confere(s().images.length === 0 && s().plan === null && s().transcript === DA_VOZ, 'sem cenas: plano null, transcript da voz intacto')
  await s().automount('recap', null)
  const pedido = chamadas.find((c) => c.metodo === 'automount')?.args[0] as { transcript?: Transcript | null } | undefined
  confere(pedido?.transcript === DA_VOZ, 'o pedido da montagem leva o transcript do take')
  confere(s().transcript === DA_VOZ && s().studio?.vozAlinhada === true && s().images.length === 2, 'montou com o transcript da voz (nenhum Whisper), guarda ligada')
  confere(quantas('analyze') === 0, 'nenhum analyze')
  abrirProjeto(null)
  await s().automount('recap', null)
  const pedidoDoDangai = chamadas.find((c) => c.metodo === 'automount')?.args[0] as { transcript?: Transcript | null } | undefined
  confere(pedidoDoDangai?.transcript == null && s().transcript === TRANSCRIPT_DO_WHISPER, 'projeto do Dangai: a montagem ouve de novo (como sempre)')

  console.log(falhas === 0 ? '\nTUDO CERTO' : `\n${falhas} FALHA(S)`)
  process.exitCode = falhas === 0 ? 0 : 1
}

void main()
