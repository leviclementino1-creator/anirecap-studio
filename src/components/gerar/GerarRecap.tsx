import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Library as LibraryIcon, Settings2, X } from 'lucide-react'
import {
  ehEpisodio,
  escutarGerar,
  podeIrAoRoteiro,
  useGerar,
  type FaseDoEpisodio,
  type PassoDoAssistente,
} from '@/store/gerar'
import { escutarRoteiro, roteiroAprovado, useRoteiro } from '@/store/gerar-roteiro'
import { escutarVoz, useSituacaoDaVoz, useVoz } from '@/store/gerar-voz'
import { useProject } from '@/store/project'
import { classifyFile } from '@shared/channels'
import { AndamentoDaAnalise, Indexando } from './AndamentoDaAnalise'
import { AreaDeSoltar, CartaoDoEpisodio } from './CartaoDoEpisodio'
import { PassoDaVoz } from './PassoDaVoz'
import { PassoDoRoteiro } from './PassoDoRoteiro'
import { PedidoDeDescoberta, ResultadoDaBusca } from './ResultadoDaBusca'
import { ResumoDoEpisodio } from './ResumoDoEpisodio'
import { RodapeDaVoz } from './RodapeDaVoz'
import { RodapeDoRoteiro } from './RodapeDoRoteiro'
import { Botao } from './pecas'

const PASSOS = [
  { n: 1, nome: 'Episodio' },
  { n: 2, nome: 'Roteiro' },
  { n: 3, nome: 'Voz' },
  { n: 4, nome: 'Cenas' },
] as const

/**
 * O ASSISTENTE "GERAR RECAP": do episodio ao projeto, em quatro paradas
 * (Episodio -> Roteiro -> Voz -> Cenas). Os passos 1, 2 e 3 existem; o 4
 * aparece apagado, para o caminho inteiro estar a vista desde ja.
 *
 * Tela cheia por cima do app, como a Biblioteca -- e um lugar, nao um aviso.
 * Fica ABAIXO da Biblioteca, das Configuracoes e da paleta (z-35 contra 40 e
 * 50): "Ver cenas na Biblioteca" e "Trocar pasta" abrem por cima, e fechar
 * volta para ca. O App poe o resto da tela em `inert` enquanto ele esta aberto,
 * para o Tab nao fugir para os botoes escondidos atras.
 *
 * Esc fecha (a guarda de modais do App cuida disso). Fechar nao cancela nada:
 * a analise continua (a barra de status mostra) e reabrir mostra onde parou.
 */
export function GerarRecap() {
  const aberto = useGerar((s) => s.aberto)

  // A escuta mora aqui, e nao no Assistente: o componente monta com o app e
  // continua ouvindo o motor com a tela fechada.
  useEffect(() => escutarGerar(), [])
  useEffect(() => escutarRoteiro(), [])
  useEffect(() => escutarVoz(), [])

  if (!aberto) return null
  return <Assistente />
}

function Assistente() {
  const fase = useGerar((s) => s.fase)
  const passo = useGerar((s) => s.passo)
  const temJob = useGerar((s) => s.job !== null)
  const fechar = useGerar((s) => s.fechar)
  const openSettings = useProject((s) => s.openSettings)
  // A IA escrevendo o roteiro: trocar de episodio agora deixaria a resposta gravando no rascunho de outro, fora da vista.
  const temIa = useRoteiro((s) => s.geracao !== null)
  // O mesmo para a voz sendo gerada (passo 3).
  const temVoz = useVoz((s) => s.pedido !== null)

  const [arrastando, setArrastando] = useState(false)
  /** No passo 3 um audio solto vira a narracao: o aviso do arraste diz isso (pelo tipo, quando o sistema da). */
  const [arrastandoAudio, setArrastandoAudio] = useState(false)
  const profundidade = useRef(0)

  const temArquivos = (e: React.DragEvent): boolean => e.dataTransfer.types.includes('Files')
  const noPassoDaVoz = passo === 3 && fase !== 'vazio'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Gerar recap"
      className="fixed inset-0 z-[35] flex flex-col bg-bg"
      onDragEnter={(e) => {
        if (!temArquivos(e)) return
        e.preventDefault()
        profundidade.current += 1
        setArrastando(true)
        setArrastandoAudio(Array.from(e.dataTransfer.items).some((i) => i.kind === 'file' && i.type.startsWith('audio/')))
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
        /*
         * No passo 3 o audio solto e a narracao gravada por ele (o texto vem do
         * roteiro, o audio so da os tempos). Episodio continua trocando de
         * episodio; o resto ganha o recado no rodape DESTE passo (o do passo 1
         * nao aparece aqui).
         */
        if (noPassoDaVoz) {
          const audio = caminhos.find((c) => classifyFile(c) === 'audio')
          if (audio) {
            void useVoz.getState().importar(audio)
            return
          }
          if (!caminhos.some(ehEpisodio)) {
            useVoz.setState({ erro: 'Solte um audio (.wav, .mp3, .m4a) ou um episodio.' })
            return
          }
        }
        const escolhido = caminhos.find(ehEpisodio) ?? caminhos[0]!
        if (escolhido === gerar.arquivo) return
        if (useRoteiro.getState().geracao) {
          useRoteiro.setState({ erro: 'Cancele a IA antes de trocar de episodio.' })
          return
        }
        if (useVoz.getState().pedido) {
          // O recado vai para o rodape do passo na tela (cada passo mostra o erro da store dele).
          const erro = 'Cancele a voz antes de trocar de episodio.'
          if (noPassoDaVoz) useVoz.setState({ erro })
          else if (passo === 2) useRoteiro.setState({ erro })
          else useGerar.setState({ erro })
          return
        }
        void gerar.carregarArquivo(escolhido)
      }}
    >
      {/* O mesmo cabecalho da Biblioteca: 46 px, titulo de 15 px, acoes no canto. */}
      <header className="flex h-[46px] shrink-0 items-center gap-3 border-b border-line px-5">
        <h2 className="text-[15px] font-semibold text-ink">Gerar recap</h2>
        <Passos />
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => openSettings(true)}
          aria-label="Configuracoes"
          title="Configuracoes (Ctrl+,)"
          className="grid size-6 place-items-center rounded-sm text-ink-3 transition-colors duration-150 hover:text-ink"
        >
          <Settings2 size={13} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          onClick={fechar}
          aria-label="Fechar"
          title={
            temJob
              ? 'Fechar (Esc). A analise continua rodando.'
              : temIa
                ? 'Fechar (Esc). A IA continua.'
                : temVoz
                  ? 'Fechar (Esc). A voz continua.'
                  : 'Fechar (Esc)'
          }
          className="grid size-6 place-items-center rounded-sm text-ink-3 transition-colors duration-150 hover:text-ink"
        >
          <X size={13} strokeWidth={1.5} />
        </button>
      </header>

      {/*
       * scrollbar-gutter: o lugar da barra de rolagem fica reservado. Sem ele o
       * conteudo pulava 5 px para o lado quando a barra aparecia ou sumia (passo
       * 1 -> 2, o roteiro chegando depois da geracao).
       */}
      <div className="relative min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        {fase === 'vazio' ? (
          // Sem episodio, a area de soltar e a tela inteira, como o Dropzone da tela inicial.
          <div className="flex h-full p-6">
            <AreaDeSoltar arrastando={arrastando} />
          </div>
        ) : passo === 3 ? (
          <PassoDaVoz />
        ) : passo === 2 ? (
          <PassoDoRoteiro />
        ) : (
          <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-6 py-6">
            <CartaoDoEpisodio />
            <PedidoDeDescoberta />
            <ResultadoDaBusca />
            <AndamentoDaAnalise />
            <Indexando />
            <ResumoDoEpisodio />
          </div>
        )}
        {/* bg/90: com /70 o texto da tela vazava por baixo da frase grande e disputava com ela. */}
        {arrastando && fase !== 'vazio' && (
          <div className="pointer-events-none fixed inset-x-0 bottom-[52px] top-[46px] z-20 grid place-items-center bg-bg/90 p-6">
            <div className="flex h-full w-full items-center justify-center rounded-lg border border-dashed border-accent bg-accent-dim">
              <span className="text-[32px] font-semibold tracking-tight text-accent">
                {noPassoDaVoz && arrastandoAudio
                  ? temVoz
                    ? 'Espere a voz terminar'
                    : 'Solte para importar a narracao'
                  : temJob
                    ? 'Cancele a analise antes de trocar'
                    : temIa
                      ? 'Cancele a IA antes de trocar'
                      : temVoz
                        ? 'Cancele a voz antes de trocar'
                        : noPassoDaVoz
                          ? 'Solte a narracao ou um episodio'
                          : 'Solte para trocar de episodio'}
              </span>
            </div>
          </div>
        )}
      </div>

      {noPassoDaVoz ? <RodapeDaVoz /> : passo === 2 && fase !== 'vazio' ? <RodapeDoRoteiro /> : <Rodape />}
    </div>
  )
}

/**
 * Os quatro passos no cabecalho, numa barra so -- o mesmo seletor das
 * Configuracoes (Geral / Atalhos) e dos Segmentos do painel. O passo onde se
 * esta fica marcado; o 1, o 2 e o 3 viram botao quando da para ir (o 2 so com
 * o episodio pronto e a regua salva, o 3 so com o roteiro aprovado); o 4 e
 * "em breve" (no tooltip, para nao repetir a mesma frase na tela).
 */
function Passos() {
  const passo = useGerar((s) => s.passo)
  const fase = useGerar((s) => s.fase)
  const pode2 = useGerar(podeIrAoRoteiro)
  const mudaram = useGerar((s) => s.exclusoesMudaram)
  const episodioId = useGerar((s) => s.indice?.id ?? null)
  const irParaPasso = useGerar((s) => s.irParaPasso)
  const aprovado = useRoteiro((s) => episodioId !== null && s.episodioId === episodioId && roteiroAprovado(s))
  const vozAprovada = useSituacaoDaVoz() === 'aprovada' && aprovado

  return (
    <ol aria-label="Passos do assistente" className="ml-3 flex items-center gap-0.5 rounded-sm border border-line bg-elevated p-0.5">
      {PASSOS.map((p) => {
        const atual = p.n === passo
        const feito = (p.n === 1 && fase === 'pronto') || (p.n === 2 && aprovado) || (p.n === 3 && vozAprovada)
        const destino: PassoDoAssistente | null = p.n === 4 ? null : p.n
        const clicavel =
          !atual && destino !== null && (destino === 1 || (destino === 2 && pode2) || (destino === 3 && pode2 && aprovado))
        const dica = atual
          ? undefined
          : p.n === 1
            ? 'Voltar ao episodio'
            : p.n === 2
              ? pode2
                ? 'Ir ao roteiro'
                : mudaram
                  ? 'Salve as marcacoes de OP/ED antes'
                  : 'Primeiro o episodio'
              : p.n === 3
                ? !pode2
                  ? 'Primeiro o episodio'
                  : aprovado
                    ? 'Ir a voz'
                    : 'Aprove o roteiro antes'
                : 'Em breve'
        const classe = [
          'flex h-6 items-center gap-1.5 rounded-[3px] px-2.5 text-[11px]',
          atual
            ? 'bg-accent-dim text-ink ring-1 ring-inset ring-accent'
            : clicavel
              ? 'text-ink-2 transition-colors hover:bg-surface hover:text-ink'
              : 'text-ink-3',
        ].join(' ')
        const conteudo = (
          <>
            {feito ? (
              <Check size={11} strokeWidth={2} className="text-accent" aria-label="feito" />
            ) : (
              <span className="tnum">{p.n}</span>
            )}
            {p.nome}
          </>
        )
        return (
          <li key={p.n} aria-current={atual ? 'step' : undefined}>
            {clicavel && destino !== null ? (
              <button type="button" onClick={() => irParaPasso(destino)} title={dica} className={classe}>
                {conteudo}
              </button>
            ) : (
              <span title={dica} className={classe}>
                {conteudo}
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** Barra, caixa e barra final nao importam no Windows. */
function normal(caminho: string): string {
  return caminho.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

/**
 * As cenas deste episodio estao na Biblioteca do editor? Ela le duas raizes:
 * a do Studio e a Biblioteca do AnCut das Configuracoes (biblioteca-editor.ts).
 * Um episodio do Corte Cenas so esta la se a Biblioteca do AnCut apontar para
 * a pasta dele -- sem isso o "Ver cenas na Biblioteca" abria num episodio
 * errado, sem aviso. Le de novo quando as Configuracoes fecham.
 */
function useNaBibliotecaDoEditor(): boolean {
  const indice = useGerar((s) => s.indice)
  const configuracoesAbertas = useProject((s) => s.settingsOpen)
  const [libraryDir, setLibraryDir] = useState('')
  useEffect(() => {
    if (configuracoesAbertas) return
    let vivo = true
    void window.dangai.getSettings().then((r) => {
      if (vivo && r.ok) setLibraryDir(r.value.libraryDir)
    })
    return () => {
      vivo = false
    }
  }, [configuracoesAbertas])
  if (!indice) return false
  const { origem, pasta } = indice.biblioteca
  if (origem === 'studio' || origem === 'dangai') return true
  if (!libraryDir) return false
  const p = normal(pasta)
  const r = normal(libraryDir)
  return p === r || p.startsWith(`${r}\\`)
}

/**
 * A barra de baixo: onde se esta, e os recados. O erro mora AQUI, em vermelho
 * discreto como na barra de status do editor: no topo da pagina ele ficava
 * fora da vista com a regua rolada, e o clique parecia nao ter feito nada.
 * Clicar no erro (ou no recado) fecha; o texto inteiro fica no tooltip.
 */
function Rodape() {
  const fase = useGerar((s) => s.fase)
  const totalCenas = useGerar((s) => s.indice?.planos.length ?? 0)
  const mudaram = useGerar((s) => s.exclusoesMudaram)
  const erro = useGerar((s) => s.erro)
  const recado = useGerar((s) => s.recado)
  const limparErro = useGerar((s) => s.limparErro)
  const limparRecado = useGerar((s) => s.limparRecado)
  const verNaBiblioteca = useGerar((s) => s.verNaBiblioteca)
  const irParaPasso = useGerar((s) => s.irParaPasso)
  const pode2 = useGerar(podeIrAoRoteiro)
  const naBiblioteca = useNaBibliotecaDoEditor()

  const texto: Record<FaseDoEpisodio, string> = {
    vazio: '',
    sondando: 'Lendo o episodio...',
    escolha: '',
    analisando: 'Pode fechar: a analise continua',
    indexando: 'Lendo as falas...',
    pronto: `Pronto · ${totalCenas.toLocaleString('pt-BR')} cenas${mudaram ? ' · OP/ED nao salvos' : ''}`,
  }

  return (
    <footer className="flex h-[52px] shrink-0 items-center gap-3 border-t border-line px-5">
      <div className="flex min-w-0 flex-1 items-center" aria-live="polite">
        {erro ? (
          <button
            type="button"
            onClick={limparErro}
            title={`${erro}\n\nClique para fechar o aviso.`}
            className="min-w-0 truncate text-left text-[11px] text-danger"
          >
            {erro}
          </button>
        ) : recado ? (
          <button
            type="button"
            onClick={limparRecado}
            title={`${recado}\n\nClique para fechar o recado.`}
            className="min-w-0 truncate text-left text-[11px] text-ink-2"
          >
            {recado}
          </button>
        ) : (
          <span className="min-w-0 truncate text-[11px] text-ink-3">{texto[fase]}</span>
        )}
      </div>
      {fase === 'pronto' && naBiblioteca && (
        <Botao
          onClick={() => void verNaBiblioteca()}
          title="Abre a Biblioteca do editor neste episodio. Fechar a Biblioteca volta para ca."
        >
          <LibraryIcon size={13} strokeWidth={1.5} className="text-accent" />
          Ver cenas na Biblioteca
        </Botao>
      )}
      {/* A acao que leva adiante: o rosa da tela (com marcacao por salvar, o Salvar assume). */}
      {fase === 'pronto' && (
        <Botao
          principal
          onClick={() => irParaPasso(2)}
          disabled={!pode2}
          title={pode2 ? 'Ir ao roteiro (passo 2)' : 'Salve ou desfaca as marcacoes de OP/ED antes'}
        >
          Proximo: Roteiro
          <ArrowRight size={13} strokeWidth={1.5} />
        </Botao>
      )}
    </footer>
  )
}
