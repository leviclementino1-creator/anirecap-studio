import { useEffect, useRef } from 'react'
import { useAbreParaBaixo } from './aperto-da-barra'
import { Loader2, Undo2, WandSparkles, X } from 'lucide-react'
import { nadaLigado, partesLigadas } from '@shared/edicao-rapida'
import { useProject } from '@/store/project'
import { fotografar } from '@/store/documento'
import { desfazer, fecharPassoAgora } from '@/store/undo'
import {
  configDoPadrao,
  linhasDoResumo,
  mesmoDocumento,
  SO_A_MUSICA,
  useEdicaoRapida,
  type OpcoesDaEdicaoRapida,
} from '@/store/edicao-rapida'

/**
 * O BOTAO "EDICAO RAPIDA" da barra do editor (pedido do Levi, 14/10): um
 * clique faz o que hoje e manual -- whoosh nas viradas de parte, impacto no
 * gancho e no climax, musica baixa com ducking, cada bloco no rosto e a
 * legenda no estilo salvo. O que ela faz vem das Configuracoes (Edicao
 * rapida). Tudo continua editavel e Ctrl+Z desfaz a Edicao rapida inteira.
 *
 * Mora fora do RenderBar.tsx (herdado do Dangai) para ele ganhar so uma linha.
 * O controle de musica de la usa as acoes de som daqui.
 */

/** Roda a Edicao rapida com o que as Configuracoes dizem, e abre o resumo. */
export async function rodarEdicaoRapida(): Promise<void> {
  const ui = useEdicaoRapida.getState()
  if (ui.rodando) return
  const config = await configDoPadrao()
  // Tudo desligado: nao ha o que fazer (o botao e o Ctrl+K ja ficam apagados).
  if (nadaLigado(config)) {
    useProject.setState({ error: 'Nada ligado na Edicao rapida (Configuracoes).' })
    return
  }
  ui.marcarRodando('tudo')
  try {
    const resumo = await useProject.getState().edicaoRapida(config)
    if (!resumo) return
    // Um passo so: um gesto logo depois nao cai dentro dele.
    fecharPassoAgora()
    // O "Desfazer" do resumo vale enquanto o projeto for o que ela deixou.
    const depois = resumo.aplicou === false ? null : fotografar(useProject.getState())
    useEdicaoRapida.getState().mostrarResumo(resumo, 'editor', depois)
  } finally {
    useEdicaoRapida.getState().marcarRodando(null)
  }
}

/**
 * So a MUSICA (o controle de musica da barra): por uma da pasta sem repetir,
 * trocar pela proxima, ou a escolhida no dialogo (`musicaForcada`). Tambem e um
 * passo de Ctrl+Z. Sem musica nenhuma, o recado vai para o erro do editor.
 */
export async function rodarSoAMusica(opcoes: OpcoesDaEdicaoRapida = {}): Promise<void> {
  const ui = useEdicaoRapida.getState()
  if (ui.rodando) return
  ui.marcarRodando('musica')
  try {
    const resumo = await useProject.getState().edicaoRapida(SO_A_MUSICA, opcoes)
    if (resumo?.aplicou) fecharPassoAgora()
    if (resumo && !resumo.musica) {
      useProject.setState({ error: resumo.avisos[0] ?? 'Sem musica na pasta de musicas (Configuracoes).' })
    }
  } finally {
    useEdicaoRapida.getState().marcarRodando(null)
  }
}

/** O dialogo do sistema para escolher o arquivo da musica. */
export async function escolherArquivoDaMusica(): Promise<void> {
  const r = await window.dangai.pickMusic()
  if (!r.ok) {
    useProject.setState({ error: r.error })
    return
  }
  // null = fechou o dialogo sem escolher: nada muda.
  if (r.value) await rodarSoAMusica({ musicaForcada: r.value.path })
}

/** A dica das partes ligadas ("sons, musica, rosto e legenda"); vazia = nada ligado. */
export function useDicaDaEdicaoRapida(): { ligadas: string; nada: boolean } {
  const padrao = useEdicaoRapida((s) => s.padrao)
  const carregarPadrao = useEdicaoRapida((s) => s.carregarPadrao)
  useEffect(() => {
    if (!useEdicaoRapida.getState().padrao) void carregarPadrao()
  }, [carregarPadrao])
  if (!padrao) return { ligadas: 'sons, musica, rosto e legenda', nada: false }
  return { ligadas: partesLigadas(padrao.config), nada: nadaLigado(padrao.config) }
}

/**
 * `soIcone`: a barra do Dangai nao quebra linha; quando ela aperta (janela
 * estreita, "Abrir pasta" depois do render), o RenderBar pede so o icone.
 */
export function BotaoDaEdicaoRapida({ soIcone = false }: { soIcone?: boolean }) {
  const pronto = useProject((s) => s.audio !== null && s.plan !== null && s.images.length > 0)
  const busy = useProject((s) => s.busy)
  // Projeto com algo posto pela Edicao rapida: o botao fica "ligado", como o
  // Publicacao com o texto pronto.
  const aplicada = useProject((s) => s.trilhas.some((t) => t.papel !== undefined))
  const rodando = useEdicaoRapida((s) => s.rodando)
  const resumo = useEdicaoRapida((s) => s.resumo)
  const aberto = useEdicaoRapida((s) => s.resumoAberto)
  const origem = useEdicaoRapida((s) => s.origemDoResumo)
  const depois = useEdicaoRapida((s) => s.depois)
  const fechar = useEdicaoRapida((s) => s.fecharResumo)
  const pedirRolar = useEdicaoRapida((s) => s.pedirRolarAteAjustes)
  const openSettings = useProject((s) => s.openSettings)
  const { ligadas, nada } = useDicaDaEdicaoRapida()
  const caixa = useRef<HTMLDivElement>(null)
  const paraBaixo = useAbreParaBaixo(caixa, aberto && resumo !== null, 260)

  const ocupado = rodando !== null || busy !== null
  const linhas = resumo ? linhasDoResumo(resumo, origem) : []
  const podeDesfazer = origem === 'editor' && resumo?.aplicou !== false && depois !== null

  /*
   * Fecha ao apertar FORA (no documento, sem camada por cima): o primeiro
   * clique em outro botao da barra ja faz o que ele pediu, em vez de so fechar
   * o resumo (auditoria de 14/10).
   */
  useEffect(() => {
    if (!aberto) return
    const fora = (e: PointerEvent): void => {
      if (caixa.current && e.target instanceof Node && caixa.current.contains(e.target)) return
      fechar()
    }
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') fechar()
    }
    document.addEventListener('pointerdown', fora, true)
    window.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('pointerdown', fora, true)
      window.removeEventListener('keydown', tecla)
    }
  }, [aberto, fechar])

  /*
   * O projeto mudou depois da Edicao rapida (Ctrl+Z, outra edicao): o resumo
   * descrevia um estado que nao existe mais, e o "Desfazer" dele desfaria OUTRO
   * passo. Fecha na hora.
   */
  useEffect(() => {
    if (!aberto || !depois) return
    return useProject.subscribe((estado) => {
      if (!mesmoDocumento(depois, estado)) fechar()
    })
  }, [aberto, depois, fechar])

  const titulo = nada
    ? 'Nada ligado na Edicao rapida (Configuracoes)'
    : `Edicao rapida: ${ligadas} de uma vez. Ctrl+Z desfaz tudo.`

  return (
    <div className="relative shrink-0" ref={caixa}>
      <button
        type="button"
        onClick={() => void rodarEdicaoRapida()}
        disabled={!pronto || ocupado || nada}
        aria-label="Edicao rapida"
        title={titulo}
        className={[
          'lift flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border px-2.5 py-1.5 text-[11px] disabled:opacity-40',
          aplicada || rodando === 'tudo'
            ? 'border-accent bg-accent-dim text-ink'
            : 'border-line bg-elevated text-ink-3 hover:text-ink-2',
        ].join(' ')}
      >
        {/* O icone na altura de uma linha de texto: so com o icone, o botao fica
            da mesma altura dos botoes de texto da barra (antes, 26 x 31 px). */}
        <span className="flex h-[1lh] items-center">
          {rodando === 'tudo' ? (
            <Loader2 size={12} strokeWidth={1.5} className="animate-spin" />
          ) : (
            <WandSparkles size={12} strokeWidth={1.5} />
          )}
        </span>
        {!soIcone && <span>{rodando === 'tudo' ? 'Editando...' : 'Edicao rapida'}</span>}
      </button>

      {aberto && resumo && (
        // Fundo quase opaco: abre por cima do canto do preview, e os rotulos
        // apagados sumiam sobre a imagem clara atras do vidro.
        <div
          className={`glass enter absolute left-0 z-50 w-[300px] rounded-md p-3 ${paraBaixo ? 'top-[calc(100%+6px)]' : 'bottom-[calc(100%+6px)]'}`}
          style={{ backgroundColor: 'rgb(23 23 26 / 0.97)' }}
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="flex-1 text-[10px] uppercase tracking-wide text-ink-3">Edicao rapida</span>
            <button
              type="button"
              onClick={fechar}
              aria-label="Fechar"
              className="grid size-5 place-items-center rounded-sm text-ink-3 hover:text-ink"
            >
              <X size={11} strokeWidth={1.5} />
            </button>
          </div>
          {resumo.aplicou === false && (
            <p className="mb-1.5 text-[12px] text-ink-2">Nada mudou: o projeto ja estava assim.</p>
          )}
          <dl className="grid grid-cols-[64px_1fr] gap-x-2 gap-y-1 text-[12px]">
            {linhas.map((l) => (
              <div key={l.rotulo} className="contents">
                <dt className="text-ink-2">{l.rotulo}</dt>
                <dd className="min-w-0 truncate text-ink" title={l.valor}>
                  {l.valor}
                </dd>
              </div>
            ))}
          </dl>
          {resumo.avisos.length > 0 && (
            <ul className="mt-2 flex flex-col gap-0.5 text-[10px] leading-snug text-ink-2" title={resumo.avisos.join('\n')}>
              {resumo.avisos.slice(0, 3).map((a) => (
                <li key={a} className="truncate">
                  {a}
                </li>
              ))}
              {resumo.avisos.length > 3 && <li>+{resumo.avisos.length - 3}</li>}
            </ul>
          )}
          <div className="mt-3 flex items-center gap-2">
            {podeDesfazer && (
              <button
                type="button"
                onClick={() => {
                  // So desfaz se o topo ainda for a Edicao rapida (o resumo
                  // fecha sozinho quando o projeto muda, mas por garantia).
                  if (depois && mesmoDocumento(depois, useProject.getState())) desfazer()
                  fechar()
                }}
                title="Desfaz a Edicao rapida inteira (Ctrl+Z)"
                className="lift flex items-center gap-1.5 rounded-sm border border-line bg-elevated px-2 py-1 text-[11px] text-ink-2 hover:text-ink"
              >
                <Undo2 size={11} strokeWidth={1.5} />
                Desfazer
              </button>
            )}
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => {
                fechar()
                pedirRolar('edicao')
                openSettings(true)
              }}
              title="O que a Edicao rapida faz e a pasta de musicas"
              className="text-[11px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
            >
              Ajustar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
