/**
 * A janela falsa do v-montar-guarda.ts: um `window.dangai` que responde o
 * minimo e ANOTA cada chamada. Mora num modulo proprio porque precisa existir
 * ANTES de o src/store/project.ts ser avaliado (o import deste vem primeiro).
 */
import type { AnalysisResult, ImageAsset, Transcript } from '../../shared/contract'
import { planEqualSplit } from '../../shared/plan'

export const chamadas: { metodo: string; args: unknown[] }[] = []

export function quantas(metodo: string): number {
  return chamadas.filter((c) => c.metodo === metodo).length
}

/** O que o "Whisper" falso devolve: se aparecer no estado, a guarda falhou. */
export const TRANSCRIPT_DO_WHISPER: Transcript = {
  source: 'whisper',
  words: [{ text: 'whisper', start: 0, end: 1 }],
  segments: [{ text: 'whisper', start: 0, end: 1 }],
  text: 'whisper',
  cutCandidates: [],
}

/** O roteiro que o readScript falso devolve (o teste troca). */
export const respostas = { roteiro: '', duracaoDoAudio: 12 }

let n = 0
export function imagemFalsa(path: string): ImageAsset {
  n += 1
  return {
    id: `img-${n}`,
    path,
    fileName: path.split(/[\\/]/).pop() ?? path,
    url: `http://127.0.0.1/${n}`,
    urlSource: null,
    width: 1920,
    height: 1080,
    thumbnail: '',
    focusX: 0.5,
    focusY: 0.5,
    focusAuto: false,
    kind: /\.mp4$/i.test(path) ? 'video' : 'image',
    section: null,
    ...(/\.mp4$/i.test(path) ? { durationSec: 5 } : {}),
  }
}

const implementados: Record<string, (...args: unknown[]) => unknown> = {
  analyze: (args) => {
    const a = args as { images: unknown[]; durationSec: number }
    const resultado: AnalysisResult = {
      plan: planEqualSplit(a.images.length, a.durationSec),
      origin: 'equal',
      transcript: TRANSCRIPT_DO_WHISPER,
      aiNote: null,
      scriptNote: null,
      sectionNote: null,
    }
    return resultado
  },
  importImages: (paths) => (paths as string[]).map(imagemFalsa),
  expandDrop: (paths) => ({
    files: (paths as string[]).filter((p) => /\.(png|jpg|mp4)$/i.test(p)),
    sections: [],
  }),
  readScript: () => respostas.roteiro,
  // O main de verdade (electron/services/automount.ts): transcript com palavras no pedido vale inteiro; senao, o Whisper.
  automount: (pedido) => {
    const p = pedido as { transcript?: Transcript | null }
    const transcript = p.transcript && p.transcript.words.length > 0 ? p.transcript : TRANSCRIPT_DO_WHISPER
    return {
      blocks: [
        { start: 0, end: 6, text: 'a', characters: [], candidates: [{ path: 'C:/shots/m1.mp4', thumbUrl: '', label: 'x', durationSec: 6, reason: '' }] },
        { start: 6, end: 12, text: 'b', characters: [], candidates: [{ path: 'C:/shots/m2.mp4', thumbUrl: '', label: 'x', durationSec: 6, reason: '' }] },
      ],
      transcript,
      scriptNote: null,
      note: null,
    }
  },
  analyzeAudio: (path) => ({
    path,
    fileName: String(path),
    url: 'http://127.0.0.1/audio',
    durationSec: respostas.duracaoDoAudio,
    peaks: [0.1],
  }),
}

const dangai = new Proxy(
  {},
  {
    get(_alvo, nome) {
      if (typeof nome !== 'string') return undefined
      return async (...args: unknown[]) => {
        chamadas.push({ metodo: nome, args })
        const f = implementados[nome]
        return { ok: true, value: f ? f(...args) : null }
      }
    },
  },
)

Reflect.set(globalThis, 'window', { dangai })
