import { useEffect, useState } from 'react'
import { Wand2, Clapperboard, Lightbulb, Library as LibraryIcon, Loader2 } from 'lucide-react'
import { useProject } from '@/store/project'
import type { AutomountMode } from '@shared/channels'
import { Segmentos, type Segmento } from '@/components/painel'
import { gravarModoDoAutomount, lerModoDoAutomount } from '@/components/automount-modo'

/*
 * A cronologia e a unica diferenca entre os dois modos, e e decisiva: por isso
 * ela vai no title de cada opcao, e nao em texto na tela.
 */
const MODOS: readonly Segmento<AutomountMode>[] = [
  {
    valor: 'recap',
    rotulo: (
      <>
        <Clapperboard size={12} strokeWidth={1.5} />
        Recap
      </>
    ),
    title: 'Recap: segue a ordem do episodio, cada cena vem depois da anterior (so escolhe o modo)',
  },
  {
    valor: 'theory',
    rotulo: (
      <>
        <Lightbulb size={12} strokeWidth={1.5} />
        Teoria
      </>
    ),
    title: 'Teoria: segue a ordem do argumento, misturando temporadas (so escolhe o modo)',
  },
]

/**
 * A escolha entre recap e teoria, no instante em que ela existe.
 *
 * Aparece so quando ha narracao e nenhuma imagem -- que e exatamente o momento
 * depois de soltar o mp3 sozinho. Quem solta narracao E imagens nunca ve isto,
 * e o caminho manual continua intocado: montar sozinho e um segundo gesto no
 * mesmo lugar, nao um modo em que se entra.
 *
 * "Montar recap" e "Montar teoria" eram dois botoes com o MESMO gesto e uma
 * diferenca so; viraram um "Montar sozinho" com a escolha dentro (decisao do
 * Levi, 15/10). A escolha fica lembrada (automount-modo.ts), entao o caso de
 * sempre e um clique.
 *
 * O botao da Biblioteca fica AQUI ao lado, e nao so na tela vazia: soltar a
 * narracao ja tira o app do estado vazio, e ele ficou sem nenhuma porta visivel
 * para escolher as cenas na mao. Palavras dele: "cade a outra mecanica?".
 */
export function Automount() {
  const audio = useProject((s) => s.audio)
  const images = useProject((s) => s.images)
  const busy = useProject((s) => s.busy)
  const automount = useProject((s) => s.automount)
  const openLibrary = useProject((s) => s.openLibrary)
  const library = useProject((s) => s.library)
  const libraryBusy = useProject((s) => s.libraryBusy)
  const syncLibrary = useProject((s) => s.syncLibrary)
  const serie = useProject((s) => s.automountSeries)
  const setSerie = useProject((s) => s.setAutomountSeries)
  const [modo, setModo] = useState<AutomountMode>(lerModoDoAutomount)

  const visivel = audio !== null && images.length === 0

  /*
   * A lista de series vem da varredura, que pode nunca ter rodado nesta sessao.
   * Puxar aqui e o que faz a escolha existir antes do primeiro clique -- pedir
   * depois seria mostrar um seletor vazio.
   */
  useEffect(() => {
    if (visivel && !library && !libraryBusy) void syncLibrary()
  }, [visivel, library, libraryBusy, syncLibrary])

  if (!visivel) return null

  const ocupado = busy !== null
  const trocarModo = (m: AutomountMode): void => {
    setModo(m)
    gravarModoDoAutomount(m)
  }

  return (
    <div className="enter flex flex-col items-center gap-4 rounded-lg border border-dashed border-line p-8">
      <div className="flex items-center gap-2 text-[13px] text-ink-2">
        <Wand2 size={14} strokeWidth={1.5} className="text-accent" />
        Solte as cenas, escolha na biblioteca, ou deixe ele montar
      </div>

      <div className="flex items-center gap-2">
        <label className="text-[12px] text-ink-3" htmlFor="automount-serie">
          Anime
        </label>
        <select
          id="automount-serie"
          value={serie ?? ''}
          onChange={(e) => setSerie(e.target.value || null)}
          disabled={ocupado || !library}
          className="min-w-[200px] rounded-sm border border-line bg-bg px-2 py-1.5 text-[12px] text-ink disabled:opacity-40"
        >
          {/* Deduzir continua sendo o padrao, mas dizer e uma linha so a menos de
              trabalho para um resultado que ele controla. */}
          <option value="">
            {library ? 'Descobrir pelo roteiro' : 'Lendo a biblioteca...'}
          </option>
          {(library?.animes ?? []).map((nome) => (
            <option key={nome} value={nome}>
              {nome}
            </option>
          ))}
        </select>
        {libraryBusy !== null && (
          <Loader2 size={13} strokeWidth={1.5} className="animate-spin text-ink-3" />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {/*
          O botao e a escolha moram na MESMA moldura rosa: a escolha e parte do
          gesto de montar, nao um ajuste solto. O fieldset desliga os dois de
          uma vez enquanto algo roda (o mesmo jeito do "Partes | Texto").
          A explicacao que antes ficava num paragrafo embaixo foi para o title:
          pouco texto na tela.
        */}
        <fieldset
          disabled={ocupado}
          aria-label="Montar sozinho"
          className="flex items-center gap-1 rounded-sm border border-accent bg-accent-dim p-[3px] disabled:opacity-40"
        >
          <button
            type="button"
            onClick={() => void automount(modo, serie)}
            title={`${modo === 'recap' ? 'Recap' : 'Teoria'}: le a narracao, descobre quem esta em cada frase e traz uma cena para cada uma. Depois voce troca o que nao gostou.`}
            className="flex h-[30px] items-center gap-2 rounded-[3px] px-3 text-[13px] font-medium text-ink transition-colors duration-150 enabled:hover:bg-accent-glow"
          >
            <Wand2 size={14} strokeWidth={1.5} className="text-accent" />
            Montar sozinho
          </button>
          {/* O divisor separa o gesto (montar) da escolha (o modo): clicar em
              "Teoria" so escolhe, quem monta e o botao. */}
          <span aria-hidden className="h-5 w-px shrink-0 bg-accent/30" />
          <div className="flex w-[148px] shrink-0">
            <Segmentos opcoes={MODOS} ativo={(v) => v === modo} onChange={trocarModo} />
          </div>
        </fieldset>

        <button
          type="button"
          onClick={() => void openLibrary(true)}
          disabled={ocupado}
          title="Escolher as cenas na mao (Ctrl+B)"
          className="flex items-center gap-2 rounded-sm border border-line bg-bg px-4 py-2 text-[13px] text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink disabled:opacity-40"
        >
          <LibraryIcon size={14} strokeWidth={1.5} className="text-accent" />
          Escolher na biblioteca
        </button>
      </div>
    </div>
  )
}
