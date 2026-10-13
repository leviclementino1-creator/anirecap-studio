import { useEffect, useMemo, useState } from 'react'
import { Check, CircleCheck, FolderOpen, Plus, Scissors, Subtitles, Trash2, TriangleAlert, Undo2, Users } from 'lucide-react'
import {
  ROTULO_DA_ORIGEM,
  ROTULO_DO_MOTIVO,
  resumirIndice,
  slugDoEpisodio,
  type Exclusao,
  type ResumoDoIndice,
  type MotivoDaExclusao,
} from '@shared/episodio'
import { useGerar } from '@/store/gerar'
import { rotuloDaFaixa } from './CartaoDoEpisodio'
import { LISTRADO, ReguaDoEpisodio } from './ReguaDoEpisodio'
import { Botao, CampoDeTempo, CLASSE_DO_CAMPO, Contagem, duracaoCurta, formatarTempo, listaCurta, Secao } from './pecas'

/** Quantos personagens cabem em chips antes do "+N". */
const PERSONAGENS_VISIVEIS = 24

/**
 * (e) O EPISODIO PRONTO: o que o indice sabe (cenas, falas, quem fala, quem
 * aparece) e a regua de OP/ED para confirmar.
 *
 * O resumo vem de resumirIndice (shared), o mesmo que qualquer outra tela vai
 * usar -- o numero que aparece aqui e o numero que o roteiro vai enxergar.
 */
export function ResumoDoEpisodio() {
  const fase = useGerar((s) => s.fase)
  const indice = useGerar((s) => s.indice)
  const ultimaAnalise = useGerar((s) => s.ultimaAnalise)

  const resumo = useMemo(() => (indice ? resumirIndice(indice) : null), [indice])

  if (fase !== 'pronto' || !indice || !resumo) return null

  const faixa = indice.faixaLegenda
  const personagensSobram = resumo.personagens.length - PERSONAGENS_VISIVEIS

  return (
    <>
      <Secao
        titulo="Episodio pronto"
        icone={<CircleCheck size={13} strokeWidth={1.5} className="text-accent" />}
        acao={
          <Botao
            pequeno
            onClick={() => void window.dangai.revealFile(indice.biblioteca.pasta)}
            title={indice.biblioteca.pasta}
          >
            <FolderOpen size={12} strokeWidth={1.5} />
            Abrir a pasta das cenas
          </Botao>
        }
      >
        <p className="text-[13px] leading-relaxed text-ink">
          {indice.anime} · {slugDoEpisodio(indice.temporada, indice.episodio, indice.kind)} · cenas na biblioteca do{' '}
          {ROTULO_DA_ORIGEM[indice.biblioteca.origem]}
          {ultimaAnalise && (
            <span className="text-ink-3">
              {' '}
              · analise feita em {duracaoCurta(ultimaAnalise.segundos)}
              {ultimaAnalise.rodadas > 1 ? ` (somando ${ultimaAnalise.rodadas} rodadas do motor)` : ''}
            </span>
          )}
        </p>

        <Numeros resumo={resumo} />

        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-ink-2">
            <Users size={12} strokeWidth={1.5} className="text-ink-3" />
            Personagens
          </span>
          {resumo.personagens.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {resumo.personagens.slice(0, PERSONAGENS_VISIVEIS).map((p) => (
                <Contagem key={p.nome} nome={p.nome} n={p.cenas} />
              ))}
              {personagensSobram > 0 && (
                <span className="px-1 py-1 text-[11px] text-ink-3">e mais {personagensSobram}</span>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] text-ink-3">
                {indice.reconhecimento === 'pulado'
                  ? 'Nao reconhecidos: a analise foi so de corte.'
                  : indice.reconhecimento === 'desconhecido'
                    ? 'A biblioteca de origem nao diz quem aparece nas cenas.'
                    : 'O motor nao reconheceu ninguem com confianca.'}
              </p>
              {indice.reconhecimento === 'pulado' && indice.biblioteca.origem === 'studio' && <ReconhecerAgora />}
            </div>
          )}
          {resumo.personagens.length > 0 && (
            <p className="text-[11px] text-ink-3">O numero e em quantas cenas o personagem foi reconhecido.</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-ink-2">
            <Subtitles size={12} strokeWidth={1.5} className="text-ink-3" />
            Legenda
          </span>
          {faixa ? (
            <>
              <p className="text-[12px] text-ink">
                {rotuloDaFaixa(faixa)} · <span className="tnum">{resumo.totalFalas}</span> falas
              </p>
              <p className="text-[11px] leading-relaxed text-ink-3">
                {resumo.falantes.length > 0
                  ? `Quem mais fala: ${listaCurta(
                      resumo.falantes.map((f) => ({ nome: f.nome, n: f.falas })),
                      5,
                    )}`
                  : resumo.totalFalas > 0
                    ? 'A legenda nao diz quem fala (sem o campo Name): as falas ficam sem falante.'
                    : 'A legenda nao tem falas.'}
              </p>
            </>
          ) : (
            <p className="text-[11px] text-ink-3">Sem legenda de texto: as cenas ficam sem falas.</p>
          )}
        </div>

        {indice.avisos.length > 0 && (
          <ul className="flex flex-col gap-1">
            {indice.avisos.map((aviso, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-2">
                <TriangleAlert size={12} strokeWidth={1.5} className="mt-0.5 shrink-0 text-accent" />
                <span className="select-text">{aviso}</span>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <AberturaEEncerramento />
    </>
  )
}

/**
 * Depois de um "so cortar": roda a analise completa sobre o mesmo episodio. O
 * motor reaproveita os cortes (vem do cache), entao o custo e o elenco e o
 * reconhecimento. As marcacoes CONFIRMADAS da regua passam para o indice novo.
 */
function ReconhecerAgora() {
  const analisar = useGerar((s) => s.analisar)
  const mudaram = useGerar((s) => s.exclusoesMudaram)
  const motor = useGerar((s) => s.motor)
  const pronto = motor?.studio.pronto === true
  return (
    <Botao
      pequeno
      onClick={() => void analisar('studio', true)}
      disabled={mudaram || !pronto}
      title={
        mudaram
          ? 'Salve ou descarte as marcacoes da regua antes'
          : !pronto
            ? (motor?.studio.erro ?? 'O motor do Studio nao esta pronto')
            : 'Busca o elenco e reconhece os personagens nas cenas que ja estao cortadas'
      }
    >
      <Users size={12} strokeWidth={1.5} />
      Reconhecer personagens agora
    </Botao>
  )
}

/** Os quatro numeros do episodio, em cartoes. "Fora do recap" segue a regua, salva ou nao. */
function Numeros({ resumo }: { resumo: ResumoDoIndice }) {
  const indice = useGerar((s) => s.indice)
  const exclusoes = useGerar((s) => s.exclusoes)
  if (!indice) return null

  const fora = exclusoes.reduce((s, e) => s + Math.max(0, e.end - e.start), 0)
  const pendentes = exclusoes.filter((e) => !e.confirmada).length

  return (
    <div className="grid grid-cols-4 gap-2">
      <Numero titulo="Cenas" valor={resumo.totalCenas.toLocaleString('pt-BR')} detalhe={`${resumo.cenasComFala} com fala`} />
      <Numero
        titulo="Falas"
        valor={resumo.totalFalas.toLocaleString('pt-BR')}
        detalhe={
          resumo.falantes.length > 0
            ? `${resumo.falantes.length} ${resumo.falantes.length === 1 ? 'falante' : 'falantes'}`
            : 'sem quem fala'
        }
      />
      <Numero
        titulo="Personagens"
        valor={String(resumo.personagens.length)}
        detalhe={
          indice.reconhecimento === 'pulado'
            ? 'so corte'
            : indice.reconhecimento === 'desconhecido'
              ? 'sem informacao'
              : 'pelo rosto'
        }
      />
      <Numero
        titulo="Fora do recap"
        valor={formatarTempo(fora)}
        detalhe={
          exclusoes.length === 0
            ? 'nada marcado'
            : pendentes > 0
              ? `${pendentes} a confirmar`
              : 'tudo confirmado'
        }
        alerta={pendentes > 0}
      />
    </div>
  )
}

function Numero({
  titulo,
  valor,
  detalhe,
  alerta = false,
}: {
  titulo: string
  valor: string
  detalhe: string
  alerta?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-sm border border-line bg-elevated px-3 py-2">
      <span className="text-[10px] font-medium uppercase tracking-wide text-ink-3">{titulo}</span>
      <span className="tnum text-[20px] font-semibold leading-tight text-ink">{valor}</span>
      <span className={['truncate text-[11px]', alerta ? 'text-accent' : 'text-ink-3'].join(' ')}>{detalhe}</span>
    </div>
  )
}

/**
 * A REGUA DE OP/ED com a lista dos trechos. O Studio sugere (tracejado), o
 * usuario confirma (cheio), remove, ajusta ou marca outro trecho. Nada vai para
 * o disco ate "Salvar marcacoes": o indice so muda quando ele decide.
 */
function AberturaEEncerramento() {
  const indice = useGerar((s) => s.indice)
  const sonda = useGerar((s) => s.sonda)
  const exclusoes = useGerar((s) => s.exclusoes)
  const mudaram = useGerar((s) => s.exclusoesMudaram)
  const salvando = useGerar((s) => s.salvando)
  const salvoEm = useGerar((s) => s.salvoEm)
  const confirmar = useGerar((s) => s.confirmarExclusao)
  const confirmarTodas = useGerar((s) => s.confirmarTodas)
  const remover = useGerar((s) => s.removerExclusao)
  const ajustar = useGerar((s) => s.ajustarExclusao)
  const marcarTrecho = useGerar((s) => s.marcarTrecho)
  const descartar = useGerar((s) => s.descartarMudancas)
  const salvar = useGerar((s) => s.salvarExclusoes)
  const [selecionada, setSelecionada] = useState<number | null>(null)

  const falas = useMemo(
    () => (indice?.cues ?? []).filter((c) => c.tipo === 'fala').map((c) => ({ start: c.start, end: c.end })),
    [indice],
  )
  // Inicio de cada cena e o fim da ultima: os pontos onde a borda gruda.
  const cortes = useMemo(() => {
    const planos = indice?.planos ?? []
    const pontos = new Set<number>()
    for (const p of planos) pontos.add(Math.round(p.start * 1000) / 1000)
    const ultimo = planos[planos.length - 1]
    if (ultimo) pontos.add(Math.round(ultimo.end * 1000) / 1000)
    return [...pontos].sort((a, b) => a - b)
  }, [indice])

  // Trecho removido (ou lista trocada): a escolha que apontava para ele some.
  useEffect(() => {
    if (selecionada !== null && selecionada >= exclusoes.length) setSelecionada(null)
  }, [exclusoes.length, selecionada])

  if (!indice) return null
  const duracao = indice.fonte.duracaoSec
  const pendentes = exclusoes.filter((e) => !e.confirmada).length

  const marcarManual = (): void => {
    const largura = Math.min(30, duracao)
    const depoisDe = selecionada !== null ? exclusoes[selecionada]?.end : undefined
    const base = depoisDe !== undefined ? depoisDe + 5 : duracao / 2 - largura / 2
    const start = Math.min(Math.max(0, base), Math.max(0, duracao - largura))
    setSelecionada(marcarTrecho(start, start + largura))
  }

  return (
    <Secao
      titulo="Abertura e encerramento"
      icone={<Scissors size={13} strokeWidth={1.5} className="text-accent" />}
      destaque={pendentes > 0}
      acao={
        <span className="text-[11px] text-ink-3">
          {mudaram
            ? 'Mudancas nao salvas'
            : salvoEm
              ? 'Salvo'
              : pendentes === 1
                ? '1 sugestao para olhar'
                : pendentes > 1
                  ? `${pendentes} sugestoes para olhar`
                  : ''}
        </span>
      }
    >
      <p className="text-[11px] leading-relaxed text-ink-3">
        O que estiver marcado fica fora do recap. Tracejado e sugestao do Studio; cheio e confirmado. Arraste as
        bordas para ajustar (grudam nos cortes; Alt solta), ou arraste num espaco vazio para marcar outro trecho.
      </p>

      <ReguaDoEpisodio
        duracao={duracao}
        exclusoes={exclusoes}
        selecionada={selecionada}
        onSelecionar={setSelecionada}
        onAjustar={ajustar}
        onMarcar={marcarTrecho}
        falas={falas}
        cortes={cortes}
        capitulos={sonda?.capitulos ?? []}
      />
      <Legenda />

      {exclusoes.length === 0 ? (
        <p className="text-[12px] text-ink-2">
          Nenhuma abertura ou encerramento sugerido. Se o episodio tem, marque na regua.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {exclusoes.map((ex, i) => (
            <LinhaDaExclusao
              key={i}
              ex={ex}
              escolhida={i === selecionada}
              onEscolher={() => setSelecionada(i)}
              onConfirmar={() => confirmar(i)}
              onRemover={() => {
                remover(i)
                setSelecionada(null)
              }}
              onAjustar={(patch) => ajustar(i, patch)}
            />
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Botao pequeno onClick={marcarManual} title="Acrescenta um trecho de 30 s para ajustar (ou arraste na regua)">
          <Plus size={12} strokeWidth={1.75} />
          Marcar trecho manual
        </Botao>
        {pendentes > 1 && (
          <Botao pequeno onClick={confirmarTodas}>
            <Check size={12} strokeWidth={1.75} />
            Confirmar todas ({pendentes})
          </Botao>
        )}
        <span className="flex-1" />
        {mudaram && (
          <Botao pequeno onClick={descartar} disabled={salvando} title="Volta as marcacoes ao que esta salvo">
            <Undo2 size={12} strokeWidth={1.5} />
            Desfazer mudancas
          </Botao>
        )}
        <Botao principal onClick={() => void salvar()} disabled={!mudaram || salvando}>
          {salvando ? 'Salvando...' : 'Salvar marcacoes'}
        </Botao>
      </div>
    </Secao>
  )
}

/** A legenda da regua, em uma linha. */
function Legenda() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-ink-3">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-[3px] border border-dashed border-accent" style={{ backgroundImage: LISTRADO }} />
        Sugerida
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-[3px] border border-accent bg-accent/30" />
        Confirmada
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-4 rounded-[2px] bg-ink-2/60" />
        Fala
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-px bg-white/30" />
        Corte de cena
      </span>
    </div>
  )
}

const MOTIVOS = Object.entries(ROTULO_DO_MOTIVO) as [MotivoDaExclusao, string][]

/** Uma linha da lista: motivo, inicio e fim em m:ss, por que, e confirmar/remover. */
function LinhaDaExclusao({
  ex,
  escolhida,
  onEscolher,
  onConfirmar,
  onRemover,
  onAjustar,
}: {
  ex: Exclusao
  escolhida: boolean
  onEscolher: () => void
  onConfirmar: () => void
  onRemover: () => void
  onAjustar: (patch: Partial<Pick<Exclusao, 'start' | 'end' | 'motivo'>>) => void
}) {
  const porque = ex.porque || (ex.origem === 'usuario' ? 'Marcado por voce' : '')
  return (
    <li
      onPointerDown={onEscolher}
      className={[
        'flex min-w-0 items-center gap-2 rounded-sm border px-2 py-1.5 transition-colors',
        escolhida ? 'border-accent bg-accent-dim' : 'border-line bg-elevated',
      ].join(' ')}
    >
      <span
        className={[
          'h-3 w-3 shrink-0 rounded-[3px] border border-accent',
          ex.confirmada ? 'bg-accent/40' : 'border-dashed',
        ].join(' ')}
        style={ex.confirmada ? undefined : { backgroundImage: LISTRADO }}
        aria-hidden
      />
      <select
        value={ex.motivo}
        onChange={(e) => onAjustar({ motivo: e.target.value as MotivoDaExclusao })}
        aria-label="Motivo"
        className={`${CLASSE_DO_CAMPO} w-[120px] shrink-0 px-1.5 py-1 text-[12px]`}
      >
        {MOTIVOS.map(([valor, rotulo]) => (
          <option key={valor} value={valor}>
            {rotulo}
          </option>
        ))}
      </select>
      <CampoDeTempo valor={ex.start} rotulo="Inicio" onChange={(start) => onAjustar({ start })} />
      <span className="text-[11px] text-ink-3">ate</span>
      <CampoDeTempo valor={ex.end} rotulo="Fim" onChange={(end) => onAjustar({ end })} />
      <span className="tnum w-[52px] shrink-0 text-[11px] text-ink-3">{duracaoCurta(ex.end - ex.start)}</span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-ink-3" title={porque}>
        {porque}
      </span>
      {ex.confirmada ? (
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-ink-2">
          <Check size={12} strokeWidth={2} className="text-accent" />
          Confirmada
        </span>
      ) : (
        <Botao pequeno principal onClick={onConfirmar} title="Fica fora do recap">
          <Check size={12} strokeWidth={1.75} />
          Confirmar
        </Botao>
      )}
      <button
        type="button"
        onClick={onRemover}
        aria-label="Remover o trecho"
        title="Remover (o trecho volta para o recap)"
        className="grid size-6 shrink-0 place-items-center rounded-sm text-ink-3 hover:text-danger"
      >
        <Trash2 size={13} strokeWidth={1.5} />
      </button>
    </li>
  )
}
