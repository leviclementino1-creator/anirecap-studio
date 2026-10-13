import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Check, Circle, Loader2, ScanFace } from 'lucide-react'
import { ROTULO_DA_ETAPA, type EtapaDaAnalise } from '@shared/episodio'
import { useGerar } from '@/store/gerar'
import { Botao, formatarTempo, Secao } from './pecas'

/*
 * A ORDEM DAS ETAPAS na tela e a ordem em que o motor de fato anda: ele busca o
 * elenco ANTES de cortar (a identidade do anime decide a pasta), corta, volta
 * ao elenco para as fotos de referencia e so entao reconhece. Por isso o
 * "Buscando o elenco" pode acender duas vezes -- e o motor, nao a tela.
 */
const ORDEM: EtapaDaAnalise[] = ['preparando', 'elenco', 'detectando', 'cortando', 'personagens', 'organizando']
const SO_COM_PERSONAGENS: EtapaDaAnalise[] = ['elenco', 'personagens']

/**
 * (d) O ANDAMENTO DA ANALISE: as seis etapas, a barra, a frase do motor, o
 * tempo decorrido e o Cancelar. Analise leva minutos; nenhum minuto pode
 * passar sem sinal visivel.
 */
export function AndamentoDaAnalise() {
  const fase = useGerar((s) => s.fase)
  const job = useGerar((s) => s.job)
  const progresso = useGerar((s) => s.progresso)
  const vistas = useGerar((s) => s.etapasVistas)
  const cancelar = useGerar((s) => s.cancelar)
  const agora = useRelogio(fase === 'analisando' && job !== null)

  if (fase !== 'analisando' || !job) return null

  const atual: EtapaDaAnalise = progresso?.etapa ?? 'preparando'
  const decorrido = Math.max(0, (agora - job.inicio) / 1000)
  const fracao = progresso?.fracao ?? null

  return (
    <Secao
      titulo={job.motor === 'studio' ? 'Analisando no Studio' : 'Analisando com o AnCut'}
      destaque
      icone={<ScanFace size={13} strokeWidth={1.5} className="text-accent" />}
      acao={
        <div className="flex items-center gap-3">
          <span className="tnum text-[11px] text-ink-3" title="Tempo decorrido">
            {formatarTempo(decorrido)}
          </span>
          <Botao pequeno onClick={() => void cancelar()} disabled={job.cancelando}>
            {job.cancelando ? 'Cancelando...' : 'Cancelar'}
          </Botao>
        </div>
      }
    >
      <ol className="grid grid-cols-6 gap-1.5">
        {ORDEM.map((etapa) => {
          const pulada = !job.reconhecer && SO_COM_PERSONAGENS.includes(etapa)
          const eAtual = !pulada && etapa === atual
          const feita = !pulada && !eAtual && vistas.includes(etapa)
          return (
            <li
              key={etapa}
              title={pulada ? 'Pulado: a analise e so de corte' : ROTULO_DA_ETAPA[etapa]}
              className={[
                'flex min-w-0 flex-col gap-1.5 rounded-sm border px-2 py-1.5',
                eAtual ? 'border-accent bg-accent-dim' : 'border-line bg-elevated',
                pulada ? 'opacity-40' : '',
              ].join(' ')}
            >
              <span className="flex items-start gap-1.5">
                {eAtual ? (
                  <Loader2 size={11} strokeWidth={1.75} className="mt-px shrink-0 animate-spin text-accent" />
                ) : feita ? (
                  <Check size={11} strokeWidth={2} className="mt-px shrink-0 text-accent" />
                ) : (
                  <Circle size={11} strokeWidth={1.5} className="mt-px shrink-0 text-ink-3" />
                )}
                <span
                  className={[
                    'min-w-0 text-[11px] leading-tight',
                    eAtual ? 'text-ink' : feita ? 'text-ink-2' : 'text-ink-3',
                    pulada ? 'line-through' : '',
                  ].join(' ')}
                >
                  {ROTULO_DA_ETAPA[etapa]}
                </span>
              </span>
            </li>
          )
        })}
      </ol>

      <Barra fracao={fracao} />

      <div className="flex min-w-0 items-center gap-2">
        <p className="min-w-0 flex-1 select-text truncate text-[11px] text-ink-2" title={progresso?.mensagem}>
          {progresso?.mensagem || (job.id === null ? 'Chamando o motor...' : 'Preparando o ambiente de analise...')}
        </p>
        {fracao !== null && <span className="tnum shrink-0 text-[11px] text-ink-3">{Math.round(fracao * 100)}%</span>}
      </div>
      <p className="text-[11px] text-ink-3">
        {job.reconhecer ? 'Corte e personagens.' : 'So corte, sem personagens.'} Pode fechar o assistente: a analise
        continua, e reabrir mostra onde parou.
      </p>
    </Secao>
  )
}

/** A barra da etapa: cheia ate a fracao, ou um trecho correndo quando o motor nao sabe quanto falta. */
function Barra({ fracao }: { fracao: number | null }) {
  return (
    <div className="relative h-[3px] w-full overflow-hidden rounded-full bg-line-strong">
      {fracao === null ? (
        <motion.span
          className="absolute inset-y-0 w-1/3 rounded-full bg-accent"
          initial={{ left: '-33%' }}
          animate={{ left: '100%' }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
        />
      ) : (
        <span
          className="block h-full rounded-full bg-accent transition-[width] duration-300 ease-dangai"
          style={{ width: `${Math.max(2, fracao * 100)}%` }}
        />
      )}
    </div>
  )
}

/** Um Date.now() que anda de segundo em segundo enquanto `ligado`. */
function useRelogio(ligado: boolean): number {
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    if (!ligado) return
    setAgora(Date.now())
    const t = setInterval(() => setAgora(Date.now()), 1000)
    return () => clearInterval(t)
  }, [ligado])
  return agora
}

/** A indexacao: ler a legenda, cruzar com as cenas, sugerir OP/ED. Segundos, nao minutos. */
export function Indexando() {
  const fase = useGerar((s) => s.fase)
  const mensagem = useGerar((s) => s.indexando)
  if (fase !== 'indexando') return null
  return (
    <Secao titulo="Montando o indice" destaque>
      <p className="flex items-center gap-2 text-[12px] text-ink-2">
        <Loader2 size={13} strokeWidth={1.5} className="shrink-0 animate-spin text-accent" />
        <span className="min-w-0 truncate">{mensagem ?? 'Lendo a legenda...'}</span>
      </p>
      <Barra fracao={null} />
      <p className="text-[11px] text-ink-3">
        Le a legenda, cruza cada fala (e quem fala) com as cenas e procura a abertura e o encerramento.
      </p>
    </Secao>
  )
}
