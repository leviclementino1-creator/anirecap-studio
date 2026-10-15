import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AudioLines, Check, ChevronDown, ChevronUp, Cpu, Download, ExternalLink, KeyRound, Loader2, X } from 'lucide-react'
import type { ProvedorDeVoz, PublicSettings } from '@shared/channels'
import { textoDoTamanho, type EstadoDoMotorRuntime } from '@shared/motor-runtime'
import { useProject } from '@/store/project'
import { useGerar } from '@/store/gerar'
import { useMotorRuntime } from '@/store/motor-runtime'
import { instalarMotorAgora, motorPronto, useBoasVindas } from '@/store/boas-vindas'
import { usePrenderFoco } from '@/hooks/usePrenderFoco'
import { ChaveDoGemini, LINK_DA_CHAVE_DO_GEMINI } from './ChaveDoGemini'
import { AjustesDeVoz } from './gerar/AjustesDeVoz'
import { Botao, focarBotao, Link } from './gerar/pecas'
import icone from '../../build/icon.png'

/**
 * A TELA DE BOAS-VINDAS (v0.1.0, decisao do Levi em 15/10).
 *
 * Sem chave de IA nenhuma, o app abre RECOMENDANDO a do Gemini (gratis): sem
 * ela o roteiro nao sai. A voz e o motor de personagens aparecem como
 * opcionais, cada um numa linha. Nada aqui e novo por dentro:
 *
 * - a chave do Gemini e o ChaveDoGemini, o MESMO campo/teste das Configuracoes;
 * - a voz e o AjustesDeVoz das Configuracoes (chaves, Testar, a voz padrao);
 * - o motor abre a tela "Motor de personagens" (InstalarMotor) e instala pelo
 *   IPC do motor-runtime.
 *
 * A decisao de abrir (uma vez por sessao, so na tela inicial) mora em
 * @/store/boas-vindas. Fica ABAIXO da tela do motor (z-55), da pergunta do
 * episodio (z-45) e das Configuracoes (z-50), que abrem por cima dela.
 */
export function BoasVindas() {
  const momento = useBoasVindas((s) => s.momento)
  const naTelaInicial = useProject((s) => s.phase() === 'empty')
  const gerarAberto = useGerar((s) => s.aberto)
  // A Biblioteca (Ctrl+B) e tela cheia ABAIXO dela (z-40): abrir e sair da tela inicial.
  const bibliotecaAberta = useProject((s) => s.libraryOpen)
  const configAberta = useProject((s) => s.settingsOpen)

  // O App monta isto na abertura: decide uma vez, quando as settings chegam.
  useEffect(() => {
    void useBoasVindas.getState().decidir(() => {
      const p = useProject.getState()
      return p.phase() === 'empty' && !p.libraryOpen && !useGerar.getState().aberto
    })
  }, [])

  // Projeto aberto (pelo Abrir, pelos recentes, por arquivo solto), o
  // assistente ou a Biblioteca: ela nunca fica por cima, nem volta nesta sessao.
  useEffect(() => {
    if (!naTelaInicial || gerarAberto || bibliotecaAberta) useBoasVindas.getState().saiuDaTelaInicial()
  }, [naTelaInicial, gerarAberto, bibliotecaAberta])

  // As Configuracoes abrem por cima (Ctrl+,): o que ele salvou la aparece aqui ao fechar.
  useEffect(() => {
    if (configAberta || useBoasVindas.getState().momento !== 'aberta') return
    void window.dangai.getSettings().then((r) => {
      if (r.ok) useBoasVindas.getState().receber(r.value)
    })
  }, [configAberta])

  useEffect(() => {
    if (momento !== 'aberta') return
    const tecla = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return
      // Com algo aberto por cima dela, o Esc e de quem esta em cima.
      const p = useProject.getState()
      if (p.settingsOpen || p.paletteOpen || p.scriptOpen || useMotorRuntime.getState().aberta) return
      ev.stopPropagation()
      useBoasVindas.getState().depois()
    }
    window.addEventListener('keydown', tecla, true)
    return () => window.removeEventListener('keydown', tecla, true)
  }, [momento])

  if (momento !== 'aberta') return null
  return createPortal(
    <div
      className="fixed inset-0 z-[44] grid place-items-center bg-black/45"
      onPointerDown={() => useBoasVindas.getState().depois()}
      // Arquivo solto por cima: vale o arquivo (o drop da janela decide o que fazer com ele).
      onDrop={() => useBoasVindas.getState().depois()}
    >
      <CartaoDeBoasVindas />
    </div>,
    document.body,
  )
}

/** O cartao em si, fora do portal: o teste sem interface desenha so ele. */
export function CartaoDeBoasVindas() {
  const settings = useBoasVindas((s) => s.settings)
  const estado = useMotorRuntime((s) => s.estado)
  const [vozAberta, setVozAberta] = useState(false)
  const { depois, receber } = useBoasVindas.getState()
  // O Tab fica no cartao: atras do fundo escuro o Enter abria o "Gerar recap".
  const caixa = useRef<HTMLDivElement>(null)
  usePrenderFoco(caixa)
  const temChave = !!settings && (settings.hasGeminiKey || settings.hasApiKey)

  // A chave chegou (salvou aqui): o foco vai para o "Comecar", que fecha.
  useEffect(() => {
    if (temChave) focarBotao('boas-vindas-fim')
  }, [temChave])

  const receberSettings = (s: PublicSettings): void => receber(s)

  return (
    <div
      ref={caixa}
      role="dialog"
      aria-modal="true"
      aria-label="Boas-vindas"
      onPointerDown={(ev) => ev.stopPropagation()}
      // Fundo cheio por cima do glass: o titulo grande da tela inicial atravessava.
      style={{ backgroundColor: 'var(--color-elevated)' }}
      className="glass enter flex max-h-[88vh] w-[480px] max-w-[calc(100%-32px)] flex-col rounded-lg"
    >
      <header className="flex min-w-0 shrink-0 items-center gap-3 px-5 pt-5 pb-4">
        <img src={icone} alt="" draggable={false} className="size-10 shrink-0 rounded-md" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold text-ink">Bem-vindo ao AniRecap Studio</h2>
          <p className="truncate text-[12px] text-ink-3">Comece pela chave da IA.</p>
        </div>
        <button
          type="button"
          onClick={depois}
          aria-label="Fechar"
          title="Depois (Esc)"
          className="grid size-7 shrink-0 place-items-center self-start rounded-sm text-ink-3 transition-colors duration-150 hover:text-ink"
        >
          <X size={13} strokeWidth={1.5} />
        </button>
      </header>

      <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto px-5">
        <Item
          icone={<KeyRound size={13} strokeWidth={1.5} />}
          titulo="Chave do Gemini"
          detalhe="gratis, recomendada"
          destaque={!settings?.hasGeminiKey}
          canto={
            settings?.hasGeminiKey ? (
              <Pronto texto="Salva" />
            ) : (
              // A acao mais importante de quem chega sem chave: rosa, com o icone de fora do app.
              <a
                href={LINK_DA_CHAVE_DO_GEMINI}
                target="_blank"
                rel="noreferrer"
                title="Abre o Google AI Studio no navegador"
                className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-accent underline-offset-2 hover:underline"
              >
                Pegar chave gratis
                <ExternalLink size={11} strokeWidth={1.75} />
              </a>
            )
          }
        >
          <div>
            <ChaveDoGemini settings={settings} onSettings={receberSettings} testarAoSalvar focar />
          </div>
        </Item>

        <Item
          icone={<AudioLines size={13} strokeWidth={1.5} />}
          titulo="Narracao"
          detalhe="opcional"
          canto={
            <>
              <EstadoDaVoz settings={settings} />
              <Link onClick={() => setVozAberta((v) => !v)}>
                <span className="flex items-center gap-1">
                  {vozAberta ? 'Ocultar' : 'Configurar'}
                  {vozAberta ? <ChevronUp size={11} strokeWidth={1.5} /> : <ChevronDown size={11} strokeWidth={1.5} />}
                </span>
              </Link>
            </>
          }
        >
          {vozAberta ? (
            // O AjustesDeVoz das Configuracoes, no modo compacto: as chaves
            // primeiro, voz e velocidade so com uma chave de voz salva.
            <AjustesDeVoz settings={settings} onSettings={receberSettings} compacto />
          ) : (
            // Com uma chave de voz salva, o canto ja diz tudo.
            !settings?.hasElevenKey &&
            !settings?.hasFishKey && <p className="text-[11px] text-ink-3">ElevenLabs ou Fish Audio. Ou importe o audio depois.</p>
          )}
        </Item>

        <Item
          icone={<Cpu size={13} strokeWidth={1.5} />}
          titulo="Motor de personagens"
          // O "~3 GB" e o que falta baixar; antes de o main responder, o tamanho da instalacao cheia.
          detalhe={motorPronto(estado) ? 'opcional' : `opcional, ${textoDoTamanho(Math.max(estado?.bytesParaBaixar || 3e9, 1e6))}`}
          canto={<EstadoDoMotor estado={estado} />}
        >
          {!motorPronto(estado) && (
            <p className="text-[11px] text-ink-3">Corta as cenas e reconhece os personagens.</p>
          )}
        </Item>
      </div>

      <footer className="mt-4 flex shrink-0 items-center gap-2 border-t border-line px-5 py-4">
        {!temChave && (
          <Link onClick={() => void useBoasVindas.getState().naoPerguntarMais()} title="Nao abrir mais esta tela">
            Nao perguntar mais
          </Link>
        )}
        <span className="flex-1" />
        {temChave ? (
          <Botao principal foco="boas-vindas-fim" onClick={depois}>
            Comecar
          </Botao>
        ) : (
          <Botao foco="boas-vindas-fim" onClick={depois} title="Fecha. Volta na proxima vez que abrir o app.">
            Depois
          </Botao>
        )}
      </footer>
    </div>
  )
}

/** Uma linha da tela: icone, nome, o detalhe curto e o canto (estado ou acao). */
function Item({
  icone,
  titulo,
  detalhe,
  destaque = false,
  canto,
  children,
}: {
  icone: React.ReactNode
  titulo: string
  detalhe?: string
  /** A recomendada: borda e icone rosa (so a chave do Gemini, enquanto falta). */
  destaque?: boolean
  canto?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <section
      className={[
        'flex min-w-0 flex-col gap-2.5 rounded-md border bg-surface p-3.5',
        destaque ? 'border-accent/40' : 'border-line',
      ].join(' ')}
    >
      <header className="flex min-h-7 min-w-0 items-center gap-2">
        <span className={['shrink-0', destaque ? 'text-accent' : 'text-ink-3'].join(' ')}>{icone}</span>
        <span className="min-w-0 truncate text-[13px] font-medium text-ink">{titulo}</span>
        {detalhe && <span className="shrink-0 text-[11px] text-ink-3">{detalhe}</span>}
        <span className="flex-1" />
        {canto}
      </header>
      {children}
    </section>
  )
}

function Pronto({ texto }: { texto: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-ink-2">
      <Check size={12} strokeWidth={2} className="text-accent" />
      {texto}
    </span>
  )
}

const NOME_DA_VOZ: Record<ProvedorDeVoz, string> = { elevenlabs: 'ElevenLabs', fish: 'Fish Audio' }

/** O provedor da voz padrao, se a chave dele estiver salva; so a chave, "Chave salva"; nada, nada. */
function EstadoDaVoz({ settings }: { settings: PublicSettings | null }) {
  if (!settings) return null
  const provedor = settings.vozPadrao.provedor
  const temDele = provedor === 'elevenlabs' ? settings.hasElevenKey : provedor === 'fish' ? settings.hasFishKey : false
  if (provedor && temDele) return <Pronto texto={NOME_DA_VOZ[provedor]} />
  if (settings.hasElevenKey || settings.hasFishKey) return <Pronto texto="Chave salva" />
  return null
}

/** Pronto, ou o botao que leva a tela do motor (e ja instala, quando da). */
function EstadoDoMotor({ estado }: { estado: EstadoDoMotorRuntime | null }) {
  if (!estado) return null
  if (motorPronto(estado)) return <Pronto texto="Pronto" />
  if (estado.fase === 'instalando') {
    const f = estado.andamento?.fracao
    return (
      <Botao pequeno onClick={() => useMotorRuntime.getState().abrir()} title="Ver a instalacao">
        <Loader2 size={12} strokeWidth={1.5} className="animate-spin text-accent" />
        {f === null || f === undefined ? 'Instalando...' : `Instalando ${Math.round(f * 100)}%`}
      </Botao>
    )
  }
  const rotulo = estado.fase === 'incompleto' ? 'Continuar' : estado.fase === 'desatualizado' ? 'Atualizar' : 'Instalar agora'
  return (
    <Botao pequeno onClick={instalarMotorAgora} title="Python e torch do motor, das fontes oficiais. Uma vez so.">
      <Download size={12} strokeWidth={1.5} />
      {rotulo}
    </Botao>
  )
}
