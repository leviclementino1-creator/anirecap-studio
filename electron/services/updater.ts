import type { BrowserWindow } from 'electron'
import type { UpdateStatus } from '@shared/channels'
import { IPC } from '@shared/channels'

/**
 * Atualizacao automatica pelas releases do GitHub.
 *
 * O app instalado consulta o repositorio, baixa a versao nova em segundo plano
 * e troca de versao na proxima abertura -- ou na hora, se o usuario clicar.
 *
 * Quem decide reiniciar e o usuario, sempre. Um render de um minuto morrendo
 * porque o app resolveu se atualizar sozinho seria pior que ficar uma versao
 * atras.
 *
 * O import do electron-updater e dinamico: em desenvolvimento nao ha app
 * instalado para atualizar, e carregar a biblioteca so para nao usa-la custa
 * tempo de abertura.
 */

type Enviar = (status: UpdateStatus) => void

/**
 * Como avisar a interface, guardado no modulo.
 *
 * Precisa viver fora de startUpdater porque a busca manual (o usuario clicando
 * na versao) tambem precisa reportar -- inclusive o caso em que o updater nem
 * chegou a iniciar, que antes ficava invisivel.
 */
let enviarStatus: Enviar | null = null

/** Se o updater chegou a subir. Falso em dev e se a carga falhou. */
let ativo = false

/**
 * A versao baixada e esperando, e se ele ja mandou instalar.
 *
 * Os dois existem para distinguir DUAS falhas que chegam pelo mesmo evento
 * `error`: "nao consegui verificar" (rede, GitHub fora) e "o sistema nao
 * deixou instalar o que ja esta baixado". A segunda tem uma saida -- baixar o
 * pacote em pasta -- e a primeira nao, entao dizer as duas do mesmo jeito
 * manda o usuario procurar o problema no lugar errado.
 */
let prontaPara: string | null = null
let instalando = false

/**
 * Carrega o electron-updater lidando com o embrulho de CJS.
 *
 * A biblioteca e CommonJS e o processo main sai bundlado como CJS, entao o
 * `await import()` devolve `{ default: { autoUpdater } }` em vez de
 * `{ autoUpdater }`. Sem desembrulhar, autoUpdater vem undefined e a primeira
 * atribuicao explode.
 *
 * Isso NUNCA aparece em desenvolvimento, onde o updater nem chega a rodar --
 * so no app empacotado, e so quando ele tenta se atualizar.
 */
async function carregar(): Promise<typeof import('electron-updater')> {
  const modulo = await import('electron-updater')
  const embrulhado = (modulo as { default?: typeof import('electron-updater') }).default
  return embrulhado?.autoUpdater ? embrulhado : modulo
}

/**
 * A cada 6 h: o app fica aberto por sessoes de edicao, e uma versao nova nao
 * precisa chegar no mesmo minuto. Cada busca le o releases.atom do repo e o
 * latest.yml da ultima release (sem token: o repo e publico).
 */
const INTERVALO_MS = 6 * 60 * 60 * 1000

/** A 1a busca espera a janela abrir: os primeiros segundos sao do usuario. */
const ESPERA_DA_1A_BUSCA_MS = 8000

/**
 * A busca de atualizacao esta LIGADA desde a 1a release (0.1.0).
 *
 * QUANDO CONSULTA: so no app instalado (em dev nao ha o que substituir), 8 s
 * depois de abrir e a cada 6 h com o app aberto, nas releases PUBLICADAS de
 * leviclementino1-creator/anirecap-studio (o `publish` do electron-builder.yml,
 * gravado no resources/app-update.yml). Achou versao nova: baixa sozinha em
 * segundo plano e a barra mostra "Atualizar para X". A troca so acontece
 * quando o Levi clica -- nunca no meio de um render, nunca enquanto o motor de
 * personagens instala (o StatusBar segura o botao nos dois casos).
 *
 * O que ela le na release: o latest.yml, que aponta para
 * AniRecap-Studio-Setup-<versao>.exe. O release.mjs confere os dois antes de
 * subir; sem o latest.yml (ou com o de outra versao) ninguem atualiza.
 *
 * Busca sem release ainda (repo sem release, ou no meio de uma publicacao,
 * com a release criada e o latest.yml ainda subindo) responde "em dia" e nao
 * "erro", na automatica E na manual (versao na barra, "Procurar atualizacoes"
 * nas Configuracoes): nao ha versao mais nova que a instalada, nao e falha de
 * ninguem, e um "nao consegui verificar" em vermelho assustaria por nada. Sem
 * internet, GitHub fora e o resto continuam "erro" na manual.
 *
 * Desligar = false: o app nao consulta nada e a versao na barra responde "em
 * dia". O resto do codigo fica inteiro.
 */
export const ATUALIZACAO_LIGADA: boolean = true

/**
 * Os erros que querem dizer "ainda nao ha release com latest.yml para ler":
 * repo sem release publicada, ou a ultima sem o latest.yml. Pelos codigos do
 * electron-updater 6 (GitHubProvider), e pela frase como reserva -- o repo sem
 * release nenhuma chega com o codigo generico ERR_XML_MISSED_ELEMENT (o
 * releases.atom vazio) e a frase "No published versions on GitHub" (medido no
 * app instalado em 15/10).
 */
const CODIGOS_SEM_RELEASE = new Set([
  'ERR_UPDATER_NO_PUBLISHED_VERSIONS',
  'ERR_UPDATER_LATEST_VERSION_NOT_FOUND',
  'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND',
])

export function semReleaseAinda(err: unknown): boolean {
  const codigo = (err as { code?: unknown } | null)?.code
  if (typeof codigo === 'string' && CODIGOS_SEM_RELEASE.has(codigo)) return true
  const msg = err instanceof Error ? err.message : String(err)
  return /No published versions|Unable to find latest version|Cannot find latest\.yml/i.test(msg)
}

export async function startUpdater(
  windows: () => BrowserWindow[],
  isPackaged: boolean,
): Promise<void> {
  const enviar: Enviar = (status) => {
    for (const window of windows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.updateStatus, status)
    }
  }
  enviarStatus = enviar

  // Em dev nao existe instalacao para substituir; o updater reclamaria da falta
  // de app-update.yml a cada abertura.
  if (!isPackaged || !ATUALIZACAO_LIGADA) return

  const { autoUpdater } = await carregar()
  ativo = true

  autoUpdater.autoDownload = true
  // Instalar sozinho ao fechar surpreenderia: a troca acontece quando o usuario
  // manda, e nao quando ele so quis fechar a janela.
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-available', (info) => {
    enviar({ state: 'baixando', version: info.version, percent: 0 })
  })
  autoUpdater.on('download-progress', (progress) => {
    enviar({ state: 'baixando', percent: progress.percent / 100 })
  })
  autoUpdater.on('update-downloaded', (info) => {
    prontaPara = info.version
    enviar({ state: 'pronta', version: info.version })
  })
  autoUpdater.on('update-not-available', () => {
    enviar({ state: 'atual' })
  })
  autoUpdater.on('error', (err) => {
    // Falha de atualizacao nunca vira erro na cara do usuario: ele esta editando
    // um video, e o app funciona perfeitamente na versao que ja tem.
    console.error('[updater]', err)

    /*
     * Erro DEPOIS de mandar instalar e sempre sobre instalar.
     *
     * O electron-updater manda tudo pelo mesmo `error`, entao sem esta
     * distincao o "o Windows barrou o instalador" aparecia como "nao consegui
     * verificar" -- e mandava procurar problema na internet, que estava
     * perfeita: o arquivo ja tinha sido baixado e conferido.
     */
    if (instalando && prontaPara) {
      instalando = false
      enviar({ state: 'bloqueada', version: prontaPara, message: err.message })
      return
    }
    if (semReleaseAinda(err)) {
      enviar({ state: 'atual' })
      return
    }
    enviar({ state: 'erro', message: err.message })
  })

  const verificar = (): void => {
    void autoUpdater.checkForUpdates().catch(() => undefined)
  }

  // Nao na abertura: os primeiros segundos sao do usuario soltando arquivos,
  // e nao de uma consulta de rede disputando a banda.
  setTimeout(verificar, ESPERA_DA_1A_BUSCA_MS)
  setInterval(verificar, INTERVALO_MS)
}

/**
 * Fecha e instala. So chamado por acao explicita do usuario.
 *
 * `quitAndInstall` nao devolve o fracasso: quando ele consegue, o app morre
 * na linha seguinte; quando nao consegue, ele volta em silencio e a falha
 * chega depois, pelo evento `error`. A marca abaixo e o que liga um ao outro.
 */
export async function installUpdate(): Promise<void> {
  const { autoUpdater } = await carregar()
  instalando = true
  try {
    autoUpdater.quitAndInstall()
  } catch (err) {
    // Alguns fracassos sao sincronos. Sem este ramo, um deles deixaria a
    // marca ligada e o proximo erro de rede sairia como "o Windows barrou".
    instalando = false
    if (enviarStatus && prontaPara) {
      enviarStatus({
        state: 'bloqueada',
        version: prontaPara,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

/**
 * Procura atualizacao agora, porque o usuario pediu.
 *
 * Existe por um motivo que a busca automatica nao resolve: quando tudo esta em
 * dia, o app nao mostra nada -- e "em dia" fica visualmente igual a "quebrado".
 * Sem uma forma de perguntar, a unica maneira de saber se a atualizacao
 * funciona e esperar sair uma versao nova e torcer.
 *
 * Ao contrario da busca automatica, esta REPORTA o erro (sem internet, GitHub
 * fora): quem clicou esta esperando uma resposta, e silencio seria a mesma
 * armadilha de novo. "Ainda sem release" nao e erro: responde "em dia".
 */
export async function checkForUpdateNow(): Promise<void> {
  const enviar = enviarStatus
  if (!enviar) return

  // Desligada, nao ha o que procurar, e responder erro aqui pintaria de
  // vermelho a versao na barra por um motivo que nao e falha de ninguem.
  if (!ATUALIZACAO_LIGADA) {
    enviar({ state: 'atual' })
    return
  }

  if (!ativo) {
    enviar({
      state: 'erro',
      message: 'A atualizacao automatica so funciona no app instalado.',
    })
    return
  }

  enviar({ state: 'procurando' })

  try {
    const { autoUpdater } = await carregar()
    const resultado = await autoUpdater.checkForUpdates()
    // Sem updateInfo nao ha o que baixar, e nenhum evento vai chegar depois --
    // sem isto a interface ficaria presa em "procurando" para sempre.
    if (!resultado) enviar({ state: 'atual' })
  } catch (err) {
    // O `error` do autoUpdater ja respondeu; isto e para a falha que chega so
    // pela promessa. Sem release ainda = "em dia" (ver ATUALIZACAO_LIGADA).
    enviar(
      semReleaseAinda(err)
        ? { state: 'atual' }
        : { state: 'erro', message: err instanceof Error ? err.message : 'Nao consegui verificar agora.' },
    )
  }
}
