import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IPC,
  type AnalyzeArgs,
  type AutomountRequest,
  type AutomountResult,
  type ScriptBlocksResult,
  type DangaiBridge,
  type IpcResult,
  type MusicPick,
  type PublicSettings,
  type DropExpansion,
  type LibraryIndex,
  type Nickname,
  type NicknameSuggestion,
  type ReframeArgs,
  type SaveProjectArgs,
  type SceneDescription,
  type SettingsPatch,
  type StartRenderArgs,
  type TesteDoGemini,
  type TesteDeVoz,
  type AchadoDoAniRecap,
  type TiraDaCena,
  type LegendasSincronizadas,
  type ArquivoDaBin,
  type UpdateStatus,
} from '@shared/channels'
import type {
  AnalysisResult,
  AudioAnalysis,
  ImageAsset,
  Metadata,
  RenderProgress,
} from '@shared/contract'
import type { OpenedProject, ProjectFile } from '@shared/project-file'
import type {
  EpisodeIndex,
  EpisodioEncontrado,
  EstadoDoCorte,
  EventoDoCorte,
  FimDaAnalise,
  ProgressoDaAnalise,
  SondaDoEpisodio,
  StatusDoMotor,
} from '@shared/episodio'
import type {
  EventosGerados,
  ProgressoDoRoteiro,
  RascunhoAberto,
  RascunhoDoRecap,
  ResumoDoRascunho,
  RoteiroGerado,
  RoteiroReligado,
} from '@shared/roteiro'
import type { AudioDoTake, EstimativaDeCusto, ProgressoDaVoz, VozGerada } from '@shared/voz'
import type { EstadoDaDescoberta, EventoDaDescoberta, ResultadoDaDescoberta } from '@shared/descoberta'
import type { EstadoDoMotorRuntime } from '@shared/motor-runtime'
import type { CandidatosDaFrase, CenasGravadas, EtapaDaMontagem, ProjetoMontado } from '@shared/cenas'
import type { MedidaDoSom, MusicaDaPasta, PlanoDeSom, RostosDoLote, SfxDaEdicaoRapida } from '@shared/edicao-rapida'

/**
 * Unica superficie entre renderer e sistema. Tipada por DangaiBridge, entao um
 * metodo novo aqui exige a assinatura no contrato compartilhado.
 *
 * pathForFile existe porque File.path foi removido no Electron 32: webUtils e
 * a unica forma de obter o caminho real de um arquivo soltado na janela.
 */
const bridge: DangaiBridge = {
  pathForFile: (file) => webUtils.getPathForFile(file),

  analyzeAudio: (path) =>
    ipcRenderer.invoke(IPC.analyzeAudio, path) as Promise<IpcResult<AudioAnalysis>>,
  ondaDetalhada: (path) =>
    ipcRenderer.invoke(IPC.ondaDetalhada, path) as Promise<
      IpcResult<{ peaks: number[]; rms: number[]; durationSec: number }>
    >,

  importImages: (paths, focus, sections) =>
    ipcRenderer.invoke(IPC.importImages, paths, focus, sections) as Promise<
      IpcResult<ImageAsset[]>
    >,

  reframeImage: (args: ReframeArgs) =>
    ipcRenderer.invoke(IPC.reframeImage, args) as Promise<IpcResult<string>>,

  expandDrop: (paths) =>
    ipcRenderer.invoke(IPC.expandDrop, paths) as Promise<IpcResult<DropExpansion>>,

  readScript: (path) => ipcRenderer.invoke(IPC.readScript, path) as Promise<IpcResult<string>>,

  scanLibrary: () => ipcRenderer.invoke(IPC.scanLibrary) as Promise<IpcResult<LibraryIndex>>,

  pickLibraryDir: () =>
    ipcRenderer.invoke(IPC.pickLibraryDir) as Promise<IpcResult<string | null>>,

  libraryClipUrl: (path) =>
    ipcRenderer.invoke(IPC.libraryClipUrl, path) as Promise<IpcResult<string>>,
  libraryClipStrip: (path) =>
    ipcRenderer.invoke(IPC.libraryClipStrip, path) as Promise<IpcResult<TiraDaCena>>,
  prepararSobreposicao: (path) =>
    ipcRenderer.invoke(IPC.prepararSobreposicao, path) as Promise<
      IpcResult<{ url: string; tipo: 'video' | 'image'; durationSec: number; aspecto: number }>
    >,
  escolherPasta: (titulo) =>
    ipcRenderer.invoke(IPC.escolherPasta, titulo) as Promise<IpcResult<string | null>>,
  exportarTexto: (args) => ipcRenderer.invoke(IPC.exportarTexto, args) as Promise<IpcResult<string | null>>,
  importarTexto: (args) =>
    ipcRenderer.invoke(IPC.importarTexto, args) as Promise<IpcResult<{ nome: string; conteudo: string } | null>>,
  listarPasta: (pasta) =>
    ipcRenderer.invoke(IPC.listarPasta, pasta) as Promise<IpcResult<ArquivoDaBin[]>>,
  existemArquivos: (paths) =>
    ipcRenderer.invoke(IPC.existemArquivos, paths) as Promise<IpcResult<boolean[]>>,
  mesclarClipes: (paths) =>
    ipcRenderer.invoke(IPC.mesclarClipes, paths) as Promise<
      IpcResult<{ path: string; pedacos: string[]; ancut: 'atualizado' | 'sem-banco' | 'episodio-nao-encontrado'; segundos: number }>
    >,
  escolherVideo: () =>
    ipcRenderer.invoke(IPC.escolherVideo) as Promise<IpcResult<{ video: string; roteiro: string | null } | null>>,
  sondarVideo: (path) =>
    ipcRenderer.invoke(IPC.sondarVideo, path) as Promise<
      IpcResult<{ width: number; height: number; durationSec: number; temAudio: boolean }>
    >,
  sincronizarLegendas: (audioPath, palavras) =>
    ipcRenderer.invoke(IPC.sincronizarLegendas, audioPath, palavras) as Promise<IpcResult<LegendasSincronizadas>>,

  onLibraryProgress: (listener) => {
    const handler = (_event: unknown, mensagem: string): void => listener(mensagem)
    ipcRenderer.on(IPC.libraryProgress, handler)
    return () => {
      ipcRenderer.off(IPC.libraryProgress, handler)
    }
  },

  readNicknames: () =>
    ipcRenderer.invoke(IPC.readNicknames) as Promise<IpcResult<Record<string, Nickname[]>>>,

  saveNicknames: (series, list) =>
    ipcRenderer.invoke(IPC.saveNicknames, series, list) as Promise<
      IpcResult<Record<string, Nickname[]>>
    >,

  suggestNicknames: (series, characters) =>
    ipcRenderer.invoke(IPC.suggestNicknames, series, characters) as Promise<
      IpcResult<NicknameSuggestion[]>
    >,

  automount: (request) =>
    ipcRenderer.invoke(IPC.automount, request) as Promise<IpcResult<AutomountResult>>,

  scriptBlocks: (request) =>
    ipcRenderer.invoke(IPC.scriptBlocks, request) as Promise<IpcResult<ScriptBlocksResult>>,

  tagLibrary: () =>
    ipcRenderer.invoke(IPC.tagLibrary) as Promise<IpcResult<Record<string, string[]>>>,

  readTags: () => ipcRenderer.invoke(IPC.readTags) as Promise<IpcResult<Record<string, string[]>>>,

  describeLibrary: (anime: string | null) =>
    ipcRenderer.invoke(IPC.describeLibrary, anime) as Promise<IpcResult<Record<string, SceneDescription>>>,

  readDescriptions: () =>
    ipcRenderer.invoke(IPC.readDescriptions) as Promise<IpcResult<Record<string, SceneDescription>>>,

  readFavorites: () => ipcRenderer.invoke(IPC.readFavorites) as Promise<IpcResult<string[]>>,

  toggleFavorite: (id) =>
    ipcRenderer.invoke(IPC.toggleFavorite, id) as Promise<IpcResult<string[]>>,

  listSfx: () => ipcRenderer.invoke(IPC.listSfx) as Promise<IpcResult<string[]>>,

  openSfxDir: () => ipcRenderer.invoke(IPC.openSfxDir) as Promise<IpcResult<null>>,

  listFontes: () =>
    ipcRenderer.invoke(IPC.listFontes) as Promise<IpcResult<{ nome: string; url: string }[]>>,

  openFontesDir: () => ipcRenderer.invoke(IPC.openFontesDir) as Promise<IpcResult<null>>,

  upscaleAssets: (assets, limites) =>
    ipcRenderer.invoke(IPC.upscaleAssets, assets, limites) as Promise<
      IpcResult<Record<string, string> | null>
    >,

  upscaleVideoPronto: () =>
    ipcRenderer.invoke(IPC.upscaleVideoPronto) as Promise<IpcResult<string | null>>,

  cancelarUpscale: () => ipcRenderer.invoke(IPC.cancelarUpscale) as Promise<IpcResult<null>>,

  onVideoProntoProgress: (listener) => {
    const handler = (_event: unknown, p: { feitos: number; total: number; nome: string }): void => listener(p)
    ipcRenderer.on(IPC.videoProntoProgress, handler)
    return () => {
      ipcRenderer.off(IPC.videoProntoProgress, handler)
    }
  },

  inverterClipe: (asset, invertido) =>
    ipcRenderer.invoke(IPC.inverterClipe, asset, invertido) as Promise<IpcResult<ImageAsset>>,

  appVersion: () => ipcRenderer.invoke(IPC.appVersion) as Promise<IpcResult<string>>,

  installUpdate: () => ipcRenderer.invoke(IPC.installUpdate) as Promise<IpcResult<null>>,

  checkUpdate: () => ipcRenderer.invoke(IPC.checkUpdate) as Promise<IpcResult<null>>,

  onUpdateStatus: (listener) => {
    const handler = (_event: unknown, status: UpdateStatus): void => listener(status)
    ipcRenderer.on(IPC.updateStatus, handler)
    return () => {
      ipcRenderer.off(IPC.updateStatus, handler)
    }
  },

  pickFiles: () => ipcRenderer.invoke(IPC.pickFiles) as Promise<IpcResult<string[]>>,

  pickMusic: () => ipcRenderer.invoke(IPC.pickMusic) as Promise<IpcResult<MusicPick | null>>,

  loadMusic: (path) => ipcRenderer.invoke(IPC.loadMusic, path) as Promise<IpcResult<MusicPick>>,

  generateMetadata: (texto) =>
    ipcRenderer.invoke(IPC.generateMetadata, texto) as Promise<IpcResult<Metadata>>,

  testarGemini: (chave) =>
    ipcRenderer.invoke(IPC.testarGemini, chave) as Promise<IpcResult<TesteDoGemini>>,

  testarEleven: (chave) => ipcRenderer.invoke(IPC.testarEleven, chave) as Promise<IpcResult<TesteDeVoz>>,
  testarFish: (chave) => ipcRenderer.invoke(IPC.testarFish, chave) as Promise<IpcResult<TesteDeVoz>>,
  procurarAniRecap: () =>
    ipcRenderer.invoke(IPC.procurarAniRecap) as Promise<IpcResult<AchadoDoAniRecap | null>>,
  importarAniRecap: (arquivo) =>
    ipcRenderer.invoke(IPC.importarAniRecap, arquivo) as Promise<IpcResult<PublicSettings>>,

  copyText: (text) => ipcRenderer.invoke(IPC.copyText, text) as Promise<IpcResult<null>>,

  startRender: (args: StartRenderArgs) =>
    ipcRenderer.invoke(IPC.startRender, args) as Promise<IpcResult<string | null>>,

  cancelRender: () => ipcRenderer.invoke(IPC.cancelRender) as Promise<IpcResult<null>>,
  cancelAnalyze: () => ipcRenderer.invoke(IPC.cancelAnalyze) as Promise<IpcResult<null>>,
  faceAt: (path, instantes) =>
    ipcRenderer.invoke(IPC.faceAt, path, instantes) as ReturnType<DangaiBridge['faceAt']>,
  setFormato: (formato) =>
    ipcRenderer.invoke(IPC.setFormato, formato) as Promise<IpcResult<null>>,
  trackBox: (path, inicio, duracao, caixa) =>
    ipcRenderer.invoke(IPC.trackBox, path, inicio, duracao, caixa) as ReturnType<
      DangaiBridge['trackBox']
    >,

  revealFile: (path) => ipcRenderer.invoke(IPC.revealFile, path) as Promise<IpcResult<null>>,

  analyze: (args: AnalyzeArgs) =>
    ipcRenderer.invoke(IPC.analyze, args) as Promise<IpcResult<AnalysisResult>>,

  saveProject: (args: SaveProjectArgs) =>
    ipcRenderer.invoke(IPC.saveProject, args) as Promise<IpcResult<string | null>>,

  openProject: (path) =>
    ipcRenderer.invoke(IPC.openProject, path) as Promise<IpcResult<OpenedProject | null>>,

  autosaveProject: (file: ProjectFile, projectPath) =>
    ipcRenderer.invoke(IPC.autosaveProject, file, projectPath) as Promise<IpcResult<null>>,

  readAutosave: () =>
    ipcRenderer.invoke(IPC.readAutosave) as Promise<IpcResult<OpenedProject | null>>,

  clearAutosave: () => ipcRenderer.invoke(IPC.clearAutosave) as Promise<IpcResult<null>>,

  getSettings: () => ipcRenderer.invoke(IPC.getSettings) as Promise<IpcResult<PublicSettings>>,

  saveSettings: (patch: SettingsPatch) =>
    ipcRenderer.invoke(IPC.saveSettings, patch) as Promise<IpcResult<PublicSettings>>,

  onRenderProgress: (listener) => {
    const handler = (_event: unknown, progress: RenderProgress): void => listener(progress)
    ipcRenderer.on(IPC.renderProgress, handler)
    return () => {
      ipcRenderer.off(IPC.renderProgress, handler)
    }
  },

  onAnalyzeProgress: (listener) => {
    const handler = (_event: unknown, message: string): void => listener(message)
    ipcRenderer.on(IPC.analyzeProgress, handler)
    return () => {
      ipcRenderer.off(IPC.analyzeProgress, handler)
    }
  },

  // Gerar recap, passo 1 (Episodio)
  escolherEpisodio: () =>
    ipcRenderer.invoke(IPC.escolherEpisodio) as Promise<IpcResult<string | null>>,
  sondarEpisodio: (path) =>
    ipcRenderer.invoke(IPC.sondarEpisodio, path) as Promise<IpcResult<SondaDoEpisodio>>,
  procurarEpisodio: (path, palpite) =>
    ipcRenderer.invoke(IPC.procurarEpisodio, path, palpite) as Promise<IpcResult<EpisodioEncontrado[]>>,
  statusDoMotor: () => ipcRenderer.invoke(IPC.statusDoMotor) as Promise<IpcResult<StatusDoMotor>>,
  analisarEpisodio: (pedido) =>
    ipcRenderer.invoke(IPC.analisarEpisodio, pedido) as Promise<IpcResult<string>>,
  cancelarAnalise: (jobId) =>
    ipcRenderer.invoke(IPC.cancelarAnalise, jobId) as Promise<IpcResult<null>>,
  onAnaliseProgresso: (listener) => {
    const handler = (_event: unknown, progresso: ProgressoDaAnalise): void => listener(progresso)
    ipcRenderer.on(IPC.analiseProgresso, handler)
    return () => {
      ipcRenderer.off(IPC.analiseProgresso, handler)
    }
  },
  onAnaliseFim: (listener) => {
    const handler = (_event: unknown, fim: FimDaAnalise): void => listener(fim)
    ipcRenderer.on(IPC.analiseFim, handler)
    return () => {
      ipcRenderer.off(IPC.analiseFim, handler)
    }
  },

  // Runtime do motor (app instalado). Contrato em shared/motor-runtime.ts.
  estadoDoMotorRuntime: () =>
    ipcRenderer.invoke(IPC.estadoDoMotorRuntime) as Promise<IpcResult<EstadoDoMotorRuntime>>,
  instalarMotorRuntime: (pedido) =>
    ipcRenderer.invoke(IPC.instalarMotorRuntime, pedido) as Promise<IpcResult<EstadoDoMotorRuntime>>,
  cancelarMotorRuntime: () => ipcRenderer.invoke(IPC.cancelarMotorRuntime) as Promise<IpcResult<null>>,
  escolherPastaDoMotorRuntime: (padrao) =>
    ipcRenderer.invoke(IPC.escolherPastaDoMotorRuntime, padrao === true) as Promise<IpcResult<EstadoDoMotorRuntime>>,
  removerMotorRuntime: () =>
    ipcRenderer.invoke(IPC.removerMotorRuntime) as Promise<IpcResult<EstadoDoMotorRuntime>>,
  onMotorRuntime: (listener) => {
    const handler = (_event: unknown, estado: EstadoDoMotorRuntime): void => listener(estado)
    ipcRenderer.on(IPC.motorRuntimeEstado, handler)
    return () => {
      ipcRenderer.off(IPC.motorRuntimeEstado, handler)
    }
  },

  indexarEpisodio: (args) =>
    ipcRenderer.invoke(IPC.indexarEpisodio, args) as Promise<IpcResult<EpisodeIndex>>,
  onIndexarProgresso: (listener) => {
    const handler = (_event: unknown, mensagem: string): void => listener(mensagem)
    ipcRenderer.on(IPC.indexarProgresso, handler)
    return () => {
      ipcRenderer.off(IPC.indexarProgresso, handler)
    }
  },
  salvarExclusoes: (indiceId, exclusoes) =>
    ipcRenderer.invoke(IPC.salvarExclusoes, indiceId, exclusoes) as Promise<IpcResult<EpisodeIndex>>,

  // Gerar recap, passo 2 (Roteiro)
  abrirRascunho: (episodioId, novo) =>
    ipcRenderer.invoke(IPC.abrirRascunho, episodioId, novo === true) as Promise<IpcResult<RascunhoAberto>>,
  listarRascunhos: () => ipcRenderer.invoke(IPC.listarRascunhos) as Promise<IpcResult<ResumoDoRascunho[]>>,
  gerarEventos: (rascunhoId) =>
    ipcRenderer.invoke(IPC.gerarEventos, rascunhoId) as Promise<IpcResult<EventosGerados>>,
  gerarRoteiro: (rascunhoId, pedido) =>
    ipcRenderer.invoke(IPC.gerarRoteiro, rascunhoId, pedido) as Promise<IpcResult<RoteiroGerado>>,
  cancelarRoteiro: (rascunhoId, pedidoId) =>
    ipcRenderer.invoke(IPC.cancelarRoteiro, rascunhoId, pedidoId) as Promise<IpcResult<boolean>>,
  salvarRoteiro: (rascunhoId, roteiro) =>
    ipcRenderer.invoke(IPC.salvarRoteiro, rascunhoId, roteiro) as Promise<IpcResult<RascunhoDoRecap>>,
  escolherVersao: (rascunhoId, versao) =>
    ipcRenderer.invoke(IPC.escolherVersao, rascunhoId, versao) as Promise<IpcResult<RascunhoDoRecap>>,
  aprovarRoteiro: (rascunhoId, roteiro) =>
    ipcRenderer.invoke(IPC.aprovarRoteiro, rascunhoId, roteiro) as Promise<IpcResult<RascunhoDoRecap>>,
  desaprovarRoteiro: (rascunhoId) =>
    ipcRenderer.invoke(IPC.desaprovarRoteiro, rascunhoId) as Promise<IpcResult<RascunhoDoRecap>>,
  miniaturasDasCenas: (episodioId, planoIds) =>
    ipcRenderer.invoke(IPC.miniaturasDasCenas, episodioId, planoIds) as Promise<
      IpcResult<Record<string, string | null>>
    >,
  onRoteiroProgresso: (listener) => {
    const handler = (_event: unknown, progresso: ProgressoDoRoteiro): void => listener(progresso)
    ipcRenderer.on(IPC.roteiroProgresso, handler)
    return () => {
      ipcRenderer.off(IPC.roteiroProgresso, handler)
    }
  },

  // Gerar recap, passo 3 (Voz)
  estimarVoz: (rascunhoId, pedido) =>
    ipcRenderer.invoke(IPC.estimarVoz, rascunhoId, pedido) as Promise<IpcResult<EstimativaDeCusto>>,
  gerarVoz: (rascunhoId, pedido) =>
    ipcRenderer.invoke(IPC.gerarVoz, rascunhoId, pedido) as Promise<IpcResult<VozGerada>>,
  regravarFrases: (rascunhoId, pedido) =>
    ipcRenderer.invoke(IPC.regravarFrases, rascunhoId, pedido) as Promise<IpcResult<VozGerada>>,
  ajustarVoz: (rascunhoId, pedido) =>
    ipcRenderer.invoke(IPC.ajustarVoz, rascunhoId, pedido) as Promise<IpcResult<VozGerada>>,
  importarAudio: (rascunhoId, pedido) =>
    ipcRenderer.invoke(IPC.importarAudio, rascunhoId, pedido) as Promise<IpcResult<VozGerada>>,
  cancelarVoz: (rascunhoId, pedidoId) =>
    ipcRenderer.invoke(IPC.cancelarVoz, rascunhoId, pedidoId) as Promise<IpcResult<boolean>>,
  escolherTake: (rascunhoId, takeId) =>
    ipcRenderer.invoke(IPC.escolherTake, rascunhoId, takeId) as Promise<IpcResult<RascunhoDoRecap>>,
  aprovarVoz: (rascunhoId) => ipcRenderer.invoke(IPC.aprovarVoz, rascunhoId) as Promise<IpcResult<RascunhoDoRecap>>,
  desaprovarVoz: (rascunhoId) =>
    ipcRenderer.invoke(IPC.desaprovarVoz, rascunhoId) as Promise<IpcResult<RascunhoDoRecap>>,
  urlDoAudio: (rascunhoId, takeId) =>
    ipcRenderer.invoke(IPC.urlDoAudio, rascunhoId, takeId) as Promise<IpcResult<AudioDoTake>>,
  escolherNarracao: () => ipcRenderer.invoke(IPC.escolherNarracao) as Promise<IpcResult<string | null>>,
  onVozProgresso: (listener) => {
    const handler = (_event: unknown, progresso: ProgressoDaVoz): void => listener(progresso)
    ipcRenderer.on(IPC.vozProgresso, handler)
    return () => {
      ipcRenderer.off(IPC.vozProgresso, handler)
    }
  },

  // Gerar recap, passo 1 sem esperar o corte
  indexarFalas: (args) => ipcRenderer.invoke(IPC.indexarFalas, args) as Promise<IpcResult<EpisodeIndex>>,
  iniciarCorte: (pedido) => ipcRenderer.invoke(IPC.iniciarCorte, pedido) as Promise<IpcResult<EstadoDoCorte>>,
  estadoDoCorte: (episodioId) =>
    ipcRenderer.invoke(IPC.estadoDoCorte, episodioId) as Promise<IpcResult<EstadoDoCorte | null>>,
  cancelarCorte: (episodioId) => ipcRenderer.invoke(IPC.cancelarCorte, episodioId) as Promise<IpcResult<boolean>>,
  onCorteProgresso: (listener) => {
    const handler = (_event: unknown, evento: EventoDoCorte): void => listener(evento)
    ipcRenderer.on(IPC.corteProgresso, handler)
    return () => {
      ipcRenderer.off(IPC.corteProgresso, handler)
    }
  },

  // Gerar recap, passo 1: Reconhecer na mao
  iniciarDescoberta: (pedido) =>
    ipcRenderer.invoke(IPC.iniciarDescoberta, pedido) as Promise<IpcResult<EstadoDaDescoberta>>,
  descobertaAtual: (episodioId) =>
    ipcRenderer.invoke(IPC.descobertaAtual, episodioId) as Promise<IpcResult<EventoDaDescoberta | null>>,
  confirmarDescoberta: (jobId, decisao) =>
    ipcRenderer.invoke(IPC.confirmarDescoberta, jobId, decisao) as Promise<IpcResult<ResultadoDaDescoberta>>,
  cancelarDescoberta: (jobId) => ipcRenderer.invoke(IPC.cancelarDescoberta, jobId) as Promise<IpcResult<boolean>>,
  onDescobertaProgresso: (listener) => {
    const handler = (_event: unknown, evento: EventoDaDescoberta): void => listener(evento)
    ipcRenderer.on(IPC.descobertaProgresso, handler)
    return () => {
      ipcRenderer.off(IPC.descobertaProgresso, handler)
    }
  },

  // Gerar recap, passo 2 em texto
  religarRoteiro: (rascunhoId, pedido) =>
    ipcRenderer.invoke(IPC.religarRoteiro, rascunhoId, pedido) as Promise<IpcResult<RoteiroReligado>>,

  // Gerar recap, passo 4 (Cenas)
  sugerirCenas: (rascunhoId) => ipcRenderer.invoke(IPC.sugerirCenas, rascunhoId) as Promise<IpcResult<CenasGravadas>>,
  candidatosDaFrase: (rascunhoId, fraseId, filtros) =>
    ipcRenderer.invoke(IPC.candidatosDaFrase, rascunhoId, fraseId, filtros) as Promise<IpcResult<CandidatosDaFrase>>,
  salvarCenas: (rascunhoId, escolhas) =>
    ipcRenderer.invoke(IPC.salvarCenas, rascunhoId, escolhas) as Promise<IpcResult<CenasGravadas>>,
  encaixarNaVoz: (rascunhoId) =>
    ipcRenderer.invoke(IPC.encaixarNaVoz, rascunhoId) as Promise<IpcResult<CenasGravadas>>,
  montarProjeto: (rascunhoId, pedido) =>
    ipcRenderer.invoke(IPC.montarProjeto, rascunhoId, pedido ?? {}) as Promise<IpcResult<ProjetoMontado>>,
  onMontarProgresso: (listener) => {
    const handler = (_event: unknown, etapa: EtapaDaMontagem): void => listener(etapa)
    ipcRenderer.on(IPC.montarProgresso, handler)
    return () => {
      ipcRenderer.off(IPC.montarProgresso, handler)
    }
  },

  // Edicao rapida
  listarMusicas: () => ipcRenderer.invoke(IPC.listarMusicas) as Promise<IpcResult<MusicaDaPasta[]>>,
  escolherMusica: (evitar) =>
    ipcRenderer.invoke(IPC.escolherMusica, evitar ?? []) as Promise<IpcResult<MusicaDaPasta | null>>,
  registrarMusicaUsada: (path, projeto) =>
    ipcRenderer.invoke(IPC.registrarMusicaUsada, path, projeto ?? null) as Promise<IpcResult<true>>,
  sfxDaEdicaoRapida: () => ipcRenderer.invoke(IPC.sfxDaEdicaoRapida) as Promise<IpcResult<SfxDaEdicaoRapida>>,
  planejarSom: (pedido) => ipcRenderer.invoke(IPC.planejarSom, pedido) as Promise<IpcResult<PlanoDeSom>>,
  medirSom: (path) => ipcRenderer.invoke(IPC.medirSom, path) as Promise<IpcResult<MedidaDoSom>>,
  rostosDosPedacos: (lote) => ipcRenderer.invoke(IPC.rostosDosPedacos, lote) as Promise<IpcResult<RostosDoLote>>,
}

contextBridge.exposeInMainWorld('dangai', bridge)
