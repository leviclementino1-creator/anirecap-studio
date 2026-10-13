import { Fragment, useEffect, useRef, useState } from 'react'
import { ChevronRight, CircleCheck, Library as LibraryIcon, Upload, WandSparkles, X } from 'lucide-react'
import { ehEpisodio, escutarGerar, useGerar, type FaseDoEpisodio } from '@/store/gerar'
import { AndamentoDaAnalise, Indexando } from './AndamentoDaAnalise'
import { AreaDeSoltar, CartaoDoEpisodio } from './CartaoDoEpisodio'
import { PedidoDeDescoberta, ResultadoDaBusca } from './ResultadoDaBusca'
import { ResumoDoEpisodio } from './ResumoDoEpisodio'
import { Botao, Erro, Recado } from './pecas'

const PASSOS = [
  { n: 1, nome: 'Episodio' },
  { n: 2, nome: 'Roteiro' },
  { n: 3, nome: 'Voz' },
  { n: 4, nome: 'Cenas' },
] as const

/**
 * O ASSISTENTE "GERAR RECAP": do episodio ao projeto, em quatro paradas
 * (Episodio -> Roteiro -> Voz -> Cenas). So o passo 1 existe por enquanto; os
 * outros aparecem desligados, para o caminho inteiro estar a vista desde ja.
 *
 * Tela cheia por cima do app, como a Biblioteca -- e um lugar, nao um aviso.
 * Fica ABAIXO da Biblioteca e das Configuracoes (z-35 contra 40 e 50): "Ver
 * cenas na Biblioteca" abre por cima, e fechar a Biblioteca volta para ca.
 *
 * Esc fecha (a guarda de modais do App cuida disso). Fechar nao cancela nada:
 * a analise continua e reabrir mostra onde parou.
 */
export function GerarRecap() {
  const aberto = useGerar((s) => s.aberto)

  // A escuta mora aqui, e nao no Assistente: o componente monta com o app e
  // continua ouvindo o motor com a tela fechada.
  useEffect(() => escutarGerar(), [])

  if (!aberto) return null
  return <Assistente />
}

function Assistente() {
  const fase = useGerar((s) => s.fase)
  const erro = useGerar((s) => s.erro)
  const recado = useGerar((s) => s.recado)
  const temJob = useGerar((s) => s.job !== null)
  const fechar = useGerar((s) => s.fechar)
  const limparErro = useGerar((s) => s.limparErro)
  const limparRecado = useGerar((s) => s.limparRecado)

  const [arrastando, setArrastando] = useState(false)
  const profundidade = useRef(0)

  const temArquivos = (e: React.DragEvent): boolean => e.dataTransfer.types.includes('Files')

  return (
    <div
      className="fixed inset-0 z-[35] flex flex-col bg-bg"
      onDragEnter={(e) => {
        if (!temArquivos(e)) return
        e.preventDefault()
        profundidade.current += 1
        setArrastando(true)
      }}
      onDragOver={(e) => {
        if (!temArquivos(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(e) => {
        if (!temArquivos(e)) return
        profundidade.current = Math.max(0, profundidade.current - 1)
        if (profundidade.current === 0) setArrastando(false)
      }}
      onDrop={(e) => {
        /*
         * O drop PARA AQUI, sempre, ate no fundo da tela: o da janela
         * (useFileDrop) faria o ingest do Dangai e o .mkv viraria clipe de um
         * projeto novo por baixo do assistente.
         */
        e.preventDefault()
        e.stopPropagation()
        profundidade.current = 0
        setArrastando(false)
        const caminhos = Array.from(e.dataTransfer.files)
          .map((f) => window.dangai.pathForFile(f))
          .filter((p): p is string => Boolean(p))
        if (caminhos.length === 0) return
        // O store confere a extensao e diz o que fazer com o que nao for episodio.
        const gerar = useGerar.getState()
        const escolhido = caminhos.find(ehEpisodio) ?? caminhos[0]!
        if (escolhido === gerar.arquivo) return
        void gerar.carregarArquivo(escolhido)
      }}
    >
      <header className="flex h-[46px] shrink-0 items-center gap-3 border-b border-line px-5">
        <WandSparkles size={14} strokeWidth={1.5} className="text-accent" />
        <h2 className="text-[15px] font-semibold text-ink">Gerar recap</h2>
        <Passos fase={fase} />
        <span className="flex-1" />
        <button
          type="button"
          onClick={fechar}
          aria-label="Fechar"
          title={temJob ? 'Fechar (Esc). A analise continua rodando.' : 'Fechar (Esc)'}
          className="grid size-6 place-items-center rounded-sm text-ink-3 hover:text-ink"
        >
          <X size={13} strokeWidth={1.5} />
        </button>
      </header>

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[920px] flex-col gap-4 px-6 py-6">
          {erro && <Erro texto={erro} onFechar={limparErro} />}
          {recado && <Recado texto={recado} onFechar={limparRecado} />}
          {fase === 'vazio' ? <AreaDeSoltar arrastando={arrastando} /> : <CartaoDoEpisodio />}
          <PedidoDeDescoberta />
          <ResultadoDaBusca />
          <AndamentoDaAnalise />
          <Indexando />
          <ResumoDoEpisodio />
        </div>
        {arrastando && fase !== 'vazio' && (
          <div className="pointer-events-none fixed inset-x-0 bottom-[52px] top-[46px] z-20 grid place-items-center bg-bg/70 p-6">
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-accent bg-accent-dim">
              <Upload size={20} strokeWidth={1.5} className="text-accent" />
              <span className="text-[20px] font-semibold tracking-tight text-accent">
                {temJob ? 'Cancele a analise antes de trocar de episodio' : 'Solte para trocar de episodio'}
              </span>
            </div>
          </div>
        )}
      </div>

      <Rodape />
    </div>
  )
}

/** Os quatro passos no cabecalho. Do 2 em diante, desligados ate a parte 2. */
function Passos({ fase }: { fase: FaseDoEpisodio }) {
  return (
    <nav aria-label="Passos do assistente" className="ml-3 flex items-center gap-1">
      {PASSOS.map((p, i) => {
        const atual = p.n === 1
        const feito = atual && fase === 'pronto'
        return (
          <Fragment key={p.n}>
            {i > 0 && <ChevronRight size={12} strokeWidth={1.5} className="text-ink-3" />}
            <button
              type="button"
              disabled={!atual}
              aria-current={atual ? 'step' : undefined}
              title={atual ? undefined : 'Em breve'}
              className={[
                'flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[12px]',
                atual ? 'border-accent bg-accent-dim text-ink' : 'cursor-not-allowed border-transparent text-ink-3',
              ].join(' ')}
            >
              {feito ? (
                <CircleCheck size={13} strokeWidth={1.75} className="text-accent" />
              ) : (
                <span
                  className={[
                    'tnum grid size-4 place-items-center rounded-full border text-[10px]',
                    atual ? 'border-accent text-ink' : 'border-line-strong',
                  ].join(' ')}
                >
                  {p.n}
                </span>
              )}
              {p.nome}
              {!atual && <span className="text-[10px] text-ink-3/70">em breve</span>}
            </button>
          </Fragment>
        )
      })}
    </nav>
  )
}

/** A barra de baixo: onde se esta e o que vem depois. O "Proximo" fica desligado ate a parte 2. */
function Rodape() {
  const fase = useGerar((s) => s.fase)
  const totalCenas = useGerar((s) => s.indice?.planos.length ?? 0)
  const mudaram = useGerar((s) => s.exclusoesMudaram)
  const verNaBiblioteca = useGerar((s) => s.verNaBiblioteca)

  const texto: Record<FaseDoEpisodio, string> = {
    vazio: 'Passo 1 de 4: escolha o episodio.',
    sondando: 'Passo 1 de 4: lendo medidas, legendas e capitulos do episodio.',
    escolha: 'Escolha como seguir com este episodio.',
    analisando: 'Analisando. Pode fechar o assistente: a analise continua.',
    indexando: 'Montando o indice do episodio...',
    pronto: `Indice salvo · ${totalCenas.toLocaleString('pt-BR')} cenas${mudaram ? ' · marcacoes da regua ainda nao salvas' : ''}`,
  }

  return (
    <footer className="flex h-[52px] shrink-0 items-center gap-3 border-t border-line px-5">
      <span className="min-w-0 flex-1 truncate text-[11px] text-ink-3">{texto[fase]}</span>
      {fase === 'pronto' && (
        <Botao
          onClick={() => void verNaBiblioteca()}
          title="Abre a Biblioteca do editor neste episodio. Fechar a Biblioteca volta para ca."
        >
          <LibraryIcon size={13} strokeWidth={1.5} className="text-accent" />
          Ver cenas na Biblioteca
        </Botao>
      )}
      <Botao principal disabled onClick={() => {}} title="O roteiro chega na parte 2">
        Proximo: Roteiro
        <span className="font-normal text-ink-3">(parte 2)</span>
      </Botao>
    </footer>
  )
}
