/**
 * A janela falsa do v-continuar.ts: um `window.dangai` que responde o minimo
 * da porta do "Gerar recap" (listarRascunhos, abrirRascunho, escolherEpisodio,
 * sondarEpisodio) e ANOTA cada chamada. Mora num modulo proprio porque precisa
 * existir ANTES de as stores serem avaliadas (o import deste vem primeiro).
 *
 * O teste troca as respostas (`respostas`); metodo sem resposta devolve
 * { ok: true, value: null }, como nas outras janelas falsas.
 */
import type { IpcResult } from '../../shared/channels'
import type { RascunhoAberto, ResumoDoRascunho } from '../../shared/roteiro'

export const chamadas: { metodo: string; args: unknown[] }[] = []

export function quantas(metodo: string): number {
  return chamadas.filter((c) => c.metodo === metodo).length
}

export function ultima(metodo: string): unknown[] | undefined {
  return [...chamadas].reverse().find((c) => c.metodo === metodo)?.args
}

/** Atraso artificial por metodo (ms), para testar respostas que chegam depois de outro gesto. */
export const atrasos: Record<string, number> = {}

export const respostas = {
  /** A lista de rascunhos (o teste liga no listarRascunhos DE VERDADE, sobre uma pasta temporaria). */
  listar: async (): Promise<IpcResult<ResumoDoRascunho[]>> => ({ ok: true, value: [] }),
  /** O abrirRascunho. */
  abrir: async (_episodioId: string): Promise<IpcResult<RascunhoAberto>> => ({ ok: false, error: 'sem rascunho' }),
  /** O arquivo que o dialogo devolve. null = cancelou. */
  escolhido: null as string | null,
  /** Caminhos que a sonda le; o resto e "nao existe mais". */
  existem: new Set<string>(),
}

const implementados: Record<string, (...args: unknown[]) => unknown> = {
  listarRascunhos: () => respostas.listar(),
  abrirRascunho: (id) => respostas.abrir(String(id)),
  escolherEpisodio: () => ({ ok: true, value: respostas.escolhido }),
  sondarEpisodio: (path) =>
    respostas.existem.has(String(path))
      ? { ok: false, error: 'sonda falsa: o teste nao precisa das medidas' }
      : { ok: false, error: `O arquivo nao existe mais ou nao abre: ${String(path)}` },
}

const espera = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const dangai = new Proxy(
  {},
  {
    get(_alvo, nome) {
      if (typeof nome !== 'string') return undefined
      // As escutas (on*) devolvem a funcao que desliga, sincrona.
      if (nome.startsWith('on')) return () => () => {}
      return async (...args: unknown[]) => {
        chamadas.push({ metodo: nome, args })
        const atraso = atrasos[nome]
        if (atraso) await espera(atraso)
        const f = implementados[nome]
        return f ? await f(...args) : { ok: true, value: null }
      }
    },
  },
)

Reflect.set(globalThis, 'window', { dangai })
