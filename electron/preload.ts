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
} from '@shared/roteiro'

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
}

contextBridge.exposeInMainWorld('dangai', bridge)
