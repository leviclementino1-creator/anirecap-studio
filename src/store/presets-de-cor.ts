import { create } from 'zustand'
import { ajusteDeCorSchema, type AjusteDeCor } from '@shared/contract'
import { presetsDeCorConferidos } from '@shared/edicao-rapida'
import { exportarPreset, importarPreset, nomeLivre } from './arquivo-de-preset'

/**
 * OS PRESETS DE COR da camada de ajuste: "uma opcao para salvar preset da
 * Color Correction que eu fizer". Guardados no settings.json -- valem para
 * todos os projetos, como os estilos de legenda e as curvas.
 */
export interface PresetDeCor {
  nome: string
  cor: AjusteDeCor
}

// A mesma conferencia que a Edicao rapida usa para achar o look escolhido.
const conferir = presetsDeCorConferidos

export const usePresetsDeCor = create<{
  lista: PresetDeCor[]
  /**
   * A lista ja veio das settings. Antes disso ela e vazia, e quem confere "o
   * preset escolhido sumiu" (as Configuracoes da Edicao rapida) acusaria um
   * apagado que nao foi.
   */
  carregado: boolean
  carregar: () => Promise<void>
  salvar: (nome: string, cor: AjusteDeCor) => Promise<void>
  remover: (nome: string) => Promise<void>
  /** Devolve o recado para a tela (ou null se ele cancelou). */
  exportar: (nome: string) => Promise<string | null>
  importar: () => Promise<string | null>
}>((set, get) => {
  const gravar = async (lista: PresetDeCor[]): Promise<void> => {
    set({ lista })
    await window.dangai.saveSettings({ presetsDeCor: lista as unknown as Record<string, unknown>[] })
  }
  return {
    lista: [],
    carregado: false,
    carregar: async () => {
      const r = await window.dangai.getSettings()
      if (r.ok) set({ lista: conferir(r.value.presetsDeCor), carregado: true })
    },
    // Mesmo nome substitui: e o jeito de atualizar um preset que ele refinou.
    salvar: (nome, cor) =>
      gravar([...get().lista.filter((p) => p.nome !== nome.trim()), { nome: nome.trim().slice(0, 40), cor }]),
    remover: (nome) => gravar(get().lista.filter((p) => p.nome !== nome)),
    exportar: async (nome) => {
      const p = get().lista.find((x) => x.nome === nome)
      return p ? exportarPreset('cor', p.nome, p.cor) : null
    },
    importar: async () => {
      const r = await importarPreset('cor', ajusteDeCorSchema)
      if (r === null) return null
      if ('erro' in r) return r.erro
      const nome = nomeLivre(r.nome, get().lista.map((p) => p.nome))
      await gravar([...get().lista, { nome, cor: r.dados }])
      return `"${nome}" importado.`
    },
  }
})
