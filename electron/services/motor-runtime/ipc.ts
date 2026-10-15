import { BrowserWindow, dialog, ipcMain, net } from 'electron'
import { IPC, type IpcResult } from '@shared/channels'
import { pedidoDeInstalacaoSchema, type EstadoDoMotorRuntime } from '@shared/motor-runtime'
import { esquecerSondaDoMotor } from '../motor'
import type { FetchDoMotor } from './baixar'
import {
  cancelarMotorRuntime,
  definirAoMudarORuntime,
  definirAvisoDoMotorRuntime,
  definirFetchDoMotorRuntime,
  estadoDoMotorRuntime,
  instalarMotorRuntime,
  removerMotorRuntime,
  usarPastaDoMotorRuntime,
} from './index'
import { pastaDoRuntime } from './pastas'

/**
 * Os canais motor-runtime:* (shared/channels.ts). Chamado UMA vez pelo
 * registerIpc do electron/ipc.ts.
 *
 * DONO: agente A. O mesmo envelope do `handle` de electron/ipc.ts: erro nunca
 * atravessa a ponte como excecao, vira { ok: false, error } com a frase pronta.
 *
 * O que so o Electron tem entra aqui no index.ts (que fica sem electron para
 * os testes no Node):
 * - net.fetch para as rodas do torch: a pilha de rede do Chromium respeita o
 *   proxy e os certificados do sistema (antivirus que intercepta HTTPS);
 * - o dialogo de pasta;
 * - esquecer a sonda do motor.ts quando o runtime muda (instalou, removeu),
 *   para o "Motor pronto" aparecer sem reiniciar o app.
 */
function handle<Args extends unknown[], T>(canal: string, fn: (...args: Args) => Promise<T>): void {
  ipcMain.handle(canal, async (_evento, ...args: Args): Promise<IpcResult<T>> => {
    try {
      return { ok: true, value: await fn(...args) }
    } catch (err) {
      console.error(`[ipc:${canal}]`, err)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

export function registrarIpcDoMotorRuntime(): void {
  definirAvisoDoMotorRuntime((estado: EstadoDoMotorRuntime) => {
    for (const janela of BrowserWindow.getAllWindows()) {
      if (!janela.isDestroyed()) janela.webContents.send(IPC.motorRuntimeEstado, estado)
    }
  })
  definirFetchDoMotorRuntime(((url, init) => net.fetch(url, init)) as FetchDoMotor)
  definirAoMudarORuntime(() => esquecerSondaDoMotor())

  handle<[], EstadoDoMotorRuntime>(IPC.estadoDoMotorRuntime, () => estadoDoMotorRuntime())
  handle<[unknown], EstadoDoMotorRuntime>(IPC.instalarMotorRuntime, (pedido) =>
    instalarMotorRuntime(pedidoDeInstalacaoSchema.parse(pedido ?? {})),
  )
  handle<[], null>(IPC.cancelarMotorRuntime, async () => {
    await cancelarMotorRuntime()
    return null
  })
  handle<[unknown], EstadoDoMotorRuntime>(IPC.escolherPastaDoMotorRuntime, async (padrao) => {
    if (padrao === true) return usarPastaDoMotorRuntime(null)
    const janela = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const opcoes: Electron.OpenDialogOptions = {
      title: 'Pasta do motor de personagens (~5 GB)',
      defaultPath: pastaDoRuntime().pasta,
      properties: ['openDirectory', 'createDirectory'],
    }
    const r = janela ? await dialog.showOpenDialog(janela, opcoes) : await dialog.showOpenDialog(opcoes)
    if (r.canceled || !r.filePaths[0]) return estadoDoMotorRuntime()
    return usarPastaDoMotorRuntime(r.filePaths[0])
  })
  handle<[], EstadoDoMotorRuntime>(IPC.removerMotorRuntime, () => removerMotorRuntime())
}
