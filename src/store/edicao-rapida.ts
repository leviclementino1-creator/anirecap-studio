import { create } from 'zustand'
import type { PublicSettings } from '@shared/channels'
import type { PedidoDeMontagem } from '@shared/cenas'
import {
  captionStyleSchema,
  type AudioAnalysis,
  type CaptionStyle,
  type PapelDaTrilha,
  type TrechoDeAudioSalvo,
} from '@shared/contract'
import {
  CONFIG_DA_EDICAO_RAPIDA_PADRAO,
  chaveDoPedidoDeRosto,
  faixasDaEdicaoRapida,
  naFaixaDaEdicaoRapida,
  PREFERENCIAS_DA_EDICAO_RAPIDA_PADRAO,
  preferenciasDaEdicaoRapidaSchema,
  secoesParaSom,
  trilhasDoPlanoDeSom,
  type ConfigDaEdicaoRapida,
  type PedidoDeRosto,
  type PlanoDeSom,
  type PreferenciasDaEdicaoRapida,
  type ResumoDaEdicaoRapida,
  type RostosDoLote,
} from '@shared/edicao-rapida'
// So o TIPO: project.ts importa este arquivo (a action edicaoRapida), e um
// valor daqui de volta fecharia o ciclo.
import type { ProjectState } from './project'
import { CAMPOS, type CampoDoDocumento, type Documento } from './documento'

/**
 * A EDICAO RAPIDA no editor (agente C, 14/10). O contrato e as funcoes puras
 * moram em shared/edicao-rapida.ts; o som e do main (agente A) e o rosto pelo
 * motor tambem (agente B). Aqui fica:
 *
 * - prepararEdicaoRapida: TODO o trabalho assincrono (plano de som, ondas dos
 *   arquivos, rostos, recorte das imagens paradas, estilo salvo) ANTES de
 *   mexer no projeto. Devolve um `aplicar(estado)` que a action edicaoRapida
 *   (src/store/project.ts) passa a UM set() so: a Edicao rapida inteira e um
 *   passo de Ctrl+Z (o desfazer fotografa o documento a cada rajada de
 *   mudancas, ver ./undo.ts).
 * - useEdicaoRapida: o que a interface lembra (as preferencias das
 *   Configuracoes, o ultimo resumo e quem esta rodando).
 *
 * Tudo continua editavel: os trechos de som entram nas faixas de audio com
 * `papel` (cada papel na sua faixa, arquivo inteiro como sobra), o foco e o
 * mesmo focusX/focusY que ele arrasta, e o estilo e o mesmo do painel.
 * Rodar de novo troca SO o que a Edicao rapida tinha posto.
 */

// =========================================================== preparar/aplicar

/** O que a action le do estado (o resto do store nao interessa). */
export type EstadoParaEdicaoRapida = Pick<
  ProjectState,
  'audio' | 'images' | 'plan' | 'transcript' | 'studio' | 'trilhas' | 'formato' | 'fontes'
>

export interface OpcoesDaEdicaoRapida {
  /** Forca esta musica (o "trocar" do controle de musica, pelo dialogo). */
  musicaForcada?: string | null
}

/** O que vem de project.ts sem importar valor de la (ver o import de tipo acima). */
export interface DepsDaEdicaoRapida {
  /** A onda reduzida que o store guarda no trecho (ondaDoTrecho). */
  onda: (a: { peaks: readonly number[]; rms?: readonly number[] }) => { peaks: number[]; rms: number[] }
}

type TrechoComUrl = TrechoDeAudioSalvo & { url: string }

export interface PreparoDaEdicaoRapida {
  /**
   * O patch do documento, calculado sobre o estado ATUAL (ele pode ter mexido
   * enquanto o som e o rosto rodavam): trilhas dele ficam, foco mexido a mao
   * no meio fica. {} = nada a aplicar.
   */
  aplicar: (atual: EstadoParaEdicaoRapida) => Partial<ProjectState>
  resumo: ResumoDaEdicaoRapida
  /**
   * A musica que entrou. null = nenhuma. O historico de "ja usada" NAO e
   * gravado aqui: so ao salvar/renderizar (registrarMusicaDoProjeto).
   */
  musica: string | null
}

/**
 * O patch sem os campos que ja estao IGUAIS no projeto (comparados por valor).
 * Rodar duas vezes com o mesmo resultado (so o rosto, focos iguais; a legenda
 * ja no estilo salvo) nao vira passo de Ctrl+Z -- e o resumo sabe que nada
 * mudou, em vez de oferecer um "Desfazer" que desfaria a edicao anterior.
 */
export function soOQueMuda(patch: Partial<ProjectState>, atual: Partial<ProjectState>): Partial<ProjectState> {
  const saida: Partial<ProjectState> = {}
  for (const [campo, valor] of Object.entries(patch) as [keyof ProjectState, unknown][]) {
    const agora = atual[campo]
    if (valor === agora) continue
    if (typeof valor === 'object' && valor !== null && JSON.stringify(valor) === JSON.stringify(agora)) continue
    // Os SFX refeitos nascem com id novo (prefixo da rodada) e a musica mantida
    // vem antes deles: iguais em todo o resto, nao sao mudanca (a pasta de
    // musicas vazia oferecia um "Desfazer" que nao mudava nada).
    if (campo === 'trilhas' && trilhasPorValor(valor) === trilhasPorValor(agora)) continue
    ;(saida as Record<string, unknown>)[campo] = valor
  }
  return saida
}

/** As trilhas sem o id e sem a ordem do array (a faixa e o tempo ja dizem onde ficam). */
function trilhasPorValor(v: unknown): string | null {
  if (!Array.isArray(v)) return null
  const cada = v.map((t: unknown) => JSON.stringify(t !== null && typeof t === 'object' ? { ...t, id: '' } : t))
  return JSON.stringify(cada.sort())
}

/**
 * Foco que ELE pos: sem a marca de automatico e fora do centro. Esse a Edicao
 * rapida nao toca (a mao dele manda).
 */
export function focoDaMao(img: { focusX: number; focusY: number; focusAuto?: boolean }): boolean {
  return !img.focusAuto && (img.focusX !== 0.5 || img.focusY !== 0.5)
}

const RE_EPISODIO = /^ep_[0-9a-f]{40}$/

export async function prepararEdicaoRapida(
  estado: EstadoParaEdicaoRapida,
  config: ConfigDaEdicaoRapida,
  opcoes: OpcoesDaEdicaoRapida,
  deps: DepsDaEdicaoRapida,
): Promise<PreparoDaEdicaoRapida> {
  const avisos: string[] = []
  // Parte que quebra vira aviso: as outras seguem (melhor esforco).
  const seguro = <T,>(nome: string, p: Promise<T>): Promise<T | null> =>
    p.catch((err: unknown) => {
      avisos.push(`${nome}: ${err instanceof Error ? err.message : String(err)}`)
      return null
    })
  // As tres partes sao independentes: correm juntas (o rosto pelo motor e a
  // mais lenta; o som mede arquivos no ffmpeg).
  const [som, rostos, legenda] = await Promise.all([
    config.sfx || config.musica ? seguro('Sem som', prepararSom(estado, config, opcoes, deps, avisos)) : Promise.resolve(null),
    config.rosto ? seguro('Sem rosto', prepararRostos(estado, avisos)) : Promise.resolve(null),
    config.legenda ? seguro('Legenda sem o estilo salvo', prepararLegenda(estado, avisos)) : Promise.resolve(null),
  ])

  const aplicar = (atual: EstadoParaEdicaoRapida): Partial<ProjectState> => {
    const patch: Partial<ProjectState> = {}
    if (som && som.papeis.size > 0) {
      // As faixas de novo sobre o estado atual: ele pode ter posto trilha numa
      // faixa nova enquanto isto rodava. Cada papel fica na faixa que ja tinha
      // (so muda se ele pos um som la no mesmo trecho de tempo).
      const ficam = atual.trilhas.filter((t) => !t.papel || !som.papeis.has(t.papel))
      const entram = naFaixaDaEdicaoRapida(
        atual.trilhas,
        som.novas.filter((t) => t.papel !== undefined && som.papeis.has(t.papel)),
        som.papeis,
      )
      patch.trilhas = [...ficam, ...entram]
    }
    if (rostos && rostos.porImagem.size > 0) {
      let mudou = false
      const images = atual.images.map((img) => {
        const novo = rostos.porImagem.get(img.id)
        if (!novo) return img
        // Mexeu no foco enquanto o motor rodava: a mao dele ganha.
        if (img.focusX !== novo.antes.focusX || img.focusY !== novo.antes.focusY) return img
        mudou = true
        return { ...img, focusX: novo.focusX, focusY: novo.focusY, focusAuto: novo.focusAuto, ...(novo.url ? { url: novo.url } : {}) }
      })
      if (mudou) patch.images = images
    }
    if (legenda) Object.assign(patch, legenda)
    return patch
  }

  const aplicadas = som ? som.novas.filter((t) => t.papel !== undefined && som.papeis.has(t.papel)) : []
  const musica = aplicadas.find((t) => t.papel === 'musica')?.path ?? null
  // Sem musica nova (pasta vazia): a que estava no projeto fica -- o resumo diz.
  const mantida = config.musica && !musica ? (estado.trilhas.find((t) => t.papel === 'musica')?.fileName ?? null) : null
  const resumo: ResumoDaEdicaoRapida = {
    config,
    whoosh: aplicadas.filter((t) => t.papel === 'whoosh').length,
    impacto: aplicadas.filter((t) => t.papel === 'impacto').length,
    musica: musica ? (aplicadas.find((t) => t.papel === 'musica')?.fileName ?? null) : null,
    rostos: rostos ? { comRosto: rostos.comRosto, total: rostos.total, fonte: rostos.fonte } : null,
    legenda: legenda !== null,
    avisos: [...new Set(avisos)],
    musicaMantida: mantida,
  }
  return { aplicar, resumo, musica }
}

// ------------------------------------------------------------------- som

async function prepararSom(
  e: EstadoParaEdicaoRapida,
  config: ConfigDaEdicaoRapida,
  opcoes: OpcoesDaEdicaoRapida,
  deps: DepsDaEdicaoRapida,
  avisos: string[],
): Promise<{ novas: TrechoComUrl[]; papeis: Set<PapelDaTrilha>; plano: PlanoDeSom } | null> {
  const duracaoSec = e.audio?.durationSec ?? 0
  if (!(duracaoSec > 0)) return null
  const atuais = [...new Set(e.trilhas.filter((t) => t.papel === 'musica').map((t) => t.path))]
  const forcada = opcoes.musicaForcada ?? null
  const r = await window.dangai.planejarSom({
    sfx: config.sfx,
    musica: config.musica,
    duracaoSec,
    cortes: [...new Set((e.plan?.scenes ?? []).map((s) => s.start))].sort((a, b) => a - b),
    secoes: secoesParaSom({
      studio: e.studio,
      images: e.images,
      plan: e.plan,
      words: e.transcript?.words ?? [],
      duracaoSec,
    }),
    // Rodar de novo troca a musica (a de agora so volta se nao houver outra).
    evitarMusicas: forcada ? [] : atuais.slice(0, 50),
    musicaForcada: forcada,
    // A narracao: cada SFX tambem fica abaixo da voz NAQUELE instante.
    vozPath: e.audio?.path ?? null,
  })
  if (!r.ok) {
    avisos.push(`Sem som: ${r.error}`)
    return null
  }
  const plano = r.value
  // O main ja diz por que nao ha musica (pasta vazia, sumida, sem pasta).
  avisos.push(...plano.avisos)

  const trechos = trilhasDoPlanoDeSom(plano, {
    duracaoSec,
    faixas: faixasDaEdicaoRapida(e.trilhas),
    prefixoId: `er-${Date.now().toString(36)}`,
  })
  // A URL do servidor local e a onda de cada ARQUIVO (uma vez por arquivo).
  const analises = new Map<string, AudioAnalysis | null>()
  for (const path of new Set(trechos.map((t) => t.path))) {
    const a = await window.dangai.analyzeAudio(path)
    analises.set(path, a.ok ? a.value : null)
    if (!a.ok) avisos.push(`Nao deu para ler ${path.split(/[\\/]/).pop() ?? path}: ${a.error}`)
  }
  const novas: TrechoComUrl[] = trechos.flatMap((t) => {
    const a = analises.get(t.path)
    return a ? [{ ...t, ...deps.onda(a), url: a.url }] : []
  })
  // So troca o papel que tem substituto: pasta vazia nao apaga o que ja estava.
  const papeis = new Set<PapelDaTrilha>()
  if (config.sfx && novas.some((t) => t.papel === 'whoosh' || t.papel === 'impacto')) {
    papeis.add('whoosh')
    papeis.add('impacto')
  }
  if (config.musica && novas.some((t) => t.papel === 'musica')) papeis.add('musica')
  return { novas, papeis, plano }
}

// ----------------------------------------------------------------- rosto

interface FocoNovo {
  focusX: number
  focusY: number
  focusAuto: boolean
  /** O recorte 9:16 novo (imagem parada ou clipe). Ausente = o recorte falhou (o foco nao entra). */
  url?: string
  /** O foco de quando comecou: se mudar ate o fim, a mao dele ganha. */
  antes: { focusX: number; focusY: number }
}

/**
 * O rosto de cada imagem do plano, pelo lote do main (motor YOLO; sem motor,
 * o detector antigo). Olha o trecho que o bloco MAIS LONGO daquela imagem
 * toca, e prefere quem a frase daquele trecho cita (studio.secoes).
 *
 * Fica de fora: foco que ele pos a mao (focoDaMao) e tela dividida (cada
 * metade tem outro quadro, e o foco do lote e calculado para o quadro cheio).
 */
async function prepararRostos(
  e: EstadoParaEdicaoRapida,
  avisos: string[],
): Promise<{ porImagem: Map<string, FocoNovo>; comRosto: number; total: number; fonte: RostosDoLote['fonte'] } | null> {
  const plan = e.plan
  if (!plan || e.images.length === 0) return null
  const divididas = new Set<number>()
  const maisLonga = new Map<number, { de: number; dura: number; start: number; end: number }>()
  for (const s of plan.scenes) {
    if (s.imageIndexB !== null) {
      divididas.add(s.imageIndex)
      divididas.add(s.imageIndexB)
      continue
    }
    const dura = Math.max(s.end - s.start, 0)
    const antes = maisLonga.get(s.imageIndex)
    if (!antes || dura > antes.dura) maisLonga.set(s.imageIndex, { de: s.sourceStart, dura, start: s.start, end: s.end })
  }
  const frases = (e.studio?.secoes ?? []).flatMap((sec) => sec.frases)
  const nomesDoTrecho = (start: number, end: number): string[] => {
    let melhor: { n: number; nomes: string[] } | null = null
    for (const f of frases) {
      const n = Math.min(end, f.fim) - Math.max(start, f.inicio)
      if (n > 0 && (!melhor || n > melhor.n)) melhor = { n, nomes: f.personagens }
    }
    return (melhor?.nomes ?? []).map((x) => x.slice(0, 120)).slice(0, 20)
  }

  const pedidos = new Map<string, PedidoDeRosto>()
  const imagensDaChave = new Map<string, number[]>()
  for (const [i, alvo] of maisLonga) {
    const img = e.images[i]
    if (!img || divididas.has(i) || focoDaMao(img)) continue
    const video = img.kind === 'video'
    const arquivo = img.invertido && img.caminhoInvertido ? img.caminhoInvertido : img.path
    const de = video ? Math.max(alvo.de, 0) : 0
    const ate = video ? de + alvo.dura : 0
    const chave = chaveDoPedidoDeRosto(arquivo, de)
    if (!pedidos.has(chave)) pedidos.set(chave, { chave, arquivo, de, ate, personagens: nomesDoTrecho(alvo.start, alvo.end) })
    imagensDaChave.set(chave, [...(imagensDaChave.get(chave) ?? []), i])
  }
  if (pedidos.size === 0) return { porImagem: new Map(), comRosto: 0, total: 0, fonte: 'nenhum' }

  const episodioId = e.studio?.episodioId ?? null
  const r = await window.dangai.rostosDosPedacos({
    pedidos: [...pedidos.values()],
    formato: e.formato,
    episodioId: episodioId && RE_EPISODIO.test(episodioId) ? episodioId : null,
    tetoMs: 120_000,
    motor: true,
  })
  if (!r.ok) {
    avisos.push(`Sem rosto: ${r.error}`)
    return null
  }
  avisos.push(...r.value.avisos)

  const porImagem = new Map<string, FocoNovo>()
  for (const f of r.value.focos) {
    if (f.fonte === null) continue
    for (const i of imagensDaChave.get(f.chave) ?? []) {
      const img = e.images[i]
      if (!img || (img.focusX === f.focusX && img.focusY === f.focusY && img.focusAuto === f.focusAuto)) continue
      porImagem.set(img.id, { focusX: f.focusX, focusY: f.focusY, focusAuto: f.focusAuto, antes: { focusX: img.focusX, focusY: img.focusY } })
    }
  }
  // O recorte 9:16 e refeito agora para TODO bloco, imagem parada e clipe: o
  // preview e o render leem image.url (o recorte pronto). So trocar o foco do
  // clipe deixava o quadro antigo ate reabrir o projeto, e ai o Ctrl+Z ja nao
  // voltava o quadro (auditoria de 14/10). O mesmo pedido do commitImageFocus
  // (copia invertida na chave dela); ~0,3 s por clipe, 4 de cada vez.
  await emParalelo([...porImagem.entries()], 4, async ([id, foco]) => {
    const img = e.images.find((x) => x.id === id)
    if (!img) {
      porImagem.delete(id)
      return
    }
    const feito = await window.dangai.reframeImage({
      id: img.invertido ? `${img.id}-inv` : img.id,
      path: img.invertido && img.caminhoInvertido ? img.caminhoInvertido : img.path,
      focusX: foco.focusX,
      focusY: foco.focusY,
    })
    if (feito.ok) foco.url = feito.value
    else porImagem.delete(id)
  })
  return { porImagem, comRosto: r.value.comRosto, total: r.value.total, fonte: r.value.fonte }
}

/** Roda `tarefa` em cada item, no maximo `juntos` ao mesmo tempo. */
async function emParalelo<T>(itens: readonly T[], juntos: number, tarefa: (item: T) => Promise<void>): Promise<void> {
  let proximo = 0
  const trabalhador = async (): Promise<void> => {
    while (proximo < itens.length) {
      const item = itens[proximo++]!
      await tarefa(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(juntos, itens.length) }, trabalhador))
}

// --------------------------------------------------------------- legenda

/** Os campos do store que o estilo salvo descreve (o mesmo de estilo-legenda.ts aplicarEstilo). */
type PatchDeLegenda = Partial<
  Pick<
    ProjectState,
    | 'captionColor'
    | 'captionY'
    | 'captionScale'
    | 'captionFont'
    | 'captionAnimation'
    | 'captionAnimationFrames'
    | 'captionAnimationCurve'
    | 'captionMark'
    | 'captionShadow'
    | 'captionStroke'
  >
>

/**
 * O estilo salvo dele (settings.captionStyle) nos campos do projeto. A fonte
 * vai pelo NOME, se estiver na pasta de fontes (senao, a embutida -- o mesmo do
 * aplicarPreset). As regras da legenda nao moram no projeto: ja sao as dele.
 */
export function patchDoEstilo(estilo: CaptionStyle, fontes: readonly { nome: string; url: string }[]): PatchDeLegenda {
  const patch: PatchDeLegenda = {}
  if (estilo.color !== undefined) patch.captionColor = estilo.color
  if (estilo.y !== undefined) patch.captionY = estilo.y
  if (estilo.scale !== undefined) patch.captionScale = estilo.scale
  if (estilo.animation !== undefined) patch.captionAnimation = estilo.animation
  if (estilo.animationFrames !== undefined) patch.captionAnimationFrames = estilo.animationFrames
  if (estilo.animationCurve !== undefined) patch.captionAnimationCurve = estilo.animationCurve
  if (estilo.mark !== undefined) patch.captionMark = estilo.mark
  if (estilo.shadow !== undefined) patch.captionShadow = estilo.shadow
  if (estilo.stroke !== undefined) patch.captionStroke = estilo.stroke
  if (estilo.fontNome !== undefined) {
    const achada = estilo.fontNome ? fontes.find((f) => f.nome === estilo.fontNome) : undefined
    patch.captionFont = achada ? { nome: achada.nome, url: achada.url } : null
  }
  return patch
}

async function prepararLegenda(e: EstadoParaEdicaoRapida, avisos: string[]): Promise<PatchDeLegenda | null> {
  const r = await window.dangai.getSettings()
  if (!r.ok) {
    avisos.push(`Legenda sem o estilo salvo: ${r.error}`)
    return null
  }
  const lido = r.value.captionStyle ? captionStyleSchema.safeParse(r.value.captionStyle) : null
  if (!lido?.success) {
    avisos.push('Sem estilo de legenda salvo: a legenda ficou como estava.')
    return null
  }
  return patchDoEstilo(lido.data, e.fontes)
}

// ======================================================= estado da interface

export type QualRoda = 'tudo' | 'musica'

interface EstadoDaInterface {
  /** As preferencias das Configuracoes (settings.edicaoRapidaPadrao). null = ainda nao lidas. */
  padrao: PreferenciasDaEdicaoRapida | null
  /** O ultimo resumo (do botao ou do "Abrir no editor"). */
  resumo: ResumoDaEdicaoRapida | null
  /** O recado do resumo aberto na barra. */
  resumoAberto: boolean
  /** De onde veio o resumo: do botao (da para desfazer) ou da montagem do passo 4. */
  origemDoResumo: 'editor' | 'montagem'
  /** Quem esta rodando agora: o botao inteiro ou so a musica. */
  rodando: QualRoda | null
  /**
   * O documento logo depois da rodada do botao (fotografia, ver documento.ts).
   * O "Desfazer" do resumo so vale enquanto o projeto for ESTE: qualquer outra
   * mudanca (Ctrl+Z, edicao) fecha o resumo. null = a rodada nao mudou nada.
   */
  depois: Documento | null
  /** As Configuracoes abrem rolando ate a secao Edicao rapida (o "Ajustar") ou os Sons de transicao. */
  rolarAteAjustes: false | 'edicao' | 'sons'
  carregarPadrao: () => Promise<PreferenciasDaEdicaoRapida>
  /** Grava nas Configuracoes. Devolve as settings novas (null = falhou). */
  gravarPadrao: (p: PreferenciasDaEdicaoRapida) => Promise<PublicSettings | null>
  /** As settings chegaram por outro caminho (a tela das Configuracoes). */
  lerDasSettings: (s: Pick<PublicSettings, 'edicaoRapidaPadrao'>) => void
  mostrarResumo: (r: ResumoDaEdicaoRapida, origem?: 'editor' | 'montagem', depois?: Documento | null) => void
  fecharResumo: () => void
  marcarRodando: (qual: QualRoda | null) => void
  pedirRolarAteAjustes: (ate: false | 'edicao' | 'sons') => void
}

export const useEdicaoRapida = create<EstadoDaInterface>((set, get) => ({
  padrao: null,
  resumo: null,
  resumoAberto: false,
  origemDoResumo: 'editor',
  rodando: null,
  depois: null,
  rolarAteAjustes: false,

  carregarPadrao: async () => {
    // Ler as settings nunca pode travar o "Abrir no editor": sem leitura, vale
    // o que ja estava (ou o padrao de fabrica, ligada).
    const r = await window.dangai.getSettings().catch(() => null)
    const p = preferenciasDaEdicaoRapidaSchema
      .catch(PREFERENCIAS_DA_EDICAO_RAPIDA_PADRAO)
      .parse(r?.ok && r.value ? (r.value.edicaoRapidaPadrao ?? {}) : (get().padrao ?? {}))
    set({ padrao: p })
    return p
  },

  gravarPadrao: async (p) => {
    // Otimista: a caixinha responde na hora; falhou, volta ao que o main tem.
    set({ padrao: p })
    const r = await window.dangai.saveSettings({ edicaoRapidaPadrao: p })
    if (!r.ok) {
      await get().carregarPadrao()
      return null
    }
    set({ padrao: preferenciasDaEdicaoRapidaSchema.catch(PREFERENCIAS_DA_EDICAO_RAPIDA_PADRAO).parse(r.value.edicaoRapidaPadrao ?? {}) })
    return r.value
  },

  lerDasSettings: (s) =>
    set({ padrao: preferenciasDaEdicaoRapidaSchema.catch(PREFERENCIAS_DA_EDICAO_RAPIDA_PADRAO).parse(s.edicaoRapidaPadrao ?? {}) }),

  mostrarResumo: (r, origem = 'editor', depois = null) => set({ resumo: r, resumoAberto: true, origemDoResumo: origem, depois }),
  fecharResumo: () => set({ resumoAberto: false, depois: null }),
  marcarRodando: (qual) => set({ rodando: qual }),
  pedirRolarAteAjustes: (ate) => set({ rolarAteAjustes: ate }),
}))

/** O documento ainda e o da fotografia (nada mudou desde a Edicao rapida). */
export function mesmoDocumento(foto: Documento, estado: Pick<ProjectState, CampoDoDocumento>): boolean {
  return CAMPOS.every((campo) => foto[campo] === estado[campo])
}

/**
 * A musica que o projeto TEM agora vai para o historico de "ja usada" (uma
 * entrada por projeto, sobrescrita). Chamado ao SALVAR e ao RENDERIZAR, e nao
 * ao aplicar: uma musica experimentada e desfeita com Ctrl+Z nao conta como
 * usada (avaliacao de 14/10). O projeto sem arquivo ainda (render antes de
 * salvar) vale pela narracao. Falhar so perde o "sem repetir" desta vez.
 */
export function registrarMusicaDoProjeto(
  estado: Pick<ProjectState, 'trilhas' | 'projectPath' | 'audio'>,
): void {
  const projeto = estado.projectPath ?? estado.audio?.path ?? null
  if (!projeto) return
  const musica = estado.trilhas.find((t) => t.papel === 'musica')?.path ?? null
  void window.dangai.registrarMusicaUsada(musica, projeto).catch(() => undefined)
}

/** O config das Configuracoes (lido agora, para valer o que ele acabou de mudar). */
export async function configDoPadrao(): Promise<ConfigDaEdicaoRapida> {
  const p = await useEdicaoRapida.getState().carregarPadrao()
  return p.config ?? CONFIG_DA_EDICAO_RAPIDA_PADRAO
}

/** O pedido do "Abrir no editor" (passo 4): com a Edicao rapida se a caixinha estiver ligada. */
export async function pedidoDaMontagem(): Promise<PedidoDeMontagem> {
  const p = useEdicaoRapida.getState().padrao ?? (await useEdicaoRapida.getState().carregarPadrao())
  return { edicaoRapida: p.aoAbrirNoEditor ? p.config : null }
}

/** So a musica: o controle de musica da barra (por, trocar). */
export const SO_A_MUSICA: ConfigDaEdicaoRapida = { sfx: false, musica: true, rosto: false, legenda: false }

/** Os trechos de musica que a Edicao rapida pos (o controle de musica mexe neles). */
export function trechosDaMusica<T extends Pick<TrechoDeAudioSalvo, 'papel'>>(trilhas: readonly T[]): T[] {
  return trilhas.filter((t) => t.papel === 'musica')
}

/** Uma linha do resumo para a tela, ASCII e curta. */
export function linhasDoResumo(
  r: ResumoDaEdicaoRapida,
  origem: 'editor' | 'montagem' = 'editor',
): { rotulo: string; valor: string }[] {
  const linhas: { rotulo: string; valor: string }[] = []
  if (r.config.sfx) {
    const n = r.whoosh + r.impacto
    linhas.push({ rotulo: 'Sons', valor: n === 0 ? 'nenhum' : `${r.whoosh} whoosh, ${r.impacto} ${r.impacto === 1 ? 'impacto' : 'impactos'}` })
  }
  if (r.config.musica) {
    const tirar = (nome: string): string => nome.replace(/\.[^.]+$/, '')
    linhas.push({
      rotulo: 'Musica',
      valor: r.musica ? tirar(r.musica) : r.musicaMantida ? `${tirar(r.musicaMantida)} (mantida)` : 'nenhuma',
    })
  }
  if (r.config.rosto && r.rostos) {
    const quem = r.rostos.fonte === 'motor' ? ' (motor)' : r.rostos.fonte === 'lbp' ? ' (antigo)' : r.rostos.fonte === 'misto' ? ' (motor + antigo)' : ''
    linhas.push({ rotulo: 'Rosto', valor: `${r.rostos.comRosto} de ${r.rostos.total}${quem}` })
  }
  if (r.config.legenda) {
    linhas.push({
      rotulo: 'Legenda',
      valor: r.legenda ? 'estilo salvo' : origem === 'montagem' ? 'padrao do app (sem estilo salvo)' : 'como estava (sem estilo salvo)',
    })
  }
  return linhas
}
