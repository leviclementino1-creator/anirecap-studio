import { useEffect, useMemo, useRef } from 'react'
import { create } from 'zustand'
import { FolderOpen, Loader2, Music, Shuffle, X } from 'lucide-react'
import { MUSIC_GAIN_DB_MAX, MUSIC_GAIN_DB_MIN } from '@shared/contract'
import { trechosDaMusica, useEdicaoRapida } from '@/store/edicao-rapida'
import { useProject } from '@/store/project'
import { escolherArquivoDaMusica, rodarSoAMusica } from './EdicaoRapida'
import { useAbreParaBaixo } from './aperto-da-barra'

/**
 * A MUSICA DE FUNDO na barra (o MusicControl do Dangai, que estava definido e
 * nao era desenhado), agora sobre os trechos de papel 'musica' das faixas de
 * audio -- e nao sobre a cama antiga `music`, que o Dangai desligou (o render
 * manda music: null e o migrarSonsAntigos converte projeto antigo em trilha).
 *
 * "Musica" poe uma da pasta sem repetir entre videos, com ducking pela voz; o
 * trocar (shuffle, ou o nome) pega a proxima da pasta; a pasta abre o dialogo
 * para escolher o arquivo; o deslizante e o volume NAS PAUSAS (sob a voz ela
 * desce mais o ducking) e vale para todas as voltas; o X tira todas. Cada um e
 * um passo de Ctrl+Z, e os trechos continuam la na faixa para mexer a mao.
 *
 * `nivel` vem do aperto da barra (aperto-da-barra.ts): 1+ some o nome (o dB
 * fica: e por ele que ele repete o equilibrio); 3+ vira um botao so, com
 * nome, trocar, pasta e volume num popover.
 */
export function ControleDaMusica({ nivel }: { nivel: number }) {
  const trilhas = useProject((s) => s.trilhas)
  const busy = useProject((s) => s.busy)
  const rodando = useEdicaoRapida((s) => s.rodando)
  const musica = useMemo(() => trechosDaMusica(trilhas), [trilhas])
  const primeira = musica[0]
  const ocupado = rodando !== null || busy !== null
  const recolhido = nivel >= 3

  // A barra largou de ser apertada (janela maior): o popover da musica fecha.
  // Com espera, porque trocar a musica passa um instante pelo nivel 0.
  useEffect(() => {
    if (recolhido) return
    const t = setTimeout(() => usePopoverDaMusica.getState().abrir(false), 500)
    return () => clearTimeout(t)
  }, [recolhido])

  if (!primeira) {
    return (
      <button
        type="button"
        onClick={() => void rodarSoAMusica()}
        disabled={ocupado}
        aria-label="Musica"
        title="Uma musica da pasta por baixo da narracao, sem repetir entre videos"
        className="lift flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-[11px] text-ink-3 hover:text-ink-2 disabled:opacity-40"
      >
        <span className="flex h-[1lh] items-center">
          {rodando === 'musica' ? (
            <Loader2 size={12} strokeWidth={1.5} className="animate-spin" />
          ) : (
            <Music size={12} strokeWidth={1.5} />
          )}
        </span>
        {!recolhido && 'Musica'}
      </button>
    )
  }

  return recolhido ? (
    <MusicaRecolhida ocupado={ocupado} />
  ) : (
    <div
      className={[
        'flex shrink-0 items-center gap-1.5 rounded-sm border border-accent bg-accent-dim px-2.5 py-1.5 text-[11px]',
        ocupado ? 'opacity-60' : '',
      ].join(' ')}
    >
      {/* A nota e so o rotulo do grupo: o trocar e o shuffle (ou o nome). */}
      <span className="flex h-[1lh] items-center">
        {rodando === 'musica' ? (
          <Loader2 size={12} strokeWidth={1.5} className="animate-spin text-accent" />
        ) : (
          <Music size={12} strokeWidth={1.5} className="text-accent" />
        )}
      </span>
      {nivel === 0 && (
        <button
          type="button"
          onClick={() => void rodarSoAMusica()}
          disabled={ocupado}
          title={`${primeira.fileName} - clique para trocar pela proxima da pasta`}
          className="max-w-[110px] truncate text-ink min-[1700px]:max-w-[220px]"
        >
          {primeira.fileName.replace(/\.[^.]+$/, '')}
        </button>
      )}
      <Pecas ocupado={ocupado} />
    </div>
  )
}

/** Trocar, pasta, volume (com o dB) e tirar: o miolo do controle e do popover. */
function Pecas({ ocupado, largo = false }: { ocupado: boolean; largo?: boolean }) {
  const trilhas = useProject((s) => s.trilhas)
  const ajustarTrilha = useProject((s) => s.ajustarTrilha)
  const removeTrilha = useProject((s) => s.removeTrilha)
  const musica = useMemo(() => trechosDaMusica(trilhas), [trilhas])
  const primeira = musica[0]
  if (!primeira) return null

  const gainDb = primeira.gainDb
  // A Edicao rapida nivela pelo LUFS do arquivo e pode passar dos limites da
  // cama antiga: o deslizante abre para caber o valor que esta la.
  const min = Math.min(MUSIC_GAIN_DB_MIN, Math.floor(gainDb))
  const max = Math.max(MUSIC_GAIN_DB_MAX, Math.ceil(gainDb))
  const sobVoz = primeira.ducking ? ` (sob a voz, ${gainDb - primeira.ducking.abaixoDb} dB)` : ''

  return (
    <>
      <button
        type="button"
        onClick={() => void rodarSoAMusica()}
        disabled={ocupado}
        aria-label="Trocar a musica"
        title={`Trocar pela proxima da pasta (agora: ${primeira.fileName})`}
        className="grid size-4 shrink-0 place-items-center rounded-sm text-ink-2 hover:text-ink disabled:opacity-40"
      >
        <Shuffle size={11} strokeWidth={1.5} />
      </button>
      <button
        type="button"
        onClick={() => void escolherArquivoDaMusica()}
        disabled={ocupado}
        aria-label="Escolher o arquivo da musica"
        title="Escolher o arquivo da musica"
        className="grid size-4 shrink-0 place-items-center rounded-sm text-ink-3 hover:text-ink disabled:opacity-40"
      >
        <FolderOpen size={11} strokeWidth={1.5} />
      </button>
      <input
        type="range"
        min={min}
        max={max}
        step={0.5}
        value={gainDb}
        disabled={ocupado}
        onChange={(event) => {
          const db = Number(event.target.value)
          for (const t of musica) ajustarTrilha(t.id, { gainDb: db })
        }}
        aria-label="Volume da musica"
        title={`Volume da musica nas pausas: ${gainDb} dB${sobVoz}`}
        className={`dangai-range shrink-0 disabled:opacity-40 ${largo ? 'w-[140px]' : 'w-[56px]'}`}
      />
      <span className="tnum min-w-[46px] shrink-0 whitespace-nowrap text-right text-ink-3" title={`Nas pausas${sobVoz}`}>
        {gainDb} dB
      </span>
      <button
        type="button"
        onClick={() => {
          for (const t of musica) removeTrilha(t.id)
        }}
        disabled={ocupado}
        aria-label="Tirar a musica"
        title="Tirar a musica"
        className="grid size-4 shrink-0 place-items-center rounded-sm text-ink-3 hover:text-ink disabled:opacity-40"
      >
        <X size={11} strokeWidth={1.5} />
      </button>
    </>
  )
}

/**
 * O popover aberto mora FORA do componente: trocar a musica muda o nome, a
 * barra se mede de novo (aperto-da-barra.ts recomeca do nivel 0 e volta ao 3)
 * e o botao recolhido nasce de novo -- com estado local, o popover fechava
 * no meio da troca.
 */
const usePopoverDaMusica = create<{ aberto: boolean; abrir: (v: boolean) => void }>((set) => ({
  aberto: false,
  abrir: (aberto) => set({ aberto }),
}))

/**
 * A barra apertada (janela estreita, "Abrir pasta" depois do render): a
 * musica vira UM botao (a nota e o dB), e o resto abre num popover acima.
 */
function MusicaRecolhida({ ocupado }: { ocupado: boolean }) {
  const trilhas = useProject((s) => s.trilhas)
  const rodando = useEdicaoRapida((s) => s.rodando)
  const primeira = useMemo(() => trechosDaMusica(trilhas), [trilhas])[0]
  const aberto = usePopoverDaMusica((s) => s.aberto)
  const setAberto = usePopoverDaMusica((s) => s.abrir)
  const caixa = useRef<HTMLDivElement>(null)
  const paraBaixo = useAbreParaBaixo(caixa, aberto, 130)

  // Fecha ao apertar fora (sem camada por cima: o clique ja vale no outro botao).
  useEffect(() => {
    if (!aberto) return
    const fora = (e: PointerEvent): void => {
      if (caixa.current && e.target instanceof Node && caixa.current.contains(e.target)) return
      setAberto(false)
    }
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setAberto(false)
    }
    document.addEventListener('pointerdown', fora, true)
    window.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('pointerdown', fora, true)
      window.removeEventListener('keydown', tecla)
    }
  }, [aberto, setAberto])

  // Sem musica (o X) o popover nao tem do que falar.
  useEffect(() => {
    if (!primeira && aberto) setAberto(false)
  }, [primeira, aberto, setAberto])

  if (!primeira) return null
  return (
    <div className="relative shrink-0" ref={caixa}>
      <button
        type="button"
        onClick={() => setAberto(!aberto)}
        aria-label="Musica"
        aria-expanded={aberto}
        title={`${primeira.fileName} - ${primeira.gainDb} dB nas pausas`}
        className={[
          'lift flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border border-accent bg-accent-dim px-2.5 py-1.5 text-[11px] text-ink',
          ocupado ? 'opacity-60' : '',
        ].join(' ')}
      >
        <span className="flex h-[1lh] items-center">
          {rodando === 'musica' ? (
            <Loader2 size={12} strokeWidth={1.5} className="animate-spin text-accent" />
          ) : (
            <Music size={12} strokeWidth={1.5} className="text-accent" />
          )}
        </span>
        <span className="tnum text-ink-3">{primeira.gainDb} dB</span>
      </button>
      {aberto && (
        <div
          className={`glass enter absolute left-0 z-50 w-[280px] rounded-md p-3 ${paraBaixo ? 'top-[calc(100%+6px)]' : 'bottom-[calc(100%+6px)]'}`}
          style={{ backgroundColor: 'rgb(23 23 26 / 0.97)' }}
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="flex-1 text-[10px] uppercase tracking-wide text-ink-3">Musica</span>
          </div>
          <button
            type="button"
            onClick={() => void rodarSoAMusica()}
            disabled={ocupado}
            title={`${primeira.fileName} - clique para trocar pela proxima da pasta`}
            className="mb-2 block w-full truncate text-left text-[12px] text-ink hover:text-accent disabled:opacity-60"
          >
            {primeira.fileName.replace(/\.[^.]+$/, '')}
          </button>
          <div className="flex items-center gap-2 text-[11px]">
            <Pecas ocupado={ocupado} largo />
          </div>
        </div>
      )}
    </div>
  )
}
