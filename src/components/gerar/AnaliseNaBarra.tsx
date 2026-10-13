import { Loader2 } from 'lucide-react'
import { ROTULO_DA_ETAPA } from '@shared/episodio'
import { useGerar } from '@/store/gerar'

/**
 * A analise do "Gerar recap" na barra de status, com o assistente fechado --
 * igual ao upscale de video pronto: o andamento e o caminho de volta ("Ver").
 *
 * A analise leva minutos e continua com o assistente fechado; antes, o unico
 * sinal dela era um spinner de 13 px no botao da tela inicial, e no editor nao
 * havia sinal nenhum. Com o assistente aberto ele cobre a barra, e isto nao
 * aparece.
 */
export function AnaliseNaBarra() {
  const job = useGerar((s) => s.job)
  const indexando = useGerar((s) => s.fase === 'indexando')
  const progresso = useGerar((s) => s.progresso)
  const abrir = useGerar((s) => s.abrir)

  if (!job && !indexando) return null

  const etapa = indexando ? 'Lendo as falas' : ROTULO_DA_ETAPA[progresso?.etapa ?? 'preparando']
  const fracao = !indexando && progresso?.fracao != null ? ` ${Math.round(progresso.fracao * 100)}%` : ''

  return (
    <span className="flex min-w-0 shrink items-center gap-2 text-[11px] text-ink-2">
      <Loader2 size={12} strokeWidth={1.5} className="shrink-0 animate-spin text-accent" />
      <span className="truncate">
        {job?.cancelando ? 'Cancelando a analise...' : `Analisando episodio · ${etapa}${fracao}`}
      </span>
      <button
        type="button"
        onClick={() => abrir()}
        title="Abrir o Gerar recap"
        className="shrink-0 rounded-sm border border-line bg-elevated px-2 py-0.5 text-[11px] text-ink-2 hover:text-ink"
      >
        Ver
      </button>
    </span>
  )
}
