/**
 * O MODELO RESERVA no passo 2, sem chave real, sem rede e sem gastar cota.
 *
 * Quando a cota gratis dos modelos bons (3.8/3.7/3.6/3.5-flash) acaba, o
 * automatico do llm.ts desce ate o 3.5-flash-lite, e o roteiro dele sai
 * chapado. O passo 2 agora PARA antes e pergunta. O que cobre:
 *
 * - llm.ts, com o fetch trocado por um falso que responde como o Google:
 *   ehModeloReserva e melhorFlash(soBons); so reserva livre + permitirReserva
 *   false = nota 'so-reserva' SEM chamar o lite (cota do dia e lotacao, com o
 *   renovaEm de cada caso); com permissao, chama o lite; o reserva lembrado
 *   pelo automatico nao serve para quem nao aceita; sucessor sugerido que e
 *   lite tambem nao; modelo escolhido a mao continua valendo; e o resto do
 *   app (planner, metadata) continua descendo ate o reserva como antes;
 * - gerar/* com a IA falsa (trocarIaParaTeste): eventos e roteiro pedem com
 *   permitirReserva false; a parada volta tipada (etapa eventos, roteiro e
 *   secao) sem gravar nada -- o roteiro aprovado nao muda; com aceitouReserva
 *   o pedido inteiro vai no reserva e a versao fica marcada; resposta do
 *   reserva guardada no cache nao e lida sem permissao; a segunda tentativa
 *   que cai no reserva fica com a primeira, sem perguntar;
 * - textoDaParada: "renova ~4h" (horario de verao dos EUA), "~5h" fora dele,
 *   "voltam em ~5 min" na lotacao.
 *
 * Le os indices reais da biblioteca do Studio (so leitura) e grava so numa
 * pasta temporaria. Rodar da raiz do projeto:
 *   npx esbuild scripts/teste/v-modelo-reserva.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json | node
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { lerIndice, type EpisodeIndex } from '../../shared/episodio'
import {
  cuesElegiveis,
  ehModeloReserva,
  ehParadaNoReserva,
  roteiroAtual,
  textoDaParada,
  type EventosDaIa,
  type EventosGerados,
  type FraseDaIa,
  type RoteiroDaIa,
  type RoteiroGerado,
  type SecaoDaIa,
} from '../../shared/roteiro'
import {
  esquecerModelos,
  gerarJson,
  melhorFlash,
  msAteRenovarACota,
  type PedidoJson,
  type RespostaJson,
} from '../../electron/services/llm'
import { configureSettings, saveSettings, type Cofre } from '../../electron/services/settings'
import { generateMetadata } from '../../electron/services/metadata'
import { planWithAI } from '../../electron/services/planner'
import { configurarEpisodios } from '../../electron/services/episodio/indice'
import { trocarIaParaTeste } from '../../electron/services/gerar/ia'
import { gerarEventos } from '../../electron/services/gerar/eventos'
import { gerarRoteiro } from '../../electron/services/gerar/roteiro'
import { abrirRascunho, aprovarRoteiro, lerRascunhoDoDisco, pastaDosRascunhos } from '../../electron/services/gerar/rascunho'

// O texto da tela usa a hora local: o teste fixa a do Levi.
process.env.TZ = 'America/Sao_Paulo'

const BIBLIOTECA = 'G:\\AniRecap Studio\\Biblioteca'
const ID_37 = 'ep_25d63d4babd6dd9145aae70912d5b5b2b1fcb067'
const LITE = 'gemini-3.5-flash-lite'

let falhas = 0
function confere(ok: boolean, mensagem: string): void {
  if (ok) console.log(`  ok  ${mensagem}`)
  else {
    falhas += 1
    console.log(`  FALHOU  ${mensagem}`)
  }
}
function secao(titulo: string): void {
  console.log(`\n== ${titulo}`)
}
const nada = (): void => {}

// O log do llm.ts ("indo no ...") e do gerar nao interessa aqui.
const logs: string[] = []
console.warn = (...args: unknown[]) => void logs.push(args.map(String).join(' '))
const logDeVerdade = console.log
console.log = (...args: unknown[]) => {
  const linha = args.map(String).join(' ')
  if (linha.startsWith('[gerar:') || linha.startsWith('[llm')) logs.push(linha)
  else logDeVerdade(...args)
}

// ------------------------------------------------------------- Google falso

/** Os ids que a lista de modelos devolve. */
let lista: string[] = []
/** Como cada modelo responde; ausente = responde certo. */
type Jeito = 'cota' | 'lotado' | { aposentadoPara: string }
const jeito = new Map<string, Jeito>()
/** 'lista' ou o id do modelo chamado no generateContent, em ordem. */
let chamadas: string[] = []

function json(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })
}

function respostaDoGemini(objeto: unknown): Response {
  return json(200, { candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(objeto) }] }, finishReason: 'STOP' }] })
}

const TEXTOS = { titles: ['Um', 'Dois', 'Tres'], description: 'Frieren lembra de Himmel.', hashtags: ['frieren'] }
const cena = (imageIndex: number, start: number, end: number) => ({
  imageIndex, start, end, effect: 'zoom-in', intensity: 0.1, transitionIn: 'cut', reason: 'muda de assunto',
})

/** A resposta certa para o schema que veio no pedido (plano, textos ou o { ok }). */
function respostaPara(corpo: Record<string, unknown> | null): Response {
  const config = (corpo?.['generationConfig'] ?? {}) as Record<string, any>
  const schema = config['responseJsonSchema'] ?? config['responseFormat']?.text?.schema ?? {}
  const props = Object.keys((schema as { properties?: object }).properties ?? {})
  if (props.includes('scenes')) return respostaDoGemini({ scenes: [cena(0, 0, 2), cena(1, 2, 4)] })
  if (props.includes('titles')) return respostaDoGemini(TEXTOS)
  return respostaDoGemini({ ok: true })
}

globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
  const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url
  if (/\/v1beta\/models\?/.test(url)) {
    chamadas.push('lista')
    return json(200, { models: lista.map((id) => ({ name: `models/${id}`, supportedGenerationMethods: ['generateContent'] })) })
  }
  const m = /\/models\/([^:/]+):generateContent/.exec(url)
  if (!m) throw new Error(`teste: chamada que nao era esperada para ${url}`)
  const id = m[1]!
  chamadas.push(id)
  const j = jeito.get(id)
  if (j === 'cota') {
    return json(429, {
      error: {
        code: 429,
        message: `You exceeded your current quota. Quota exceeded for metric: generate_content_free_tier_requests, limit: 20, model: ${id}`,
        status: 'RESOURCE_EXHAUSTED',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [{ quotaMetric: 'generate_content_free_tier_requests', quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }],
          },
        ],
      },
    })
  }
  if (j === 'lotado') {
    return json(503, {
      error: {
        code: 503,
        message: 'This model is currently experiencing high demand.',
        status: 'UNAVAILABLE',
        details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '0.01s' }],
      },
    })
  }
  if (j && typeof j === 'object') {
    return json(404, {
      error: {
        code: 404,
        message: `This model models/${id} is no longer available to new users. Please update your code to use models/${j.aposentadoPara} for the latest features and improvements.`,
        status: 'NOT_FOUND',
      },
    })
  }
  const corpo = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
  return respostaPara(corpo)
}) as typeof fetch

/** So os generateContent (sem as listas). */
function geracoes(): string[] {
  return chamadas.filter((c) => c !== 'lista')
}

const SIMPLES = z.object({ ok: z.boolean() })
function pedido(permitirReserva?: boolean): PedidoJson<typeof SIMPLES> {
  return { schema: SIMPLES, sistema: 'Responda so com o JSON.', prompt: 'ok = true', etapa: 'teste', ...(permitirReserva === undefined ? {} : { permitirReserva }) }
}

function perto(a: number, b: number, folga = 5_000): boolean {
  return Math.abs(a - b) <= folga
}

// ------------------------------------------------------------- IA falsa do passo 2

interface Pedido {
  etapa: string
  permitirReserva: boolean | undefined
}
const pedidos: Pedido[] = []
/** Os modelos bons estao sem cota: so o reserva responde. */
let soReserva = false
/** Depois de responder o primeiro roteiro, os bons acabam (para a segunda tentativa cair no reserva). */
let acabaDepoisDoPrimeiroRoteiro = false
/** O primeiro roteiro sai curto (60 palavras), para o passo pedir uma segunda tentativa. */
let primeiroRoteiroCurto = false

let indice37: EpisodeIndex

function frase(texto: string, eventoIds: string[], extra: Partial<FraseDaIa> = {}): FraseDaIa {
  return { texto, eventoIds, cueDoMomento: null, intencaoVisual: 'close no Senku', textoDeTela: null, citacaoCueId: null, ...extra }
}

/** N palavras de narracao, em frases de 10. */
function frases(n: number, eventoId: string, prefixo: string): FraseDaIa[] {
  const saida: FraseDaIa[] = []
  for (let sobra = n, i = 0; sobra > 0; i += 1) {
    const k = Math.min(10, sobra)
    saida.push(frase(`${Array.from({ length: k }, (_, j) => (j === 0 ? `${prefixo}${i}` : 'palavra')).join(' ')}.`, [eventoId]))
    sobra -= k
  }
  return saida
}

function eventosFalsos(indice: EpisodeIndex): EventosDaIa {
  const falas = cuesElegiveis(indice)
  const eventos: EventosDaIa['eventos'] = []
  for (let i = 0; i + 4 <= falas.length && eventos.length < 18; i += 12) {
    eventos.push({ cueIds: falas.slice(i, i + 4).map((c) => c.id), resumo: `Senku faz a coisa ${eventos.length + 1}.`, personagens: ['Senku'], peso: 3 })
  }
  return { eventos }
}

/** Gancho de 10 palavras que nenhuma versao anterior teve. */
let ganchoN = 0
function roteiroFalso(palavras: number): RoteiroDaIa {
  ganchoN += 1
  const gancho = `${Array.from({ length: 10 }, (_, j) => (j === 0 ? `Imagina${ganchoN}` : `p${j}x${ganchoN}`)).join(' ')}.`
  const resto = palavras - 10
  const ctx = Math.round(resto * 0.3)
  const meio = Math.round(resto * 0.5)
  return {
    secoes: [
      { papel: 'gancho', frases: [frase(gancho, ['e01'])] },
      { papel: 'contexto', frases: frases(ctx, 'e02', 'Contexto') },
      { papel: 'desenvolvimento', frases: frases(meio, 'e05', 'Meio') },
      { papel: 'fechamento', frases: frases(resto - ctx - meio, 'e09', 'Fim') },
    ],
  }
}

let roteirosRespondidos = 0
async function iaFalsa<S extends z.ZodType>(p: PedidoJson<S>): Promise<RespostaJson<z.infer<S>>> {
  pedidos.push({ etapa: p.etapa, permitirReserva: p.permitirReserva })
  if (soReserva && p.permitirReserva === false) {
    // O que o llm.ts devolve: nenhum modelo chamado.
    return {
      ok: false,
      motivo: 'so-reserva',
      nota: 'Os modelos bons do Gemini acabaram a cota de hoje.',
      bruto: `so reserva livre (${LITE})`,
      provedor: 'gemini',
      reserva: LITE,
      renovaEm: Date.now() + 3_600_000,
      porCota: true,
    }
  }
  const modelo = soReserva ? LITE : 'gemini-3.8-flash'
  let valor: unknown
  if (p.etapa === 'eventos') valor = eventosFalsos(indice37)
  else if (p.etapa === 'roteiro') {
    roteirosRespondidos += 1
    valor = roteiroFalso(primeiroRoteiroCurto && roteirosRespondidos === 1 ? 60 : 160)
    if (acabaDepoisDoPrimeiroRoteiro) soReserva = true
  } else valor = { frases: [frase('Parte nova e bem mais forte, com o Senku no meio.', ['e03'])] } satisfies SecaoDaIa
  const conferido = p.schema.safeParse(valor)
  if (!conferido.success) throw new Error(`resposta falsa fora do schema (${p.etapa})`)
  return { ok: true, valor: conferido.data, provedor: 'gemini', modelo }
}

function desde(n: number): Pedido[] {
  return pedidos.slice(n)
}

function pronto(r: RoteiroGerado): Exclude<RoteiroGerado, { motivo: 'so-reserva' }> {
  if (ehParadaNoReserva(r)) throw new Error('teste: esperava o roteiro, veio a parada no reserva')
  return r
}
function eventosProntos(r: EventosGerados): Exclude<EventosGerados, { motivo: 'so-reserva' }> {
  if (ehParadaNoReserva(r)) throw new Error('teste: esperava os eventos, veio a parada no reserva')
  return r
}

// ------------------------------------------------------------------ roteiro do teste

async function principal(): Promise<void> {
  const pasta = mkdtempSync(join(tmpdir(), 'anirecap-v-reserva-'))
  const cofreFalso: Cofre = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' }
  configureSettings(pasta, cofreFalso)
  // Valores de teste: nenhuma chave de verdade passa por aqui.
  saveSettings({ geminiApiKey: 'chave-falsa-do-teste', iaProvedor: 'gemini', geminiModelo: '', anthropicApiKey: '' })

  try {
    secao('1. Quem e reserva')
    const reservas = ['gemini-3.5-flash-lite', 'gemini-2.0-flash-lite-001', 'gemini-3.5-flash-lite-preview-09-2026', 'gemini-1.5-flash-8b', 'gemini-nano']
    const bons = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3-pro', 'gemini-2.5-flash', 'gemini-3.8-flash-preview', 'gemini-exp-1206']
    confere(reservas.every(ehModeloReserva), `reserva: ${reservas.join(', ')}`)
    confere(!bons.some(ehModeloReserva), `bom (o "mini" de "gemini" nao conta): ${bons.join(', ')}`)
    confere(melhorFlash(['gemini-3.5-flash-lite', 'gemini-3.5-flash'], true) === 'gemini-3.5-flash', 'soBons: o flash cheio')
    confere(melhorFlash(['gemini-3.5-flash-lite'], true) === null && melhorFlash(['gemini-3.5-flash-lite']) === LITE, 'soBons sem bom = null; sem soBons, o lite')
    confere(melhorFlash(['gemini-1.5-flash-8b', 'gemini-1.5-flash']) === 'gemini-1.5-flash', '8b tambem vai para o fim da fila')

    secao('2. llm.ts: so o reserva livre (cota do dia)')
    esquecerModelos()
    lista = ['gemini-3.8-flash', 'gemini-3.5-flash', LITE]
    jeito.clear()
    jeito.set('gemini-3.8-flash', 'cota')
    jeito.set('gemini-3.5-flash', 'cota')
    chamadas = []
    const r1 = await gerarJson(pedido(false))
    confere(!r1.ok && r1.motivo === 'so-reserva', `sem permissao: nota 'so-reserva' (${r1.ok ? 'ok' : r1.motivo ?? r1.nota})`)
    confere(!geracoes().includes(LITE), `o lite NAO foi chamado (${geracoes().join(' -> ')})`)
    confere(geracoes().join() === 'gemini-3.8-flash,gemini-3.5-flash', 'tentou os bons, um de cada vez, sem repetir')
    if (!r1.ok && r1.motivo === 'so-reserva') {
      confere(r1.reserva === LITE && r1.porCota, 'diz qual e o reserva, e que foi a cota')
      confere(perto(r1.renovaEm, Date.now() + msAteRenovarACota()), 'renovaEm = a meia-noite do Pacifico')
      confere(/^Os modelos bons acabaram a cota de hoje \(renova ~[45]h\)$/.test(textoDaParada(r1)), `a frase da tela: "${textoDaParada(r1)}"`)
      confere(r1.nota.length > 0 && r1.bruto.includes(LITE), 'tem nota e bruto, como a falha comum')
    }

    chamadas = []
    const r2 = await gerarJson(pedido(false))
    confere(!r2.ok && r2.motivo === 'so-reserva' && geracoes().length === 0, `de novo: para sem chamar nada (${chamadas.join(', ')})`)

    chamadas = []
    const r3 = await gerarJson(pedido(true))
    confere(r3.ok && r3.modelo === LITE && geracoes().join() === LITE, 'com permissao: vai no lite')

    // Agora o automatico lembra do lite: quem nao aceita reserva nao pode herdar.
    chamadas = []
    const r4 = await gerarJson(pedido(false))
    confere(!r4.ok && r4.motivo === 'so-reserva' && geracoes().length === 0 && chamadas.includes('lista'), 'o lite lembrado pelo automatico nao serve: rele a lista e para')

    // Um modelo bom aparece (cota nova, modelo novo): quem nao aceita reserva vai nele.
    lista = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash', LITE]
    chamadas = []
    const r5 = await gerarJson(pedido(false))
    confere(r5.ok && r5.modelo === 'gemini-3.7-flash' && geracoes().join() === 'gemini-3.7-flash', 'bom livre de novo: vai nele')
    lista = ['gemini-3.8-flash', 'gemini-3.5-flash', LITE]

    secao('3. O resto do app continua no reserva, como antes')
    esquecerModelos()
    chamadas = []
    const textos = await generateMetadata({ texto: 'Frieren volta ao vilarejo e lembra de Himmel.' })
    confere(textos.titles.length === 3 && geracoes().at(-1) === LITE, `metadata: desce ate o lite (${geracoes().join(' -> ')})`)
    chamadas = []
    const transcript = { source: 'srt', words: [], segments: [{ start: 0, end: 4, text: 'Frieren volta.' }], text: 'Frieren volta.', cutCandidates: [] } as any
    const plano = await planWithAI({ imageCount: 2, durationSec: 4, transcript, imageNames: ['a.png', 'b.png'] })
    confere(plano.scenes.length === 2 && geracoes().join() === LITE, `planner: vai no lite (${geracoes().join(' -> ')})`)
    chamadas = []
    const r6 = await gerarJson(pedido())
    confere(r6.ok && r6.modelo === LITE, 'gerarJson sem a opcao: permite reserva (padrao true)')

    secao('4. llm.ts: bons lotados (503), sucessor lite, modelo a mao')
    esquecerModelos()
    jeito.clear()
    lista = ['gemini-3.8-flash', LITE]
    jeito.set('gemini-3.8-flash', 'lotado')
    chamadas = []
    const l1 = await gerarJson(pedido(false))
    confere(!l1.ok && l1.motivo === 'so-reserva' && !l1.porCota, 'lotado: para, e diz que nao e a cota')
    confere(geracoes().join() === 'gemini-3.8-flash,gemini-3.8-flash,gemini-3.8-flash', 'lotado: 1 chamada + 2 retentativas no bom, nenhuma no lite')
    if (!l1.ok && l1.motivo === 'so-reserva') {
      confere(perto(l1.renovaEm, Date.now() + 5 * 60_000), 'volta em ~5 min')
      confere(textoDaParada(l1) === 'Os modelos bons estao lotados (voltam em ~5 min)', `a frase da tela: "${textoDaParada(l1)}"`)
    }

    esquecerModelos()
    jeito.clear()
    jeito.set('gemini-3.8-flash', { aposentadoPara: LITE })
    chamadas = []
    const s1 = await gerarJson(pedido(false))
    confere(!s1.ok && s1.motivo === 'so-reserva' && !geracoes().includes(LITE), 'o 404 sugere o lite: sem permissao, nao vai nele')
    esquecerModelos()
    chamadas = []
    const s2 = await gerarJson(pedido(true))
    confere(s2.ok && s2.modelo === LITE, 'com permissao: segue o sucessor sugerido')

    esquecerModelos()
    jeito.clear()
    saveSettings({ geminiModelo: LITE })
    chamadas = []
    const m1 = await gerarJson(pedido(false))
    confere(m1.ok && m1.modelo === LITE && geracoes().join() === LITE, 'lite escolhido a mao nas configuracoes: e escolha dele, vale')
    saveSettings({ geminiModelo: '' })

    secao('5. A frase da tela')
    const pdt = Date.UTC(2026, 9, 15, 7, 0, 0) // meia-noite no Pacifico em outubro (UTC-7)
    const pst = Date.UTC(2026, 11, 15, 8, 0, 0) // e em dezembro (UTC-8)
    confere(textoDaParada({ porCota: true, renovaEm: pdt }, false, pdt - 3_600_000) === 'Os modelos bons acabaram a cota de hoje (renova ~4h)', 'horario de verao dos EUA: ~4h')
    confere(textoDaParada({ porCota: true, renovaEm: pst }, true, pst - 3_600_000) === 'Modelos bons sem cota hoje (renova ~5h)', 'fora dele: ~5h (curta, a do "Esperar")')
    confere(textoDaParada({ porCota: false, renovaEm: pdt }, false, pdt - 5 * 60_000) === 'Os modelos bons estao lotados (voltam em ~5 min)', 'lotado: em minutos')

    secao('6. gerar/*: eventos e roteiro param antes do reserva')
    configurarEpisodios(pasta)
    saveSettings({ bibliotecaStudio: BIBLIOTECA, libraryDir: '' })
    indice37 = lerIndice(JSON.parse(readFileSync(join(BIBLIOTECA, '_indices', ID_37, 'episodio.json'), 'utf8')))
    const desfazer = trocarIaParaTeste(iaFalsa)
    try {
      const a = await abrirRascunho(ID_37)
      const id = a.rascunho.id
      soReserva = true
      let n = pedidos.length
      const ev = await gerarEventos(id, nada)
      confere(ehParadaNoReserva(ev) && ev.etapa === 'eventos' && ev.reserva === LITE, 'gerarEventos: parada tipada, etapa eventos')
      confere(desde(n).length === 1 && desde(n)[0]!.permitirReserva === false, 'pediu com permitirReserva false')
      confere(lerRascunhoDoDisco(id).eventos.length === 0, 'nada gravado')

      n = pedidos.length
      const ro = await gerarRoteiro(id, { alvoSec: 60 }, nada)
      confere(ehParadaNoReserva(ro) && ro.etapa === 'eventos', 'gerarRoteiro sem eventos: para nos eventos')
      confere(lerRascunhoDoDisco(id).roteiros.length === 0, 'sem versao nova')

      n = pedidos.length
      const aceito = pronto(await gerarRoteiro(id, { alvoSec: 60, aceitouReserva: true }, nada))
      confere(desde(n).map((p) => `${p.etapa}:${p.permitirReserva}`).join() === 'eventos:true,roteiro:true', `aceito: eventos e roteiro com permissao (${desde(n).map((p) => p.etapa).join(', ')})`)
      confere(aceito.roteiro.modelo === LITE && ehModeloReserva(aceito.roteiro.modelo), 'a versao fica marcada com o lite ("Modelo reserva" na tela)')
      confere(aceito.rascunho.eventosMeta?.modelo === LITE, 'os eventos tambem dizem que vieram do lite')

      secao('7. O roteiro aprovado nao muda')
      soReserva = false
      const bom = pronto(await gerarRoteiro(id, { alvoSec: 60 }, nada))
      confere(bom.roteiro.modelo === 'gemini-3.8-flash' && bom.roteiro.versao === 2, 'outra versao com o bom: v2')
      await aprovarRoteiro(id, roteiroAtual(lerRascunhoDoDisco(id))!)
      const antes = readFileSync(join(pastaDosRascunhos(), `${id}.json`), 'utf8')
      soReserva = true
      n = pedidos.length
      const outra = await gerarRoteiro(id, { alvoSec: 60 }, nada)
      confere(ehParadaNoReserva(outra) && outra.etapa === 'roteiro' && desde(n).every((p) => p.permitirReserva === false), '"Outra versao": para, etapa roteiro')
      const refazer = await gerarRoteiro(id, { alvoSec: 60, secaoId: 's2', instrucao: 'mais forte' }, nada)
      confere(ehParadaNoReserva(refazer) && refazer.etapa === 'secao', '"Refazer esta parte": para, etapa secao')
      const depois = lerRascunhoDoDisco(id)
      confere(readFileSync(join(pastaDosRascunhos(), `${id}.json`), 'utf8') === antes, 'o arquivo do rascunho nem foi regravado')
      confere(depois.aprovado && depois.atual === 2 && depois.roteiros.length === 2, 'continua aprovado, na v2, com 2 versoes')

      const usado = pronto(await gerarRoteiro(id, { alvoSec: 60, secaoId: 's2', instrucao: 'mais forte', aceitouReserva: true }, nada))
      confere(usado.roteiro.versao === 3 && usado.roteiro.modelo === LITE && usado.roteiro.derivadoDe === 2, '"Usar modelo reserva" no Refazer: v3 do lite, derivada da v2')

      secao('8. Cache: resposta do reserva nao volta sem permissao')
      // O rascunho novo do mesmo episodio teria os eventos e o 1o roteiro do lite no cache (secao 6).
      soReserva = false
      const novo = await abrirRascunho(ID_37, true)
      n = pedidos.length
      const evNovo = eventosProntos(await gerarEventos(novo.rascunho.id, nada))
      confere(!evNovo.doCache && desde(n).length === 1 && evNovo.rascunho.eventosMeta?.modelo === 'gemini-3.8-flash', 'eventos do lite no cache: ignorados, o bom foi chamado')
      n = pedidos.length
      const roNovo = pronto(await gerarRoteiro(novo.rascunho.id, { alvoSec: 60 }, nada))
      confere(!roNovo.doCache && desde(n).length === 1 && roNovo.roteiro.modelo === 'gemini-3.8-flash', 'roteiro do lite no cache: ignorado tambem')
      // Agora o cache tem a resposta do bom: com so o reserva livre, ela serve sem perguntar.
      soReserva = true
      const outroNovo = await abrirRascunho(ID_37, true)
      n = pedidos.length
      const doCache = pronto(await gerarRoteiro(outroNovo.rascunho.id, { alvoSec: 60 }, nada))
      confere(doCache.doCache && desde(n).length === 0 && doCache.roteiro.modelo === 'gemini-3.8-flash', 'resposta do bom no cache: serve, sem chamar e sem parar')

      secao('9. Segunda tentativa no reserva: fica a primeira')
      soReserva = false
      primeiroRoteiroCurto = true
      acabaDepoisDoPrimeiroRoteiro = true
      roteirosRespondidos = 0
      n = pedidos.length
      const segunda = await gerarRoteiro(id, { alvoSec: 60 }, nada)
      confere(!ehParadaNoReserva(segunda), 'nao pergunta: ja havia uma resposta boa')
      confere(desde(n).map((p) => p.etapa).join() === 'roteiro,roteiro' && desde(n)[1]!.permitirReserva === false, 'a segunda tentativa pediu sem permissao e parou')
      confere(!ehParadaNoReserva(segunda) && segunda.roteiro.modelo === 'gemini-3.8-flash', 'a versao e a do bom (curta, com o aviso de tamanho)')
      primeiroRoteiroCurto = false
      acabaDepoisDoPrimeiroRoteiro = false
    } finally {
      desfazer()
    }
  } finally {
    esquecerModelos()
    rmSync(pasta, { recursive: true, force: true })
  }
  logDeVerdade(falhas === 0 ? '\ntudo certo' : `\n${falhas} falha(s)`)
  process.exit(falhas === 0 ? 0 : 1)
}

principal().catch((err: unknown) => {
  logDeVerdade('ERRO', err)
  process.exit(1)
})
