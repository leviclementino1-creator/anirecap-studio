import { useEffect, useState } from 'react'
import { Cpu, FolderOpen, Loader2 } from 'lucide-react'
import type { PublicSettings } from '@shared/channels'
import { useGerar } from '@/store/gerar'
import { nuvemDoCaminho } from './pecas'

/**
 * O pedaco das Configuracoes que e do Studio: onde ele grava as cenas que
 * corta, e se o motor de personagens (e o AnCut HUB) estao a mao.
 *
 * Mora aqui, e nao no Settings.tsx, para o arquivo herdado do Dangai ganhar so
 * uma linha.
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
  const [aviso, setAviso] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  // Pronto, a resposta e o cache do main (de graca). Nao pronto, abrir as
  // Configuracoes confere de novo: o motor pode ter sido instalado depois. So
  // na montagem -- depender de `motor` aqui sondaria em laco enquanto ele
  // continuasse fora.
  useEffect(() => {
    if (!useGerar.getState().motor?.studio.pronto) void conferirMotor()
  }, [conferirMotor])

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

  return (
    <>
      <div className="my-5 h-px bg-line" />

      <div className="mb-1.5 flex items-baseline gap-2">
        <label className="block text-[11px] font-medium text-ink-2">Biblioteca do Studio</label>
        <span className="flex-1" />
        {!padrao && (
          <button
            type="button"
            onClick={() => void gravar('')}
            disabled={salvando}
            className="text-[11px] text-ink-3 underline-offset-2 hover:text-ink hover:underline disabled:opacity-40"
          >
            Usar o padrao
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => void escolher()}
        disabled={salvando}
        title={settings?.bibliotecaStudioEfetiva}
        className="lift flex w-full items-center gap-2 rounded-sm border border-line bg-elevated px-2.5 py-1.5 text-left text-[13px] text-ink-2 hover:text-ink disabled:opacity-40"
      >
        <FolderOpen size={13} strokeWidth={1.5} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{settings?.bibliotecaStudioEfetiva || 'Escolher a pasta...'}</span>
        {settings && padrao && <span className="shrink-0 text-[11px] text-ink-3">(padrao)</span>}
      </button>
      {aviso && <p className="mt-2 select-text text-[11px] leading-relaxed text-danger">{aviso}</p>}
      {settings && nuvemDoCaminho(settings.bibliotecaStudioEfetiva) && (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-2">
          Essa pasta fica no {nuvemDoCaminho(settings.bibliotecaStudioEfetiva)}: cada episodio cortado (perto de 1 GB de
          cenas e keyframes) entra na sincronizacao. Uma pasta fora dele evita isso.
        </p>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
        Onde o Studio grava as cenas que ele corta e o indice de cada episodio. As bibliotecas do AnCut e do Corte
        Cenas continuam so leitura.
      </p>

      <label className="mt-4 mb-1.5 block text-[11px] font-medium text-ink-2">Motor de personagens</label>
      <div className="flex flex-col gap-1.5 rounded-sm border border-line bg-elevated px-2.5 py-2 text-[12px]">
        <p className="flex items-start gap-2">
          <Cpu size={13} strokeWidth={1.5} className="mt-0.5 shrink-0 text-ink-3" />
          {motorErro ? (
            <span className="select-text text-danger">Motor de personagens: nao deu para conferir ({motorErro})</span>
          ) : !motor ? (
            <span className="flex items-center gap-1.5 text-ink-3">
              <Loader2 size={12} strokeWidth={1.5} className="animate-spin text-accent" />
              Conferindo o motor...
            </span>
          ) : motor.studio.pronto ? (
            <span className="text-ink-2">
              Motor de personagens: <span className="text-ink">pronto</span>{' '}
              {motor.studio.gpu ? `(GPU ${motor.studio.gpu})` : '(sem GPU: roda na CPU, bem mais lento)'}
            </span>
          ) : (
            <span className="select-text text-danger">
              Motor de personagens: nao esta pronto. {motor.studio.erro ?? ''}
            </span>
          )}
        </p>
        {motor && (
          <p className="flex items-start gap-2 pl-[21px] text-ink-2" title={motor.ancut.caminho ?? undefined}>
            AnCut HUB: {motor.ancut.instalado ? <span className="text-ink">instalado</span> : 'nao encontrado'}
          </p>
        )}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
        O mesmo motor do AnCut, com pasta e banco proprios. Corta o episodio em cenas e reconhece os personagens pelo
        rosto no passo 1 do "Gerar recap".
      </p>
    </>
  )
}
