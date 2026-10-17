import { useState } from 'react'
import { ExternalLink, X } from 'lucide-react'

/**
 * O AVISO DA ULTIMA VERSAO (0.1.2): o AniRecap Studio agora vive dentro do
 * Dangai, no modulo "Gerar recap (beta)". Uma faixa discreta na tela
 * inicial; o Studio continua funcionando igual.
 *
 * "Saiba mais" abre a ultima versao do Dangai no navegador (o
 * setWindowOpenHandler do main manda link de fora para o shell). "Fechar"
 * lembra nesta maquina (localStorage, chave dangai.* como as outras
 * preferencias da tela) e o aviso nao volta.
 */

export const LINK_DO_DANGAI = 'https://github.com/faahpla/dangai/releases/latest'
const CHAVE_FECHADO = 'dangai.avisoDoDangaiFechado'

function jaFechou(): boolean {
  try {
    return localStorage.getItem(CHAVE_FECHADO) === '1'
  } catch {
    return false
  }
}

export function AvisoDoDangai() {
  const [fechado, setFechado] = useState(jaFechou)
  if (fechado) return null

  const fechar = (): void => {
    try {
      localStorage.setItem(CHAVE_FECHADO, '1')
    } catch {
      /* vale so nesta sessao */
    }
    setFechado(true)
  }

  return (
    <div
      role="note"
      className="enter flex shrink-0 items-center gap-3 rounded-md border border-line bg-surface px-3 py-2 text-[12px] text-ink-2"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        O AniRecap Studio agora vive dentro do Dangai: <span className="text-ink">Gerar recap (beta)</span>
      </span>
      <a
        href={LINK_DO_DANGAI}
        target="_blank"
        rel="noreferrer"
        title="Abre a ultima versao do Dangai no navegador"
        className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-accent underline-offset-2 hover:underline"
      >
        Saiba mais
        <ExternalLink size={11} strokeWidth={1.75} />
      </a>
      <button
        type="button"
        onClick={fechar}
        title="Fechar (nao aparece de novo)"
        className="flex shrink-0 items-center gap-1 text-[11px] text-ink-3 hover:text-ink"
      >
        <X size={12} strokeWidth={1.75} />
        Fechar
      </button>
    </div>
  )
}
