import { useState } from 'react'
import type { UpdateStatus } from '@shared/channels'
import { Download, Loader2, RefreshCw } from 'lucide-react'
import { useProject } from '@/store/project'

/**
 * Versao instalada e "Procurar atualizacoes", no fim das Configuracoes.
 *
 * A mesma busca do clique na versao da barra de baixo (checkForUpdateNow), so
 * que num lugar onde o Levi procura. A resposta fica escrita ate fechar a
 * janela (cada abertura das Configuracoes monta de novo, sem resposta velha):
 * aqui ele veio perguntar, e uma resposta que some em 5 s some antes de ele ler.
 *
 * Sem release ainda o main responde "atual" (updater.ts): "Ja esta na ultima
 * versao", sem vermelho. Em dev nao ha o que atualizar, e a frase diz isso.
 */
export function VersaoDoApp() {
  const appVersion = useProject((s) => s.appVersion)
  const update = useProject((s) => s.update)
  const rendering = useProject((s) => s.render !== null)
  const [perguntou, setPerguntou] = useState(false)

  const procurando = update?.state === 'procurando'
  const resposta = !perguntou || !update ? null : frase(update)

  return (
    <>
      <div className="my-5 h-px bg-line" />
      <label className="mb-1.5 block text-[11px] font-medium text-ink-2">Atualizacoes</label>
      <div className="flex items-center gap-2">
        <span className="tnum text-[13px] text-ink-2">{appVersion ? `Versao ${appVersion}` : 'Versao'}</span>
        <span className="flex-1" />
        {update?.state === 'pronta' ? (
          <button
            type="button"
            disabled={rendering}
            onClick={() => void window.dangai.installUpdate()}
            title={rendering ? 'Termine o render primeiro' : `Instala a ${update.version} e reabre o app`}
            className="lift flex shrink-0 items-center gap-1.5 rounded-sm border border-accent bg-accent-dim px-3 py-1.5 text-[13px] font-medium text-ink disabled:opacity-40"
          >
            <Download size={13} strokeWidth={1.5} className="text-accent" />
            Atualizar para {update.version}
          </button>
        ) : (
          <button
            type="button"
            disabled={procurando}
            onClick={() => {
              setPerguntou(true)
              void window.dangai.checkUpdate()
            }}
            className="lift flex shrink-0 items-center gap-1.5 rounded-sm border border-line bg-elevated px-3 py-1.5 text-[13px] font-medium text-ink disabled:opacity-40"
          >
            {procurando ? (
              <Loader2 size={13} strokeWidth={1.5} className="animate-spin" />
            ) : (
              <RefreshCw size={13} strokeWidth={1.5} />
            )}
            {procurando ? 'Procurando...' : 'Procurar atualizacoes'}
          </button>
        )}
      </div>
      <p className="mt-2 select-text text-[11px] leading-relaxed text-ink-3">
        {resposta ?? 'O app procura sozinho ao abrir e a cada 6 h, e baixa em segundo plano. Trocar de versao e sempre no seu clique.'}
      </p>
    </>
  )
}

function frase(update: UpdateStatus): string {
  switch (update.state) {
    case 'procurando':
      return 'Procurando...'
    case 'atual':
      return 'Ja esta na ultima versao.'
    case 'baixando':
      return `Versao nova${update.version ? ` (${update.version})` : ''}: baixando ${Math.round(update.percent * 100)}%.`
    case 'pronta':
      return `A ${update.version} esta baixada. O app fecha, instala e reabre.`
    case 'bloqueada':
      return `O Windows barrou o instalador da ${update.version}. Veja o aviso na barra de baixo.`
    case 'erro':
      return /so funciona no app instalado/i.test(update.message)
        ? 'Aqui e o app de desenvolvimento: atualizacao so no app instalado.'
        : 'Nao consegui verificar agora (sem internet?). Tente de novo mais tarde.'
  }
}
