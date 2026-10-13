import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { FileVideo, FolderOpen, Loader2, RotateCcw, Search, Upload } from 'lucide-react'
import { legendaTemTexto, type FaixaDeLegenda, type KindDoEpisodio } from '@shared/episodio'
import { useGerar } from '@/store/gerar'
import { Field } from '@/components/painel'
import { Botao, CLASSE_DO_CAMPO, formatarTempo, Secao } from './pecas'

/**
 * (a) A AREA DE SOLTAR do assistente, enquanto nao ha episodio. Mesmo desenho
 * da tela inicial (borda tracejada, frase grande), para o gesto ser o mesmo:
 * clicar abre o dialogo, soltar o .mkv aqui (ou em qualquer canto do
 * assistente) tambem vale.
 */
export function AreaDeSoltar({ arrastando }: { arrastando: boolean }) {
  const escolherArquivo = useGerar((s) => s.escolherArquivo)
  return (
    <button
      type="button"
      onClick={() => void escolherArquivo()}
      className={[
        'enter flex min-h-[300px] w-full flex-col items-center justify-center gap-4 rounded-lg border border-dashed transition-colors duration-200 ease-dangai',
        arrastando ? 'border-accent bg-accent-dim' : 'border-line hover:border-line-strong',
      ].join(' ')}
    >
      <motion.div
        animate={{ scale: arrastando ? 1.04 : 1 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center gap-4"
      >
        <Upload size={22} strokeWidth={1.5} className={arrastando ? 'text-accent' : 'text-ink-3'} />
        <span
          className={[
            'text-[24px] font-semibold tracking-tight transition-colors duration-200',
            arrastando ? 'text-accent' : 'text-ink',
          ].join(' ')}
        >
          Soltar o episodio aqui
        </span>
        <span className="text-[13px] text-ink-3">ou clique para escolher o .mkv</span>
        <span className="max-w-[440px] text-center text-[11px] leading-relaxed text-ink-3">
          O Studio procura o episodio nas bibliotecas (Studio, AnCut, Corte Cenas). Se nao achar, corta
          as cenas e reconhece os personagens.
        </span>
      </motion.div>
    </button>
  )
}

/** Nome legivel do codigo de idioma do container. Fora da lista, o proprio codigo. */
const IDIOMAS: Record<string, string> = {
  por: 'Portugues',
  pt: 'Portugues',
  eng: 'Ingles',
  en: 'Ingles',
  spa: 'Espanhol',
  es: 'Espanhol',
  jpn: 'Japones',
  ja: 'Japones',
  fre: 'Frances',
  fra: 'Frances',
  ger: 'Alemao',
  deu: 'Alemao',
  ita: 'Italiano',
  rus: 'Russo',
  ara: 'Arabe',
  chi: 'Chines',
  zho: 'Chines',
  kor: 'Coreano',
  ind: 'Indonesio',
  may: 'Malaio',
  msa: 'Malaio',
  tha: 'Tailandes',
  vie: 'Vietnamita',
  pol: 'Polones',
  tur: 'Turco',
  hin: 'Hindi',
}

const CODECS: Record<string, string> = {
  ass: '.ass',
  ssa: '.ssa',
  subrip: '.srt',
  srt: '.srt',
  webvtt: '.vtt',
  mov_text: 'mov_text',
  hdmv_pgs_subtitle: 'PGS',
  dvd_subtitle: 'VobSub',
}

/** "Ingles · English · .ass · padrao". Faixa de imagem diz que nao da falas. */
export function rotuloDaFaixa(faixa: FaixaDeLegenda): string {
  const idioma = IDIOMAS[faixa.idioma.toLowerCase()] ?? (faixa.idioma || 'Sem idioma')
  const partes = [idioma]
  if (faixa.nome && faixa.nome.toLowerCase() !== idioma.toLowerCase()) partes.push(faixa.nome)
  partes.push(CODECS[faixa.codec.toLowerCase()] ?? faixa.codec)
  if (faixa.default) partes.push('padrao')
  if (faixa.forced) partes.push('forcada')
  const texto = partes.join(' · ')
  return legendaTemTexto(faixa) ? texto : `${texto} (imagem, sem falas)`
}

const TIPOS: { valor: KindDoEpisodio; rotulo: string }[] = [
  { valor: '', rotulo: 'Episodio' },
  { valor: 'OP', rotulo: 'Abertura (OP)' },
  { valor: 'ED', rotulo: 'Encerramento (ED)' },
  { valor: 'MOVIE', rotulo: 'Filme' },
]

/**
 * (b) O CARTAO DO ARQUIVO: o que e o arquivo (nome, duracao, resolucao) e o
 * que o Studio acha que ele e (anime, temporada, episodio), com a legenda que
 * vai ser lida.
 *
 * O palpite e editavel ate a analise comecar: e ele que da nome a pasta das
 * cenas, e depois de cortar trocar o nome seria mentir sobre onde elas estao.
 * A legenda continua trocavel depois de pronto -- reler a legenda nao corta
 * nada de novo.
 */
export function CartaoDoEpisodio() {
  const fase = useGerar((s) => s.fase)
  const arquivo = useGerar((s) => s.arquivo)
  const sonda = useGerar((s) => s.sonda)
  const palpite = useGerar((s) => s.palpite)
  const faixaLegenda = useGerar((s) => s.faixaLegenda)
  const palpiteDaBusca = useGerar((s) => s.palpiteDaBusca)
  const procurando = useGerar((s) => s.procurando)
  const indice = useGerar((s) => s.indice)
  const temJob = useGerar((s) => s.job !== null)
  const mudasMarcacoes = useGerar((s) => s.exclusoesMudaram)
  const editarPalpite = useGerar((s) => s.editarPalpite)
  const procurarDeNovo = useGerar((s) => s.procurarDeNovo)
  const escolherFaixa = useGerar((s) => s.escolherFaixa)
  const recomecar = useGerar((s) => s.recomecar)
  const reindexar = useGerar((s) => s.reindexar)

  if (!arquivo) return null
  const nome = arquivo.split(/[\\/]/).pop() ?? arquivo

  const travado = fase === 'analisando' || fase === 'indexando' || fase === 'pronto'
  const chaveAtual = palpite
    ? `${palpite.anime.trim().toLowerCase()}|${palpite.temporada}|${palpite.episodio}|${palpite.kind}`
    : null
  const palpiteMudou = fase === 'escolha' && !procurando && palpiteDaBusca !== null && chaveAtual !== palpiteDaBusca
  // Pronto com outra faixa escolhida: oferece reler a legenda sobre as mesmas cenas.
  const faixaMudou = fase === 'pronto' && indice !== null && (indice.faixaLegenda?.index ?? null) !== faixaLegenda

  const medidas = sonda
    ? [
        formatarTempo(sonda.duracaoSec),
        `${sonda.largura}x${sonda.altura}`,
        `${Number(sonda.fps.toFixed(3))} fps`,
        sonda.codec,
        sonda.hdr ? 'HDR' : null,
        `${sonda.legendas.length} ${sonda.legendas.length === 1 ? 'legenda' : 'legendas'}`,
        sonda.capitulos.length > 0
          ? `${sonda.capitulos.length} ${sonda.capitulos.length === 1 ? 'capitulo' : 'capitulos'}`
          : null,
      ].filter((x): x is string => x !== null)
    : []

  return (
    <Secao
      titulo="Episodio"
      icone={<FileVideo size={13} strokeWidth={1.5} className="text-accent" />}
      acao={
        <div className="flex items-center gap-1.5">
          <Botao
            pequeno
            onClick={() => void window.dangai.revealFile(arquivo)}
            title={`Mostrar no Explorer: ${arquivo}`}
          >
            <FolderOpen size={12} strokeWidth={1.5} />
            Abrir pasta
          </Botao>
          <Botao
            pequeno
            onClick={recomecar}
            disabled={temJob || mudasMarcacoes}
            title={
              temJob
                ? 'Cancele a analise antes de trocar de episodio'
                : mudasMarcacoes
                  ? 'Salve ou descarte as marcacoes da regua antes'
                  : 'Escolher outro episodio'
            }
          >
            <RotateCcw size={12} strokeWidth={1.5} />
            Trocar episodio
          </Botao>
        </div>
      }
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="select-text truncate text-[14px] font-medium text-ink" title={arquivo}>
            {nome}
          </p>
          {sonda ? (
            <p className="tnum mt-0.5 text-[11px] text-ink-3">{medidas.join(' · ')}</p>
          ) : (
            <p className="mt-1 flex items-center gap-2 text-[11px] text-ink-2">
              <Loader2 size={12} strokeWidth={1.5} className="animate-spin text-accent" />
              Lendo o arquivo...
            </p>
          )}
        </div>
      </div>

      {sonda && palpite && (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_88px_88px_150px] items-end gap-2">
            <Field label="Anime">
              <input
                type="text"
                value={palpite.anime}
                disabled={travado}
                onChange={(e) => editarPalpite({ anime: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && palpiteMudou) void procurarDeNovo()
                  if (e.key === 'Escape') e.currentTarget.blur()
                }}
                placeholder="Nome do anime"
                spellCheck={false}
                className={CLASSE_DO_CAMPO}
              />
            </Field>
            <Field label="Temporada">
              <CampoInteiro
                valor={palpite.temporada}
                disabled={travado}
                onChange={(n) => editarPalpite({ temporada: n })}
              />
            </Field>
            <Field label={palpite.kind === 'MOVIE' ? 'Ano' : palpite.kind ? 'Numero' : 'Episodio'}>
              <CampoInteiro
                valor={palpite.episodio}
                disabled={travado}
                onChange={(n) => editarPalpite({ episodio: n })}
              />
            </Field>
            <Field label="Tipo">
              <select
                value={palpite.kind}
                disabled={travado}
                onChange={(e) => editarPalpite({ kind: e.target.value as KindDoEpisodio })}
                className={`${CLASSE_DO_CAMPO} w-full`}
              >
                {TIPOS.map((t) => (
                  <option key={t.valor} value={t.valor}>
                    {t.rotulo}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-ink-3">
              {travado
                ? 'O nome da pasta das cenas ja esta decidido.'
                : sonda.palpiteOrigem === 'motor'
                  ? 'Adivinhado pelo nome do arquivo, do mesmo jeito que o AnCut le. Corrija se precisar: e o nome da pasta.'
                  : 'Adivinhado pelo nome do arquivo. Corrija se precisar: e o nome da pasta.'}
            </p>
            {palpiteMudou && (
              <Botao pequeno onClick={() => void procurarDeNovo()} title="Procura de novo com o nome corrigido">
                <Search size={12} strokeWidth={1.5} />
                Procurar de novo
              </Botao>
            )}
          </div>

          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Field label="Legenda (falas e quem fala)">
                <select
                  value={faixaLegenda === null ? '' : String(faixaLegenda)}
                  disabled={fase === 'analisando' || fase === 'indexando'}
                  onChange={(e) => escolherFaixa(e.target.value === '' ? null : Number(e.target.value))}
                  className={`${CLASSE_DO_CAMPO} w-full`}
                >
                  {sonda.legendas.map((f) => (
                    <option key={f.index} value={String(f.index)} disabled={!legendaTemTexto(f)}>
                      {rotuloDaFaixa(f)}
                      {f.index === sonda.legendaSugerida ? '  (sugerida)' : ''}
                    </option>
                  ))}
                  <option value="">Sem legenda (as cenas ficam sem falas)</option>
                </select>
              </Field>
            </div>
            {faixaMudou && (
              <Botao
                onClick={() => void reindexar()}
                disabled={mudasMarcacoes}
                title={
                  mudasMarcacoes
                    ? 'Salve ou descarte as marcacoes da regua antes'
                    : 'Le a legenda escolhida e refaz as falas de cada cena. Nao corta nada de novo.'
                }
              >
                Ler essa legenda
              </Botao>
            )}
          </div>
          {sonda.legendas.length === 0 && (
            <p className="text-[11px] text-ink-3">
              O arquivo nao tem legenda embutida: as cenas ficam sem falas e sem quem fala.
            </p>
          )}
        </>
      )}
    </Secao>
  )
}

/**
 * Numero inteiro sem a briga do input controlado: da para apagar e digitar de
 * novo. Grava enquanto e um numero valido; ao sair, volta ao ultimo valido.
 */
function CampoInteiro({
  valor,
  onChange,
  disabled,
}: {
  valor: number
  onChange: (n: number) => void
  disabled?: boolean
}) {
  const [texto, setTexto] = useState(String(valor))
  useEffect(() => setTexto(String(valor)), [valor])
  return (
    <input
      type="text"
      inputMode="numeric"
      value={texto}
      disabled={disabled}
      onChange={(e) => {
        const limpo = e.target.value.replace(/\D/g, '').slice(0, 4)
        setTexto(limpo)
        if (limpo !== '') onChange(Number(limpo))
      }}
      onBlur={() => setTexto(String(valor))}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || e.key === 'Enter') e.currentTarget.blur()
      }}
      className={`${CLASSE_DO_CAMPO} tnum w-full`}
    />
  )
}
