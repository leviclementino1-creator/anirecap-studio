/**
 * A action EDICAO RAPIDA do store (src/store/project.ts + edicao-rapida.ts),
 * no store DE VERDADE com o desfazer DE VERDADE (src/store/undo.ts) e um
 * window.dangai falso (v-edicao-rapida-janela.ts) que anota as chamadas:
 *
 * 1. aplica tudo: SFX e musica nas faixas de audio com papel (uma faixa por
 *    papel, depois da dele), url e onda prontas, ducking na musica; o rosto
 *    em cada bloco (menos o foco que ele pos a mao e com o recorte novo da
 *    imagem parada); a legenda no estilo salvo (fonte pelo nome); o pedido
 *    leva os cortes, as partes do studio e os nomes da frase;
 * 2. UM passo de Ctrl+Z: desfazer volta TUDO (as mesmas referencias de antes)
 *    e nao sobra outro passo; refazer traz de volta;
 * 3. rodar de novo troca SO o que a Edicao rapida pos (a trilha dele fica) e
 *    a musica troca (evitarMusicas);
 * 4. so a musica (o controle da barra), com a escolhida no dialogo: os SFX
 *    ficam;
 * 5. o som falha: o resto vale, as trilhas nao mudam, aviso; pasta sem
 *    musica: a musica que estava fica;
 * 6. foco mexido a mao ENQUANTO a Edicao rapida roda: a mao dele ganha;
 * 7. ocupado (busy) ou sem projeto: nada roda, nenhum IPC;
 * 8. (integracao) com o estilo-legenda.ts ligado: nem a Edicao rapida nem o
 *    Ctrl+Z/refazer dela gravam o estilo como padrao, o ajuste dele grava; e
 *    abrir outro projeto (semSujar trocando a narracao) esquece o historico.
 *
 * Nao escreve nada. Rodar da raiz do projeto:
 *   npx esbuild scripts/teste/v-edicao-rapida-store.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.web.json | node
 */
import { chamadas, ESTILO, MUSICAS, quantas, respostas, ultima } from './v-edicao-rapida-janela'
import type { AudioAnalysis, ImageAsset, Transcript } from '../../shared/contract'
import { CONFIG_DA_EDICAO_RAPIDA_PADRAO, type LoteDeRostos, type PedidoDePlanoDeSom } from '../../shared/edicao-rapida'
import { planEqualSplit } from '../../shared/plan'
import type { OrigemDoStudio } from '../../shared/project-file'
import { registrarMusicaDoProjeto, SO_A_MUSICA } from '../../src/store/edicao-rapida'
import { useProject } from '../../src/store/project'
import { desfazer, podeDesfazer, refazer, startUndo } from '../../src/store/undo'
import { startEstiloLegenda } from '../../src/store/estilo-legenda'
import { semSujar } from '../../src/store/quiet'

let falhas = 0
function confere(ok: boolean, mensagem: string): void {
  if (ok) console.log(`  ok  ${mensagem}`)
  else {
    falhas += 1
    console.log(`  FALHOU  ${mensagem}`)
  }
}
function secao(t: string): void {
  console.log(`\n== ${t}`)
}
const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const AUDIO: AudioAnalysis = { path: 'C:/proj/narracao.wav', fileName: 'narracao.wav', url: 'http://127.0.0.1/n', durationSec: 12, peaks: [] }

function imagem(n: number, kind: 'video' | 'image', foco: { x: number; y: number; auto: boolean }): ImageAsset {
  return {
    id: `img-${n}`,
    path: kind === 'video' ? `C:/shots/${n}.mp4` : `C:/fotos/${n}.png`,
    fileName: `${n}`,
    url: `http://127.0.0.1/i/${n}`,
    urlSource: null,
    width: 1920,
    height: 1080,
    thumbnail: '',
    focusX: foco.x,
    focusY: foco.y,
    focusAuto: foco.auto,
    kind,
    section: null,
    ...(kind === 'video' ? { durationSec: 8 } : {}),
  }
}

const palavras = ['Senku', 'liga', 'o', 'radio.', 'Todos', 'ouvem.', 'Chrome', 'corre.', 'Fim', 'da', 'parte.']
const TRANSCRIPT: Transcript = {
  source: 'script',
  words: palavras.map((text, i) => ({ text, start: 0.2 + i * 1.05, end: 0.2 + i * 1.05 + 0.8 })),
  segments: [],
  text: palavras.join(' '),
  cutCandidates: [],
  alinhado: true,
}
const STUDIO: OrigemDoStudio = {
  rascunhoId: 'rc_25d63d4babd6_mv7cxp1z',
  episodioId: `ep_${'a'.repeat(40)}`,
  takeId: 't1',
  roteiroVersao: 3,
  vozAlinhada: true,
  geradoEm: '2026-10-14T18:00:00.000Z',
  secoes: [
    { id: 's1', papel: 'gancho', inicio: 0, fim: 6, frases: [{ id: 'f01', inicio: 0, fim: 6, personagens: ['Senku', 'Kohaku'] }] },
    { id: 's2', papel: 'climax', inicio: 6, fim: 12, frases: [{ id: 'f02', inicio: 6, fim: 12, personagens: ['Chrome'] }] },
  ],
}

/** O projeto do teste: 4 blocos (2 clipes no centro/auto, 1 com foco DELE, 1 imagem parada) e uma trilha dele. */
function carregar(): void {
  const plano = planEqualSplit(4, 12)
  plano.scenes = plano.scenes.map((s, i) => ({ ...s, sourceStart: 1 + i }))
  useProject.setState({
    audio: AUDIO,
    images: [
      imagem(1, 'video', { x: 0.5, y: 0.5, auto: false }),
      imagem(2, 'video', { x: 0.3, y: 0.5, auto: true }),
      imagem(3, 'video', { x: 0.2, y: 0.7, auto: false }),
      imagem(4, 'image', { x: 0.5, y: 0.5, auto: false }),
    ],
    plan: plano,
    transcript: TRANSCRIPT,
    studio: STUDIO,
    projectPath: 'C:/proj/teste.anirecap',
    formato: 'short',
    fontes: [{ nome: 'Minha Fonte', url: 'http://127.0.0.1/f/minha' }],
    trilhas: [
      {
        id: 'dele',
        path: 'C:/meus/ambiente.wav',
        fileName: 'ambiente.wav',
        faixa: 0,
        at: 2,
        durationSec: 5,
        inicioSec: 0,
        usarSec: null,
        gainDb: -8,
        fadeInSec: 0,
        fadeOutSec: 0,
        peaks: [],
        rms: [],
        url: 'http://127.0.0.1/a/amb',
      },
    ],
    busy: null,
    error: null,
    projectDirty: false,
  })
}

async function main(): Promise<void> {
  carregar()
  const pararUndo = startUndo()

  // ------------------------------------------------------------- 1. aplica
  secao('1. Edicao rapida inteira')
  const antes = useProject.getState()
  const resumo = await antes.edicaoRapida(CONFIG_DA_EDICAO_RAPIDA_PADRAO)
  const depois = useProject.getState()
  console.log(`  resumo: ${JSON.stringify(resumo)}`)
  confere(resumo !== null && resumo.whoosh === 1 && resumo.impacto === 1 && resumo.musica === 'Afternoon.mp3' && resumo.legenda, 'resumo: 1 whoosh, 1 impacto, musica, legenda')
  confere(resumo?.rostos?.comRosto === 3 && resumo.rostos.total === 3 && resumo.rostos.fonte === 'motor', 'rosto: 3 de 3 pedidos pelo motor')

  const pedido = ultima('planejarSom')?.[0] as PedidoDePlanoDeSom
  confere(JSON.stringify(pedido.cortes) === JSON.stringify([0, 3, 6, 9]) && pedido.duracaoSec === 12, 'pedido de som: os cortes dos blocos e a duracao da voz')
  confere(pedido.secoes.length === 2 && pedido.secoes[0]!.papel === 'gancho' && pedido.secoes[1]!.papel === 'climax' && pedido.secoes[1]!.inicio === 6, 'pedido de som: as partes do studio.secoes')
  confere(pedido.evitarMusicas.length === 0 && pedido.musicaForcada === null && pedido.sfx && pedido.musica, 'pedido de som: nada a evitar na 1a vez')

  const dele = depois.trilhas.find((t) => t.id === 'dele')
  confere(dele === antes.trilhas[0], 'a trilha DELE ficou (a mesma referencia)')
  const porPapel = (p: string) => depois.trilhas.filter((t) => t.papel === p)
  const [musica, whoosh, impacto] = [porPapel('musica'), porPapel('whoosh'), porPapel('impacto')]
  confere(musica.length === 1 && whoosh.length === 1 && impacto.length === 1, 'entrou 1 musica, 1 whoosh, 1 impacto')
  confere(musica[0]!.faixa === 1 && whoosh[0]!.faixa === 2 && impacto[0]!.faixa === 3, 'uma faixa por papel, depois da dele (musica 1, whoosh 2, impacto 3)')
  confere(
    [...musica, ...whoosh, ...impacto].every((t) => t.url.startsWith('http://') && t.peaks.length > 0 && t.rms.length > 0),
    'url e onda prontas (nada de refresh depois: seria outro passo de Ctrl+Z)',
  )
  confere(musica[0]!.ducking?.abaixoDb === 6 && musica[0]!.fadeInSec > 0 && musica[0]!.fadeOutSec > 0, 'musica com ducking e fades')
  confere(whoosh[0]!.durationSec === 1.5 && whoosh[0]!.usarSec === 0.9, 'sobra: o arquivo inteiro (1,5 s) e o trecho usado (0,9 s)')

  const lote = ultima('rostosDosPedacos')?.[0] as LoteDeRostos
  confere(lote.pedidos.length === 3 && !lote.pedidos.some((p) => p.arquivo.includes('/3.mp4')), 'rosto: 3 pedidos, o bloco com foco DELE ficou de fora')
  const p1 = lote.pedidos.find((p) => p.arquivo.endsWith('/1.mp4'))!
  confere(p1.de === 1 && p1.ate === 4 && p1.personagens.join() === 'Senku,Kohaku', 'pedido do bloco 1: o trecho que ele toca (1-4 s) e quem a frase cita')
  confere(lote.episodioId === STUDIO.episodioId && lote.formato === 'short', 'lote com o episodio do studio e o formato')
  const [i1, i2, i3, i4] = depois.images
  confere(i1!.focusX === 0.8 && i1!.focusY === 0.25 && i1!.focusAuto, 'bloco 1 enquadrado no rosto (focusAuto)')
  confere(i3 === antes.images[2], 'bloco 3 (foco dele) intocado')
  confere(
    i4!.url === 'http://127.0.0.1/recorte/img-4' && i1!.url === 'http://127.0.0.1/recorte/img-1' && i2!.url === 'http://127.0.0.1/recorte/img-2' && quantas('reframeImage') === 3,
    'recorte 9:16 refeito para a imagem parada E os clipes (o preview e o render leem a url)',
  )
  confere(i2!.focusAuto && Math.abs(i2!.focusX - 0.7) < 1e-9, 'bloco 2 (auto) reenquadrado')

  confere(
    depois.captionColor === ESTILO.color &&
      depois.captionY === ESTILO.y &&
      depois.captionScale === ESTILO.scale &&
      depois.captionAnimation === ESTILO.animation &&
      depois.captionAnimationFrames === ESTILO.animationFrames &&
      depois.captionMark === ESTILO.mark &&
      depois.captionStroke === ESTILO.stroke &&
      JSON.stringify(depois.captionShadow) === JSON.stringify(ESTILO.shadow),
    'legenda no estilo salvo',
  )
  confere(depois.captionFont?.nome === 'Minha Fonte' && depois.captionFont.url === 'http://127.0.0.1/f/minha', 'fonte pelo nome, com a URL da pasta')
  confere(resumo?.aplicou === true, 'o resumo sabe que aplicou (um passo de Ctrl+Z)')
  confere(quantas('registrarMusicaUsada') === 0, 'aplicar NAO registra a musica (so salvar/renderizar)')
  registrarMusicaDoProjeto(useProject.getState())
  const reg = ultima('registrarMusicaUsada')
  confere(reg?.[0] === MUSICAS[0] && reg?.[1] === 'C:/proj/teste.anirecap', 'ao salvar/renderizar: a musica que o projeto TEM, com o projeto')
  confere(depois.busy === null && depois.projectDirty, 'busy limpo, projeto sujo')

  // --------------------------------------------------------- 2. um passo
  secao('2. Um passo de Ctrl+Z')
  await esperar(500)
  confere(podeDesfazer(), 'ha o que desfazer')
  desfazer()
  const desfeito = useProject.getState()
  confere(
    desfeito.trilhas === antes.trilhas &&
      desfeito.images === antes.images &&
      desfeito.captionColor === antes.captionColor &&
      desfeito.captionFont === antes.captionFont &&
      desfeito.captionShadow === antes.captionShadow &&
      desfeito.captionY === antes.captionY,
    'desfazer: trilhas, imagens e legenda voltam (as mesmas referencias de antes)',
  )
  confere(!podeDesfazer(), 'e nao sobra outro passo: a Edicao rapida inteira era UM')
  refazer()
  confere(useProject.getState().trilhas === depois.trilhas && useProject.getState().images === depois.images, 'refazer traz tudo de volta')

  // ------------------------------------------------------ 3. rodar de novo
  secao('3. Rodar de novo')
  await esperar(500)
  const r2 = await useProject.getState().edicaoRapida(CONFIG_DA_EDICAO_RAPIDA_PADRAO)
  const s2 = useProject.getState()
  const p2 = ultima('planejarSom')?.[0] as PedidoDePlanoDeSom
  confere(JSON.stringify(p2.evitarMusicas) === JSON.stringify([MUSICAS[0]]), 'evita a musica que o projeto ja tem')
  confere(r2?.musica === 'Galactico.m4a' && s2.trilhas.filter((t) => t.papel === 'musica').every((t) => t.path === MUSICAS[1]), 'a musica trocou')
  confere(s2.trilhas.filter((t) => t.papel).length === 3 && s2.trilhas.some((t) => t.id === 'dele'), 'so as dela foram trocadas (3 de novo), a dele ficou')
  confere(s2.trilhas.filter((t) => t.papel === 'whoosh').every((t) => t.faixa === 2), 'as faixas continuam as mesmas')

  // ------------------------------------------------------ 4. so a musica
  secao('4. So a musica (o controle da barra), escolhida no dialogo')
  await esperar(500)
  const sfxAntes = s2.trilhas.filter((t) => t.papel === 'whoosh' || t.papel === 'impacto')
  const reframesAntes = quantas('reframeImage')
  const rostosAntes = quantas('rostosDosPedacos')
  const r3 = await useProject.getState().edicaoRapida(SO_A_MUSICA, { musicaForcada: 'C:/outra/Escolhida.mp3' })
  const s3 = useProject.getState()
  const p3 = ultima('planejarSom')?.[0] as PedidoDePlanoDeSom
  confere(!p3.sfx && p3.musica && p3.musicaForcada === 'C:/outra/Escolhida.mp3' && p3.evitarMusicas.length === 0, 'pedido: so musica, a forcada')
  confere(r3?.musica === 'Escolhida.mp3' && s3.trilhas.filter((t) => t.papel === 'musica').every((t) => t.path === 'C:/outra/Escolhida.mp3'), 'a musica e a escolhida')
  confere(
    sfxAntes.every((t) => s3.trilhas.includes(t)) && s3.trilhas.filter((t) => t.papel === 'whoosh' || t.papel === 'impacto').length === sfxAntes.length,
    'os SFX ficaram (as mesmas referencias)',
  )
  confere(quantas('rostosDosPedacos') === rostosAntes && quantas('reframeImage') === reframesAntes && s3.images === s2.images, 'nem rosto nem imagem')

  // --------------------------------------------------- 5. falhas no som
  secao('5. O som falha / pasta sem musica')
  await esperar(500)
  respostas.somOk = false
  const trilhasAntes = useProject.getState().trilhas
  const r4 = await useProject.getState().edicaoRapida(CONFIG_DA_EDICAO_RAPIDA_PADRAO)
  confere(useProject.getState().trilhas === trilhasAntes, 'som falhou: as trilhas nao mudaram')
  confere(r4 !== null && r4.avisos.includes('Sem som: ffmpeg sumiu') && r4.whoosh === 0 && r4.musica === null && r4.legenda, `o resto rodou e o aviso diz o que faltou ("${r4?.avisos[0]}")`)
  respostas.somOk = true
  respostas.semMusica = true
  await esperar(500)
  const r5 = await useProject.getState().edicaoRapida(SO_A_MUSICA)
  confere(
    useProject.getState().trilhas.filter((t) => t.papel === 'musica').every((t) => t.path === 'C:/outra/Escolhida.mp3') && r5?.musica === null,
    'pasta sem musica: a que estava fica',
  )
  confere(r5?.avisos.includes('A pasta de musicas esta vazia') === true && r5?.musicaMantida === 'Escolhida.mp3', 'o aviso diz "pasta vazia" e o resumo diz que a musica ficou')
  confere(r5?.aplicou === false, 'nada mudou: o resumo nao oferece Desfazer')
  respostas.semMusica = false

  // ----------------------------------------- 5b. nada muda = nenhum passo
  secao('5b. Rodar de novo sem mudar nada')
  await esperar(500)
  await useProject.getState().edicaoRapida({ sfx: false, musica: false, rosto: true, legenda: true, cor: false })
  await esperar(500)
  const passoAntes = podeDesfazer()
  const fotoAntes = useProject.getState()
  const r5b = await useProject.getState().edicaoRapida({ sfx: false, musica: false, rosto: true, legenda: true, cor: false })
  await esperar(500)
  const s5b = useProject.getState()
  confere(r5b?.aplicou === false && s5b.images === fotoAntes.images && s5b.captionShadow === fotoAntes.captionShadow, 'rosto e legenda iguais: o patch sai vazio e nada muda')
  desfazer()
  // O ultimo passo de verdade foi o da secao 4 (a musica escolhida no dialogo).
  confere(
    passoAntes && useProject.getState().trilhas.filter((t) => t.papel === 'musica').every((t) => t.path === MUSICAS[1]),
    'o Ctrl+Z desfaz o ultimo passo DE VERDADE (as rodadas sem mudanca nao viraram passo)',
  )
  refazer()

  // ------------ 5c. pasta de musicas vazia: os SFX voltam iguais, com id novo
  secao('5c. Rodar de novo com a pasta de musicas vazia')
  respostas.semMusica = true
  await esperar(500)
  await useProject.getState().edicaoRapida(CONFIG_DA_EDICAO_RAPIDA_PADRAO)
  await esperar(500)
  const trilhas5c = useProject.getState().trilhas
  const r5c = await useProject.getState().edicaoRapida(CONFIG_DA_EDICAO_RAPIDA_PADRAO)
  await esperar(500)
  confere(
    r5c?.aplicou === false && useProject.getState().trilhas === trilhas5c && r5c.musicaMantida !== null,
    'mesmos SFX (id novo) e a musica mantida: nada mudou, sem Desfazer',
  )
  respostas.semMusica = false

  // ------------------------------------------- 6. a mao dele no meio
  secao('6. Foco mexido a mao enquanto a Edicao rapida roda')
  pararUndo()
  carregar()
  const rodando = useProject.getState().edicaoRapida({ sfx: false, musica: false, rosto: true, legenda: false, cor: false })
  useProject.getState().setImageFocus('img-1', 0.1, 0.9)
  await rodando
  const s6 = useProject.getState()
  confere(s6.images[0]!.focusX === 0.1 && s6.images[0]!.focusY === 0.9 && !s6.images[0]!.focusAuto, 'o foco que ele pos no meio ficou')
  console.log(`  imagens: ${s6.images.map((i) => `${i.id} ${i.focusX}/${i.focusY} ${i.focusAuto}`).join(" ; ")}`)
  confere(s6.images[1]!.focusAuto && Math.abs(s6.images[1]!.focusX - 0.7) < 1e-9, 'os outros blocos foram enquadrados')

  // ------------------------------------------------- 7. nada roda
  secao('7. Ocupado ou sem projeto')
  const n = chamadas.length
  useProject.setState({ busy: 'Analisando...' })
  confere((await useProject.getState().edicaoRapida(CONFIG_DA_EDICAO_RAPIDA_PADRAO)) === null && chamadas.length === n, 'busy: nada roda, nenhum IPC')
  useProject.setState({ busy: null, audio: null })
  confere((await useProject.getState().edicaoRapida(CONFIG_DA_EDICAO_RAPIDA_PADRAO)) === null && chamadas.length === n, 'sem narracao: nada roda')

  // ---------------------------------- 8. o padrao da legenda e o historico
  // (integracao, 14/10) O estilo-legenda.ts grava como padrao qualquer troca de
  // estilo fora do carregamento; a Edicao rapida e o Ctrl+Z dela nao sao ajuste
  // dele. E abrir outro projeto esquece o historico do anterior.
  secao('8. Estilo salvo intocado pelo Ctrl+Z; abrir outro projeto esquece o historico')
  carregar()
  useProject.setState({ captionColor: 'rosa', captionY: 0.355, captionScale: 1, captionAnimation: 'nenhuma', captionMark: 'palavra', captionStroke: 6 })
  const pararUndo8 = startUndo()
  const pararEstilo = startEstiloLegenda()
  const gravouEstilo = (): Array<{ captionStyle?: { color?: string } }> =>
    chamadas.filter((c) => c.metodo === 'saveSettings' && (c.args[0] as { captionStyle?: unknown })?.captionStyle !== undefined).map((c) => c.args[0] as { captionStyle?: { color?: string } })
  const g0 = gravouEstilo().length
  const a8 = useProject.getState()
  await a8.edicaoRapida({ sfx: false, musica: false, rosto: false, legenda: true, cor: false })
  confere(useProject.getState().captionColor === ESTILO.color, 'a Edicao rapida pos o estilo salvo')
  await esperar(500)
  desfazer()
  await esperar(800)
  confere(useProject.getState().captionColor === a8.captionColor, 'Ctrl+Z voltou o estilo do video')
  confere(gravouEstilo().length === g0, 'nem a Edicao rapida nem o Ctrl+Z gravaram o estilo do video como padrao')
  refazer()
  await esperar(800)
  confere(gravouEstilo().length === g0, 'o refazer tambem nao')
  useProject.getState().setCaptionColor('#123456')
  await esperar(800)
  const g1 = gravouEstilo()
  confere(g1.length === g0 + 1 && g1[g1.length - 1]!.captionStyle?.color === '#123456', 'ajuste DELE continua virando padrao')
  pararEstilo()
  await esperar(500)
  confere(podeDesfazer(), 'antes de abrir outro: ha historico')
  await semSujar(async () => {
    useProject.setState({ audio: { ...AUDIO, path: 'C:/outro/narracao.wav' }, projectPath: 'C:/outro/outro.anirecap', trilhas: [] })
  })
  confere(!podeDesfazer(), 'abrir outro projeto esquece o historico (Ctrl+Z nao traz o video anterior)')
  pararUndo8()
}

main()
  .then(() => {
    console.log(`\n${falhas === 0 ? 'TUDO OK' : `${falhas} FALHA(S)`}`)
    process.exit(falhas === 0 ? 0 : 1)
  })
  .catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
