import { useEffect, useState } from 'react'
import { Cpu, FolderOpen, Library as LibraryIcon, Loader2, Scissors, TriangleAlert } from 'lucide-react'
import { ROTULO_DA_ORIGEM, type ComoAchou, type EpisodioEncontrado } from '@shared/episodio'
import { useGerar } from '@/store/gerar'
import { Botao, Caixinha, listaCurta, nuvemDoCaminho, Secao } from './pecas'

const COMO_ACHOU: Record<ComoAchou, string> = {
  source: 'Mesmo arquivo',
  impressao: 'Mesmo arquivo (achado pela impressao digital: ele mudou de lugar)',
  nome: 'Mesmo nome de arquivo',
  'anime+episodio': 'So o anime e o episodio batem',
}

function quando(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/**
 * (c) O RESULTADO DA BUSCA nas bibliotecas e a decisao que ele pede.
 *
 * Achou: o mais forte vem na frente, com o que ja existe (cenas, personagens)
 * e dois caminhos -- usar o que esta la, que e de graca, ou cortar de novo no
 * Studio. Nao achou: analisar, no Studio ou no AnCut HUB quando ele esta
 * instalado. O "Reconhecer personagens" vale para qualquer analise.
 */
export function ResultadoDaBusca() {
  const fase = useGerar((s) => s.fase)
  const busca = useGerar((s) => s.busca)
  const procurando = useGerar((s) => s.procurando)
  const sonda = useGerar((s) => s.sonda)
  const [escolhido, setEscolhido] = useState(0)

  // Busca nova, escolha nova: o indice velho apontaria para outro achado.
  useEffect(() => setEscolhido(0), [busca])

  if (fase !== 'escolha' || !sonda) return null

  if (procurando || busca === null) {
    return (
      <Secao titulo="Bibliotecas" icone={<LibraryIcon size={13} strokeWidth={1.5} className="text-accent" />}>
        <p className="flex items-center gap-2 text-[12px] text-ink-2">
          <Loader2 size={13} strokeWidth={1.5} className="animate-spin text-accent" />
          Procurando nas bibliotecas do Studio, do AnCut e do Corte Cenas...
        </p>
      </Secao>
    )
  }

  if (busca.length === 0) return <EpisodioNovo />

  const achado = busca[Math.min(escolhido, busca.length - 1)]!
  return (
    <Secao
      titulo="Ja analisado"
      destaque
      icone={<LibraryIcon size={13} strokeWidth={1.5} className="text-accent" />}
    >
      <Achado achado={achado} />

      {busca.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-ink-2">Tambem achado em</span>
          <div className="flex flex-wrap gap-1.5">
            {busca.map((b, i) => (
              <button
                key={`${b.origem}:${b.pasta}`}
                type="button"
                onClick={() => setEscolhido(i)}
                title={b.pasta}
                className={[
                  'lift rounded-sm border px-2 py-1 text-[11px]',
                  i === escolhido ? 'border-accent bg-accent-dim text-ink' : 'border-line bg-elevated text-ink-2',
                ].join(' ')}
              >
                {ROTULO_DA_ORIGEM[b.origem]} · {b.totalCenas} cenas
                {b.comoAchou === 'anime+episodio' ? ' · so o nome' : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      <Acoes achado={achado} />
    </Secao>
  )
}

function Achado({ achado }: { achado: EpisodioEncontrado }) {
  const data = quando(achado.analisadoEm)
  const fraco = achado.comoAchou === 'anime+episodio'
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[13px] leading-relaxed text-ink">
        Ja analisado na biblioteca do {ROTULO_DA_ORIGEM[achado.origem]}:{' '}
        <span className="tnum">{achado.totalCenas.toLocaleString('pt-BR')} cenas</span>
        {achado.personagens.length > 0 ? (
          <>
            {' · personagens: '}
            <span className="text-ink-2">
              {listaCurta(
                achado.personagens.map((p) => ({ nome: p.nome, n: p.cenas })),
                6,
              )}
            </span>
          </>
        ) : (
          <span className="text-ink-3"> · sem personagens reconhecidos</span>
        )}
      </p>
      <p className="text-[11px] text-ink-3">
        {[COMO_ACHOU[achado.comoAchou], data ? `analisado em ${data}` : null, achado.indice ? 'ja indexado no Studio' : null]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {fraco && (
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-2">
          <TriangleAlert size={12} strokeWidth={1.5} className="mt-0.5 shrink-0 text-accent" />
          So o nome da serie e o numero do episodio batem: pode ser outro release, com os tempos deslocados, ou ate outro anime com o
          mesmo numero. Confira a pasta. Se as falas cairem nas cenas erradas, analise de novo no Studio.
        </p>
      )}
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 select-text truncate text-[11px] text-ink-3" title={achado.pasta}>
          {achado.pasta}
        </span>
        <button
          type="button"
          onClick={() => void window.dangai.revealFile(achado.pasta)}
          title="Mostrar a pasta no Explorer (so olhar: o Studio nao mexe nela)"
          className="flex shrink-0 items-center gap-1 text-[11px] text-ink-3 hover:text-ink"
        >
          <FolderOpen size={12} strokeWidth={1.5} />
          Abrir
        </button>
      </div>
    </div>
  )
}

/** Os botoes do achado: usar o que existe, ou cortar de novo no Studio. */
function Acoes({ achado }: { achado: EpisodioEncontrado }) {
  const usarAnalise = useGerar((s) => s.usarAnalise)
  const analisar = useGerar((s) => s.analisar)
  const reconhecer = useGerar((s) => s.reconhecer)
  const definirReconhecer = useGerar((s) => s.definirReconhecer)
  const bloqueio = useBloqueioDoStudio()

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Botao
          principal
          onClick={() => void usarAnalise(achado)}
          title={
            achado.origem === 'studio'
              ? 'Usa as cenas que o Studio ja cortou e le a legenda'
              : `Usa as cenas do ${ROTULO_DA_ORIGEM[achado.origem]} sem mexer nelas (so leitura) e le a legenda`
          }
        >
          Usar essa analise
        </Botao>
        <Botao
          onClick={() => void analisar('studio')}
          disabled={bloqueio !== null}
          title={bloqueio ?? 'Corta o episodio inteiro de novo, na biblioteca do Studio'}
        >
          <Scissors size={13} strokeWidth={1.5} />
          Analisar de novo no Studio
        </Botao>
        <span className="flex-1" />
        <Caixinha
          ligada={reconhecer}
          onChange={definirReconhecer}
          title="Vale para a analise de novo no Studio"
        >
          Reconhecer personagens (mais lento)
        </Caixinha>
      </div>
      <LinhaDoMotor />
    </div>
  )
}

/** (c) sem achado: o episodio e novo e precisa ser cortado. */
function EpisodioNovo() {
  const analisar = useGerar((s) => s.analisar)
  const reconhecer = useGerar((s) => s.reconhecer)
  const definirReconhecer = useGerar((s) => s.definirReconhecer)
  const motor = useGerar((s) => s.motor)
  const bloqueio = useBloqueioDoStudio()
  const semAnime = useGerar((s) => !s.palpite?.anime.trim())
  const corteSemIndice = useGerar((s) => s.corteSemIndice)
  const nuvem = useNuvemDaBiblioteca()

  return (
    <Secao
      titulo={corteSemIndice ? 'Cenas cortadas, sem personagens' : 'Episodio novo'}
      destaque
      icone={<Scissors size={13} strokeWidth={1.5} className="text-accent" />}
    >
      {corteSemIndice ? (
        <>
          {/* O motor cortou e parou no elenco: as cenas existem, so o indice nao. */}
          <p className="text-[13px] leading-relaxed text-ink">
            As cenas ja estao cortadas na biblioteca do {corteSemIndice === 'ancut' ? 'AnCut' : 'Studio'}, mas a analise parou
            antes de reconhecer os personagens.
          </p>
          <p className="text-[11px] leading-relaxed text-ink-3">
            Analisar de novo reaproveita o corte: sem reconhecer, termina em segundos; reconhecendo, so falta buscar o
            elenco.
          </p>
        </>
      ) : (
        <>
          <p className="text-[13px] leading-relaxed text-ink">
            Nao esta na biblioteca do Studio, do AnCut nem do Corte Cenas.
          </p>
          <p className="text-[11px] leading-relaxed text-ink-3">
            O Studio corta o episodio inteiro em cenas (.mp4, no formato de pasta do AnCut) e, se voce quiser, reconhece
            os personagens pelo rosto.
          </p>
        </>
      )}
      {nuvem && (
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-2">
          <TriangleAlert size={12} strokeWidth={1.5} className="mt-0.5 shrink-0 text-accent" />
          A biblioteca do Studio fica no {nuvem}: cada episodio cortado (perto de 1 GB) entra na sincronizacao. Da para
          trocar a pasta nas Configuracoes.
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <Caixinha ligada={reconhecer} onChange={definirReconhecer}>
          Reconhecer personagens (mais lento)
        </Caixinha>
        <p className="pl-6 text-[11px] leading-relaxed text-ink-3">
          {reconhecer
            ? 'Uns 3 a 5 min com GPU. Na primeira vez de um anime, mais uns 9 min para buscar o elenco na internet.'
            : 'So corta: bem mais rapido. Os personagens ficam de fora.'}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Botao
          principal
          onClick={() => void analisar('studio')}
          disabled={bloqueio !== null}
          title={bloqueio ?? 'Corta na biblioteca do Studio'}
        >
          <Scissors size={13} strokeWidth={1.5} />
          Analisar no Studio
        </Botao>
        {motor?.ancut.instalado && (
          <Botao
            onClick={() => void analisar('ancut')}
            disabled={semAnime}
            title={
              semAnime
                ? 'Diga o nome do anime antes'
                : `Usa o AnCut HUB instalado${motor.ancut.caminho ? ` (${motor.ancut.caminho})` : ''}. As cenas ficam na biblioteca dele, e o Studio le de la.`
            }
          >
            Analisar com o AnCut
          </Botao>
        )}
      </div>
      <LinhaDoMotor />
    </Secao>
  )
}

/**
 * Por que o "Analisar no Studio" esta desligado, em texto para o tooltip e a
 * linha do motor. null = pode analisar.
 */
function useBloqueioDoStudio(): string | null {
  const motor = useGerar((s) => s.motor)
  const motorErro = useGerar((s) => s.motorErro)
  const semAnime = useGerar((s) => !s.palpite?.anime.trim())
  if (semAnime) return 'Diga o nome do anime antes: e ele que da nome a pasta'
  if (motorErro) return `Nao deu para conferir o motor: ${motorErro}`
  if (!motor) return 'Conferindo o motor de personagens...'
  if (!motor.studio.pronto) return `O motor do Studio nao esta pronto: ${motor.studio.erro ?? 'sem motivo informado'}`
  return null
}

/** O servico de nuvem em que a biblioteca do Studio esta (nuvemDoCaminho), ou null. */
function useNuvemDaBiblioteca(): string | null {
  const [nuvem, setNuvem] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    void window.dangai.getSettings().then((r) => {
      if (vivo && r.ok) setNuvem(nuvemDoCaminho(r.value.bibliotecaStudioEfetiva))
    })
    return () => {
      vivo = false
    }
  }, [])
  return nuvem
}

/**
 * Sonda o motor de novo. O main so guarda a resposta pronta, entao um probe
 * que estourou o tempo (disco frio) ou um venv instalado com o app aberto se
 * resolvem aqui, sem reiniciar.
 */
function ConferirDeNovo() {
  const conferir = useGerar((s) => s.conferirMotor)
  const conferindo = useGerar((s) => s.conferindoMotor)
  return (
    <button
      type="button"
      onClick={() => void conferir()}
      disabled={conferindo}
      className="shrink-0 text-[11px] text-ink-3 underline-offset-2 hover:text-ink hover:underline disabled:opacity-40"
    >
      {conferindo ? 'Conferindo...' : 'Conferir de novo'}
    </button>
  )
}

/** Uma linha discreta sobre o motor: pronto (e com que GPU) ou por que nao. */
export function LinhaDoMotor() {
  const motor = useGerar((s) => s.motor)
  const motorErro = useGerar((s) => s.motorErro)

  if (motorErro) {
    return (
      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-danger">
        <Cpu size={12} strokeWidth={1.5} className="mt-0.5 shrink-0" />
        <span className="min-w-0 flex-1 select-text">Nao deu para conferir o motor: {motorErro}</span>
        <ConferirDeNovo />
      </p>
    )
  }
  if (!motor) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-ink-3">
        <Loader2 size={12} strokeWidth={1.5} className="animate-spin text-accent" />
        Conferindo o motor de personagens (na primeira vez leva alguns segundos)...
      </p>
    )
  }
  if (!motor.studio.pronto) {
    return (
      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-danger">
        <Cpu size={12} strokeWidth={1.5} className="mt-0.5 shrink-0" />
        <span className="min-w-0 flex-1 select-text">
          O motor do Studio nao esta pronto: {motor.studio.erro ?? 'sem motivo informado'}
        </span>
        <ConferirDeNovo />
      </p>
    )
  }
  return (
    <p className="flex items-center gap-1.5 text-[11px] text-ink-3">
      <Cpu size={12} strokeWidth={1.5} className="shrink-0" />
      Motor do Studio pronto
      {motor.studio.versao ? ` (${motor.studio.versao})` : ''}
      {motor.studio.gpu ? ` · GPU ${motor.studio.gpu}` : ' · sem GPU: roda na CPU, bem mais lento'}
      {motor.ancut.instalado ? ' · AnCut HUB instalado' : ''}
    </p>
  )
}

/**
 * O motor parou pedindo ajuda para achar o elenco. A rodada de descoberta com
 * nomes fica para depois; por agora, cortar sem personagens ja destrava o
 * episodio -- e o "reconhecer" pode rodar de novo quando o nome estiver certo.
 */
export function PedidoDeDescoberta() {
  const fase = useGerar((s) => s.fase)
  const descoberta = useGerar((s) => s.descoberta)
  const anime = useGerar((s) => s.palpite?.anime ?? '')
  const analisar = useGerar((s) => s.analisar)
  const esquecer = useGerar((s) => s.esquecerDescoberta)

  if (fase !== 'escolha' || !descoberta) return null

  return (
    <Secao
      titulo="Elenco nao encontrado"
      destaque
      icone={<TriangleAlert size={13} strokeWidth={1.5} className="text-accent" />}
    >
      <p className="text-[13px] leading-relaxed text-ink">
        {descoberta.motivo === 'anime-nao-encontrado'
          ? `O motor nao achou "${anime.trim()}" no AniList nem no MyAnimeList, entao nao tem como saber quem e quem.`
          : 'O motor achou o anime, mas nao conseguiu fotos de referencia dos personagens.'}
      </p>
      <p className="text-[11px] leading-relaxed text-ink-3">
        Da para cortar as cenas agora e deixar os personagens de fora.
        {descoberta.motivo === 'anime-nao-encontrado'
          ? ' Ou corrija o nome do anime acima (o titulo em romaji costuma achar) e analise de novo.'
          : ''}
      </p>
      {descoberta.erro && <p className="select-text text-[11px] leading-relaxed text-ink-3">{descoberta.erro}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Botao principal onClick={() => void analisar(descoberta.motor, false)}>
          <Scissors size={13} strokeWidth={1.5} />
          Cortar sem reconhecer personagens
        </Botao>
        <Botao onClick={esquecer}>Agora nao</Botao>
      </div>
    </Secao>
  )
}
