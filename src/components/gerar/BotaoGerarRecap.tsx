import { useEffect, useRef, useState } from 'react'
import { Loader2, WandSparkles } from 'lucide-react'
import { useProject } from '@/store/project'
import { ehEpisodio, useGerar } from '@/store/gerar'

/**
 * A porta do assistente "Gerar recap" na tela inicial -- a funcao principal do
 * app, por isso a unica acao rosa da linha de cima (o mesmo rosa apagado do
 * "Adicionar ao projeto" da Biblioteca), na mesma altura e no mesmo tamanho de
 * letra dos vizinhos. E o primeiro da linha no Tab.
 *
 * Clicar abre o dialogo e vai direto ao episodio escolhido -- um clique a
 * menos que abrir o assistente vazio. Com um episodio ja no assistente (ou uma
 * analise rodando), clicar so reabre onde parou.
 *
 * Soltar o .mkv EM CIMA do botao tambem vale, como no "Legendar video pronto":
 * enquanto um arquivo passa por cima, ele acende cheio. Solto em qualquer
 * outro lugar da tela inicial, o .mkv continua fazendo o que o Dangai faz
 * (vira clipe de um projeto novo). `aoAcender` avisa a tela inicial, que apaga
 * a area de soltar enquanto o alvo e o botao.
 */
export function BotaoGerarRecap({
  arrastando,
  aoAcender,
}: {
  arrastando: boolean
  aoAcender?: (aceso: boolean) => void
}) {
  const busy = useProject((s) => s.busy)
  const rodando = useGerar((s) => s.job !== null || s.fase === 'indexando')
  const abrirOuEscolher = useGerar((s) => s.abrirOuEscolher)
  const [sobre, setSobre] = useState(false)
  // Entrar num filho (icone, texto) dispara leave no pai: conta a profundidade.
  const profundidade = useRef(0)

  // `arrastando` e o da janela: um arraste cancelado fora do botao apaga o realce.
  const acesso = sobre && arrastando && busy === null
  useEffect(() => {
    aoAcender?.(acesso)
  }, [acesso, aoAcender])

  if (busy !== null) return null

  return (
    <button
      type="button"
      onClick={() => void abrirOuEscolher()}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        profundidade.current += 1
        setSobre(true)
      }}
      onDragLeave={() => {
        profundidade.current = Math.max(0, profundidade.current - 1)
        if (profundidade.current === 0) setSobre(false)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        profundidade.current = 0
        setSobre(false)
        const caminhos = Array.from(event.dataTransfer.files).map((f) => window.dangai.pathForFile(f))
        const episodio = caminhos.find(ehEpisodio)
        if (!episodio) return
        event.preventDefault()
        event.stopPropagation()
        useGerar.getState().abrir(episodio)
      }}
      title={rodando ? 'Analise rodando. Clique para ver o andamento.' : 'Gerar recap de um episodio (clique ou solte o .mkv aqui)'}
      className={[
        'flex shrink-0 items-center gap-2 rounded-sm border border-accent px-3 py-1.5 text-[12px] font-medium transition-colors duration-150',
        acesso ? 'bg-accent text-white' : 'bg-accent-dim text-ink hover:bg-accent-glow',
      ].join(' ')}
    >
      {rodando ? (
        <Loader2 size={13} strokeWidth={1.5} className={['animate-spin', acesso ? 'text-white' : 'text-accent'].join(' ')} />
      ) : (
        <WandSparkles size={13} strokeWidth={1.5} className={acesso ? 'text-white' : 'text-accent'} />
      )}
      Gerar recap
    </button>
  )
}
