import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DRIVER_MINIMO_CU128, type GpuDetectada, type VarianteDoMotor } from '@shared/motor-runtime'

/**
 * Qual torch instalar: cu128 (NVIDIA) ou cpu.
 *
 * DONO: agente A. Sem electron.
 *
 * 1. nvidia-smi (vem com o driver; no PATH ou em System32): nome e versao do
 *    driver numa linha. E o que diz se o CUDA 12.8 roda (driver R570+).
 * 2. Sem ele, o WMI (Win32_VideoController): so o nome, sem driver.
 * Sem nenhuma NVIDIA, a cpu (~320 MB em vez de ~3 GB).
 *
 * O resultado vale para a sessao: placa nao muda com o app aberto, e o
 * nvidia-smi leva ~0,5 s.
 */

let emCache: Promise<GpuDetectada> | null = null

function rodar(cmd: string, args: string[], limiteMs: number): Promise<string | null> {
  return new Promise((resolver) => {
    try {
      execFile(cmd, args, { windowsHide: true, timeout: limiteMs, encoding: 'utf8' }, (erro, saida) => {
        resolver(erro ? null : String(saida))
      })
    } catch {
      resolver(null)
    }
  })
}

/** "NVIDIA GeForce RTX 5080, 581.57" -> nome e driver (a primeira placa). */
export function lerNvidiaSmi(saida: string): { nome: string; driver: string | null } | null {
  for (const linha of saida.split(/\r?\n/)) {
    const [nome, driver] = linha.split(',').map((s) => s.trim())
    if (nome) return { nome, driver: driver && /^\d+(\.\d+)*$/.test(driver) ? driver : null }
  }
  return null
}

/** O driver esta abaixo do que o CUDA 12.8 pede? null (sem driver lido) = nao da para dizer. */
export function driverAntigo(driver: string | null): boolean {
  if (!driver) return false
  const n = Number.parseFloat(driver)
  return Number.isFinite(n) && n < DRIVER_MINIMO_CU128
}

async function detectar(): Promise<GpuDetectada> {
  if (process.platform !== 'win32') return { nome: null, driver: null, driverAntigo: false, fonte: 'nenhuma' }
  const args = ['--query-gpu=name,driver_version', '--format=csv,noheader']
  const system32 = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'nvidia-smi.exe')
  for (const cmd of ['nvidia-smi', ...(existsSync(system32) ? [system32] : [])]) {
    const saida = await rodar(cmd, args, 5000)
    const lido = saida ? lerNvidiaSmi(saida) : null
    if (lido) return { nome: lido.nome, driver: lido.driver, driverAntigo: driverAntigo(lido.driver), fonte: 'nvidia-smi' }
  }
  const wmi = await rodar(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_VideoController).Name'],
    10_000,
  )
  const nvidia = wmi
    ?.split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => /nvidia/i.test(s))
  if (nvidia) return { nome: nvidia, driver: null, driverAntigo: false, fonte: 'wmi' }
  return { nome: null, driver: null, driverAntigo: false, fonte: 'nenhuma' }
}

/** A placa (cache da sessao). Nunca lanca. */
export function detectarGpu(): Promise<GpuDetectada> {
  emCache ??= detectar().catch(() => ({ nome: null, driver: null, driverAntigo: false, fonte: 'nenhuma' as const }))
  return emCache
}

/** O que a tela sugere: ANIRECAP_MOTOR_RUNTIME_VARIANTE (testes) > a placa. */
export function varianteSugerida(gpu: GpuDetectada | null): VarianteDoMotor {
  const env = process.env['ANIRECAP_MOTOR_RUNTIME_VARIANTE']
  if (env === 'cpu' || env === 'cu128') return env
  return gpu?.nome ? 'cu128' : 'cpu'
}
