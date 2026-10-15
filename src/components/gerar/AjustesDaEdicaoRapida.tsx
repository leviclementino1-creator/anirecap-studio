import { useEffect, useRef, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import type { PublicSettings } from '@shared/channels'
import {
  NOME_DO_ANIME_VIVO,
  PREFERENCIAS_DA_EDICAO_RAPIDA_PADRAO,
  type ConfigDaEdicaoRapida,
  type MusicaDaPasta,
  type PreferenciasDaEdicaoRapida,
} from '@shared/edicao-rapida'
import { useEdicaoRapida } from '@/store/edicao-rapida'
import { usePresetsDeCor } from '@/store/presets-de-cor'
import { Caixinha, CAMPO_NORMAL, CLASSE_DO_CAMPO, Link, meioDoCaminho } from './pecas'

/**
 * A EDICAO RAPIDA nas Configuracoes: o que ela faz (sons, musica, rosto,
 * legenda, cor), o look da cor (o Anime vivo ou um preset de cor salvo no
 * inspetor da camada de ajuste), se vem ligada no "Abrir no editor" do passo
 * 4, e a PASTA DE MUSICAS -- so leitura: o app lista e toca, nunca grava la (o
 * historico de "ja usada" mora no userData).
 *
 * Mora aqui, e nao no Settings.tsx, para o arquivo herdado do Dangai ganhar so
 * uma linha (o mesmo do AjustesDoStudio). Mesmo desenho das outras secoes:
 * rotulo, controle, uma linha de ajuda.
 */

const PARTES: readonly { campo: keyof ConfigDaEdicaoRapida; nome: string; dica: string }[] = [
  { campo: 'sfx', nome: 'Sons', dica: 'Whoosh nas viradas de parte e impacto no gancho e no climax, bem baixos' },
  { campo: 'musica', nome: 'Musica', dica: 'Uma da pasta, sem repetir entre videos, abaixando quando a voz fala' },
  { campo: 'rosto', nome: 'Rosto', dica: 'Cada bloco centralizado no rosto (de quem a frase cita, se der)' },
  { campo: 'legenda', nome: 'Legenda', dica: 'A legenda no seu estilo salvo' },
  { campo: 'cor', nome: 'Cor', dica: 'Uma camada de ajuste no video inteiro, com o look escolhido abaixo' },
]

/** Quantas musicas a lista curta mostra. */
const NA_LISTA = 4

export function AjustesDaEdicaoRapida({
  settings,
  onSettings,
}: {
  settings: PublicSettings | null
  onSettings: (s: PublicSettings) => void
}) {
  const gravarPadrao = useEdicaoRapida((s) => s.gravarPadrao)
  const lerDasSettings = useEdicaoRapida((s) => s.lerDasSettings)
  const [musicas, setMusicas] = useState<MusicaDaPasta[] | null>(null)
  const [erroDaLista, setErroDaLista] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  // A lembranca da store vem primeiro: a caixinha responde na hora (gravarPadrao
  // e otimista) e dois cliques seguidos nao desfazem um ao outro.
  const daLoja = useEdicaoRapida((s) => s.padrao)
  const prefs: PreferenciasDaEdicaoRapida = daLoja ?? settings?.edicaoRapidaPadrao ?? PREFERENCIAS_DA_EDICAO_RAPIDA_PADRAO
  const atuais = (): PreferenciasDaEdicaoRapida => useEdicaoRapida.getState().padrao ?? prefs
  const efetiva = settings?.pastaDeMusicasEfetiva ?? ''
  const padrao = !settings || settings.pastaDeMusicas === ''
  // A escolhida sumiu (disco fora, pasta apagada): diz qual, em vez de "Escolher a pasta...".
  const sumiu = settings !== null && settings.pastaDeMusicas !== '' && efetiva === ''
  const raiz = useRef<HTMLDivElement>(null)
  const rolarAte = useEdicaoRapida((s) => s.rolarAteAjustes)
  const pedirRolar = useEdicaoRapida((s) => s.pedirRolarAteAjustes)
  // Os presets de cor sao os do inspetor da camada de ajuste (mesma lista).
  const presetsDeCor = usePresetsDeCor((s) => s.lista)
  const presetsCarregados = usePresetsDeCor((s) => s.carregado)
  const carregarPresetsDeCor = usePresetsDeCor((s) => s.carregar)
  useEffect(() => void carregarPresetsDeCor(), [carregarPresetsDeCor])
  // O preset escolhido que sumiu (apagado no inspetor) aparece como tal, e a
  // Edicao rapida usa o Anime vivo ate ele escolher outro. So depois de a
  // lista chegar: antes ela e vazia, e todo preset pareceria apagado.
  const presetSumiu =
    presetsCarregados && prefs.corPreset !== null && !presetsDeCor.some((p) => p.nome === prefs.corPreset)

  // O passo 4 e o botao do editor leem o mesmo padrao: as settings que chegam
  // aqui atualizam a lembranca deles.
  useEffect(() => {
    if (settings) lerDasSettings(settings)
  }, [settings, lerDasSettings])

  // A lista curta: relida quando a pasta muda. So lista (sem medir): rapido.
  const temSettings = settings !== null
  useEffect(() => {
    if (!temSettings) return
    let vivo = true
    void window.dangai.listarMusicas().then((r) => {
      if (!vivo) return
      if (r.ok) {
        setMusicas(r.value)
        setErroDaLista(null)
      } else {
        setMusicas(null)
        setErroDaLista(r.error)
      }
    })
    return () => {
      vivo = false
    }
  }, [temSettings, efetiva])

  // O "Ajustar" do resumo (e o aviso de SFX do passo 4) abre as Configuracoes
  // AQUI, e nao no topo (Inteligencia artificial): espera as settings chegarem
  // (a altura das secoes de cima muda com elas) e rola ate a secao.
  useEffect(() => {
    if (!rolarAte || !temSettings) return
    const quadro = requestAnimationFrame(() => {
      const alvo = rolarAte === 'sons' ? document.getElementById('config-sons') : raiz.current
      ;(alvo ?? raiz.current)?.scrollIntoView({ block: 'start' })
      pedirRolar(false)
    })
    return () => cancelAnimationFrame(quadro)
  }, [rolarAte, temSettings, pedirRolar])

  const gravarPrefs = async (p: PreferenciasDaEdicaoRapida): Promise<void> => {
    const s = await gravarPadrao(p)
    if (s) onSettings(s)
  }

  const gravarPasta = async (pasta: string): Promise<void> => {
    setSalvando(true)
    const r = await window.dangai.saveSettings({ pastaDeMusicas: pasta })
    setSalvando(false)
    if (r.ok) {
      onSettings(r.value)
      setAviso(null)
    } else {
      setAviso(r.error)
    }
  }

  const escolher = async (): Promise<void> => {
    const r = await window.dangai.escolherPasta('Pasta de musicas')
    if (!r.ok) {
      setAviso(r.error)
      return
    }
    if (r.value) await gravarPasta(r.value)
  }

  const lista = musicas ?? []
  return (
    <div ref={raiz} id="config-edicao-rapida" className="scroll-mt-2">
      <div className="my-5 h-px bg-line" />

      <label className="mb-1.5 block text-[11px] font-medium text-ink-2">Edicao rapida</label>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {PARTES.map((p) => (
          <Caixinha
            key={p.campo}
            ligada={prefs.config[p.campo]}
            title={p.dica}
            onChange={(v) => void gravarPrefs({ ...atuais(), config: { ...atuais().config, [p.campo]: v } })}
          >
            {p.nome}
          </Caixinha>
        ))}
      </div>
      <div className="mt-2.5">
        <Caixinha
          ligada={prefs.aoAbrirNoEditor}
          title="A caixinha Edicao rapida do Abrir no editor (passo 4) vem ligada"
          onChange={(v) => void gravarPrefs({ ...atuais(), aoAbrirNoEditor: v })}
        >
          Ligada ao abrir no editor
        </Caixinha>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
        O botao Edicao rapida do editor faz tudo de uma vez. Continua editavel, e Ctrl+Z desfaz.
      </p>
      <label htmlFor="cor-da-edicao-rapida" className="mt-4 mb-1.5 block text-[11px] font-medium text-ink-2">
        Cor da Edicao rapida
      </label>
      <select
        id="cor-da-edicao-rapida"
        value={prefs.corPreset ?? ''}
        disabled={!prefs.config.cor}
        onChange={(e) => void gravarPrefs({ ...atuais(), corPreset: e.target.value || null })}
        title={prefs.config.cor ? 'O look da camada de cor: o Anime vivo ou um preset de cor seu' : 'Ligue a Cor acima'}
        className={`${CLASSE_DO_CAMPO} ${CAMPO_NORMAL} w-full text-ellipsis pr-7`}
      >
        <option value="">{NOME_DO_ANIME_VIVO}</option>
        {presetsDeCor.map((p) => (
          <option key={p.nome} value={p.nome}>
            {p.nome}
          </option>
        ))}
        {/* Escolhido e ainda nao na lista (sumiu, ou a lista nao chegou): a
            opcao existe para o select mostrar o nome, e nao o Anime vivo. */}
        {prefs.corPreset && !presetsDeCor.some((p) => p.nome === prefs.corPreset) && (
          <option value={prefs.corPreset}>
            {presetSumiu ? `${prefs.corPreset} (apagado)` : prefs.corPreset}
          </option>
        )}
      </select>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
        {presetSumiu ? 'Esse preset foi apagado: entra o Anime vivo.' : 'Camada de ajuste no video todo; os presets sao os do inspetor de cor.'}
      </p>

      <div className="mt-4 mb-1.5 flex items-baseline gap-2">
        <label className="block text-[11px] font-medium text-ink-2">Pasta de musicas (so leitura)</label>
        <span className="flex-1" />
        {!padrao && (
          <Link onClick={() => void gravarPasta('')} disabled={salvando}>
            Usar o padrao
          </Link>
        )}
      </div>
      <button
        type="button"
        onClick={() => void escolher()}
        disabled={salvando}
        title={efetiva || undefined}
        className="lift flex w-full items-center gap-2 rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-left text-[13px] text-ink-2 hover:text-ink disabled:opacity-40"
      >
        <FolderOpen size={13} strokeWidth={1.5} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {efetiva
            ? meioDoCaminho(comBarraDoSistema(efetiva))
            : sumiu && settings
              ? meioDoCaminho(comBarraDoSistema(settings.pastaDeMusicas))
              : 'Escolher a pasta...'}
        </span>
        {settings && padrao && efetiva && <span className="shrink-0 text-[11px] text-ink-3">(padrao)</span>}
        {sumiu ? (
          <span className="shrink-0 text-[11px] text-danger">nao encontrada</span>
        ) : (
          musicas &&
          efetiva && (
            <span className="tnum shrink-0 text-[11px] text-ink-3">
              {musicas.length} {musicas.length === 1 ? 'faixa' : 'faixas'}
            </span>
          )
        )}
      </button>
      {aviso && <p className="mt-2 select-text text-[11px] leading-relaxed text-danger">{aviso}</p>}
      {lista.length > 0 && (
        <ul className="mt-2 flex flex-col gap-0.5">
          {lista.slice(0, NA_LISTA).map((m) => (
            <li key={m.path} className="flex items-center gap-2 text-[11px]" title={m.path}>
              <span className="min-w-0 flex-1 truncate text-ink-2">{m.fileName.replace(/\.[^.]+$/, '')}</span>
              {m.usadaEm && <span className="tnum shrink-0 text-ink-3">usada {dataCurta(m.usadaEm)}</span>}
            </li>
          ))}
          {lista.length > NA_LISTA && <li className="text-[11px] text-ink-3">e mais {lista.length - NA_LISTA}</li>}
        </ul>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
        {erroDaLista
          ? erroDaLista
          : sumiu
            ? 'A pasta escolhida nao foi encontrada: escolha outra ou use o padrao.'
            : !efetiva
              ? 'Sem pasta: a Edicao rapida segue sem musica.'
              : musicas && musicas.length === 0
                ? 'Pasta vazia: a Edicao rapida segue sem musica.'
                : 'Uma por video, sem repetir. O app so le essa pasta.'}
      </p>
    </div>
  )
}

/**
 * O caminho com a barra do Windows ("G:\App Resumo\music"), como a Biblioteca
 * do Studio logo abaixo mostra: o padrao vem escrito com "/" no codigo.
 */
function comBarraDoSistema(caminho: string): string {
  return /^[A-Za-z]:[\\/]/.test(caminho) ? caminho.replace(/\//g, '\\') : caminho
}

/** "2026-10-14T..." -> "14/10". */
function dataCurta(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}
