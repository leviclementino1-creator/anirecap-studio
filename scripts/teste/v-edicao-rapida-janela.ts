/**
 * A janela falsa do v-edicao-rapida-store.ts: um `window.dangai` que responde
 * o minimo da Edicao rapida (plano de som, rostos, estilo salvo, ondas) e
 * ANOTA cada chamada. Mora num modulo proprio porque precisa existir ANTES de
 * o src/store/project.ts ser avaliado (o import deste vem primeiro).
 */
import type { CaptionStyle } from '../../shared/contract'
import type { LoteDeRostos, PedidoDePlanoDeSom, PlanoDeSom, RostosDoLote } from '../../shared/edicao-rapida'
import { DUCKING_PADRAO } from '../../shared/contract'

export const chamadas: { metodo: string; args: unknown[] }[] = []

export function quantas(metodo: string): number {
  return chamadas.filter((c) => c.metodo === metodo).length
}

export function ultima(metodo: string): unknown[] | undefined {
  return [...chamadas].reverse().find((c) => c.metodo === metodo)?.args
}

export const MUSICAS = ['C:/musicas/Afternoon.mp3', 'C:/musicas/Galactico.m4a']

/** O estilo "salvo" das settings falsas (bem longe do padrao). */
export const ESTILO: CaptionStyle = {
  color: '#FFD400',
  y: 0.42,
  scale: 1.2,
  fontNome: 'Minha Fonte',
  animation: 'elastica',
  animationFrames: 9,
  mark: 'tudo',
  shadow: { distancia: 8, desfoque: 4, opacidade: 0.7, angulo: 90 },
  stroke: 4,
}

/** O que cada resposta faz (o teste troca). */
export const respostas = {
  /** false = o planejarSom falha (ok: false). */
  somOk: true,
  /** false = o rostosDosPedacos falha. */
  rostoOk: true,
  /** null = sem estilo salvo. */
  estilo: ESTILO as CaptionStyle | null,
  /** Musica forcada vale; senao, a primeira de MUSICAS que nao esta em evitar. */
  semMusica: false,
  /** Cor: o look escolhido nas Configuracoes (null = Anime vivo) e os presets de cor salvos (crus). */
  corPreset: null as string | null,
  presetsDeCor: [] as unknown[],
}

/** O plano de som que o "main" devolve: whoosh nas viradas e impacto no comeco, musica sem repetir. */
function planejarSom(pedido: PedidoDePlanoDeSom): PlanoDeSom {
  const viradas = pedido.secoes.slice(1).map((s) => s.inicio)
  const sfx = !pedido.sfx
    ? []
    : [
        { at: 0, arquivo: 'C:/sfx/impact.mp3', tipo: 'impacto' as const, ganhoDb: -11, inSec: 0, outSec: 1.2, durationSec: 2.5, marcaSec: 0, motivo: 'comeco do Gancho' },
        ...viradas.map((t, k) => ({
          at: Math.max(0, t - 0.5),
          arquivo: 'C:/sfx/whoosh.mp3',
          tipo: 'whoosh' as const,
          ganhoDb: -14,
          inSec: 0,
          outSec: 0.9,
          durationSec: 1.5,
          marcaSec: t,
          motivo: `virada ${k + 1}`,
        })),
      ]
  const livre = MUSICAS.find((m) => !pedido.evitarMusicas.includes(m)) ?? MUSICAS[0]!
  const arquivo = pedido.musicaForcada ?? livre
  return {
    sfx,
    musica:
      pedido.musica && !respostas.semMusica
        ? { arquivo, ganhoDb: -23.5, fadeInSec: 1.2, fadeOutSec: 2, ducking: DUCKING_PADRAO, inSec: 0, durationSec: 30, lufsIntegrado: -14.5 }
        : null,
    // O main diz por que nao ha musica (planejar.ts).
    avisos: pedido.musica && respostas.semMusica ? ['A pasta de musicas esta vazia'] : [],
  }
}

/** Um rosto achado em cada pedido, a direita e no alto (para ver o foco mudar). */
function rostosDosPedacos(lote: LoteDeRostos): RostosDoLote {
  return {
    focos: lote.pedidos.map((p, i) => ({
      chave: p.chave,
      focusX: 0.8 - i * 0.1,
      focusY: 0.25,
      focusAuto: true,
      fonte: 'motor' as const,
      personagem: p.personagens[0] ?? null,
      instantesComRosto: 3,
      instantes: 3,
    })),
    fonte: 'motor',
    comRosto: lote.pedidos.length,
    total: lote.pedidos.length,
    avisos: [],
    ms: 5,
  }
}

const implementados: Record<string, (...args: unknown[]) => { ok: true; value: unknown } | { ok: false; error: string }> = {
  planejarSom: (pedido) =>
    respostas.somOk ? { ok: true, value: planejarSom(pedido as PedidoDePlanoDeSom) } : { ok: false, error: 'ffmpeg sumiu' },
  rostosDosPedacos: (lote) =>
    respostas.rostoOk ? { ok: true, value: rostosDosPedacos(lote as LoteDeRostos) } : { ok: false, error: 'motor caiu' },
  analyzeAudio: (path) => ({
    ok: true,
    value: {
      path,
      fileName: String(path).split('/').pop(),
      url: `http://127.0.0.1/a/${String(path).split('/').pop()}`,
      durationSec: String(path).includes('musicas') ? 30 : 2,
      peaks: Array.from({ length: 50 }, (_, i) => (i % 10) / 10),
      rms: Array.from({ length: 50 }, () => 0.2),
    },
  }),
  reframeImage: (args) => ({ ok: true, value: `http://127.0.0.1/recorte/${(args as { id: string }).id}` }),
  getSettings: () => ({
    ok: true,
    value: {
      captionStyle: respostas.estilo,
      edicaoRapidaPadrao: { aoAbrirNoEditor: true, config: { sfx: true, musica: true, rosto: true, legenda: true, cor: true }, corPreset: respostas.corPreset },
      presetsDeCor: respostas.presetsDeCor,
    },
  }),
  registrarMusicaUsada: () => ({ ok: true, value: true }),
  pickMusic: () => ({ ok: true, value: { path: 'C:/outra/Escolhida.mp3', fileName: 'Escolhida.mp3', url: 'x' } }),
}

const dangai = new Proxy(
  {},
  {
    get(_alvo, nome) {
      if (typeof nome !== 'string') return undefined
      return async (...args: unknown[]) => {
        chamadas.push({ metodo: nome, args })
        const f = implementados[nome]
        return f ? f(...args) : { ok: true, value: null }
      }
    },
  },
)

Reflect.set(globalThis, 'window', { dangai })
