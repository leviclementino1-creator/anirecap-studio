import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * ONDE MORA o runtime do motor e o que vai no instalador.
 *
 * DONO: agente A. Contrato em shared/motor-runtime.ts (o layout da pasta esta
 * no comentario do topo de la).
 *
 * Sem import do electron de proposito: os testes (scripts/teste) rodam isto
 * no Node puro, passando a configuracao na mao.
 */

export interface ConfigDoRuntime {
  /** %APPDATA%/AniRecap Studio (ou o --user-data-dir dos testes). */
  userData: string
  /** app.getAppPath(): em dev, a raiz do repositorio. */
  appPath: string
  /** process.resourcesPath: no app instalado, <instalacao>/resources. */
  resourcesPath: string
  empacotado: boolean
  /** app.getVersion(), gravado no impressao.json. */
  versaoDoApp: string
}

let config: ConfigDoRuntime | null = null

/** Chamada pelo main.ts depois do ready, logo depois do configurarMotor. */
export function configurarMotorRuntime(c: ConfigDoRuntime): void {
  config = c
}

export function configDoRuntime(): ConfigDoRuntime {
  if (!config) throw new Error('Runtime do motor nao configurado')
  return config
}

/**
 * O nome FIXO da pasta em %LOCALAPPDATA%, e nao o basename do userData: nos
 * testes o userData e uma pasta temporaria (--user-data-dir), e o runtime tem
 * que continuar no lugar definitivo, que e o que o Levi usa.
 */
export const NOME_DO_APP = 'AniRecap Studio'

/** Caminho maximo da pasta do runtime: o torch tem arquivos 150+ caracteres abaixo do venv. */
export const CAMINHO_MAXIMO_DA_PASTA = 80

/**
 * O app usa o runtime (e nao o motor/.venv)? No app instalado, sempre. Em dev,
 * so com ANIRECAP_MOTOR_RUNTIME=1 (para testar a instalacao sem empacotar).
 */
export function usaRuntime(): boolean {
  // Sem configuracao (os testes antigos do motor, que so chamam configurarMotor): o dev de sempre.
  if (!config) return false
  return config.empacotado || process.env['ANIRECAP_MOTOR_RUNTIME'] === '1'
}

/** O codigo do motor (app/, run.py, studio-runtime.json): resources/motor ou <repo>/motor. */
export function pastaDoCodigoDoMotor(): string {
  const c = configDoRuntime()
  return c.empacotado ? join(c.resourcesPath, 'motor') : join(c.appPath, 'motor')
}

/** motor/studio-runtime.json (scripts/motor-lock.mjs). */
export function caminhoDoLock(): string {
  return join(pastaDoCodigoDoMotor(), 'studio-runtime.json')
}

/**
 * O uv.exe: resources/uv no app instalado (win.extraResources), build/uv em dev
 * (`npm run uv`). ANIRECAP_UV troca, para testes.
 */
export function caminhoDoUv(): string {
  const env = process.env['ANIRECAP_UV']
  if (env) return env
  const c = configDoRuntime()
  return c.empacotado ? join(c.resourcesPath, 'uv', 'uv.exe') : join(c.appPath, 'build', 'uv', 'uv.exe')
}

/** A versao do uv que o app espera (scripts/baixar-uv.mjs, VERSAO). */
export const VERSAO_DO_UV = '0.11.7'

function localAppData(): string {
  return process.env['LOCALAPPDATA'] || join(homedir(), 'AppData', 'Local')
}

/** %LOCALAPPDATA%\AniRecap Studio\motor-runtime: Local, e nao Roaming (5 GB nao sincronizam). */
export function pastaPadraoDoRuntime(): string {
  return join(localAppData(), NOME_DO_APP, 'motor-runtime')
}

/** <userData>/motor-runtime.json: {"pasta": "..."} quando o Levi escolhe outro disco. */
export function arquivoDaPastaEscolhida(): string {
  return join(configDoRuntime().userData, 'motor-runtime.json')
}

/**
 * A pasta efetiva: ANIRECAP_MOTOR_RUNTIME_PASTA (testes) > a escolhida > a padrao.
 * Arquivo torto conta como "nao escolheu".
 */
export function pastaDoRuntime(): { pasta: string; padrao: boolean } {
  const env = process.env['ANIRECAP_MOTOR_RUNTIME_PASTA']
  if (env) return { pasta: env, padrao: false }
  try {
    const j = JSON.parse(readFileSync(arquivoDaPastaEscolhida(), 'utf8')) as { pasta?: unknown }
    if (typeof j.pasta === 'string' && j.pasta.trim()) return { pasta: j.pasta.trim(), padrao: false }
  } catch {
    // sem arquivo: a padrao
  }
  return { pasta: pastaPadraoDoRuntime(), padrao: true }
}

/** Grava (ou apaga, com null) a pasta escolhida. Quem chama confere antes se da para gravar la. */
export function gravarPastaEscolhida(pasta: string | null): void {
  const arquivo = arquivoDaPastaEscolhida()
  if (pasta === null) {
    if (existsSync(arquivo)) writeFileSync(arquivo, '{}\n', 'utf8')
    return
  }
  mkdirSync(configDoRuntime().userData, { recursive: true })
  writeFileSync(arquivo, `${JSON.stringify({ pasta }, null, 2)}\n`, 'utf8')
}

/** Os caminhos dentro da pasta do runtime (o layout de shared/motor-runtime.ts). */
export function caminhosDoRuntime(pasta: string) {
  return {
    pasta,
    /** UV_PYTHON_INSTALL_DIR: cpython-3.12.13-windows-x86_64-none/ fica aqui dentro. */
    python: join(pasta, 'python'),
    venv: join(pasta, 'venv'),
    /** O python do venv (o lancador; o app abre o base com __PYVENV_LAUNCHER__, python-do-motor.ts). */
    pythonDoVenv:
      process.platform === 'win32' ? join(pasta, 'venv', 'Scripts', 'python.exe') : join(pasta, 'venv', 'bin', 'python'),
    sitePackages: join(pasta, 'venv', 'Lib', 'site-packages'),
    baixando: join(pasta, 'baixando'),
    uvCache: join(pasta, 'uv-cache'),
    requisitos: join(pasta, 'req', 'pacotes.txt'),
    log: join(pasta, 'logs', 'instalar.log'),
    estado: join(pasta, 'estado.json'),
    impressao: join(pasta, 'impressao.json'),
    trava: join(pasta, 'instalando.trava'),
  }
}

export type CaminhosDoRuntime = ReturnType<typeof caminhosDoRuntime>
