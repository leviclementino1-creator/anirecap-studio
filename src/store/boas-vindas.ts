import { create } from 'zustand'
import type { PublicSettings } from '@shared/channels'
import type { EstadoDoMotorRuntime } from '@shared/motor-runtime'
import { useMotorRuntime } from '@/store/motor-runtime'

/*
 * A TELA DE BOAS-VINDAS (decisao do Levi para a v0.1.0, 15/10).
 *
 * Quem abre o app sem chave de IA nenhuma (nem a do Gemini, nem a da
 * Anthropic, que o app usa quando falta a do Gemini) cai numa tela que
 * RECOMENDA a chave gratis do Gemini, com a voz e o motor de personagens como
 * opcionais. A tela e src/components/BoasVindas.tsx; aqui fica so a decisao,
 * para o teste sem interface (scripts/teste/v-boas-vindas.tsx).
 *
 * - Decide UMA vez por sessao, quando as settings chegam, e so na tela
 *   inicial: um projeto ja aberto (ou o assistente) nunca fica por baixo dela.
 * - Saiu da tela inicial (abriu projeto, soltou arquivo, abriu o assistente):
 *   fecha e nao volta nesta sessao.
 * - "Depois" (o X, o Esc, clicar fora) fecha so nesta sessao: nada e gravado.
 * - "Nao perguntar mais" grava `naoPerguntarChave` nas settings.
 */

type Momento = 'esperando' | 'aberta' | 'encerrada'

/** Sem chave de IA e sem o "Nao perguntar mais": a tela aparece. */
export function pedeBoasVindas(s: Pick<PublicSettings, 'hasGeminiKey' | 'hasApiKey' | 'naoPerguntarChave'>): boolean {
  return !s.hasGeminiKey && !s.hasApiKey && s.naoPerguntarChave !== true
}

interface LojaDasBoasVindas {
  momento: Momento
  /** As settings que a tela mostra (as chaves salvas, a voz). null ate chegarem. */
  settings: PublicSettings | null
  /**
   * Le as settings e decide se abre. `naTelaInicial` e perguntado DEPOIS da
   * leitura: o projeto pode ter aberto enquanto ela chegava.
   */
  decidir(naTelaInicial: () => boolean): Promise<void>
  /** Settings novas (salvou uma chave aqui ou nas Configuracoes por cima). */
  receber(settings: PublicSettings): void
  /** "Depois", o X, o Esc e clicar fora: fecha so nesta sessao. */
  depois(): void
  /** Saiu da tela inicial: fecha e nao volta nesta sessao. */
  saiuDaTelaInicial(): void
  /** Grava o "Nao perguntar mais" e fecha. */
  naoPerguntarMais(): Promise<void>
}

export const useBoasVindas = create<LojaDasBoasVindas>((set, get) => ({
  momento: 'esperando',
  settings: null,
  async decidir(naTelaInicial) {
    if (get().momento !== 'esperando') return
    const r = await window.dangai.getSettings()
    // Saiu da tela inicial enquanto a leitura chegava: nao abre mais.
    if (get().momento !== 'esperando') return
    if (!r.ok || !naTelaInicial() || !pedeBoasVindas(r.value)) {
      set({ momento: 'encerrada', settings: r.ok ? r.value : null })
      return
    }
    set({ momento: 'aberta', settings: r.value })
  },
  receber(settings) {
    set({ settings })
  },
  depois() {
    set({ momento: 'encerrada' })
  },
  saiuDaTelaInicial() {
    if (get().momento !== 'encerrada') set({ momento: 'encerrada' })
  },
  async naoPerguntarMais() {
    // Fecha antes de gravar: se o disco falhar, a sessao ja respeitou o pedido.
    set({ momento: 'encerrada' })
    const r = await window.dangai.saveSettings({ naoPerguntarChave: true })
    if (r.ok) set({ settings: r.value })
  },
}))

/** O motor esta pronto para usar (no dev, o motor/.venv: nada a instalar). */
export function motorPronto(estado: EstadoDoMotorRuntime | null): boolean {
  return estado?.fase === 'pronto' || estado?.fase === 'dev'
}

/**
 * O "Instalar agora" da boas-vindas, pela tela e pelo IPC do motor-runtime que
 * ja existem: abre a tela "Motor de personagens" (a barra, cancelar, a pasta)
 * e ja comeca, porque ele acabou de pedir.
 *
 * So abre a tela, sem comecar, quando ela tem algo a dizer antes: a placa
 * ainda nao foi lida, falta espaco no disco, ou a ultima instalacao parou na
 * conferencia (la ele escolhe entre Continuar e Recomecar). Instalando, so
 * mostra o andamento.
 */
export function instalarMotorAgora(): void {
  const { estado, abrir, instalar } = useMotorRuntime.getState()
  abrir()
  if (!estado || !comecaDireto(estado)) return
  void instalar()
}

function comecaDireto(e: EstadoDoMotorRuntime): boolean {
  if (e.fase !== 'ausente' && e.fase !== 'incompleto' && e.fase !== 'desatualizado') return false
  if (!e.gpu) return false
  if (e.erro?.tipo === 'conferencia') return false
  const faltaDisco = e.livreNoDisco !== null && e.precisaDeLivre > 0 && e.livreNoDisco < e.precisaDeLivre
  return !faltaDisco
}
