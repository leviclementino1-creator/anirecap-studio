/**
 * O CASAR v0 (electron/services/cenas/casar.ts) com os episodios de VERDADE,
 * sem IA:
 *
 * 1. Dr. Stone S4 - 37 (indice do Corte Cenas, 300 planos, .ass com falantes)
 *    e S04E24 (biblioteca do Studio, 385 planos, rostos, .srt sem falantes),
 *    cada um com o roteiro APROVADO do rascunho real (so lido). No S4 - 37 a
 *    duracao vem do take ElevenLabs do teste de voz (copia em %TEMP%, so
 *    lida) quando o texto bate; senao, a estimativa.
 *    - nenhuma cena (nem candidato da fita) encosta em OP/ED;
 *    - zero trechos repetidos entre as frases (plano LONGO pode servir a duas
 *      frases, cada uma no seu trecho, sem sobrepor);
 *    - S4 - 37: os planos com fala na borda da OP/ED achada pelo vao (0031,
 *      0061, 0308) ficam disponiveis, aparados; a f16 (epilogo, trecho sem
 *      cena no indice) leva o close do Senku (0308) com o aviso do trecho;
 *    - S04E24 (roteiro sem cue do momento): a ancora sai das palavras -- f12
 *      ("encarar o Whyman na Lua") na Lua (0237), f13 ("unem forcas pra
 *      construir uma espaconave") no Senku e Xeno lado a lado (0322);
 *    - 6 candidatos por frase, sem plano dividido dentro da fita;
 *    - nenhum plano < 0,6 s nem com placa; spans so de planos consecutivos;
 *    - porque <= 4 termos ASCII de ate 32; escolha passa no zod.
 * 2. O servico (sugerirCenas / candidatosDaFrase / salvarCenas) num perfil
 *    TEMPORARIO com a copia do rascunho: grava so la; travada fica; texto
 *    mudado refaz so aquela frase; filtros e vizinhas sem OP/ED.
 * 3. Para 8 frases do S4 - 37: a frase, os 3 melhores e o porque, e uma folha
 *    de contato com os keyframes (em SAIDA) para conferir olhando.
 *
 * Nao escreve no %APPDATA%, na biblioteca nem no Corte Cenas. Rodar da raiz:
 *   npx esbuild scripts/teste/v-cenas-casar.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json | node
 * Folhas de contato: $env:SAIDA = '<pasta>' (padrao: %TEMP%/v-cenas-casar).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  aplicarEscolhas,
  CENAS_VAZIAS,
  duracaoDaFrase,
  escolhaDaFraseSchema,
  escolhasDesatualizadas,
  estadoDasCenasSchema,
  frasesDoRoteiro,
  planosConsecutivos,
  trechosDoCandidato,
  type CandidatoDeCena,
} from '../../shared/cenas'
import { lerIndice, type EpisodeIndex } from '../../shared/episodio'
import { lerRascunho, rascunhoDoRecapSchema, roteiroAtual, type RascunhoDoRecap } from '../../shared/roteiro'
import { hashDoTexto, type TakeDaVoz } from '../../shared/voz'
import {
  AVISO_TRECHO_SEM_CENAS,
  casarFrases,
  citadosNoTexto,
  elencoDoEpisodio,
  prepararPlanos,
  type ResultadoDoCasar,
} from '../../electron/services/cenas/casar'
import { candidatosDaFrase, salvarCenas, sugerirCenas } from '../../electron/services/cenas'
import { configurarEpisodios } from '../../electron/services/episodio/perfil'
import { configureSettings, saveSettings, type Cofre } from '../../electron/services/settings'
import { gravarRascunho, lerRascunhoDoDisco } from '../../electron/services/gerar/rascunho'

let falhas = 0
function confere(ok: boolean, nome: string): void {
  console.log(`  ${ok ? 'ok ' : 'FALHOU'} ${nome}`)
  if (!ok) falhas++
}
function secao(nome: string): void {
  console.log(`\n== ${nome}`)
}
function mmss(t: number): string {
  const m = Math.floor(t / 60)
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`
}

const RECAPS = join(process.env['APPDATA'] ?? '', 'AniRecap Studio', 'recaps')
const BIBLIOTECA = 'G:/AniRecap Studio/Biblioteca'
const VOZ_COPIA = join(tmpdir(), 'anirecap-v-voz-real', 'userData', 'recaps')
const SAIDA = process.env['SAIDA'] ?? join(tmpdir(), 'v-cenas-casar')

interface Caso {
  nome: string
  indicePath: string
  rascunhoId: string
}
const CASOS: Caso[] = [
  {
    nome: 'Dr. Stone S4 - 37 (Corte Cenas)',
    indicePath: join(BIBLIOTECA, '_indices', 'ep_25d63d4babd6dd9145aae70912d5b5b2b1fcb067', 'episodio.json'),
    rascunhoId: 'rc_25d63d4babd6_mv7cxp1z',
  },
  {
    nome: 'Dr STONE S04E24 (Studio)',
    indicePath: join(BIBLIOTECA, 'Dr STONE', 'S04E24', 'episodio.json'),
    rascunhoId: 'rc_7f20fe8a8728_mv793333',
  },
]

function lerJson(caminho: string): unknown {
  return JSON.parse(readFileSync(caminho, 'utf8'))
}

/** O take ElevenLabs do teste de voz (t1/t2) cujo texto bate com o roteiro: so lido. */
function takeDaCopia(r: RascunhoDoRecap): TakeDaVoz | null {
  const arquivo = join(VOZ_COPIA, `${r.id}.json`)
  if (!existsSync(arquivo)) return null
  const copia = lerRascunho(lerJson(arquivo))
  const roteiro = roteiroAtual(r)
  if (!copia.voz || !roteiro) return null
  const hashes = new Map(frasesDoRoteiro(roteiro).map((f) => [f.id, hashDoTexto(f.texto)]))
  const elevens = copia.voz.takes.filter((t) => t.config.fonte === 'elevenlabs')
  const bate = (t: TakeDaVoz): number => t.trechos.filter((x) => hashes.get(x.fraseId) === x.hashTexto).length
  return elevens.sort((a, b) => bate(b) - bate(a))[0] ?? null
}

function sobreposicao(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

/** O trecho que cada cena mostra (inSec ate a duracao da frase) por plano: dois que se cruzam = repetido. */
function trechosRepetidos(escolhas: readonly { fraseId: string; duracao: number; cenas: { candidato: CandidatoDeCena }[] }[]): string[] {
  const vistos: { plano: string; de: number; ate: number; frase: string }[] = []
  const repetidos: string[] = []
  for (const e of escolhas) {
    for (const c of e.cenas) {
      const de = c.candidato.inSec
      const ate = Math.min(c.candidato.outSec, de + e.duracao)
      for (const plano of c.candidato.planoIds) {
        const outro = vistos.find((v) => v.plano === plano && sobreposicao(v.de, v.ate, de, ate) > 0.05)
        if (outro) repetidos.push(`${plano} (${outro.frase}/${e.fraseId})`)
        vistos.push({ plano, de, ate, frase: e.fraseId })
      }
    }
  }
  return repetidos
}

/** As conferencias duras do casar sobre um resultado. */
function conferirResultado(nome: string, indice: EpisodeIndex, res: ResultadoDoCasar, nFrases: number): void {
  const todos = prepararPlanos(indice)
  const porId = new Map(todos.map((p) => [p.plano.id, p]))
  const escolhas = res.casadas.map((c) => c.escolha)
  confere(escolhas.length === nFrases, `${nome}: uma escolha por frase (${escolhas.length}/${nFrases})`)
  const candidatos: CandidatoDeCena[] = escolhas.flatMap((e) => [...e.fita, ...e.cenas.map((c) => c.candidato)])

  const emExclusao = candidatos.filter((c) => indice.exclusoes.some((e) => sobreposicao(c.inSec, c.outSec, e.start, e.end) > 0.001))
  confere(emExclusao.length === 0, `${nome}: nenhuma cena nem candidato em OP/ED (${emExclusao.length})`)
  // O pedaco que a tela toca (trechosDoCandidato) tambem fica fora.
  const trechosFora = candidatos.flatMap((c) => trechosDoCandidato(c, indice.planos).map((t) => ({ t, p: porId.get(t.planoId)! }))).filter(({ t, p }) =>
    indice.exclusoes.some((e) => sobreposicao(p.plano.start + t.de, p.plano.start + t.ate, e.start, e.end) > 0.001),
  )
  confere(trechosFora.length === 0, `${nome}: trechos dos mp4 fora de OP/ED`)

  const repetidos = trechosRepetidos(escolhas)
  confere(repetidos.length === 0, `${nome}: zero trechos repetidos entre frases (${repetidos.join(',') || 'nenhum'})`)

  const fitas = escolhas.map((e) => e.fita.length)
  confere(fitas.every((n) => n === 6), `${nome}: 6 candidatos por frase (${fitas.join(' ')})`)
  const fitaDividida = escolhas.filter((e) => {
    const ids = e.fita.flatMap((c) => c.planoIds)
    return new Set(ids).size !== ids.length
  })
  confere(fitaDividida.length === 0, `${nome}: nenhum plano em dois candidatos da mesma fita`)
  const ruins = candidatos.filter((c) => c.planoIds.some((id) => porId.get(id)?.fora))
  confere(ruins.length === 0, `${nome}: nenhum plano curto (<0,6 s), de placa ou de OP/ED sugerido (${ruins.length})`)
  confere(candidatos.every((c) => planosConsecutivos(indice, c.planoIds)), `${nome}: spans so de planos consecutivos`)
  confere(
    candidatos.every((c) => {
      const a = porId.get(c.planoIds[0]!)!.plano
      const b = porId.get(c.planoIds[c.planoIds.length - 1]!)!.plano
      return c.inSec >= a.start - 1e-3 && c.outSec <= b.end + 1e-3 && c.outSec > c.inSec
    }),
    `${nome}: janela dentro dos planos`,
  )
  confere(
    candidatos.every((c) => c.porque.length <= 4 && c.porque.every((p) => p.length <= 32 && /^[\x20-\x7e]+$/.test(p))),
    `${nome}: porque <= 4 termos ASCII curtos`,
  )
  confere(escolhas.every((e) => escolhaDaFraseSchema.safeParse(e).success), `${nome}: escolhas passam no zod`)
  confere(escolhas.every((e) => e.cenas.length === 1 && e.cenas[0]!.candidato === e.fita[0]), `${nome}: a cena colocada e a 1a da fita`)
  confere(escolhas.every((e) => e.confianca >= 0 && e.confianca <= 1), `${nome}: confianca 0..1`)
}

// ===================================================================== 1.
const contexto: { caso: Caso; indice: EpisodeIndex; r: RascunhoDoRecap; take: TakeDaVoz | null; res: ResultadoDoCasar }[] = []
for (const caso of CASOS) {
  secao(`1. ${caso.nome}`)
  const arquivoRascunho = join(RECAPS, `${caso.rascunhoId}.json`)
  if (!existsSync(caso.indicePath) || !existsSync(arquivoRascunho)) {
    confere(false, `faltam os dados reais (${caso.indicePath} / ${arquivoRascunho})`)
    continue
  }
  const antes = statSync(arquivoRascunho).mtimeMs
  const indice = lerIndice(lerJson(caso.indicePath))
  const r = lerRascunho(lerJson(arquivoRascunho))
  const roteiro = roteiroAtual(r)!
  const frases = frasesDoRoteiro(roteiro)
  const take = takeDaCopia(r)
  const reais = frases.filter((f) => duracaoDaFrase(f, take).real).length
  console.log(`  ${indice.planos.length} planos, ${indice.cues.length} cues, exclusoes ${indice.exclusoes.map((e) => `${e.motivo} ${mmss(e.start)}-${mmss(e.end)}`).join(', ')}`)
  console.log(`  roteiro v${roteiro.versao} aprovado=${r.aprovado}, ${frases.length} frases; take ${take ? `${take.id} (${take.config.fonte}), ${reais}/${frases.length} frases com duracao real` : 'nenhum (estimativa)'}`)

  const t0 = Date.now()
  const res = casarFrases({
    indice,
    eventos: r.eventos,
    frases,
    take,
    fixas: new Map(),
    refazer: new Set(frases.map((f) => f.id)),
  })
  console.log(`  casou em ${Date.now() - t0} ms; avisos: ${res.avisos.join(' | ') || 'nenhum'}`)
  conferirResultado(caso.nome, indice, res, frases.length)

  // Sem take (a ordem antiga): continua valendo tudo.
  if (take) {
    const semTake = casarFrases({ indice, eventos: r.eventos, frases, take: null, fixas: new Map(), refazer: new Set(frases.map((f) => f.id)) })
    conferirResultado(`${caso.nome} sem take`, indice, semTake, frases.length)
  }
  // Duracao: quanto da frase a cena colocada cobre.
  const faltas = res.casadas.map((c) => ({ id: c.escolha.fraseId, falta: c.fita[0]?.falta ?? 0, d: c.escolha.duracao }))
  console.log(`  cobertura: ${faltas.filter((f) => f.falta === 0).length}/${faltas.length} frases cobertas sem congelar; faltas: ${faltas.filter((f) => f.falta > 0).map((f) => `${f.id} ${f.falta.toFixed(1)}s/${f.d.toFixed(1)}s`).join(', ') || '-'}`)
  console.log(`  spans: ${res.casadas.filter((c) => c.escolha.cenas[0]!.candidato.planoIds.length > 1).map((c) => `${c.escolha.fraseId}=${c.escolha.cenas[0]!.candidato.planoIds.join('+')}`).join(', ') || '-'}`)
  confere(statSync(arquivoRascunho).mtimeMs === antes, `${caso.nome}: rascunho real intocado`)
  contexto.push({ caso, indice, r, take, res })
}

// Os nomes: "Senku" do roteiro casa com "Ishigami, Senkuu" (rosto) e "Senku" (falante).
secao('1b. Nomes')
{
  const c = contexto[0]
  if (c) {
    const elenco = elencoDoEpisodio(prepararPlanos(c.indice), c.indice, c.r.eventos)
    const nomes = (t: string): string => citadosNoTexto(t, elenco).map((x) => x.ficha).join(',')
    confere(nomes('O Senku e o pessoal') === 'senku', `"O Senku" -> senku (${nomes('O Senku e o pessoal')})`)
    confere(nomes('E o Why-Man quer voltar') === 'whyman', `"Why-Man" -> whyman (${nomes('E o Why-Man quer voltar')})`)
    confere(nomes('o famoso Dr. Stone') === '', `"Dr. Stone" nao vira o Dr. Xeno (${nomes('o famoso Dr. Stone') || 'nada'})`)
    confere(nomes('O Ukyo e o Xeno') === 'ukyo,xeno', `"Ukyo", "Xeno" (${nomes('O Ukyo e o Xeno')})`)
    confere(nomes('Senku Ishigami sorri') === 'senku', `"Senku Ishigami" conta uma vez (${nomes('Senku Ishigami sorri')})`)
  }
}

// Casos que o roteiro real nao tem: frase sem evento, citacao literal, frase
// longa (span), escolha fixa, momento sem cena.
secao('1c. Regras do casar (S4 - 37, variacoes em memoria)')
{
  const c = contexto[0]
  if (c) {
    const frases = frasesDoRoteiro(roteiroAtual(c.r)!)
    const todas = new Set(frases.map((f) => f.id))
    const casar = (fs: typeof frases, extra: Partial<Parameters<typeof casarFrases>[0]> = {}): ResultadoDoCasar =>
      casarFrases({ indice: c.indice, eventos: c.r.eventos, frases: fs, take: null, fixas: new Map(), refazer: todas, ...extra })
    const de = (res: ResultadoDoCasar, id: string) => res.casadas.find((x) => x.escolha.fraseId === id)!

    // Frase sem evento: herda a janela da vizinha, confianca baixa, "sem evento".
    const alvo = frases[4]!
    const semEvento = casar(frases.map((f) => (f.id === alvo.id ? { ...f, eventoIds: [], cueDoMomento: null } : f)))
    const se = de(semEvento, alvo.id)
    confere(se.janela.herdada && se.escolha.fita.length === 6, `${alvo.id} sem evento: janela da vizinha, fita cheia`)
    confere(se.escolha.confianca <= 0.25 && se.escolha.avisos.some((a) => /sem evento/i.test(a)) && se.escolha.fita[0]!.porque[0] === 'sem evento', `${alvo.id} sem evento: confianca ${se.escolha.confianca}, aviso e porque`)

    // Citacao literal: a janela da cena cobre a fala citada.
    const comMomento = frases.find((f) => f.cueDoMomento)!
    const citada = casar(frases.map((f) => (f.id === comMomento.id ? { ...f, citacaoCueId: f.cueDoMomento } : f)))
    const ci = de(citada, comMomento.id).escolha.cenas[0]!.candidato
    const cue = c.indice.cues.find((x) => x.id === comMomento.cueDoMomento)!
    confere(ci.porque.includes('fala citada') && sobreposicao(ci.inSec, ci.outSec, cue.start, cue.end) > 0.3, `${comMomento.id} com citacao: "fala citada" e a janela cobre a fala (${mmss(ci.inSec)}-${mmss(ci.outSec)})`)

    // Frase longa (14 s no take): span de planos seguintes ou aviso de cena curta.
    const longa = frases[6]!
    const takeLongo = { trechos: [{ fraseId: longa.id, offset: 0, duracao: 14, hashTexto: hashDoTexto(longa.texto), texto: longa.texto }] }
    const lg = de(casar(frases, { take: takeLongo }), longa.id)
    const cobre = lg.escolha.cenas[0]!.candidato.outSec - lg.escolha.cenas[0]!.candidato.inSec
    confere(lg.escolha.duracao === 14 && (cobre >= 14 - 1.5 || lg.escolha.avisos.includes('Cena curta')), `${longa.id} com 14 s: cena de ${cobre.toFixed(1)} s (${lg.escolha.cenas[0]!.candidato.planoIds.join('+')}) ${lg.escolha.avisos.join(', ')}`)
    confere(lg.escolha.fita.every((x) => planosConsecutivos(c.indice, x.planoIds) && x.planoIds.length <= 3), `${longa.id}: spans de ate 3 planos consecutivos`)

    // Escolha fixa (travada): os planos dela nao voltam em outra frase.
    const base = casar(frases)
    const fixa = { ...base.casadas[0]!.escolha, travada: true }
    const resto = new Set(frases.slice(1).map((f) => f.id))
    const comFixa = casar(frases, { fixas: new Map([[fixa.fraseId, fixa]]), refazer: resto })
    confere(
      comFixa.casadas.length === frases.length - 1 && trechosRepetidos([fixa, ...comFixa.casadas.map((x) => x.escolha)]).length === 0,
      'escolha fixa: so as outras sao refeitas e nenhuma repete o trecho dela',
    )

    // Momento sem cena (o Byakuya depois da ED, fora do corte do Corte Cenas).
    const posEd = base.casadas.find((x) => x.janela.intervalos.every((i) => i.de > 1400))
    if (posEd) {
      confere(
        posEd.janela.semCenas &&
          posEd.escolha.avisos.includes(AVISO_TRECHO_SEM_CENAS) &&
          !posEd.escolha.avisos.includes('Longe do momento') &&
          posEd.escolha.confianca <= 0.3,
        `${posEd.escolha.fraseId} (trecho sem cena no indice): aviso "${AVISO_TRECHO_SEM_CENAS}", confianca ${posEd.escolha.confianca}`,
      )
      const termos = posEd.fita[0]!.termos.map((t) => t.chave)
      confere(!termos.includes('continua') && !termos.includes('cronologia'), `${posEd.escolha.fraseId}: sem "continua" nem "em frente" (o momento dela nao tem cena)`)
    }

    // As bordas da OP/ED achadas pelo VAO: plano com fala na borda e aparado, nao sai.
    const planos = new Map(prepararPlanos(c.indice).map((p) => [p.plano.id, p]))
    for (const id of ['0031', '0061', '0308']) {
      const p = planos.get(id)
      const dentro = p?.util ? c.indice.exclusoes.some((e) => sobreposicao(p.util!.de, p.util!.ate, e.start, e.end) > 0.001) : true
      confere(!!p?.util && p.fora === null && !dentro, `${id} (fala na borda da OP/ED): disponivel, aparado ${p?.util ? `${mmss(p.util.de)}-${mmss(p.util.ate)}` : '-'}`)
    }
    const f16 = de(casar(frases), 'f16')
    confere(f16.escolha.cenas[0]?.candidato.planoIds[0] === '0308', `f16 (epilogo): o close do Senku 0308 (${f16.escolha.cenas[0]?.candidato.planoIds.join('+')})`)

    // Plano longo (o 0270, 27 s): serve a duas frases em trechos diferentes, nunca sobrepostos.
    const p0270 = planos.get('0270')!
    const f09 = frases.find((f) => f.id === 'f09')!
    const meia = { ...de(base, 'f09').escolha, travada: true }
    const outra = { ...f09, id: 'f98', texto: 'Eles descobriram que o objeto altera a massa das particulas.', cueDoMomento: 'c0184' }
    const resto2 = casar([...frases, outra], { fixas: new Map([['f09', meia]]), refazer: new Set(['f98']) })
    const f98 = de(resto2, 'f98')
    const naFita = f98.escolha.fita.find((x) => x.planoIds.includes('0270'))
    confere(
      meia.cenas[0]!.candidato.planoIds.includes('0270') &&
        !!naFita &&
        trechosRepetidos([meia, { ...f98.escolha, cenas: [{ candidato: naFita }] }]).length === 0,
      `plano longo 0270 (${(p0270.plano.end - p0270.plano.start).toFixed(1)} s): outro trecho na fita de outra frase (${naFita ? mmss(naFita.inSec) : '-'}), sem sobrepor o da f09`,
    )
  }
}

// O S04E24: roteiro de antes da cue do momento, ancora pelas palavras.
secao('1d. Ancora pelas palavras (S04E24)')
{
  const c = contexto[1]
  if (c) {
    const de = (id: string): string => c.res.casadas.find((x) => x.escolha.fraseId === id)?.escolha.cenas[0]?.candidato.planoIds.join('+') ?? '-'
    const janela = (id: string) => c.res.casadas.find((x) => x.escolha.fraseId === id)!.janela
    confere(janela('f12').estimada && janela('f12').cueAncora?.id === 'c0130', `f12: ancora estimada na fala da Lua (${janela('f12').cueAncora?.id})`)
    confere(de('f12') === '0237', `f12 "encarar o Whyman na Lua": 0237 (${de('f12')})`)
    confere(de('f13') === '0322', `f13 "unem forcas pra construir uma espaconave": 0322 (${de('f13')})`)
    confere(de('f08').startsWith('0242'), `f08 "reviveram Xeno": abre no Xeno quebrando a pedra 0242 (${de('f08')})`)
  }
}

// ===================================================================== 2.
secao('2. Servico num perfil temporario')
{
  const c = contexto[0]
  if (!c) confere(false, 'sem o S4 - 37')
  else {
    const temp = mkdtempSync(join(tmpdir(), 'v-cenas-casar-'))
    const userData = join(temp, 'userData')
    mkdirSync(join(userData, 'recaps'), { recursive: true })
    const cofreFalso: Cofre = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' }
    configureSettings(userData, cofreFalso)
    saveSettings({ bibliotecaStudio: BIBLIOTECA, libraryDir: '' })
    configurarEpisodios(userData)
    // A copia: o rascunho real + o take do teste de voz como atual (so o JSON; o casar nao toca no WAV).
    const comVoz: RascunhoDoRecap = c.take
      ? { ...c.r, voz: { versao: 1, takes: [c.take], atual: c.take.id, aprovado: true, aprovadoEm: c.r.atualizadoEm } as RascunhoDoRecap['voz'] }
      : c.r
    gravarRascunho(rascunhoDoRecapSchema.parse(comVoz))
    const id = c.r.id
    const arquivo = join(userData, 'recaps', `${id}.json`)

    void (async () => {
      const s1 = await sugerirCenas(id)
      const roteiro = roteiroAtual(s1.rascunho)!
      const frases = frasesDoRoteiro(roteiro)
      const cenas = s1.rascunho.cenas
      confere(cenas !== null && cenas.escolhas.length === frases.length, `sugerirCenas: ${cenas?.escolhas.length}/${frases.length} escolhas gravadas`)
      confere(estadoDasCenasSchema.safeParse(cenas).success, 'estado das cenas passa no zod')
      const d1 = escolhasDesatualizadas(roteiro, c.take, cenas)
      confere(d1.semEscolha.length === 0 && d1.textoMudou.length === 0 && d1.orfas.length === 0, 'nada sem escolha depois de sugerir')
      const mtime = statSync(arquivo).mtimeMs
      const s2 = await sugerirCenas(id)
      confere(statSync(arquivo).mtimeMs === mtime && s2.rascunho.atualizadoEm === s1.rascunho.atualizadoEm, 'sugerir de novo sem mudanca: nada gravado')

      // A grade.
      const f = frases[2]!
      const g = await candidatosDaFrase(id, f.id, {})
      const indice = c.indice
      const naExclusao = (x: CandidatoDeCena): boolean => indice.exclusoes.some((e) => sobreposicao(x.inSec, x.outSec, e.start, e.end) > 0.001)
      confere(g.sugestoes.length === 6 && g.sugestoes[0]!.planoIds.join() === cenas!.escolhas[2]!.fita[0]!.planoIds.join(), `grade: sugestoes = fita (${g.sugestoes.length})`)
      confere(g.vizinhas.length > 0 && g.vizinhas.every((x) => x.origem === 'vizinha'), `grade: ${g.vizinhas.length} vizinhas`)
      confere(![...g.vizinhas, ...g.outras].some(naExclusao), 'grade: vizinhas e outras sem OP/ED')
      const naFita = new Set(g.sugestoes.flatMap((x) => x.planoIds))
      confere(![...g.vizinhas, ...g.outras].some((x) => x.planoIds.some((p) => naFita.has(p))), 'grade: nada da fita repetido embaixo')
      confere(g.momento !== null, `grade: momento ${g.momento === null ? '-' : mmss(g.momento)}`)
      console.log(`  personagens: ${g.personagens.slice(0, 10).map((p) => `${p.nome} ${p.cenas}`).join(', ')}`)
      confere(g.personagens.some((p) => /Senku/i.test(p.nome)) && g.personagens.some((p) => /Why-Man/i.test(p.nome)) && !g.personagens.some((p) => /Scientist/i.test(p.nome)), 'personagens: rostos + falantes sem rosto, sem figurante sem nome')
      const senku = await candidatosDaFrase(id, f.id, { personagem: 'Ishigami, Senkuu' })
      const todos = prepararPlanos(indice)
      const porId = new Map(todos.map((p) => [p.plano.id, p]))
      const temSenku = (x: CandidatoDeCena): boolean => {
        const p = porId.get(x.planoIds[0]!)!
        return [...p.rostos, ...p.falas].some((n) => n.fichas.includes('senku'))
      }
      confere(senku.outras.length > 0 && [...senku.vizinhas, ...senku.outras].every(temSenku), `filtro personagem: ${senku.vizinhas.length + senku.outras.length} cenas, todas com o Senku (rosto ou fala)`)
      const falasSenku = todos.filter((p) => p.util && p.falas.some((x) => x.fichas.includes('senku')) && !p.rostos.some((x) => x.fichas.includes('senku'))).length
      confere(falasSenku === 0 || [...senku.vizinhas, ...senku.outras].some((x) => !porId.get(x.planoIds[0]!)!.rostos.some((r) => r.fichas.includes('senku'))), 'filtro personagem pega o falante "Senku" sem rosto')
      const busca = await candidatosDaFrase(id, f.id, { busca: 'time machine' })
      console.log(`  busca "time machine": ${busca.vizinhas.length + busca.outras.length} cenas (${busca.outras.slice(0, 4).map((x) => x.planoIds[0]).join(',')})`)
      confere(busca.vizinhas.length + busca.outras.length > 0, 'busca por fala acha cena')
      const outroCentro = g.outras[10]!.planoIds[0]!
      const viz = await candidatosDaFrase(id, f.id, { vizinhasDe: outroCentro })
      confere(viz.vizinhas.some((x) => x.planoIds[0] === outroCentro || Math.abs(Number(x.planoIds[0]) - Number(outroCentro)) <= 6), `vizinhasDe ${outroCentro}: em volta dele`)

      // Travar uma escolha (o usuario trocou pela 3a da fita), mexer no texto de outra.
      const e0 = cenas!.escolhas[0]!
      const trocada = { ...e0, cenas: [{ candidato: e0.fita[2]!, palavraInicio: 0 }], travada: true }
      await salvarCenas(id, [trocada])
      const r2 = lerRascunhoDoDisco(id)
      const rot2 = roteiroAtual(r2)!
      const alvo = rot2.secoes[1]!.frases[0]!
      const textoNovo = `${alvo.texto.replace(/\.$/, '')} de vez.`
      const mexido: RascunhoDoRecap = {
        ...r2,
        roteiros: r2.roteiros.map((v) => (v.versao !== rot2.versao ? v : { ...v, secoes: v.secoes.map((s) => ({ ...s, frases: s.frases.map((x) => (x.id === alvo.id ? { ...x, texto: textoNovo } : x)) })) })),
      }
      // E a travada tambem teve o texto mexido: continua travada.
      const e0f = frasesDoRoteiro(rot2)[0]!
      const mexido2: RascunhoDoRecap = {
        ...mexido,
        roteiros: mexido.roteiros.map((v) => (v.versao !== rot2.versao ? v : { ...v, secoes: v.secoes.map((s) => ({ ...s, frases: s.frases.map((x) => (x.id === e0f.id ? { ...x, texto: `${x.texto} Sim.` } : x)) })) })),
      }
      gravarRascunho(mexido2)
      const antesDe = new Map(lerRascunhoDoDisco(id).cenas!.escolhas.map((e) => [e.fraseId, JSON.stringify(e)]))
      const s3 = await sugerirCenas(id)
      const depois = s3.rascunho.cenas!.escolhas
      const mudaram = depois.filter((e) => antesDe.get(e.fraseId) !== JSON.stringify(e)).map((e) => e.fraseId)
      confere(mudaram.length === 1 && mudaram[0] === alvo.id, `texto mudado: so ${alvo.id} refeita (${mudaram.join(',')})`)
      const travadaDepois = depois.find((e) => e.fraseId === e0.fraseId)!
      confere(travadaDepois.travada && travadaDepois.cenas[0]!.candidato.planoIds.join() === e0.fita[2]!.planoIds.join(), 'travada fica como o usuario deixou, mesmo com o texto mexido')
      const refeita = depois.find((e) => e.fraseId === alvo.id)!
      // So os trechos que cruzam a refeita contam (a travada trocada a mao pode cruzar outra: foi o usuario).
      const daRefeita = trechosRepetidos([...depois.filter((e) => e.fraseId !== alvo.id), refeita]).filter((x) => x.endsWith(`/${alvo.id})`))
      confere(refeita.hashTexto === hashDoTexto(textoNovo) && daRefeita.length === 0, `refeita com o hash novo e sem repetir trecho das outras (${daRefeita.join(',') || 'nenhum'})`)

      // Orfa: escolha de frase que nao existe mais sai.
      const r4 = lerRascunhoDoDisco(id)
      const orfa = { ...r4.cenas!.escolhas[1]!, fraseId: 'f99' }
      gravarRascunho({ ...r4, cenas: { ...r4.cenas!, escolhas: [...r4.cenas!.escolhas, orfa] } })
      const s5 = await sugerirCenas(id)
      confere(!s5.rascunho.cenas!.escolhas.some((e) => e.fraseId === 'f99'), 'orfa descartada')
      confere(aplicarEscolhas(CENAS_VAZIAS, [], roteiro).escolhas.length === 0, 'aplicarEscolhas vazio')
      // Nada fora do perfil temporario: o rascunho real nao mudou.
      confere(lerRascunho(lerJson(join(RECAPS, `${id}.json`))).cenas === null, 'rascunho real continua sem cenas')

    })()
      .catch((e: unknown) => confere(false, `servico lancou: ${e instanceof Error ? e.stack : String(e)}`))
      .finally(() => {
        // O perfil temporario e so deste teste.
        rmSync(temp, { recursive: true, force: true })
        relatorio()
      })
  }
}

// ===================================================================== 3.
function relatorio(): void {
  // CASO=1 -> o S04E24; FRASES=todas -> todas as frases (ou "f01,f05").
  const c = contexto[Number(process.env['CASO'] ?? 0)]
  if (!c) return fim()
  secao(`3. ${c.caso.nome}: os 3 melhores de cada frase e o porque`)
  mkdirSync(SAIDA, { recursive: true })
  const roteiro = roteiroAtual(c.r)!
  const frases = frasesDoRoteiro(roteiro)
  const pedido = process.env['FRASES']
  const escolhidas =
    pedido === 'todas'
      ? frases.map((f) => f.id)
      : (pedido?.split(',') ?? ['f01', 'f02', 'f03', 'f04', 'f07', 'f08', 'f15', 'f18']).filter((id) => frases.some((f) => f.id === id))
  const porId = new Map(c.indice.planos.map((p) => [p.id, p]))
  const cuePorId = new Map(c.indice.cues.map((x) => [x.id, x]))
  for (const id of escolhidas) {
    const f = frases.find((x) => x.id === id)!
    const casada = c.res.casadas.find((x) => x.escolha.fraseId === id)!
    const mom = f.cueDoMomento ? cuePorId.get(f.cueDoMomento) : undefined
    console.log(`\n  ${id} "${f.texto}"`)
    console.log(`     IV: ${f.intencaoVisual} | eventos ${f.eventoIds.join(',')} | momento ${mom ? `${mmss(mom.start)} [${mom.falante ?? '-'}] ${mom.texto.slice(0, 60)}` : '-'} | ${casada.escolha.duracao.toFixed(1)}s | conf ${casada.escolha.confianca}`)
    const jpgs: string[] = []
    for (const [k, cand] of casada.fita.slice(0, 3).entries()) {
      const p0 = porId.get(cand.candidato.planoIds[0]!)!
      const rostos = [...new Set(cand.planos.flatMap((p) => p.rostos.map((r) => r.nome)))].join('/')
      const falas = [...new Set(cand.planos.flatMap((p) => p.falas.map((r) => r.nome)))].join('/')
      console.log(`     ${k + 1}. ${cand.candidato.planoIds.join('+')} ${mmss(cand.candidato.inSec)}-${mmss(cand.candidato.outSec)} nota ${cand.candidato.nota} [${cand.candidato.porque.join(' | ')}] rostos: ${rostos || '-'} falam: ${falas || '-'}`)
      console.log(`        termos: ${cand.termos.map((t) => `${t.chave}${t.valor >= 0 ? '+' : ''}${t.valor.toFixed(1)}`).join(' ')}`)
      if (p0.keyframe && existsSync(p0.keyframe)) jpgs.push(p0.keyframe)
    }
    if (jpgs.length > 0) {
      const saida = join(SAIDA, `${c.r.id.slice(3, 9)}-${id}.jpg`)
      try {
        const entradas = jpgs.flatMap((j) => ['-i', j])
        const filtros = jpgs.map((_, i) => `[${i}:v]scale=426:240,drawtext=text='${i + 1}':x=8:y=8:fontsize=28:fontcolor=yellow:box=1:boxcolor=black@0.6[v${i}]`).join(';')
        const pilha = `${jpgs.map((_, i) => `[v${i}]`).join('')}hstack=inputs=${jpgs.length}[out]`
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...entradas, '-filter_complex', `${filtros};${pilha}`, '-map', '[out]', '-frames:v', '1', saida])
        console.log(`     folha: ${saida}`)
      } catch {
        // Sem drawtext (ffmpeg sem freetype): sem os numeros.
        try {
          const entradas = jpgs.flatMap((j) => ['-i', j])
          const filtros = jpgs.map((_, i) => `[${i}:v]scale=426:240[v${i}]`).join(';')
          const pilha = `${jpgs.map((_, i) => `[v${i}]`).join('')}hstack=inputs=${jpgs.length}[out]`
          execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...entradas, '-filter_complex', `${filtros};${pilha}`, '-map', '[out]', '-frames:v', '1', saida])
          console.log(`     folha: ${saida}`)
        } catch (e) {
          console.log(`     (sem folha: ${e instanceof Error ? e.message.slice(0, 80) : ''})`)
        }
      }
    }
  }
  fim()
}

function fim(): void {
  console.log(falhas === 0 ? '\nTUDO CERTO' : `\n${falhas} FALHA(S)`)
  if (falhas > 0) process.exitCode = 1
}

