import { useEffect, useRef, useState } from 'react'
import { Cpu, FolderOpen, Loader2 } from 'lucide-react'
import type { PublicSettings } from '@shared/channels'
import { useGerar } from '@/store/gerar'
import { ConferirDeNovo } from './ResultadoDaBusca'
import { ConfigDoMotorRuntime } from '@/components/motor-runtime/ConfigDoMotor'
import { textoDoRuntime } from '@/components/motor-runtime/BotaoDoMotor'
import { runtimeFora, useMotorRuntime } from '@/store/motor-runtime'
import { Link, meioDoCaminho, nuvemDoCaminho, resumoDoMotor } from './pecas'

/**
 * O pedaco das Configuracoes que e do Studio: onde ele grava as cenas que
 * corta, e se o motor de personagens (e o AnCut HUB) estao a mao.
 *
 * Mora aqui, e nao no Settings.tsx, para o arquivo herdado do Dangai ganhar so
 * uma linha. Segue o desenho das outras secoes de la: rotulo, controle, uma
 * linha de ajuda -- sem caixa em volta, que nenhuma outra secao tem.
 */
export function AjustesDoStudio({
  settings,
  onSettings,
}: {
  settings: PublicSettings | null
  onSettings: (s: PublicSettings) => void
}) {
  const motor = useGerar((s) => s.motor)
  const motorErro = useGerar((s) => s.motorErro)
  const conferirMotor = useGerar((s) => s.conferirMotor)
  const runtime = useMotorRuntime((s) => s.estado)
  const foraDoRuntime = runtimeFora(runtime)
  const [aviso, setAviso] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const secao = useRef<HTMLDivElement>(null)
  // Veio do "Trocar pasta": a secao fica no fim das Configuracoes, abaixo da
  // dobra. Guarda ATE QUANDO rolar (ver o efeito de baixo); 0 = nao rolar.
  const rolarAte = useRef(useGerar.getState().ajustesPedidos ? Date.now() + 1500 : 0)

  // Pronto, a resposta e o cache do main (de graca). Nao pronto, abrir as
  // Configuracoes confere de novo: o motor pode ter sido instalado depois. So
  // na montagem -- depender de `motor` aqui sondaria em laco enquanto ele
  // continuasse fora.
  useEffect(() => {
    if (!useGerar.getState().motor?.studio.pronto) void conferirMotor()
  }, [conferirMotor])

  useEffect(() => {
    if (rolarAte.current) useGerar.getState().ajustesVistos()
  }, [])

  /*
   * Rola na abertura e de novo quando os ajustes relidos chegam (a altura de
   * cima muda com eles) -- so no primeiro instante: depois disso, salvar a
   * chave la em cima nao pode jogar a tela para o fim. O scrollTop da caixa, e
   * nao scrollIntoView: este tambem rolaria a janela do app por baixo do modal.
   */
  useEffect(() => {
    if (!settings || Date.now() > rolarAte.current) return
    const caixa = secao.current?.closest<HTMLElement>('.overflow-y-auto')
    if (caixa) caixa.scrollTop = caixa.scrollHeight
  }, [settings])

  const gravar = async (pasta: string): Promise<void> => {
    setSalvando(true)
    const r = await window.dangai.saveSettings({ bibliotecaStudio: pasta })
    setSalvando(false)
    // O main recusa pasta do AnCut/Corte Cenas: a mensagem dele vira o aviso.
    if (r.ok) {
      onSettings(r.value)
      setAviso(null)
    } else {
      setAviso(r.error)
    }
  }

  const escolher = async (): Promise<void> => {
    const r = await window.dangai.escolherPasta('Biblioteca do Studio')
    if (!r.ok) {
      setAviso(r.error)
      return
    }
    if (r.value) await gravar(r.value)
  }

  const padrao = !settings || settings.bibliotecaStudio === ''
  const efetiva = settings?.bibliotecaStudioEfetiva ?? ''
  const nuvem = efetiva ? nuvemDoCaminho(efetiva) : null
  const estado = resumoDoMotor(motor, motorErro)

  return (
    // pb-2: a linha do motor e a ultima do modal e encostava na borda de baixo.
    <div ref={secao} className="pb-2">
      <div className="my-5 h-px bg-line" />

      <div className="mb-1.5 flex items-baseline gap-2">
        <label className="block text-[11px] font-medium text-ink-2">Biblioteca do Studio</label>
        <span className="flex-1" />
        {!padrao && (
          <Link onClick={() => void gravar('')} disabled={salvando}>
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
        {/* Cortado no meio: o fim do caminho e a pasta que importa. */}
        <span className="min-w-0 flex-1 truncate">{efetiva ? meioDoCaminho(efetiva) : 'Escolher a pasta...'}</span>
        {settings && padrao && <span className="shrink-0 text-[11px] text-ink-3">(padrao)</span>}
      </button>
      {aviso && <p className="mt-2 select-text text-[11px] leading-relaxed text-danger">{aviso}</p>}
      <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
        Onde o Studio grava as cenas que corta.
        {nuvem && <span className="text-ink-2"> No {nuvem}: ~1 GB por episodio vai para a nuvem.</span>}
      </p>

      <div className="mt-4 mb-1.5 flex items-baseline gap-2">
        <label className="block text-[11px] font-medium text-ink-2">Motor de personagens</label>
        <span className="flex-1" />
        {estado.estado === 'fora' && <ConferirDeNovo />}
      </div>
      <p className="flex items-center gap-2 text-[12px]">
        {estado.estado === 'conferindo' ? (
          <Loader2 size={13} strokeWidth={1.5} className="shrink-0 animate-spin text-accent" />
        ) : (
          <Cpu size={13} strokeWidth={1.5} className="shrink-0 text-ink-3" />
        )}
        <span
          className={[
            'min-w-0 select-text truncate',
            runtime && foraDoRuntime ? (runtime.fase === 'instalando' ? 'text-ink-2' : 'text-danger') : estado.estado === 'fora' ? 'text-danger' : 'text-ink-2',
          ].join(' ')}
          title={estado.detalhe}
        >
          {/* App instalado sem o motor: a frase do runtime (a sondagem pode ser de antes de um Remover). */}
          {runtime && foraDoRuntime ? textoDoRuntime(runtime) : estado.texto}
          {motor && (
            <span className="text-ink-3" title={motor.ancut.caminho ?? undefined}>
              {' '}
              · AnCut HUB: {motor.ancut.instalado ? 'instalado' : 'nao encontrado'}
            </span>
          )}
        </span>
      </p>
      {/* App instalado: onde mora o runtime do motor, instalar, reinstalar, remover. */}
      <ConfigDoMotorRuntime />
    </div>
  )
}
