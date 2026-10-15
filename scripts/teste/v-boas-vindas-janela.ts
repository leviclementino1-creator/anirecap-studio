/**
 * A janela falsa do v-boas-vindas.tsx: um `window.dangai` que responde o
 * minimo da tela de boas-vindas (settings, motor-runtime) e ANOTA cada
 * chamada. Mora num modulo proprio porque precisa existir ANTES de os stores
 * do src/ serem avaliados (o import deste vem primeiro).
 */
import type { PublicSettings } from '../../shared/channels'
import type { EstadoDoMotorRuntime } from '../../shared/motor-runtime'

export const chamadas: { metodo: string; args: unknown[] }[] = []

export function quantas(metodo: string): number {
  return chamadas.filter((c) => c.metodo === metodo).length
}

export function ultima(metodo: string): unknown[] | undefined {
  return [...chamadas].reverse().find((c) => c.metodo === metodo)?.args
}

/** Settings publicas sem chave nenhuma (o usuario novo). */
export function semChave(): PublicSettings {
  return {
    iaProvedor: 'gemini',
    naoPerguntarChave: false,
    geminiModelo: '',
    anthropicModelo: 'claude-sonnet-5',
    whisperModel: 'small',
    sfxDir: '',
    libraryDir: '',
    bibliotecaStudio: '',
    bibliotecaStudioEfetiva: 'C:/x/Biblioteca',
    hasApiKey: false,
    apiKeyHint: '',
    hasGeminiKey: false,
    geminiKeyHint: '',
    hasElevenKey: false,
    elevenKeyHint: '',
    hasFishKey: false,
    fishKeyHint: '',
    // velocidadeNativa: o campo da frente da velocidade (1,2 por padrao); a mais nao atrapalha.
    vozPadrao: { provedor: '', voiceId: '', modelId: '', velocidadeNativa: 1.2 },
    chavesProtegidas: true,
    curvePresets: [],
    captionStyle: null,
    captionPresets: [],
    bins: [],
    curvasDeEntrada: [],
    atalhos: null,
    recentes: [],
    presetsDeCor: [],
    presetsDeTransicao: [],
    pastaDeMusicas: '',
    pastaDeMusicasEfetiva: '',
    edicaoRapidaPadrao: {
      aoAbrirNoEditor: true,
      config: { sfx: true, musica: true, rosto: true, legenda: true, cor: true },
      corPreset: null,
    },
  } as unknown as PublicSettings
}

/** O que cada resposta faz (o teste troca). */
export const respostas = {
  settings: semChave(),
  /** Segura o getSettings ate o teste soltar (o projeto abrindo enquanto as settings chegam). */
  segurarSettings: null as Promise<void> | null,
  motor: null as EstadoDoMotorRuntime | null,
}

const implementados: Record<string, (...args: unknown[]) => unknown> = {
  getSettings: async () => {
    if (respostas.segurarSettings) await respostas.segurarSettings
    return { ok: true, value: respostas.settings }
  },
  saveSettings: async (patch) => {
    respostas.settings = { ...respostas.settings, ...(patch as Partial<PublicSettings>) }
    return { ok: true, value: respostas.settings }
  },
  estadoDoMotorRuntime: async () => ({ ok: true, value: respostas.motor }),
  instalarMotorRuntime: async () => {
    if (respostas.motor) {
      respostas.motor = { ...respostas.motor, fase: 'instalando', andamento: { etapa: 'preparar', fracao: 0, mensagem: 'Preparando' } }
    }
    return { ok: true, value: respostas.motor }
  },
}

const dangai = new Proxy(
  {},
  {
    get(_alvo, nome) {
      if (typeof nome !== 'string') return undefined
      // Os "on..." sao assinaturas: devolvem o desligar na hora, sem promessa.
      if (nome.startsWith('on')) return () => () => {}
      return async (...args: unknown[]) => {
        chamadas.push({ metodo: nome, args })
        const f = implementados[nome]
        return f ? f(...args) : { ok: true, value: null }
      }
    },
  },
)

Reflect.set(globalThis, 'window', { dangai })
