import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { VozPadrao } from '@shared/channels'
import {
  PASTA_DE_MUSICAS_PADRAO,
  PREFERENCIAS_DA_EDICAO_RAPIDA_PADRAO,
  preferenciasDaEdicaoRapidaSchema,
  type PreferenciasDaEdicaoRapida,
} from '@shared/edicao-rapida'
import { arrumarVelocidadeNativa, VELOCIDADE_NATIVA_PADRAO } from '@shared/voz'

/**
 * Guarda tres campos em um JSON no userData.
 *
 * A spec pedia electron-store, mas a v11 e ESM puro ("type": "module", sem
 * main) e o processo main aqui e CJS -- externalizado, o require() quebra.
 * Para tres campos nao compensa comprar a briga ESM/CJS; isto faz o mesmo,
 * inclusive escrita atomica.
 *
 * A chave da API vive aqui, fora do repositorio. Nunca em .env, nunca no codigo.
 *
 * As chaves vao para o disco cifradas pelo safeStorage (DPAPI no Windows), em
 * campos `*Enc`. Em memoria elas ficam abertas: quem chama getSettings() ve
 * `anthropicApiKey` como sempre viu. O settings.json e copiado junto em backup
 * e suporte; chave em texto puro ali e chave vazada.
 */

/** Os campos que sao chave de API: so estes passam pelo cofre. */
const CAMPOS_DE_CHAVE = ['anthropicApiKey', 'geminiApiKey', 'elevenlabsApiKey', 'fishApiKey'] as const
type CampoDeChave = (typeof CAMPOS_DE_CHAVE)[number]

/**
 * O pedaco do safeStorage que isto usa.
 *
 * Separado para o teste trocar por um falso: fora do Electron o modulo
 * 'electron' e so o caminho do executavel, sem safeStorage nenhum.
 */
export interface Cofre {
  isEncryptionAvailable(): boolean
  encryptString(texto: string): Buffer
  decryptString(cifrado: Buffer): string
}

export interface Settings {
  anthropicApiKey: string
  /** Chave do Google AI Studio. O Gemini e o cerebro padrao: tem cota gratis. */
  geminiApiKey: string
  /** Chave do ElevenLabs, a voz do AniRecap antigo. */
  elevenlabsApiKey: string
  /** Chave do Fish Audio, a outra opcao de voz. */
  fishApiKey: string
  /**
   * A voz que narra o recap. Fica aqui e nao no rascunho: a voz e do canal
   * dele, vale para todo recap.
   */
  vozPadrao: VozPadrao
  /**
   * Qual IA ele prefere. Sem a chave dela, vale a outra que tiver chave -- quem
   * so tem a da Anthropic (todo usuario antigo) continua como estava.
   */
  iaProvedor: 'gemini' | 'anthropic'
  /**
   * "Nao perguntar mais" da tela de boas-vindas: sem chave de IA, o app abre
   * recomendando a do Gemini; quem marcou isto nao ve mais a tela. O "Depois"
   * nao grava nada -- vale so para a sessao.
   */
  naoPerguntarChave: boolean
  /** Modelo do Gemini. Vazio = automatico, o melhor "flash" que a chave enxerga. */
  geminiModelo: string
  /** Modelo da Anthropic. Antes fixo no planner e no metadata. */
  anthropicModelo: string
  /** Modelo do Whisper: quanto maior, melhor e mais lento. */
  whisperModel: 'base' | 'small' | 'medium'
  /** Pasta dos SFX. Vazio = usa a que vem com o app. */
  sfxDir: string
  /** Raiz da biblioteca de cenas do AnCut. Vazio = a biblioteca fica desligada. */
  libraryDir: string
  /**
   * Onde o Studio GRAVA: as cenas que o motor dele corta e o episodio.json de
   * cada episodio. Vazio = <Documentos>/AniRecap Studio/Biblioteca (ver
   * pastaDaBibliotecaStudio). Separada da libraryDir de proposito: aquela pode
   * ser a do AnCut/Corte Cenas, que sao so leitura.
   */
  bibliotecaStudio: string
  /**
   * Curvas de movimento que ele guardou.
   *
   * Ficam aqui e nao no projeto porque um ritmo que ele gostou vale para os
   * PROXIMOS videos -- guardar no projeto obrigaria a redesenhar a mesma curva
   * em cada um.
   */
  curvePresets: { nome: string; pontos: [number, number, number, number] }[]
  /**
   * O estilo de legenda que ele deixou por ultimo.
   *
   * Mesmo motivo das curvas: cor, altura, tamanho, fonte e contorno sao gosto
   * DELE, nao caracteristica de um video. Guardado so no projeto, cada video
   * novo nascia no padrao de fabrica e obrigava a refazer os mesmos ajustes --
   * "toda vez ficar alterando e um saco".
   *
   * O projeto continua guardando o proprio estilo: abrir um video antigo mostra
   * o que ELE tinha, e nao o de agora. Isto aqui e so o ponto de partida de
   * quem comeca do zero.
   *
   * `null` ate ele mexer em alguma coisa pela primeira vez.
   */
  captionStyle: Record<string, unknown> | null
  /**
   * Estilos de legenda que ele guardou com nome. Conferidos do outro lado, pelo
   * schema do contract -- aqui so atravessam como objetos.
   */
  captionPresets: Record<string, unknown>[]
  /** As Power Bins: colecoes de arquivos que ele arrasta para a linha do tempo. */
  bins: Record<string, unknown>[]
  /** Curvas da entrada da legenda que ele desenhou e guardou. */
  curvasDeEntrada: Record<string, unknown>[]
  /** Atalhos de teclado configurados. Conferidos no renderer; null = os de fabrica. */
  atalhos: Record<string, unknown> | null
  /** Projetos recentes, o mais novo primeiro. Conferidos no renderer. */
  recentes: Record<string, unknown>[]
  /** Presets de correcao de cor. Conferidos no renderer pelo ajusteDeCorSchema. */
  presetsDeCor: Record<string, unknown>[]
  /** Transicoes configuradas e guardadas com nome. Conferidas no renderer. */
  presetsDeTransicao: Record<string, unknown>[]
  /**
   * Edicao rapida: a pasta de musicas. Vazio = PASTA_DE_MUSICAS_PADRAO quando
   * existe (ver pastaDeMusicasEfetiva). SO LEITURA: o historico de "ja usada"
   * mora no userData, nunca la.
   */
  pastaDeMusicas: string
  /** Edicao rapida: o que ela faz por padrao e se vem ligada no "Abrir no editor". */
  edicaoRapidaPadrao: PreferenciasDaEdicaoRapida
}

const DEFAULTS: Settings = {
  anthropicApiKey: '',
  geminiApiKey: '',
  elevenlabsApiKey: '',
  fishApiKey: '',
  vozPadrao: { provedor: '', voiceId: '', modelId: '', velocidadeNativa: VELOCIDADE_NATIVA_PADRAO },
  iaProvedor: 'gemini',
  naoPerguntarChave: false,
  geminiModelo: '',
  anthropicModelo: 'claude-sonnet-5',
  whisperModel: 'small',
  sfxDir: '',
  libraryDir: '',
  bibliotecaStudio: '',
  curvePresets: [],
  captionPresets: [],
  bins: [],
  curvasDeEntrada: [],
  captionStyle: null,
  atalhos: null,
  recentes: [],
  presetsDeCor: [],
  presetsDeTransicao: [],
  pastaDeMusicas: '',
  edicaoRapidaPadrao: PREFERENCIAS_DA_EDICAO_RAPIDA_PADRAO,
}

let filePath: string | null = null
let cache: Settings | null = null
let cofre: Cofre | null = null
/**
 * Chave cifrada que nao abriu -- settings.json trazido de outra conta do
 * Windows, por exemplo. Volta para o disco como veio: regravar sem ela apagaria
 * de vez uma chave que ainda abre na conta certa.
 */
let ilegiveis: Partial<Record<CampoDeChave, string>> = {}
let avisouTextoPuro = false

export function configureSettings(userDataDir: string, cofreDoTeste?: Cofre): void {
  filePath = join(userDataDir, 'settings.json')
  // O main chama isto depois do 'ready': antes dele o safeStorage do Windows
  // responde que nao ha cifra, e as chaves iriam para o disco abertas.
  cofre = cofreDoTeste ?? safeStorage
  cache = null
  ilegiveis = {}
}

export function getSettings(): Settings {
  if (cache) return cache
  if (!filePath) throw new Error('Settings nao configurado')

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    // Arquivo ausente ou corrompido: volta ao padrao em vez de derrubar o app.
    cache = { ...DEFAULTS }
    return cache
  }

  const { chaves, emTextoPuro } = abrirChaves(raw)
  cache = coerce({ ...(raw as object), ...chaves })

  // Settings de antes da cifra, com a chave aberta no arquivo: regrava ja
  // cifrado. Acontece uma vez; da proxima a chave vem do campo *Enc.
  if (emTextoPuro && cifraDisponivel()) {
    try {
      gravar(cache)
    } catch (err) {
      console.warn('[settings] nao deu para cifrar as chaves antigas:', err)
    }
  }
  return cache
}

export function saveSettings(patch: Partial<Settings>): Settings {
  if (!filePath) throw new Error('Settings nao configurado')

  // Gravar so a voz (escolher outra no select) mantem a velocidade nativa que ja estava.
  const voz = patch.vozPadrao
  const comVelocidade =
    voz && voz.velocidadeNativa === undefined
      ? { ...patch, vozPadrao: { ...voz, velocidadeNativa: getSettings().vozPadrao.velocidadeNativa } }
      : patch
  const next = coerce({ ...getSettings(), ...comVelocidade })
  // Chave nova (ou apagada de proposito) substitui a cifrada que nao abria.
  for (const campo of CAMPOS_DE_CHAVE) {
    if (campo in patch) delete ilegiveis[campo]
  }
  gravar(next)

  cache = next
  return next
}

function gravar(settings: Settings): void {
  if (!filePath) throw new Error('Settings nao configurado')
  mkdirSync(dirname(filePath), { recursive: true })

  // Escreve em temporario e renomeia: se o app morrer no meio, o arquivo
  // antigo continua intacto em vez de virar JSON pela metade.
  const temp = `${filePath}.tmp`
  writeFileSync(temp, JSON.stringify(paraODisco(settings), null, 2), 'utf8')
  renameSync(temp, filePath)
}

/** O que vai para o arquivo: igual ao de memoria, mas com as chaves cifradas. */
function paraODisco(settings: Settings): Record<string, unknown> {
  const disco: Record<string, unknown> = { ...settings }
  for (const campo of CAMPOS_DE_CHAVE) {
    const chave = settings[campo]
    delete disco[campo]
    if (!chave) {
      const guardada = ilegiveis[campo]
      if (guardada) disco[`${campo}Enc`] = guardada
      continue
    }
    const cifrada = cifrar(chave)
    if (cifrada !== null) {
      disco[`${campo}Enc`] = cifrada
    } else {
      // Sem cifra do sistema (Linux sem chaveiro, por exemplo) o app continua
      // funcionando como antes, com a chave aberta -- mas avisa no log.
      if (!avisouTextoPuro) {
        console.warn('[settings] safeStorage indisponivel: as chaves ficam em texto puro no settings.json.')
        avisouTextoPuro = true
      }
      disco[campo] = chave
    }
  }
  return disco
}

/**
 * Le as chaves do arquivo: a aberta de settings antigos, ou a cifrada.
 *
 * A aberta ganha quando as duas existem. O app nunca grava as duas juntas, entao
 * isso so acontece quando ele colou uma chave nova a mao no arquivo -- e a nova
 * e a que ele quer.
 */
function abrirChaves(raw: unknown): {
  chaves: Partial<Record<CampoDeChave, string>>
  emTextoPuro: boolean
} {
  const chaves: Partial<Record<CampoDeChave, string>> = {}
  let emTextoPuro = false
  if (typeof raw !== 'object' || raw === null) return { chaves, emTextoPuro }
  const value = raw as Record<string, unknown>

  for (const campo of CAMPOS_DE_CHAVE) {
    const aberta = value[campo]
    if (typeof aberta === 'string' && aberta.trim().length > 0) {
      chaves[campo] = aberta
      emTextoPuro = true
      continue
    }
    const cifrada = value[`${campo}Enc`]
    if (typeof cifrada !== 'string' || cifrada.length === 0) continue
    const decifrada = decifrar(cifrada)
    if (decifrada === null) {
      console.warn(`[settings] a ${campo} cifrada nao abre nesta conta; fica guardada como veio.`)
      ilegiveis[campo] = cifrada
      chaves[campo] = ''
    } else {
      chaves[campo] = decifrada
    }
  }
  return { chaves, emTextoPuro }
}

function cifraDisponivel(): boolean {
  try {
    return cofre?.isEncryptionAvailable() === true
  } catch {
    return false
  }
}

/** Texto -> base64 cifrado. null = sem cifra agora; quem chama guarda aberto. */
export function cifrar(texto: string): string | null {
  if (!cifraDisponivel()) return null
  try {
    return cofre!.encryptString(texto).toString('base64')
  } catch (err) {
    console.warn('[settings] safeStorage recusou cifrar:', err)
    return null
  }
}

/** base64 cifrado -> texto. null = nao abre (outra conta, arquivo mexido, sem cifra). */
export function decifrar(base64: string): string | null {
  if (!cifraDisponivel()) return null
  try {
    return cofre!.decryptString(Buffer.from(base64, 'base64'))
  } catch {
    return null
  }
}

/**
 * A pasta Documentos do usuario.
 *
 * Pelo Electron quando ha Electron: com a pasta redirecionada (OneDrive), o
 * homedir()/Documents nao e onde o Explorer mostra. Fora dele (os testes em
 * scripts/teste rodam no node puro, onde `app` nao existe) cai no homedir.
 */
export function pastaDeDocumentos(): string {
  try {
    return app.getPath('documents')
  } catch {
    return join(homedir(), 'Documents')
  }
}

/**
 * A biblioteca do Studio, ja resolvida: a escolhida ou o padrao
 * <Documentos>/AniRecap Studio/Biblioteca. Nao cria a pasta -- quem grava cria.
 */
export function pastaDaBibliotecaStudio(): string {
  const escolhida = getSettings().bibliotecaStudio
  return escolhida || join(pastaDeDocumentos(), 'AniRecap Studio', 'Biblioteca')
}

/**
 * A pasta de musicas da Edicao rapida, ja resolvida: a escolhida (se existe) ou
 * PASTA_DE_MUSICAS_PADRAO (se existe). '' = nenhuma: a Edicao rapida segue sem
 * musica e avisa. So leitura -- quem lista nunca grava nela.
 */
export function pastaDeMusicasEfetiva(): string {
  const escolhida = getSettings().pastaDeMusicas
  if (escolhida) return existsSync(escolhida) ? escolhida : ''
  return existsSync(PASTA_DE_MUSICAS_PADRAO) ? PASTA_DE_MUSICAS_PADRAO : ''
}

/** A interface nunca recebe a chave inteira -- so o suficiente para reconhecer. */
export function getSettingsForRenderer(): Omit<Settings, CampoDeChave> & {
  bibliotecaStudioEfetiva: string
  pastaDeMusicasEfetiva: string
  hasApiKey: boolean
  apiKeyHint: string
  hasGeminiKey: boolean
  geminiKeyHint: string
  hasElevenKey: boolean
  elevenKeyHint: string
  hasFishKey: boolean
  fishKeyHint: string
  chavesProtegidas: boolean
} {
  const settings = getSettings()
  const key = settings.anthropicApiKey
  return {
    iaProvedor: settings.iaProvedor,
    naoPerguntarChave: settings.naoPerguntarChave,
    geminiModelo: settings.geminiModelo,
    anthropicModelo: settings.anthropicModelo,
    whisperModel: settings.whisperModel,
    sfxDir: settings.sfxDir,
    libraryDir: settings.libraryDir,
    bibliotecaStudio: settings.bibliotecaStudio,
    bibliotecaStudioEfetiva: pastaDaBibliotecaStudio(),
    curvePresets: settings.curvePresets,
    captionStyle: settings.captionStyle,
    captionPresets: settings.captionPresets,
    bins: settings.bins,
    curvasDeEntrada: settings.curvasDeEntrada,
    atalhos: settings.atalhos,
    recentes: settings.recentes,
    presetsDeCor: settings.presetsDeCor,
    presetsDeTransicao: settings.presetsDeTransicao,
    pastaDeMusicas: settings.pastaDeMusicas,
    pastaDeMusicasEfetiva: pastaDeMusicasEfetiva(),
    edicaoRapidaPadrao: settings.edicaoRapidaPadrao,
    hasApiKey: key.length > 0,
    apiKeyHint: dicaDaChave(key),
    hasGeminiKey: settings.geminiApiKey.length > 0,
    geminiKeyHint: dicaDaChave(settings.geminiApiKey),
    hasElevenKey: settings.elevenlabsApiKey.length > 0,
    elevenKeyHint: dicaDaChave(settings.elevenlabsApiKey),
    hasFishKey: settings.fishApiKey.length > 0,
    fishKeyHint: dicaDaChave(settings.fishApiKey),
    vozPadrao: settings.vozPadrao,
    chavesProtegidas: cifraDisponivel(),
  }
}

export function dicaDaChave(key: string): string {
  return key.length > 8 ? `••••${key.slice(-4)}` : ''
}

function coerce(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULTS }
  const value = raw as Record<string, unknown>

  const model = value['whisperModel']
  return {
    anthropicApiKey:
      typeof value['anthropicApiKey'] === 'string' ? value['anthropicApiKey'].trim() : '',
    geminiApiKey: typeof value['geminiApiKey'] === 'string' ? value['geminiApiKey'].trim() : '',
    elevenlabsApiKey:
      typeof value['elevenlabsApiKey'] === 'string' ? value['elevenlabsApiKey'].trim() : '',
    fishApiKey: typeof value['fishApiKey'] === 'string' ? value['fishApiKey'].trim() : '',
    vozPadrao: vozSalva(value['vozPadrao']),
    iaProvedor: value['iaProvedor'] === 'anthropic' ? 'anthropic' : 'gemini',
    // So o true de verdade dispensa a tela: lixo no arquivo volta a perguntar.
    naoPerguntarChave: value['naoPerguntarChave'] === true,
    geminiModelo: nomeDeModelo(value['geminiModelo'], ''),
    anthropicModelo: nomeDeModelo(value['anthropicModelo'], DEFAULTS.anthropicModelo),
    whisperModel: model === 'base' || model === 'small' || model === 'medium' ? model : 'small',
    sfxDir: typeof value['sfxDir'] === 'string' ? value['sfxDir'] : '',
    libraryDir: typeof value['libraryDir'] === 'string' ? value['libraryDir'] : '',
    bibliotecaStudio: typeof value['bibliotecaStudio'] === 'string' ? value['bibliotecaStudio'].trim() : '',
    curvePresets: curvasSalvas(value['curvePresets']),
    // Conferido do outro lado, pelo schema do contract: aqui so passa adiante
    // um objeto, e um campo estranho vira o padrao em vez de derrubar o app.
    captionStyle:
      typeof value['captionStyle'] === 'object' && value['captionStyle'] !== null
        ? (value['captionStyle'] as Record<string, unknown>)
        : null,
    captionPresets: Array.isArray(value['captionPresets'])
      ? (value['captionPresets'] as unknown[]).filter(
          (x): x is Record<string, unknown> => typeof x === 'object' && x !== null,
        )
      : [],
    bins: Array.isArray(value['bins'])
      ? (value['bins'] as unknown[]).filter(
          (x): x is Record<string, unknown> => typeof x === 'object' && x !== null,
        )
      : [],
    curvasDeEntrada: Array.isArray(value['curvasDeEntrada'])
      ? (value['curvasDeEntrada'] as unknown[]).filter(
          (x): x is Record<string, unknown> => typeof x === 'object' && x !== null,
        )
      : [],
    atalhos:
      typeof value['atalhos'] === 'object' && value['atalhos'] !== null && !Array.isArray(value['atalhos'])
        ? (value['atalhos'] as Record<string, unknown>)
        : null,
    recentes: Array.isArray(value['recentes'])
      ? (value['recentes'] as unknown[])
          .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
          .slice(0, 12)
      : [],
    presetsDeCor: Array.isArray(value['presetsDeCor'])
      ? (value['presetsDeCor'] as unknown[])
          .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
          .slice(0, 50)
      : [],
    presetsDeTransicao: Array.isArray(value['presetsDeTransicao'])
      ? (value['presetsDeTransicao'] as unknown[])
          .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
          .slice(0, 50)
      : [],
    pastaDeMusicas: typeof value['pastaDeMusicas'] === 'string' ? value['pastaDeMusicas'].trim() : '',
    // .catch em cada campo do schema: valor estranho volta ao padrao sem levar os outros.
    edicaoRapidaPadrao: preferenciasDaEdicaoRapidaSchema
      .catch(PREFERENCIAS_DA_EDICAO_RAPIDA_PADRAO)
      .parse(value['edicaoRapidaPadrao'] ?? {}),
  }
}

/**
 * O nome de um modelo, ou o padrao.
 *
 * O do Gemini vai parar no caminho da URL (`models/<nome>:generateContent`), e
 * o valor chega do renderer e de um arquivo editavel a mao: so letra, numero,
 * ponto, traco e sublinhado. Barra ou dois-pontos ali mudariam o endpoint.
 */
export function nomeDeModelo(raw: unknown, padrao: string): string {
  if (typeof raw !== 'string') return padrao
  const nome = raw.trim().replace(/^models\//, '')
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(nome) ? nome : padrao
}

/**
 * O id de uma voz, ou ''.
 *
 * Vai parar no caminho da URL do TTS (`/v1/text-to-speech/<id>`) e chega do
 * renderer e do config do AniRecap: so letra, numero, traco e sublinhado. Os
 * do ElevenLabs tem 20 caracteres e os do Fish 32 (hex).
 */
export function idDeVoz(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const id = raw.trim()
  return /^[A-Za-z0-9_-]{1,100}$/.test(id) ? id : ''
}

/** A voz padrao conferida: provedor conhecido, id e modelo limpos. */
function vozSalva(raw: unknown): VozPadrao {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULTS.vozPadrao }
  const value = raw as Record<string, unknown>
  const provedor = value['provedor'] === 'elevenlabs' || value['provedor'] === 'fish' ? value['provedor'] : ''
  return {
    provedor,
    voiceId: provedor ? idDeVoz(value['voiceId']) : '',
    // Vai num cabecalho/corpo do TTS, nao no caminho, mas a mesma regra dos
    // modelos do Gemini serve: nome curto, sem espaco nem barra.
    modelId: provedor ? nomeDeModelo(value['modelId'], '') : '',
    // Perfil de antes do campo (ou lixo no arquivo): o padrao 1,2 da decisao de 15/10.
    velocidadeNativa:
      typeof value['velocidadeNativa'] === 'number' ? arrumarVelocidadeNativa(value['velocidadeNativa']) : VELOCIDADE_NATIVA_PADRAO,
  }
}

/**
 * As curvas guardadas, conferidas uma a uma.
 *
 * Este arquivo e editavel a mao e sobrevive a atualizacao do app: um valor
 * estranho aqui viraria uma curva que o Remotion nao sabe interpolar, e o
 * sintoma apareceria como movimento travado no meio do render.
 */
function curvasSalvas(raw: unknown): Settings['curvePresets'] {
  if (!Array.isArray(raw)) return []
  const ok: Settings['curvePresets'] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const { nome, pontos } = item as Record<string, unknown>
    if (typeof nome !== 'string' || !nome.trim()) continue
    if (!Array.isArray(pontos) || pontos.length !== 4) continue
    if (!pontos.every((n) => typeof n === 'number' && n >= 0 && n <= 1)) continue
    ok.push({ nome: nome.trim().slice(0, 40), pontos: pontos as [number, number, number, number] })
  }
  // Vinte ja e mais do que qualquer pessoa distingue numa lista de chips.
  return ok.slice(0, 20)
}
