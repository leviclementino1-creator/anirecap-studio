import { useEffect, useRef, useState } from 'react'
import { Check, Info, X } from 'lucide-react'

/**
 * As pecas pequenas do assistente "Gerar recap": cartao de secao, botoes,
 * caixinha de marcar, campo de tempo e os recados. Seguem os mesmos tokens e
 * classes do resto do app (painel.tsx, Settings, Biblioteca) para o assistente
 * parecer parte dele, e nao um enxerto.
 */

/** 89.5 -> "1:29.5"; 3725 -> "1:02:05". `decimais` 0 arredonda para o segundo. */
export function formatarTempo(seg: number, decimais = 0): string {
  const s = Math.max(0, seg)
  const fator = 10 ** decimais
  const arredondado = Math.round(s * fator) / fator
  const h = Math.floor(arredondado / 3600)
  const m = Math.floor((arredondado % 3600) / 60)
  const resto = arredondado - h * 3600 - m * 60
  const inteiro = Math.floor(resto)
  const frac = decimais > 0 ? (resto - inteiro).toFixed(decimais).slice(1) : ''
  const ss = `${String(inteiro).padStart(2, '0')}${frac === '.0' ? '' : frac}`
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/**
 * O inverso, tolerante: "1:29", "1:29.5", "89", "89,5", "0:01:29". null quando
 * nao da para ler -- o campo volta ao valor anterior em vez de inventar um.
 */
export function lerTempo(texto: string): number | null {
  const limpo = texto.trim().replace(',', '.')
  if (!limpo) return null
  const partes = limpo.split(':')
  if (partes.length > 3) return null
  let total = 0
  for (const parte of partes) {
    if (!/^\d+(\.\d+)?$/.test(parte)) return null
    total = total * 60 + Number(parte)
  }
  return Number.isFinite(total) ? total : null
}

/** 90 -> "1m30s"; 42 -> "42s". Para duracoes de trecho, onde "1:30" confundiria com posicao. */
export function duracaoCurta(seg: number): string {
  const s = Math.round(Math.max(0, seg))
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m === 0) return `${r}s`
  return r === 0 ? `${m}min` : `${m}m${String(r).padStart(2, '0')}s`
}

/** Um bloco do passo: borda, titulo pequeno em caixa alta e o conteudo. */
export function Secao({
  titulo,
  icone,
  acao,
  children,
  destaque = false,
}: {
  titulo: string
  icone?: React.ReactNode
  /** Controles no canto do titulo. */
  acao?: React.ReactNode
  children: React.ReactNode
  /** Borda rosa: a secao que pede a proxima decisao. */
  destaque?: boolean
}) {
  return (
    <section
      className={[
        'enter flex min-w-0 flex-col gap-3 rounded-md border bg-surface p-4',
        destaque ? 'border-accent/40' : 'border-line',
      ].join(' ')}
    >
      <header className="flex min-h-6 items-center gap-2">
        {icone}
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{titulo}</h3>
        <span className="flex-1" />
        {acao}
      </header>
      {children}
    </section>
  )
}

/**
 * Os botoes do assistente. `principal` e o rosa apagado que o app usa para a
 * acao que leva adiante ("Adicionar ao projeto"); o resto e o neutro.
 */
export function Botao({
  onClick,
  disabled,
  title,
  principal = false,
  pequeno = false,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  title?: string
  principal?: boolean
  pequeno?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={[
        'lift flex shrink-0 items-center gap-1.5 rounded-sm border font-medium disabled:cursor-not-allowed disabled:opacity-40',
        pequeno ? 'px-2.5 py-1 text-[11px]' : 'px-3.5 py-1.5 text-[13px]',
        principal ? 'border-accent bg-accent-dim text-ink' : 'border-line bg-elevated text-ink-2 hover:text-ink',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

/** Uma caixinha de marcar com o texto ao lado. */
export function Caixinha({
  ligada,
  onChange,
  disabled,
  title,
  children,
}: {
  ligada: boolean
  onChange: (ligada: boolean) => void
  disabled?: boolean
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={ligada}
      onClick={() => onChange(!ligada)}
      disabled={disabled}
      title={title}
      className="group flex items-center gap-2 text-left text-[12px] text-ink-2 hover:text-ink disabled:opacity-40"
    >
      <span
        className={[
          'grid size-4 shrink-0 place-items-center rounded-[4px] border transition-colors',
          ligada ? 'border-accent bg-accent text-white' : 'border-line-strong bg-elevated',
        ].join(' ')}
      >
        {ligada && <Check size={11} strokeWidth={2.25} />}
      </span>
      {children}
    </button>
  )
}

/** As classes do campo de texto do app (as mesmas das Configuracoes). */
export const CLASSE_DO_CAMPO =
  'min-w-0 select-text rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none disabled:opacity-50'

/**
 * Campo de tempo em m:ss. Grava ao sair do campo ou no Enter; Esc desiste.
 * Texto que nao se le como tempo volta ao valor de antes.
 */
export function CampoDeTempo({
  valor,
  onChange,
  disabled,
  rotulo,
}: {
  valor: number
  onChange: (seg: number) => void
  disabled?: boolean
  /** Para leitor de tela e tooltip: "Inicio", "Fim". */
  rotulo: string
}) {
  const [texto, setTexto] = useState(() => formatarTempo(valor, 1))
  const [editando, setEditando] = useState(false)
  /*
   * O Esc desiste pelo blur, e o blur e o mesmo que grava -- rodando NA HORA,
   * com o `texto` digitado ainda no closure (o setTexto do Esc so vale no
   * proximo render). Sem esta marca, Esc gravava igual ao Enter.
   */
  const desistiu = useRef(false)

  // Arrastar na regua muda o valor por fora: o campo acompanha quando nao esta sendo digitado.
  useEffect(() => {
    if (!editando) setTexto(formatarTempo(valor, 1))
  }, [valor, editando])

  const gravar = (): void => {
    setEditando(false)
    if (desistiu.current) {
      desistiu.current = false
      setTexto(formatarTempo(valor, 1))
      return
    }
    const lido = lerTempo(texto)
    if (lido === null) setTexto(formatarTempo(valor, 1))
    else if (Math.abs(lido - valor) > 0.0005) onChange(lido)
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={texto}
      disabled={disabled}
      aria-label={rotulo}
      title={`${rotulo} (m:ss, aceita decimos: 1:29.5)`}
      onFocus={(e) => {
        setEditando(true)
        e.currentTarget.select()
      }}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={gravar}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          desistiu.current = true
          e.currentTarget.blur()
        }
      }}
      className={`${CLASSE_DO_CAMPO} tnum w-[76px] px-2 py-1 text-[12px]`}
    />
  )
}

/** O erro do assistente: vermelho discreto, selecionavel, com X. Nunca trava a tela. */
export function Erro({ texto, onFechar }: { texto: string; onFechar: () => void }) {
  return (
    <div
      role="alert"
      className="enter flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2"
    >
      <p className="min-w-0 flex-1 select-text whitespace-pre-wrap break-words text-[12px] leading-relaxed text-danger">
        {texto}
      </p>
      <button
        type="button"
        onClick={onFechar}
        aria-label="Fechar o aviso"
        className="grid size-5 shrink-0 place-items-center rounded-sm text-danger/80 hover:text-danger"
      >
        <X size={12} strokeWidth={1.75} />
      </button>
    </div>
  )
}

/** Recado neutro ("Analise cancelada."), sem cara de erro. */
export function Recado({ texto, onFechar }: { texto: string; onFechar: () => void }) {
  return (
    <div className="enter flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2">
      <Info size={13} strokeWidth={1.5} className="shrink-0 text-ink-3" />
      <p className="min-w-0 flex-1 text-[12px] text-ink-2">{texto}</p>
      <button
        type="button"
        onClick={onFechar}
        aria-label="Fechar o recado"
        className="grid size-5 shrink-0 place-items-center rounded-sm text-ink-3 hover:text-ink"
      >
        <X size={12} strokeWidth={1.75} />
      </button>
    </div>
  )
}

/**
 * A pasta de sincronizacao em que o caminho esta, ou null. O Windows costuma
 * redirecionar Documentos para o OneDrive, e a biblioteca padrao do Studio mora
 * em Documentos: cada episodio cortado (~1 GB de mp4 e keyframes) iria para a
 * nuvem sem ninguem pedir.
 */
export function nuvemDoCaminho(caminho: string): string | null {
  const m = /[\\/](OneDrive(?: - [^\\/]+)?|Dropbox|Google Drive|iCloudDrive)(?:[\\/]|$)/i.exec(caminho)
  if (!m) return null
  const pasta = m[1]!.toLowerCase()
  if (pasta.startsWith('onedrive')) return 'OneDrive'
  if (pasta === 'dropbox') return 'Dropbox'
  if (pasta === 'google drive') return 'Google Drive'
  return 'iCloud'
}

/** "Senku 120": um nome com a contagem, no estilo dos chips do app. */
export function Contagem({ nome, n }: { nome: string; n: number }) {
  return (
    <span className="flex items-center gap-1.5 rounded-sm border border-line bg-elevated px-2 py-1 text-[11px] text-ink-2">
      <span className="max-w-[160px] truncate">{nome}</span>
      <span className="tnum text-ink-3">{n}</span>
    </span>
  )
}

/** "quem: A (n), B (n), C (n) e mais 4" -- a linha curta de uma lista longa. */
export function listaCurta(itens: readonly { nome: string; n: number }[], maximo: number): string {
  const vistos = itens.slice(0, maximo).map((i) => `${i.nome} (${i.n})`)
  const resto = itens.length - vistos.length
  return resto > 0 ? `${vistos.join(', ')} e mais ${resto}` : vistos.join(', ')
}
