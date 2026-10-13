import { create } from 'zustand'
import { classifyFile } from '@shared/channels'
import type {
  EpisodeIndex,
  EpisodioEncontrado,
  Exclusao,
  FimDaAnalise,
  IndexarEpisodioArgs,
  Motor,
  PalpiteDoEpisodio,
  ProgressoDaAnalise,
  SondaDoEpisodio,
  StatusDoMotor,
} from '@shared/episodio'
import { useProject } from './project'

/**
 * O ASSISTENTE "GERAR RECAP", passo 1 (Episodio).
 *
 * Store propria, fora do documento: nada daqui entra no undo, no autosave nem
 * no arquivo do projeto. O assistente prepara o EPISODIO (cenas cortadas,
 * legenda com quem fala, OP/ED marcadas) e o que ele produz mora no disco, no
 * episodio.json da biblioteca do Studio -- nao no projeto aberto.
 *
 * O estado sobrevive a fechar o assistente: a analise leva minutos, e fechar a
 * tela para olhar outra coisa nao pode jogar fora o andamento. Reabrir mostra
 * exatamente onde parou.
 */

/**
 * Em que pe esta o passo 1. A tela mostra uma secao por fase; os dados (sonda,
 * busca, indice) ficam guardados a parte para a fase seguinte reaproveitar.
 */
export type FaseDoEpisodio =
  /** Nenhum arquivo ainda: a area de soltar. */
  | 'vazio'
  /** Lendo medidas, faixas e palpite do arquivo. */
  | 'sondando'
  /** Arquivo lido; busca e motor chegando ou ja na tela. Esperando a escolha. */
  | 'escolha'
  /** O motor esta cortando (e talvez reconhecendo personagens). */
  | 'analisando'
  /** Lendo a legenda e montando o episodio.json. */
  | 'indexando'
  /** Indice na mao: resumo e regua de OP/ED. */
  | 'pronto'

export interface JobDaAnalise {
  /** null enquanto o pedido esta no ar e o main ainda nao devolveu o id. */
  id: string | null
  motor: Motor
  reconhecer: boolean
  /** Date.now() do pedido, para o tempo decorrido. */
  inicio: number
  cancelando: boolean
}

export interface DescobertaPendente {
  motivo: 'anime-nao-encontrado' | 'sem-referencias'
  motor: Motor
  erro: string
}

interface EstadoDoGerar {
  aberto: boolean
  fase: FaseDoEpisodio
  arquivo: string | null
  sonda: SondaDoEpisodio | null
  /** O palpite como o usuario deixou (comeca no da sonda). */
  palpite: PalpiteDoEpisodio | null
  /** `index` absoluto da faixa escolhida. null = sem legenda. */
  faixaLegenda: number | null
  /** null = ainda procurando (ou nem comecou). [] = nao achou. */
  busca: EpisodioEncontrado[] | null
  procurando: boolean
  /** O palpite com que a busca rodou, para saber se vale procurar de novo. */
  palpiteDaBusca: string | null
  motor: StatusDoMotor | null
  motorErro: string | null
  /** Um statusDoMotor no ar. Segura o segundo pedido e mostra "Conferindo..." no botao. */
  conferindoMotor: boolean
  reconhecer: boolean
  job: JobDaAnalise | null
  progresso: ProgressoDaAnalise | null
  /** As etapas por onde a analise ja passou (o motor nao anda em ordem fixa). */
  etapasVistas: string[]
  descoberta: DescobertaPendente | null
  /** A linha de andamento da indexacao. null fora dela. */
  indexando: string | null
  indice: EpisodeIndex | null
  /**
   * O tempo de motor gasto NESTE episodio, somando as rodadas: uma que cortou
   * e parou no reconhecimento (minutos) mais o "cortar sem reconhecer" que
   * reaproveitou o corte (segundos). So a ultima mentiria "feita em 9s".
   */
  ultimaAnalise: { motor: Motor; segundos: number; rodadas: number } | null
  /** Todas as rodadas do motor neste episodio (as que falharam tambem). Zera ao trocar de arquivo. */
  tempoDoMotor: { segundos: number; rodadas: number }
  /**
   * De onde vieram as fotos do elenco na ultima analise deste episodio, quando
   * nao foi a busca online ('Corte Cenas', da reserva do elenco). A tela diz
   * "Fotos: Corte Cenas" no resumo. null = busca online, ou nao se sabe.
   */
  fotosDoElenco: string | null
  /**
   * O motor (este) cortou o episodio e parou no reconhecimento (sem fotos do
   * elenco): as cenas estao no disco, mas sem shots.json a busca nao as ve. A
   * tela nao pode dizer "nao esta na biblioteca". null = nao aconteceu.
   */
  corteSemIndice: Motor | null
  /** As marcacoes da regua como estao na tela (o indice guarda as salvas). */
  exclusoes: Exclusao[]
  exclusoesMudaram: boolean
  salvando: boolean
  salvoEm: number | null
  erro: string | null
  /** Recado neutro, sem vermelho ("Analise cancelada."). */
  recado: string | null
  /**
   * O "Trocar pasta" pediu as Configuracoes ja na Biblioteca do Studio, que
   * fica no fim delas. AjustesDoStudio rola ate la e apaga o pedido.
   */
  ajustesPedidos: boolean

  abrir: (path?: string) => void
  /** Abre as Configuracoes na aba Geral, roladas ate a Biblioteca do Studio. */
  abrirAjustesDoStudio: () => void
  ajustesVistos: () => void
  /**
   * A porta do assistente (botao da tela inicial, paleta): com um episodio ja
   * nele, reabre onde parou; sem, vai direto ao dialogo de escolher o .mkv --
   * um clique a menos que abrir o assistente vazio.
   */
  abrirOuEscolher: () => Promise<void>
  fechar: () => void
  /** Dialogo nativo. true = escolheu um arquivo (e o assistente abriu). */
  escolherArquivo: () => Promise<boolean>
  carregarArquivo: (path: string) => Promise<void>
  /** Volta para a area de soltar ("Trocar episodio"). */
  recomecar: () => void
  editarPalpite: (patch: Partial<PalpiteDoEpisodio>) => void
  procurarDeNovo: () => Promise<void>
  escolherFaixa: (index: number | null) => void
  definirReconhecer: (ligado: boolean) => void
  usarAnalise: (achado: EpisodioEncontrado) => Promise<void>
  analisar: (motor: Motor, reconhecer?: boolean) => Promise<void>
  cancelar: () => Promise<void>
  /** Le a legenda de novo (outra faixa) sobre a mesma pasta de cenas. */
  reindexar: () => Promise<void>
  esquecerDescoberta: () => void
  confirmarExclusao: (i: number) => void
  confirmarTodas: () => void
  removerExclusao: (i: number) => void
  ajustarExclusao: (i: number, patch: Partial<Pick<Exclusao, 'start' | 'end' | 'motivo'>>) => void
  /** Acrescenta um trecho manual e devolve o indice dele na lista. */
  marcarTrecho: (start: number, end: number) => number
  descartarMudancas: () => void
  salvarExclusoes: () => Promise<void>
  verNaBiblioteca: () => Promise<void>
  limparErro: () => void
  limparRecado: () => void
  /**
   * Pergunta ao main se o motor responde. O main guarda so a resposta pronta:
   * motor que nao respondeu e sondado de novo a cada pedido.
   */
  conferirMotor: () => Promise<void>
}

/** Trecho mais curto que a regua aceita. Menos que isso e clique, nao marcacao. */
export const TRECHO_MINIMO = 1

/** O mesmo filtro do dialogo de abrir (ipc.ts): o motor le estes. */
const EXTENSOES_DE_EPISODIO = ['mkv', 'mp4', 'm4v', 'webm', 'mov']

export function ehEpisodio(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return classifyFile(path) === 'video' && EXTENSOES_DE_EPISODIO.includes(ext)
}

function chaveDoPalpite(p: PalpiteDoEpisodio): string {
  return `${p.anime.trim().toLowerCase()}|${p.temporada}|${p.episodio}|${p.kind}`
}

/** Dentro do episodio, com pelo menos TRECHO_MINIMO de largura. */
export function normalizarExclusao(e: Exclusao, duracao: number): Exclusao {
  const fim = duracao > 0 ? duracao : Math.max(e.end, e.start + TRECHO_MINIMO)
  let start = Math.min(Math.max(0, e.start), Math.max(0, fim - TRECHO_MINIMO))
  let end = Math.min(Math.max(e.end, start + TRECHO_MINIMO), fim)
  if (end - start < TRECHO_MINIMO) start = Math.max(0, end - TRECHO_MINIMO)
  // Decimos de segundo: mais que isso e ruido de arraste, e o json fica legivel.
  start = Math.round(start * 1000) / 1000
  end = Math.round(end * 1000) / 1000
  return { ...e, start, end }
}

function emOrdem(lista: readonly Exclusao[]): Exclusao[] {
  return [...lista].sort((a, b) => a.start - b.start || a.end - b.end)
}

/** '<biblioteca>/Dr STONE/S04E24' -> 'Dr STONE': a pasta do anime, a de cima da do episodio. */
function pastaDaSerie(pastaDoEpisodio: string): string | null {
  const partes = pastaDoEpisodio.split(/[\\/]+/).filter(Boolean)
  return partes.length >= 2 ? (partes[partes.length - 2] ?? null) : null
}

/*
 * EVENTOS SEM DONO. O main devolve o jobId antes de qualquer evento do job
 * (sobe o processo em setImmediate), mas a ordem entre a resposta do invoke e
 * o primeiro webContents.send nao e algo em que valha apostar a tela. Enquanto
 * o id nao chegou, o que vier fica guardado aqui e e reaplicado na chegada.
 */
let eventosSemDono: ({ tipo: 'progresso'; p: ProgressoDaAnalise } | { tipo: 'fim'; f: FimDaAnalise })[] = []

/**
 * Cada arquivo carregado ganha uma geracao. Resposta que volta de uma geracao
 * velha (sonda lenta de um arquivo que ele ja trocou) e descartada.
 */
let geracao = 0

/** A releitura da Biblioteca do editor depois de um episodio novo do Studio. */
let sincronizando: Promise<void> | null = null

/**
 * Os receptores do progresso e do fim, preenchidos dentro do create (precisam
 * do set/get da store). Declarados ANTES dele: o create roda na hora.
 */
let receptores: {
  receberProgresso: (p: ProgressoDaAnalise) => void
  receberFim: (f: FimDaAnalise) => void
} = { receberProgresso: () => {}, receberFim: () => {} }

export const useGerar = create<EstadoDoGerar>((set, get) => {
  const limpo = {
    fase: 'vazio' as FaseDoEpisodio,
    arquivo: null,
    sonda: null,
    palpite: null,
    faixaLegenda: null,
    busca: null,
    procurando: false,
    palpiteDaBusca: null,
    progresso: null,
    etapasVistas: [],
    descoberta: null,
    indexando: null,
    indice: null,
    ultimaAnalise: null,
    tempoDoMotor: { segundos: 0, rodadas: 0 },
    fotosDoElenco: null,
    corteSemIndice: null,
    exclusoes: [],
    exclusoesMudaram: false,
    salvando: false,
    salvoEm: null,
    erro: null,
    recado: null,
  }

  const procurar = async (minhaGeracao: number): Promise<void> => {
    const { arquivo, palpite } = get()
    if (!arquivo || !palpite) return
    set({ procurando: true, busca: null })
    const r = await window.dangai.procurarEpisodio(arquivo, palpite)
    if (minhaGeracao !== geracao) return
    if (r.ok) {
      set({ procurando: false, busca: r.value, palpiteDaBusca: chaveDoPalpite(palpite) })
    } else {
      // Busca que falhou vira "nao achou", com o motivo na tela: analisar de
      // novo continua sendo um caminho valido.
      set({ procurando: false, busca: [], palpiteDaBusca: chaveDoPalpite(palpite), erro: r.error })
    }
  }

  const conferirMotor = async (): Promise<void> => {
    // Depois de pronto, a resposta e o cache do main (de graca). Antes disso
    // cada pedido sobe um probe: um por vez.
    if (get().conferindoMotor) return
    set({ conferindoMotor: true })
    const r = await window.dangai.statusDoMotor()
    if (r.ok) set({ motor: r.value, motorErro: null, conferindoMotor: false })
    else set({ motorErro: r.error, conferindoMotor: false })
  }

  const indexar = async (args: IndexarEpisodioArgs): Promise<void> => {
    const minhaGeracao = geracao
    set({ fase: 'indexando', indexando: 'Lendo a legenda...', erro: null, recado: null })
    const r = await window.dangai.indexarEpisodio(args)
    if (minhaGeracao !== geracao) return
    if (!r.ok) {
      // Ja havia um indice (trocou a legenda, ou reconheceu depois): ele continua valendo.
      if (get().indice) {
        set({ fase: 'pronto', indexando: null, erro: r.error })
        return
      }
      set({ fase: 'escolha', indexando: null, erro: r.error })
      /*
       * A analise pode ter dado certo e so a leitura da legenda falhado: as
       * cenas estao no disco. Procurar de novo poe o episodio recem-cortado no
       * cartao de "Ja analisado", e o "Usar essa analise" vira o tentar de novo
       * -- sem cortar tudo outra vez.
       */
      void procurar(minhaGeracao)
      return
    }
    set({
      fase: 'pronto',
      indexando: null,
      indice: r.value,
      exclusoes: emOrdem(r.value.exclusoes),
      exclusoesMudaram: false,
      salvoEm: null,
      faixaLegenda: r.value.faixaLegenda?.index ?? null,
    })
    /*
     * Cenas novas na biblioteca do Studio: a Biblioteca do editor so as ve
     * depois de reler. Se ela ainda nao foi aberta nesta sessao, a primeira
     * abertura ja le tudo -- reler agora seria pagar duas vezes.
     */
    if (args.origem === 'studio' && useProject.getState().library) {
      sincronizando = useProject
        .getState()
        .syncLibrary()
        .finally(() => {
          sincronizando = null
        })
    }
  }

  const receberProgresso = (p: ProgressoDaAnalise): void => {
    const job = get().job
    if (!job) return
    if (job.id === null) {
      eventosSemDono.push({ tipo: 'progresso', p })
      return
    }
    if (p.jobId !== job.id) return
    const vistas = get().etapasVistas
    set({
      progresso: p,
      etapasVistas: vistas.includes(p.etapa) ? vistas : [...vistas, p.etapa],
    })
  }

  const receberFim = (f: FimDaAnalise): void => {
    const { job, arquivo, palpite, faixaLegenda } = get()
    if (!job) return
    if (job.id === null) {
      eventosSemDono.push({ tipo: 'fim', f })
      return
    }
    if (f.jobId !== job.id) return
    const gasto = get().tempoDoMotor
    const tempoDoMotor = {
      segundos: gasto.segundos + (f.ok ? f.segundos : Math.max(0, (Date.now() - job.inicio) / 1000)),
      rodadas: gasto.rodadas + 1,
    }
    if (f.ok) {
      set({
        job: null,
        progresso: null,
        etapasVistas: [],
        corteSemIndice: null,
        tempoDoMotor,
        ultimaAnalise: { motor: f.motor, ...tempoDoMotor },
        // So muda quando a analise reconheceu: um "cortar sem personagens"
        // depois nao apaga de onde vieram as fotos de antes.
        ...(f.fotosDoElenco ? { fotosDoElenco: f.fotosDoElenco } : {}),
      })
      if (!arquivo || !palpite) return
      void indexar({
        path: arquivo,
        pastaDoEpisodio: f.pastaDoEpisodio,
        origem: f.motor === 'studio' ? 'studio' : 'ancut',
        palpite,
        faixaLegenda,
        // Acabou de cortar: um indice antigo desta pasta falaria de outras cenas.
        refazer: true,
      })
      return
    }
    /*
     * Volta para onde estava: a escolha, ou o resumo quando a analise foi um
     * "reconhecer agora" sobre um episodio ja pronto -- o indice dele continua
     * valendo.
     */
    const jaPronto = get().indice !== null
    const fimDaFila = {
      job: null,
      progresso: null,
      etapasVistas: [],
      tempoDoMotor,
      fase: (jaPronto ? 'pronto' : 'escolha') as FaseDoEpisodio,
    }
    if (f.cancelado) {
      // Cancelar nao e falha: sem vermelho.
      set({ ...fimDaFila, recado: 'Analise cancelada.' })
    } else if (f.precisaDescoberta && !jaPronto) {
      set({
        ...fimDaFila,
        descoberta: { motivo: f.precisaDescoberta, motor: job.motor, erro: f.erro },
        // Sem fotos do elenco o motor para DEPOIS de cortar; sem o anime, antes.
        corteSemIndice: f.precisaDescoberta === 'sem-referencias' ? job.motor : get().corteSemIndice,
      })
    } else if (f.precisaDescoberta) {
      /*
       * As cenas ja estao cortadas: "cortar sem personagens" nao teria o que
       * fazer. O nome do anime fica editavel ao lado do "Reconhecer agora"
       * (ResumoDoEpisodio), entao o recado diz o que fazer -- antes o campo
       * ficava travado e era um beco sem saida.
       */
      set({
        ...fimDaFila,
        erro:
          f.precisaDescoberta === 'anime-nao-encontrado'
            ? `Nao achei "${palpite?.anime.trim() ?? ''}" no AniList/MAL. Corrija o nome (em romaji) e tente de novo.`
            : 'Sem fotos do elenco desse anime, nem no Corte Cenas. Tente de novo mais tarde.',
      })
    } else {
      set({ ...fimDaFila, erro: f.erro || 'A analise parou sem dizer por que.' })
    }
  }

  // Os dois receptores ficam acessiveis a escuta, que mora fora do create.
  receptores = { receberProgresso, receberFim }

  return {
    aberto: false,
    ...limpo,
    motor: null,
    motorErro: null,
    conferindoMotor: false,
    reconhecer: true,
    job: null,
    ajustesPedidos: false,

    abrir: (path) => {
      set({ aberto: true })
      if (path && path !== get().arquivo) void get().carregarArquivo(path)
    },

    abrirAjustesDoStudio: () => {
      set({ ajustesPedidos: true })
      useProject.getState().openSettings(true)
    },
    ajustesVistos: () => set({ ajustesPedidos: false }),

    abrirOuEscolher: async () => {
      const { arquivo, job } = get()
      if (arquivo !== null || job !== null) {
        get().abrir()
        return
      }
      await get().escolherArquivo()
    },

    fechar: () => set({ aberto: false }),

    escolherArquivo: async () => {
      const r = await window.dangai.escolherEpisodio()
      if (!r.ok) {
        set({ aberto: true, erro: r.error })
        return false
      }
      if (!r.value) return false
      get().abrir(r.value)
      return true
    },

    carregarArquivo: async (path) => {
      if (get().job) {
        set({ erro: 'Tem uma analise rodando. Cancele antes de trocar de episodio.' })
        return
      }
      if (get().exclusoesMudaram) {
        set({ erro: 'Salve ou desfaca as marcacoes de OP/ED antes de trocar de episodio.' })
        return
      }
      if (!ehEpisodio(path)) {
        set({ erro: 'Solte um episodio em video (.mkv, .mp4, .m4v, .webm ou .mov).' })
        return
      }
      const minhaGeracao = ++geracao
      set({ ...limpo, fase: 'sondando', arquivo: path })
      // O motor e conferido junto: a resposta chega enquanto a sonda roda.
      // Enquanto ele nao estiver pronto, cada arquivo novo pergunta de novo.
      if (!get().motor?.studio.pronto) void conferirMotor()
      const r = await window.dangai.sondarEpisodio(path)
      if (minhaGeracao !== geracao) return
      if (!r.ok) {
        set({ ...limpo, erro: r.error })
        return
      }
      set({
        fase: 'escolha',
        sonda: r.value,
        palpite: r.value.palpite,
        faixaLegenda: r.value.legendaSugerida,
      })
      await procurar(minhaGeracao)
    },

    recomecar: () => {
      if (get().job) return
      geracao++
      set({ ...limpo })
    },

    editarPalpite: (patch) => {
      const atual = get().palpite
      if (!atual) return
      set({ palpite: { ...atual, ...patch } })
    },

    procurarDeNovo: async () => {
      await procurar(geracao)
    },

    escolherFaixa: (index) => set({ faixaLegenda: index }),

    definirReconhecer: (ligado) => set({ reconhecer: ligado }),

    usarAnalise: async (achado) => {
      const { arquivo, faixaLegenda } = get()
      if (!arquivo) return
      /*
       * O palpite passa a ser o da pasta achada. E ele que da nome a pasta do
       * indice no Studio: com o mesmo nome que a biblioteca usa, a Biblioteca
       * e o indice agrupam o episodio no mesmo lugar.
       */
      const palpite: PalpiteDoEpisodio = {
        anime: achado.anime,
        temporada: achado.temporada,
        episodio: achado.episodio,
        kind: achado.kind,
      }
      // As fotos do elenco de um corte do Studio (reserva) aparecem no resumo tambem.
      set({ palpite, descoberta: null, fotosDoElenco: achado.fotosDoElenco ?? null })
      await indexar({
        path: arquivo,
        pastaDoEpisodio: achado.pasta,
        origem: achado.origem,
        palpite,
        faixaLegenda,
      })
    },

    analisar: async (motor, reconhecer) => {
      const { arquivo, palpite, job } = get()
      if (!arquivo || !palpite || job) return
      const anime = palpite.anime.trim()
      if (!anime) {
        set({ erro: 'Falta o nome do anime.' })
        return
      }
      const comPersonagens = reconhecer ?? get().reconhecer
      /*
       * "Reconhecer agora" sobre cenas que o Studio ja cortou: a pasta do anime
       * vai junto e fica onde esta. O nome digitado passa a servir so para
       * achar o elenco -- corrigi-lo nao corta o episodio de novo noutra pasta.
       */
      const indice = get().indice
      const pastaDoAnime =
        motor === 'studio' && indice?.biblioteca.origem === 'studio' ? pastaDaSerie(indice.biblioteca.pasta) : null
      eventosSemDono = []
      set({
        fase: 'analisando',
        job: { id: null, motor, reconhecer: comPersonagens, inicio: Date.now(), cancelando: false },
        progresso: null,
        etapasVistas: [],
        descoberta: null,
        erro: null,
        recado: null,
      })
      /*
       * A escuta (escutarGerar) ja esta de pe desde que o app abriu: o que o
       * motor mandar antes do id voltar cai em eventosSemDono, e nada se perde.
       */
      const r = await window.dangai.analisarEpisodio({
        path: arquivo,
        anime,
        temporada: palpite.temporada,
        episodio: palpite.episodio,
        kind: palpite.kind,
        motor,
        reconhecer: comPersonagens,
        ...(pastaDoAnime ? { pastaDoAnime } : {}),
      })
      if (!r.ok) {
        eventosSemDono = []
        // A mesma regra do receberFim: um "reconhecer agora" sobre um
        // episodio pronto volta para o resumo, que continua valendo.
        set({ fase: get().indice ? 'pronto' : 'escolha', job: null, erro: r.error })
        return
      }
      const atual = get().job
      if (!atual) return
      set({ job: { ...atual, id: r.value } })
      // Cancelar clicado antes de o id chegar (o main pode ficar ate 15 s
      // esperando o processo anterior morrer) so foi marcado: manda agora.
      if (atual.cancelando) {
        void window.dangai.cancelarAnalise(r.value).then((c) => {
          if (c.ok) return
          const j = get().job
          if (j?.id === r.value) set({ job: { ...j, cancelando: false }, erro: c.error })
        })
      }
      const guardados = eventosSemDono
      eventosSemDono = []
      for (const e of guardados) {
        if (e.tipo === 'progresso') receptores.receberProgresso(e.p)
        else receptores.receberFim(e.f)
      }
    },

    cancelar: async () => {
      const job = get().job
      if (!job || job.cancelando) return
      set({ job: { ...job, cancelando: true } })
      if (job.id === null) return
      const r = await window.dangai.cancelarAnalise(job.id)
      // O fim (cancelado: true) chega por onAnaliseFim; aqui so o pedido falhou.
      if (!r.ok) {
        const atual = get().job
        if (atual) set({ job: { ...atual, cancelando: false }, erro: r.error })
      }
    },

    reindexar: async () => {
      const { arquivo, palpite, indice, faixaLegenda } = get()
      if (!arquivo || !palpite || !indice) return
      if (get().exclusoesMudaram) {
        set({ erro: 'Salve ou desfaca as marcacoes de OP/ED antes de ler a legenda de novo.' })
        return
      }
      await indexar({
        path: arquivo,
        pastaDoEpisodio: indice.biblioteca.pasta,
        origem: indice.biblioteca.origem,
        palpite,
        faixaLegenda,
        refazer: true,
      })
    },

    esquecerDescoberta: () => set({ descoberta: null }),

    confirmarExclusao: (i) => {
      const lista = get().exclusoes
      const alvo = lista[i]
      if (!alvo || alvo.confirmada) return
      set({
        exclusoes: lista.map((e, j) => (j === i ? { ...e, confirmada: true } : e)),
        exclusoesMudaram: true,
      })
    },

    confirmarTodas: () => {
      const lista = get().exclusoes
      if (lista.every((e) => e.confirmada)) return
      set({ exclusoes: lista.map((e) => ({ ...e, confirmada: true })), exclusoesMudaram: true })
    },

    removerExclusao: (i) => {
      const lista = get().exclusoes
      if (!lista[i]) return
      set({ exclusoes: lista.filter((_, j) => j !== i), exclusoesMudaram: true })
    },

    ajustarExclusao: (i, patch) => {
      const lista = get().exclusoes
      const alvo = lista[i]
      if (!alvo) return
      const duracao = get().indice?.fonte.duracaoSec ?? 0
      const mexeuNoTempo = patch.start !== undefined || patch.end !== undefined
      /*
       * Mexer no trecho e ter olhado para ele: vira confirmada e passa a ser
       * "do usuario" (o `porque` guarda de onde a sugestao veio). Trocar so o
       * motivo nao muda a origem.
       */
      const novo = normalizarExclusao(
        {
          ...alvo,
          ...patch,
          ...(mexeuNoTempo ? { origem: 'usuario' as const, confirmada: true } : {}),
        },
        duracao,
      )
      set({ exclusoes: lista.map((e, j) => (j === i ? novo : e)), exclusoesMudaram: true })
    },

    marcarTrecho: (start, end) => {
      const duracao = get().indice?.fonte.duracaoSec ?? 0
      const novo = normalizarExclusao(
        { start: Math.min(start, end), end: Math.max(start, end), motivo: 'manual', origem: 'usuario', confirmada: true, porque: '' },
        duracao,
      )
      const lista = [...get().exclusoes, novo]
      set({ exclusoes: lista, exclusoesMudaram: true })
      return lista.length - 1
    },

    descartarMudancas: () => {
      const indice = get().indice
      set({ exclusoes: indice ? emOrdem(indice.exclusoes) : [], exclusoesMudaram: false })
    },

    salvarExclusoes: async () => {
      const { indice, exclusoes, salvando } = get()
      if (!indice || salvando) return
      const duracao = indice.fonte.duracaoSec
      const lista = emOrdem(exclusoes.map((e) => normalizarExclusao(e, duracao)))
      set({ salvando: true, erro: null })
      const r = await window.dangai.salvarExclusoes(indice.id, lista)
      if (!r.ok) {
        set({ salvando: false, erro: r.error })
        return
      }
      set({
        salvando: false,
        indice: r.value,
        exclusoes: emOrdem(r.value.exclusoes),
        exclusoesMudaram: false,
        salvoEm: Date.now(),
      })
    },

    verNaBiblioteca: async () => {
      // Episodio recem-cortado: espera a releitura, ou o "ir ate o clipe" nao o acharia.
      if (sincronizando) await sincronizando
      const primeiro = get().indice?.planos[0]?.arquivo
      /*
       * A Biblioteca do editor so le a pasta dela e a do Studio. Um episodio
       * de fora (o Corte Cenas, sem a Biblioteca do AnCut apontada para la)
       * nao esta nela, e abrir assim caia em silencio no episodio do filtro
       * anterior. A tela ja esconde o botao nesse caso; isto e a rede -- e
       * ela le a Biblioteca antes de decidir, se ainda nao foi lida na sessao
       * (sem isso a rede pulava e abria no "Todos").
       */
      if (primeiro && useProject.getState().library === null) await useProject.getState().syncLibrary()
      const projeto = useProject.getState()
      const lida = projeto.library
      if (primeiro && lida && !lida.clips.some((c) => c.path === primeiro)) {
        set({ recado: 'Esse episodio nao esta na Biblioteca do editor. Use Abrir pasta.' })
        return
      }
      // A Biblioteca abre POR CIMA do assistente; fechar ela volta para ca.
      if (primeiro) await projeto.mostrarNaBiblioteca(primeiro)
      else await projeto.openLibrary(true)
    },

    limparErro: () => set({ erro: null }),
    limparRecado: () => set({ recado: null }),
    conferirMotor,
  }
})

/**
 * Liga a escuta do motor e da indexacao. Devolve a funcao que desliga.
 *
 * Fica de pe enquanto o assistente estiver montado -- e ele monta junto com o
 * app, aberto ou nao --, entao ja esta ouvindo antes de qualquer
 * analisarEpisodio e continua ouvindo com a tela fechada.
 */
export function escutarGerar(): () => void {
  const tirarProgresso = window.dangai.onAnaliseProgresso((p) => receptores.receberProgresso(p))
  const tirarFim = window.dangai.onAnaliseFim((f) => receptores.receberFim(f))
  const tirarIndexar = window.dangai.onIndexarProgresso((mensagem) => {
    // So substitui um andamento que existe: a ultima mensagem pode chegar
    // depois de a indexacao ter acabado e ressuscitaria o "lendo".
    if (useGerar.getState().indexando !== null) useGerar.setState({ indexando: mensagem })
  })
  return () => {
    tirarProgresso()
    tirarFim()
    tirarIndexar()
  }
}
