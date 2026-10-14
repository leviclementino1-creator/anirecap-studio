import { useEffect, useRef, useState } from 'react'
import { Import } from 'lucide-react'
import type {
  AchadoDoAniRecap,
  ProvedorDeVoz,
  PublicSettings,
  TesteDeVoz,
  VozDoProvedor,
  VozPadrao,
} from '@shared/channels'
import { modeloEleven } from '@shared/voz'
import { MODELOS_FISH, useVoz } from '@/store/gerar-voz'

/**
 * A secao "Voz" das Configuracoes: a voz padrao, as chaves do ElevenLabs e do
 * Fish Audio e o "Importar do AniRecap".
 *
 * Mora aqui pelo mesmo motivo do AjustesDoStudio: o Settings.tsx herdado do
 * Dangai ganha so uma linha. O desenho copia o da "Inteligencia artificial":
 * a escolha em cima, depois rotulo, campo + Salvar + Testar e uma linha de
 * resultado por chave.
 *
 * Como la, a chave nunca volta do main: so a dica com os quatro ultimos.
 */

/**
 * As vozes do ultimo "Testar" de cada provedor. Fora do componente: o modal
 * desmonta ao fechar, e reabrir as Configuracoes nao pode esvaziar o select.
 */
const lembradas: Record<ProvedorDeVoz, VozDoProvedor[]> = { elevenlabs: [], fish: [] }

const NOME: Record<ProvedorDeVoz, string> = { elevenlabs: 'ElevenLabs', fish: 'Fish Audio' }

const LINK_DA_CHAVE: Record<ProvedorDeVoz, string> = {
  elevenlabs: 'https://elevenlabs.io/app/settings/api-keys',
  fish: 'https://fish.audio/app/api-keys/',
}

type Resultado = { tipo: 'ok' | 'erro'; texto: string; aviso: string | null }

const CAMPO =
  'min-w-0 flex-1 select-text rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none'
const BOTAO =
  'lift shrink-0 rounded-sm border border-line bg-elevated px-3 py-1.5 text-[13px] font-medium text-ink disabled:opacity-40'

export function AjustesDeVoz({
  settings,
  onSettings,
}: {
  settings: PublicSettings | null
  onSettings: (s: PublicSettings) => void
}) {
  const [entrada, setEntrada] = useState<Record<ProvedorDeVoz, string>>({ elevenlabs: '', fish: '' })
  /*
   * As do ultimo "Testar" daqui; sem elas, as que o passo 3 ja leu (o mesmo
   * Testar, com a mesma chave salva). Sem isto o "Configurar" do passo 3 abria
   * com o id cru da voz padrao ("Crm8... (salva)") no lugar do nome.
   */
  const [vozes, setVozes] = useState<Record<ProvedorDeVoz, VozDoProvedor[]>>(() => {
    const doPasso3 = useVoz.getState().vozes
    return {
      elevenlabs: lembradas.elevenlabs.length > 0 ? lembradas.elevenlabs : (doPasso3.elevenlabs ?? []),
      fish: lembradas.fish.length > 0 ? lembradas.fish : (doPasso3.fish ?? []),
    }
  })
  const [testando, setTestando] = useState<ProvedorDeVoz | null>(null)
  const [resultado, setResultado] = useState<Partial<Record<ProvedorDeVoz, Resultado>>>({})
  const [salvando, setSalvando] = useState(false)
  const [achado, setAchado] = useState<AchadoDoAniRecap | null>(null)
  // O botao do AniRecap tem dois tempos: o primeiro clique so arma, o segundo grava.
  const [armado, setArmado] = useState(false)
  const ancora = useRef<HTMLDivElement>(null)
  // Veio do "Configurar" do passo 3: rola ate esta secao. Guarda ATE QUANDO rolar; 0 = nao rolar.
  const rolarAte = useRef(useVoz.getState().ajustesDeVozPedidos ? Date.now() + 1500 : 0)

  useEffect(() => {
    if (rolarAte.current) useVoz.getState().ajustesDeVozVistos()
  }, [])

  /*
   * Rola na abertura e de novo quando os ajustes chegam (a altura de cima muda
   * com eles), so no primeiro instante -- como o AjustesDoStudio. O scrollTop
   * da caixa, e nao scrollIntoView, que rolaria tambem o app por baixo.
   */
  useEffect(() => {
    if (!settings || Date.now() > rolarAte.current) return
    const alvo = ancora.current
    const caixa = alvo?.closest<HTMLElement>('.overflow-y-auto')
    if (!alvo || !caixa) return
    caixa.scrollTop += alvo.getBoundingClientRect().top - caixa.getBoundingClientRect().top - 8
  }, [settings])

  // So le o config do AniRecap antigo, e a resposta traz a dica, nunca a chave.
  const procurar = async (): Promise<void> => {
    const r = await window.dangai.procurarAniRecap()
    setAchado(r.ok ? r.value : null)
  }

  useEffect(() => {
    void procurar()
  }, [])

  // Armado e esquecido nao pode virar gravacao num clique distraido minutos
  // depois. O onBlur sozinho nao basta: com a janela sem foco ele nao dispara.
  useEffect(() => {
    if (!armado) return
    const desarmar = setTimeout(() => setArmado(false), 6000)
    return () => clearTimeout(desarmar)
  }, [armado])

  const mostrar = (provedor: ProvedorDeVoz, r: Resultado | undefined): void =>
    setResultado((atual) => ({ ...atual, [provedor]: r }))

  const lembrar = (provedor: ProvedorDeVoz, lista: VozDoProvedor[]): void => {
    lembradas[provedor] = lista
    setVozes((atual) => ({ ...atual, [provedor]: lista }))
  }

  // Testa a chave digitada, se houver; senao a salva, que fica no main.
  const testar = async (provedor: ProvedorDeVoz, chave: string | null): Promise<void> => {
    setTestando(provedor)
    mostrar(provedor, undefined)
    const r =
      provedor === 'elevenlabs'
        ? await window.dangai.testarEleven(chave)
        : await window.dangai.testarFish(chave)
    setTestando(null)
    if (!r.ok) {
      mostrar(provedor, { tipo: 'erro', texto: r.error, aviso: null })
      return
    }
    lembrar(provedor, r.value.vozes)
    mostrar(provedor, { tipo: 'ok', texto: resumoDoTeste(r.value), aviso: r.value.aviso })
  }

  const salvarChave = async (provedor: ProvedorDeVoz): Promise<void> => {
    const chave = entrada[provedor].trim()
    if (!chave) return
    setSalvando(true)
    const r = await window.dangai.saveSettings(
      provedor === 'elevenlabs' ? { elevenlabsApiKey: chave } : { fishApiKey: chave },
    )
    setSalvando(false)
    if (!r.ok) {
      mostrar(provedor, { tipo: 'erro', texto: r.error, aviso: null })
      return
    }
    onSettings(r.value)
    setEntrada((atual) => ({ ...atual, [provedor]: '' }))
    // A lista era da chave antiga. Testar a nova e de graca e ja enche o select.
    lembrar(provedor, [])
    void procurar()
    void testar(provedor, null)
  }

  const importar = async (): Promise<void> => {
    if (!achado) return
    if (!armado) {
      setArmado(true)
      return
    }
    setArmado(false)
    setSalvando(true)
    const r = await window.dangai.importarAniRecap(achado.arquivo)
    setSalvando(false)
    if (!r.ok) {
      mostrar('elevenlabs', { tipo: 'erro', texto: r.error, aviso: null })
      return
    }
    onSettings(r.value)
    void procurar()
    // Ja confere a chave importada e traz o nome da voz para o select.
    if (r.value.hasElevenKey) void testar('elevenlabs', null)
  }

  const gravarVoz = async (voz: VozPadrao): Promise<void> => {
    const r = await window.dangai.saveSettings({ vozPadrao: voz })
    if (r.ok) onSettings(r.value)
  }

  const escolherVoz = (valor: string): void => {
    if (!valor) {
      void gravarVoz({ provedor: '', voiceId: '', modelId: '' })
      return
    }
    const corte = valor.indexOf(':')
    const provedor = valor.slice(0, corte) as ProvedorDeVoz
    const atual = settings?.vozPadrao
    void gravarVoz({
      provedor,
      voiceId: valor.slice(corte + 1),
      // O modelo e do provedor: trocar de provedor volta ao padrao dele.
      modelId: atual?.provedor === provedor ? atual.modelId : '',
    })
  }

  const voz = settings?.vozPadrao
  const valorDoSelect = voz && voz.provedor && voz.voiceId ? `${voz.provedor}:${voz.voiceId}` : ''
  // A voz salva aparece mesmo antes do Testar (a importada, por exemplo), ou o
  // select mostraria "Nenhuma" mentindo.
  const opcoes = (provedor: ProvedorDeVoz): VozDoProvedor[] =>
    voz?.provedor === provedor && voz.voiceId && !vozes[provedor].some((v) => v.id === voz.voiceId)
      ? [{ id: voz.voiceId, nome: `${voz.voiceId} (salva)`, detalhe: '', previewUrl: null }, ...vozes[provedor]]
      : vozes[provedor]
  const semLista = vozes.elevenlabs.length === 0 && vozes.fish.length === 0
  const mostrarImportar = achado !== null && !achado.jaImportado

  const blocoDaChave = (provedor: ProvedorDeVoz) => {
    const tem = provedor === 'elevenlabs' ? settings?.hasElevenKey : settings?.hasFishKey
    const dica = provedor === 'elevenlabs' ? settings?.elevenKeyHint : settings?.fishKeyHint
    const digitada = entrada[provedor].trim()
    const r = resultado[provedor]
    return (
      <>
        <div className="mt-4 mb-1.5 flex items-baseline gap-2">
          <label className="block text-[11px] font-medium text-ink-2">Chave do {NOME[provedor]}</label>
          <span className="flex-1" />
          <a
            href={LINK_DA_CHAVE[provedor]}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
          >
            Pegar uma chave
          </a>
        </div>
        <div className="flex gap-2">
          <input
            type="password"
            value={entrada[provedor]}
            onChange={(event) => {
              const valor = event.target.value
              setEntrada((atual) => ({ ...atual, [provedor]: valor }))
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void salvarChave(provedor)
              event.stopPropagation()
            }}
            placeholder={tem && dica ? dica : provedor === 'elevenlabs' ? 'sk_...' : 'Cole a chave'}
            spellCheck={false}
            autoComplete="off"
            className={CAMPO}
          />
          <button
            type="button"
            onClick={() => void salvarChave(provedor)}
            disabled={salvando || digitada.length === 0}
            className={BOTAO}
          >
            Salvar
          </button>
          <button
            type="button"
            onClick={() => void testar(provedor, digitada || null)}
            disabled={testando !== null || (digitada.length === 0 && !tem)}
            className={BOTAO}
          >
            {testando === provedor ? 'Testando...' : 'Testar'}
          </button>
        </div>
        {r && (
          <p
            className={[
              'mt-2 select-text text-[11px] leading-relaxed',
              r.tipo === 'ok' ? 'text-ink-2' : 'text-danger',
            ].join(' ')}
          >
            {r.texto}
            {r.aviso && <span className="block text-danger">{r.aviso}</span>}
          </p>
        )}
        {provedor === 'elevenlabs' && mostrarImportar && achado && (
          <button
            type="button"
            onClick={() => void importar()}
            onBlur={() => setArmado(false)}
            disabled={salvando}
            title={achado.arquivo}
            className={[
              'lift mt-2 flex w-full items-center gap-2 rounded-sm border px-2.5 py-1.5 text-left text-[13px] disabled:opacity-40',
              armado ? 'border-accent bg-accent-dim text-ink' : 'border-line bg-elevated text-ink-2 hover:text-ink',
            ].join(' ')}
          >
            <Import size={13} strokeWidth={1.5} className="shrink-0" />
            <span className="shrink-0">{armado ? 'Confirmar e gravar' : 'Importar do AniRecap'}</span>
            <span className="tnum min-w-0 flex-1 truncate text-right text-[11px] text-ink-3">
              {[achado.chaveHint, achado.voiceId && `voz ${achado.voiceId}`].filter(Boolean).join(' · ')}
            </span>
          </button>
        )}
      </>
    )
  }

  return (
    <>
      <div ref={ancora} className="my-5 h-px bg-line" />

      <label className="mb-1.5 block text-[11px] font-medium text-ink-2">Voz</label>
      {/* pr-7 + reticencias: as vozes da biblioteca do ElevenLabs tem nome longo
          ("Andrea Wolff - clear, youthful...") e o texto encostava na seta. */}
      <select
        value={valorDoSelect}
        onChange={(event) => escolherVoz(event.target.value)}
        className="w-full text-ellipsis rounded-sm border border-line bg-elevated py-1.5 pr-7 pl-2.5 text-[13px] text-ink"
      >
        <option value="">Nenhuma ainda</option>
        {(['elevenlabs', 'fish'] as const).map((provedor) => {
          const lista = opcoes(provedor)
          if (lista.length === 0) return null
          return (
            <optgroup key={provedor} label={NOME[provedor]}>
              {lista.map((v) => (
                <option key={v.id} value={`${provedor}:${v.id}`}>
                  {v.detalhe ? `${v.nome} (${v.detalhe})` : v.nome}
                </option>
              ))}
            </optgroup>
          )
        })}
      </select>
      {(semLista || (voz?.provedor && voz.modelId)) && (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          {semLista ? 'Teste uma chave para ver as vozes da conta. ' : ''}
          {voz?.provedor && voz.modelId ? `Modelo ${nomeDoModelo(voz.provedor, voz.modelId)}.` : ''}
        </p>
      )}

      {blocoDaChave('elevenlabs')}
      {blocoDaChave('fish')}

      <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
        Testar nao gasta caractere nem credito. Ficam so nesta maquina
        {settings?.chavesProtegidas ? ', cifradas pelo sistema' : ''}, como as da IA.
      </p>
    </>
  )
}

/** O nome do modelo como o passo 3 mostra ("Multilingual v2"), nao o id cru ("eleven_multilingual_v2"). */
function nomeDoModelo(provedor: 'elevenlabs' | 'fish', modelId: string): string {
  if (provedor === 'elevenlabs') return modeloEleven(modelId).nome
  return MODELOS_FISH.find((m) => m.id === modelId)?.nome ?? modelId
}

/** "Funcionando · 1.234 de 10.000 caracteres (creator)" ou "Funcionando · saldo US$ 4,20". */
function resumoDoTeste(teste: TesteDeVoz): string {
  const partes = ['Funcionando']
  if (teste.usados !== null && teste.limite !== null) {
    partes.push(
      `${teste.usados.toLocaleString('pt-BR')} de ${teste.limite.toLocaleString('pt-BR')} caracteres${
        teste.plano ? ` (${teste.plano})` : ''
      }`,
    )
  }
  if (teste.saldo !== null) {
    const valor = Number(teste.saldo)
    partes.push(
      `saldo US$ ${
        Number.isFinite(valor)
          ? valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : teste.saldo
      }`,
    )
  }
  const n = teste.vozes.length
  partes.push(`${n} ${n === 1 ? 'voz' : 'vozes'}`)
  return partes.join(' · ')
}
