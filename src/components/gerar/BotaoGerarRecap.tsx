import { Loader2, WandSparkles } from 'lucide-react'
import { useProject } from '@/store/project'
import { ehEpisodio, useGerar } from '@/store/gerar'

/**
 * A porta do assistente "Gerar recap" na tela inicial, no grupo de botoes do
 * canto, ao lado de "Legendar video pronto" e "Biblioteca".
 *
 * Clicar abre o dialogo e vai direto ao episodio escolhido -- um clique a
 * menos que abrir o assistente vazio. Com um episodio ja no assistente (ou uma
 * analise rodando), clicar so reabre onde parou.
 *
 * Soltar o .mkv EM CIMA do botao tambem vale, como no "Legendar video pronto".
 * Solto em qualquer outro lugar da tela inicial, o .mkv continua fazendo o que
 * o Dangai faz (vira clipe de um projeto novo).
 */
export function BotaoGerarRecap() {
  const busy = useProject((s) => s.busy)
  const rodando = useGerar((s) => s.job !== null || s.fase === 'indexando')

  if (busy !== null) return null

  const clicar = async (): Promise<void> => {
    const gerar = useGerar.getState()
    if (gerar.arquivo !== null) {
      gerar.abrir()
      return
    }
    await gerar.escolherArquivo()
  }

  return (
    <button
      type="button"
      onClick={() => void clicar()}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        const caminhos = Array.from(event.dataTransfer.files).map((f) => window.dangai.pathForFile(f))
        const episodio = caminhos.find(ehEpisodio)
        if (!episodio) return
        event.preventDefault()
        event.stopPropagation()
        useGerar.getState().abrir(episodio)
      }}
      title={
        rodando
          ? 'Analise rodando. Clique para ver o andamento.'
          : 'Do episodio ao recap: escolha o .mkv e o Studio acha (ou corta) as cenas, os personagens e as falas. (Clique, ou solte o episodio aqui.)'
      }
      className="flex items-center gap-2 rounded-sm border border-line bg-bg px-3 py-1.5 text-[12px] text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink"
    >
      {rodando ? (
        <Loader2 size={13} strokeWidth={1.5} className="animate-spin text-accent" />
      ) : (
        <WandSparkles size={13} strokeWidth={1.5} className="text-accent" />
      )}
      Gerar recap
    </button>
  )
}
