import type { AutomountMode } from '@shared/channels'

/*
 * A escolha Recap/Teoria do "Montar sozinho", lembrada nesta maquina.
 *
 * Quem faz recap faz recap quase sempre: lembrar a ultima escolha deixa o
 * botao a UM clique, e a escolha fica a vista ao lado para quando mudar. Mora
 * no localStorage (chave dangai.*, como as outras preferencias da tela) e nao
 * nas settings porque e gosto de tela, nao configuracao do app.
 */
export const CHAVE_DO_MODO = 'dangai.automount.modo'
export const MODO_PADRAO: AutomountMode = 'recap'

function ehModo(v: unknown): v is AutomountMode {
  return v === 'recap' || v === 'theory'
}

export function lerModoDoAutomount(): AutomountMode {
  try {
    const v = localStorage.getItem(CHAVE_DO_MODO)
    // Valor estranho (versao futura, edicao na mao) volta ao padrao em vez de
    // mandar um modo que o main nao conhece.
    return ehModo(v) ? v : MODO_PADRAO
  } catch {
    return MODO_PADRAO
  }
}

export function gravarModoDoAutomount(modo: AutomountMode): void {
  try {
    localStorage.setItem(CHAVE_DO_MODO, modo)
  } catch {
    /* vale so nesta sessao */
  }
}
