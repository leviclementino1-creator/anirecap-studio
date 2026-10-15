/**
 * A COR da Edicao rapida (15/10) no store DE VERDADE, com o desfazer DE
 * VERDADE e a janela falsa do v-edicao-rapida-janela.ts:
 *
 * 1. a camada e criada: a camada de ajuste do Dangai (tipo 'ajuste'), no
 *    video inteiro, `papel: 'cor'`, look "Anime vivo" (vibrance +28), na faixa
 *    de video mais baixa livre; o resumo diz o look;
 * 2. UM passo de Ctrl+Z: desfazer tira a camada (e o resto da Edicao rapida)
 *    e nao sobra outro passo; refazer traz;
 * 3. rodar de novo com outro look (preset salvo dele): TROCA so a camada dela
 *    (mesmo id, mesma faixa, uma so), os clipes dele ficam (as mesmas
 *    referencias); um passo; Ctrl+Z volta o Anime vivo;
 * 4. rodar de novo com o mesmo look: nada muda, nenhum passo;
 * 5. ele mexeu na camada (auditoria de 15/10): arrastar de faixa ainda e
 *    "dela" (troca o look e fica la); cortou em duas, copiou, mexeu nos
 *    valores, na intensidade, no fade ou no comeco/fim: rodar de novo (mesmo
 *    com sons e musica) NAO apaga nem troca nada dele, e o resumo diz
 *    "mantida"; esticada alem do fim continua dela; preset refinado com o
 *    mesmo nome troca; camada de antes do `corOriginal` pelo nome; o rotulo
 *    "Cor (editada)" na linha do tempo;
 * 6. preset que sumiu: Anime vivo, dito NA linha da Cor (sem aviso solto);
 *    faixa da camada silenciada: fica la e a linha diz "V4 muda"; faixa muda
 *    ou ocupada e pulada para a camada nova;
 * 7. so a musica nao toca na cor; com a cor desligada, a camada fica;
 * 8. o render: a camada vira o filtro do video inteiro (do quadro 0 ao ultimo),
 *    e o .anirecap guarda o `papel` (sobreposicaoSchema).
 *
 * Nao escreve nada. Rodar da raiz do projeto:
 *   npx esbuild scripts/teste/v-edicao-rapida-cor.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.web.json | node
 */
import { respostas } from './v-edicao-rapida-janela'
import { AJUSTE_DE_COR_PADRAO, sobreposicaoSchema, VIDEO_FPS, type AudioAnalysis, type ImageAsset, type SobreposicaoSalva } from '../../shared/contract'
import {
  ANIME_VIVO,
  camadaDeCorIntacta,
  CONFIG_DA_EDICAO_RAPIDA_PADRAO,
  faixaDaCamadaDeCor,
  rotuloDaSobreposicao,
  type ConfigDaEdicaoRapida,
} from '../../shared/edicao-rapida'
import { planEqualSplit, toRenderProps } from '../../shared/plan'
import { linhasDoResumo, SO_A_MUSICA } from '../../src/store/edicao-rapida'
import { useProject } from '../../src/store/project'
import { desfazer, fecharPassoAgora, podeDesfazer, refazer, startUndo } from '../../src/store/undo'

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

const SO_A_COR: ConfigDaEdicaoRapida = { sfx: false, musica: false, rosto: false, legenda: false, cor: true }
const AUDIO: AudioAnalysis = { path: 'C:/proj/narracao.wav', fileName: 'narracao.wav', url: 'http://127.0.0.1/n', durationSec: 12, peaks: [] }
const MEU_LOOK = { ...AJUSTE_DE_COR_PADRAO, saturacao: 0.2, contraste: 0.3, temperatura: 0.1 }

function imagem(n: number): ImageAsset {
  return {
    id: `img-${n}`,
    path: `C:/shots/${n}.mp4`,
    fileName: `${n}`,
    url: `http://127.0.0.1/i/${n}`,
    urlSource: null,
    width: 1920,
    height: 1080,
    thumbnail: '',
    focusX: 0.5,
    focusY: 0.5,
    focusAuto: false,
    kind: 'video',
    section: null,
    durationSec: 8,
  }
}

/** Clipes DELE na faixa de video: um meme na V1 (3-5 s) e a camada de ajuste dele na V3 (0-2 s). */
type Sob = SobreposicaoSalva & { url: string }
const MEME: Sob = {
  ...sobreposicaoSchema.parse({ id: 'meme', path: 'C:/memes/uau.png', fileName: 'uau.png', tipo: 'image', faixa: 0, at: 3, durationSec: 2, usarSec: 2 }),
  url: 'http://127.0.0.1/m/uau',
}
const AJUSTE_DELE: Sob = {
  ...sobreposicaoSchema.parse({ id: 'cc-dele', path: '', fileName: 'Camada de ajuste', tipo: 'ajuste', faixa: 2, at: 0, durationSec: 3600, usarSec: 2, cor: { ...AJUSTE_DE_COR_PADRAO, exposicao: 0.4 } }),
  url: '',
}

function carregar(): void {
  useProject.setState({
    audio: AUDIO,
    images: [1, 2, 3].map(imagem),
    plan: planEqualSplit(3, 12),
    transcript: null,
    studio: null,
    projectPath: 'C:/proj/teste.anirecap',
    formato: 'short',
    trilhas: [],
    sobreposicoes: [MEME, AJUSTE_DELE],
    faixasMudas: { video: [], audio: [] },
    busy: null,
    error: null,
    projectDirty: false,
  })
}

const daEdicao = (): Sob[] => useProject.getState().sobreposicoes.filter((o) => o.papel === 'cor')

async function rodar(config: ConfigDaEdicaoRapida = SO_A_COR) {
  const r = await useProject.getState().edicaoRapida(config)
  // O mesmo que o botao faz: a Edicao rapida e um passo so.
  fecharPassoAgora()
  return r
}

async function main(): Promise<void> {
  carregar()
  const pararUndo = startUndo()

  // ------------------------------------------------------------ 1. cria
  secao('1. A camada e criada')
  const antes = useProject.getState()
  const r1 = await rodar()
  const s1 = useProject.getState()
  const [c1] = daEdicao()
  console.log(`  camada: ${JSON.stringify({ id: c1?.id, faixa: c1?.faixa, at: c1?.at, usarSec: c1?.usarSec, nome: c1?.fileName, vibrance: c1?.cor?.vibrance })}`)
  confere(daEdicao().length === 1 && c1!.tipo === 'ajuste' && c1!.papel === 'cor' && c1!.path === '' && c1!.url === '', 'uma camada de ajuste do Dangai, marcada papel cor')
  confere(c1!.at === 0 && c1!.usarSec === 12 && c1!.inicioSec === 0 && c1!.fadeInSec === 0 && c1!.fadeOutSec === 0, 'cobre o video inteiro (0 a 12 s), sem fade')
  confere(JSON.stringify(c1!.cor) === JSON.stringify(ANIME_VIVO) && c1!.cor!.vibrance >= 0.2 && c1!.cor!.vibrance <= 0.3, `look Anime vivo: vibrance +${Math.round(ANIME_VIVO.vibrance * 100)}, contraste +${Math.round(ANIME_VIVO.contraste * 100)}, nitidez ${Math.round(ANIME_VIVO.nitidez * 100)}`)
  confere(c1!.faixa === 1, 'na faixa mais baixa livre (V2: a V1 tem o meme dele aos 3 s)')
  confere(c1!.fileName === 'Cor: Anime vivo', 'o clipe diz o look ("Cor: Anime vivo")')
  confere(s1.sobreposicoes.includes(MEME) && s1.sobreposicoes.includes(AJUSTE_DELE), 'os clipes dele ficaram (as mesmas referencias)')
  confere(r1?.cor === 'Anime vivo' && r1.aplicou === true && r1.avisos.length === 0 && !r1.corMantida, 'resumo: cor Anime vivo, aplicou, sem aviso')
  confere(JSON.stringify(c1!.corOriginal) === JSON.stringify(ANIME_VIVO) && rotuloDaSobreposicao(c1!) === 'Cor: Anime vivo', 'guarda o look que pos (corOriginal); rotulo "Cor: Anime vivo"')
  confere(linhasDoResumo(r1!).some((l) => l.rotulo === 'Cor' && l.valor === 'Anime vivo'), 'a linha "Cor  Anime vivo" do resumo')
  confere(s1.projectDirty, 'projeto sujo')

  // ---------------------------------------------------------- 2. desfaz
  secao('2. Um passo de Ctrl+Z')
  confere(podeDesfazer(), 'ha o que desfazer')
  desfazer()
  confere(useProject.getState().sobreposicoes === antes.sobreposicoes && daEdicao().length === 0, 'desfazer tira a camada (as sobreposicoes de antes, mesma referencia)')
  confere(!podeDesfazer(), 'e nao sobra outro passo')
  refazer()
  confere(useProject.getState().sobreposicoes === s1.sobreposicoes, 'refazer traz a camada de volta')

  // ---------------------------------------------- 3. outro look: troca
  secao('3. Rodar de novo com um preset salvo dele: troca so a camada dela')
  respostas.presetsDeCor = [{ nome: 'Meu look', cor: MEU_LOOK }, { nome: '', cor: MEU_LOOK }, { nome: 'Quebrado', cor: { vibrance: 9 } }]
  respostas.corPreset = 'Meu look'
  const r3 = await rodar()
  const s3 = useProject.getState()
  const [c3] = daEdicao()
  confere(daEdicao().length === 1 && c3!.id === c1!.id && c3!.faixa === c1!.faixa, 'uma camada so, o mesmo id e a mesma faixa')
  confere(JSON.stringify(c3!.cor) === JSON.stringify({ ...MEU_LOOK }) && c3!.fileName === 'Cor: Meu look' && r3?.cor === 'Meu look', 'com o preset dele (e o nome no clipe e no resumo)')
  confere(s3.sobreposicoes.includes(MEME) && s3.sobreposicoes.includes(AJUSTE_DELE) && s3.sobreposicoes.length === 3, 'os clipes dele ficaram')
  confere(s3.sobreposicoes.findIndex((o) => o.papel === 'cor') === s1.sobreposicoes.findIndex((o) => o.papel === 'cor'), 'no mesmo lugar da lista')
  desfazer()
  confere(useProject.getState().sobreposicoes === s1.sobreposicoes, 'Ctrl+Z volta o Anime vivo (um passo)')
  refazer()

  // ------------------------------------------ 4. mesmo look: nada muda
  secao('4. Rodar de novo com o mesmo look')
  const r4 = await rodar()
  confere(r4?.aplicou === false && useProject.getState().sobreposicoes === s3.sobreposicoes, 'nada muda: aplicou false, nenhuma referencia nova')
  desfazer()
  confere(useProject.getState().sobreposicoes === s1.sobreposicoes, 'e o Ctrl+Z seguinte ainda e o da troca de look (nenhum passo vazio)')
  refazer()

  // --------------------------------------------- 5. ele mexeu na camada
  secao('5. Ele mexeu na camada: rodar de novo nao apaga nada dele')
  const ID = c1!.id
  const camada = (): Sob => useProject.getState().sobreposicoes.find((o) => o.id === ID)!
  const valorDaCor = (r: Awaited<ReturnType<typeof rodar>>): string | undefined => linhasDoResumo(r!).find((l) => l.rotulo === 'Cor')?.valor
  const SEM_ROSTO: ConfigDaEdicaoRapida = { ...CONFIG_DA_EDICAO_RAPIDA_PADRAO, rosto: false }

  // a. arrastar de faixa nao e mexer no look: a camada continua dela.
  useProject.getState().moveSobreposicao(ID, 0, 3)
  fecharPassoAgora()
  confere(camada().faixa === 3, '(arrastou a camada para a V4)')
  respostas.corPreset = null
  const r5a = await rodar()
  confere(daEdicao().length === 1 && camada().faixa === 3 && JSON.stringify(camada().cor) === JSON.stringify(ANIME_VIVO) && r5a?.cor === 'Anime vivo',
    'arrastada de faixa: troca o look e fica na faixa em que ele pos')
  respostas.corPreset = 'Meu look'

  // b. cortou em duas (C aos 5 s) e dessaturou a 2a metade; depois roda TUDO (refazer os sons).
  useProject.setState({ playhead: 5 })
  useProject.getState().selecionarClipe({ tipo: 'video', id: ID })
  confere(useProject.getState().cortarClipeNaAgulha(), '(cortou a camada em duas aos 5 s)')
  fecharPassoAgora()
  const metade = daEdicao().find((o) => o.id !== ID)!
  useProject.getState().ajustarSobreposicao(metade.id, { cor: { ...metade.cor!, saturacao: -0.61 } })
  fecharPassoAgora()
  const cortada = useProject.getState().sobreposicoes
  const trilhasAntes = useProject.getState().trilhas
  const r5b = await rodar(SEM_ROSTO)
  confere(useProject.getState().sobreposicoes === cortada && daEdicao().length === 2, 'rodar tudo de novo: as duas metades ficam (a dessaturada inclusive), nada trocado')
  confere(useProject.getState().trilhas !== trilhasAntes && r5b?.aplicou === true, '(os sons e a musica foram refeitos)')
  confere(r5b?.cor === null && r5b.corMantida === 'varias' && valorDaCor(r5b) === 'mantida (cortada ou copiada)', `o resumo diz: "Cor  ${valorDaCor(r5b)}"`)
  desfazer()
  desfazer()
  desfazer()
  confere(daEdicao().length === 1 && camadaDeCorIntacta(camada(), 12, []), '(Ctrl+Z x3: a camada inteira de volta)')

  // c. copiou a camada para a V6 e esfriou a copia.
  const copia = useProject.getState().duplicarClipe('video', ID)!
  useProject.getState().moveSobreposicao(copia, 0, 5)
  useProject.getState().ajustarSobreposicao(copia, { cor: { ...camada().cor!, temperatura: -0.39 } })
  fecharPassoAgora()
  const copiada = useProject.getState().sobreposicoes
  const r5c = await rodar()
  confere(useProject.getState().sobreposicoes === copiada && r5c?.aplicou === false && r5c.corMantida === 'varias', 'copiou e mexeu na copia: rodar de novo deixa as duas (nada some)')
  desfazer()

  // d. mexeu nos valores no inspetor (Vibrance +51).
  useProject.getState().ajustarSobreposicao(ID, { cor: { ...camada().cor!, vibrance: 0.51 } })
  fecharPassoAgora()
  confere(rotuloDaSobreposicao(camada()) === 'Cor (editada)', 'na linha do tempo o clipe diz "Cor (editada)"')
  const editada = useProject.getState().sobreposicoes
  const r5d = await rodar(SEM_ROSTO)
  confere(useProject.getState().sobreposicoes === editada && camada().cor!.vibrance === 0.51, 'rodar tudo de novo: a edicao dele fica (Vibrance +51)')
  confere(r5d?.cor === null && r5d.corMantida === 'editada' && valorDaCor(r5d) === 'mantida (editada por voce)', `o resumo diz: "Cor  ${valorDaCor(r5d)}"`)
  confere(linhasDoResumo(r5d!).find((l) => l.rotulo === 'Cor')?.dica?.includes('Apague a camada') === true, 'e a dica diz como voltar ao look (apagar a camada)')
  desfazer()
  desfazer()
  confere(camada().cor!.vibrance === ANIME_VIVO.vibrance && rotuloDaSobreposicao(camada()) === 'Cor: Anime vivo', '(Ctrl+Z x2: Anime vivo intacto de novo)')

  // e. intensidade, fade, comeco ou fim aparados: trabalho dele.
  const mexidas: [string, Partial<Sob>][] = [
    ['intensidade 50%', { cor: { ...ANIME_VIVO, intensidade: 0.5 } }],
    ['fade de entrada 1 s', { fadeInSec: 1 }],
    ['comeco aparado (o gancho sem cor)', { at: 2, usarSec: 10 }],
    ['fim aparado', { usarSec: 10 }],
    ['transicao na entrada', { transicaoEntrada: { tipo: 'crossfade' } }],
  ]
  for (const [nome, patch] of mexidas) {
    useProject.getState().ajustarSobreposicao(ID, patch)
    fecharPassoAgora()
    const mexida = useProject.getState().sobreposicoes
    const r = await rodar()
    confere(useProject.getState().sobreposicoes === mexida && r?.corMantida === 'editada', `${nome}: fica como esta ("mantida")`)
    desfazer()
  }
  confere(camadaDeCorIntacta(camada(), 12, []), '(desfeitas, a camada esta intacta)')

  // f. esticada alem do fim do video: cobre o video todo, continua dela.
  useProject.getState().ajustarSobreposicao(ID, { usarSec: 15 })
  fecharPassoAgora()
  const r5f = await rodar()
  confere(r5f?.cor === 'Meu look' && camada().usarSec === 12 && JSON.stringify(camada().cor) === JSON.stringify(MEU_LOOK), 'esticada alem do fim: trocada pelo look de agora, de novo do 0 ao fim')

  // g. ele refinou o preset escolhido e salvou com o MESMO nome.
  const REFINADO = { ...MEU_LOOK, saturacao: 0.35 }
  respostas.presetsDeCor = [{ nome: 'Meu look', cor: REFINADO }]
  const r5g = await rodar()
  confere(r5g?.cor === 'Meu look' && camada().cor!.saturacao === 0.35 && camada().id === ID, 'preset refinado com o mesmo nome: a camada pega a versao nova')
  respostas.presetsDeCor = [{ nome: 'Meu look', cor: MEU_LOOK }]
  await rodar()
  confere(JSON.stringify(camada().cor) === JSON.stringify(MEU_LOOK), '(o preset voltou: a camada tambem)')

  // h. camada de antes do corOriginal (projeto montado mais cedo): vale o nome.
  const semOrigem = (nome: string): void =>
    useProject.setState((st) => ({
      sobreposicoes: st.sobreposicoes.map((o) => (o.id === ID ? (({ corOriginal: _c, ...resto }) => ({ ...resto, fileName: nome }))(o) : o)),
    }))
  semOrigem('Cor: Meu look')
  fecharPassoAgora()
  respostas.corPreset = null
  const r5h = await rodar()
  confere(r5h?.cor === 'Anime vivo' && JSON.stringify(camada().corOriginal) === JSON.stringify(ANIME_VIVO), 'sem corOriginal, o nome acha o look: intacta, trocada (e ganha o corOriginal)')
  semOrigem('Cor: Sumido')
  fecharPassoAgora()
  const r5h2 = await rodar()
  confere(r5h2?.corMantida === 'editada' && camada().fileName === 'Cor: Sumido', 'sem corOriginal e o preset do nome sumiu: nao da para saber, fica')
  desfazer()
  confere(camadaDeCorIntacta(camada(), 12, []) && camada().fileName === 'Cor: Anime vivo', '(Ctrl+Z: Anime vivo intacto)')
  respostas.corPreset = 'Meu look'
  await rodar()

  // ------------------------------------------------- 6. preset sumiu
  secao('6. Preset que sumiu; faixa muda ou ocupada')
  respostas.corPreset = 'Apagado'
  const r6 = await rodar()
  confere(JSON.stringify(daEdicao()[0]!.cor) === JSON.stringify(ANIME_VIVO) && r6?.cor === 'Anime vivo', 'preset que nao existe mais: Anime vivo')
  confere(r6?.corPresetSumiu === 'Apagado' && valorDaCor(r6) === 'Anime vivo ("Apagado" apagado)', `dito NA linha da Cor: "${valorDaCor(r6)}"`)
  confere(r6?.avisos.length === 0, 'e nao como aviso solto (que ia para tras do "+1")')
  respostas.corPreset = 'Meu look'
  useProject.setState({ faixasMudas: { video: [camada().faixa], audio: [] } })
  fecharPassoAgora()
  const r6m = await rodar()
  confere(camada().faixa === 3 && r6m?.cor === 'Meu look' && r6m.corFaixaMuda === 3, 'faixa da camada silenciada (ele compara com e sem): o look troca e fica la')
  confere(valorDaCor(r6m) === 'Meu look (V4 muda)' && linhasDoResumo(r6m!).find((l) => l.rotulo === 'Cor')?.dica?.includes('sem a cor') === true, `e a linha diz: "${valorDaCor(r6m)}"`)
  useProject.setState({ faixasMudas: { video: [], audio: [] } })
  fecharPassoAgora()
  confere(faixaDaCamadaDeCor([], 12, [0]) === 1, 'faixa muda (V1 silenciada) e pulada: a camada iria para a V2')
  confere(faixaDaCamadaDeCor([{ faixa: 0, at: 11.5, durationSec: 5, inicioSec: 0, usarSec: null }], 12) === 1, 'clipe dele no fim da V1: V2')
  confere(faixaDaCamadaDeCor([{ faixa: 0, at: 12, durationSec: 5, inicioSec: 0, usarSec: null }], 12) === 0, 'clipe dele DEPOIS do fim do video nao conta: V1')
  confere(
    faixaDaCamadaDeCor([{ faixa: 2, at: 0, durationSec: 3600, inicioSec: 0, usarSec: 12, papel: 'cor' }, { faixa: 2, at: 4, durationSec: 1, inicioSec: 0, usarSec: null }], 12) === 0,
    'a faixa dela foi ocupada por um clipe dele: desce para a mais baixa livre',
  )

  // ------------------------------------ 7. so a musica; cor desligada
  secao('7. So a musica; cor desligada')
  const antes7 = useProject.getState().sobreposicoes
  await useProject.getState().edicaoRapida(SO_A_MUSICA)
  fecharPassoAgora()
  confere(useProject.getState().sobreposicoes === antes7, 'so a musica: a camada de cor nem e tocada')
  await rodar({ ...CONFIG_DA_EDICAO_RAPIDA_PADRAO, cor: false, rosto: false })
  confere(useProject.getState().sobreposicoes === antes7, 'Cor desligada nas Configuracoes: a camada que estava fica')
  respostas.corPreset = 'Meu look'
  const antesDeTudo = useProject.getState()
  const tudo = await rodar({ ...CONFIG_DA_EDICAO_RAPIDA_PADRAO, rosto: false })
  const depoisDeTudo = useProject.getState()
  console.log(`  resumo: ${JSON.stringify(tudo)}`)
  confere(
    tudo?.cor === 'Meu look' && daEdicao().length === 1 && depoisDeTudo.trilhas !== antesDeTudo.trilhas && depoisDeTudo.trilhas.some((t) => t.papel === 'impacto'),
    'tudo ligado: a cor troca junto com sons e musica',
  )
  desfazer()
  const voltou = useProject.getState()
  confere(voltou.sobreposicoes === antesDeTudo.sobreposicoes && voltou.trilhas === antesDeTudo.trilhas && voltou.captionColor === antesDeTudo.captionColor, 'um Ctrl+Z desfaz a rodada inteira (cor, som e legenda juntos)')
  refazer()
  respostas.corPreset = null

  // ------------------------------------------------------ 8. render
  secao('8. O render e o arquivo')
  const s8 = useProject.getState()
  const props = toRenderProps(s8.plan!, s8.images, [], null, undefined, undefined, 12, {}, 'short', s8.sobreposicoes)
  const filtro = props.sobreposicoes.filter((o) => o.tipo === 'ajuste')
  const doVideo = filtro.find((o) => o.from === 0 && o.durationInFrames === Math.ceil(12 * VIDEO_FPS))
  confere(filtro.length === 2 && doVideo !== undefined, `a camada vai ao render do quadro 0 ao ${Math.ceil(12 * VIDEO_FPS)} (o video inteiro), a dele tambem`)
  confere(JSON.stringify(doVideo?.cor) === JSON.stringify(daEdicao()[0]!.cor) && doVideo?.faixa === daEdicao()[0]!.faixa, 'com o look e a faixa')
  const salva = (({ url: _u, ...resto }) => resto)(daEdicao()[0]!)
  const lida = sobreposicaoSchema.parse(JSON.parse(JSON.stringify(salva)))
  confere(lida.papel === 'cor' && JSON.stringify(lida) === JSON.stringify(salva), 'o .anirecap guarda a camada inteira, com o papel')
  const antiga = sobreposicaoSchema.parse({ id: 'x', path: '', fileName: 'Camada de ajuste', tipo: 'ajuste', faixa: 0, at: 0, durationSec: 3600 })
  confere(!('papel' in antiga), 'projeto antigo (sem papel) abre igual: o campo nao aparece')

  pararUndo()
  console.log(`\n${falhas === 0 ? 'TUDO OK' : `${falhas} FALHA(S)`}`)
  process.exit(falhas === 0 ? 0 : 1)
}

void main()
