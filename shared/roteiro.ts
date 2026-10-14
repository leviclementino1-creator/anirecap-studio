import { z } from 'zod'
import type { Cue, EpisodeIndex, Exclusao, Plano } from './episodio'
// So o schema do passo 3: voz.ts importa daqui apenas TIPOS, entao nao ha ciclo de valor.
import { estadoDaVozSchema } from './voz'

/**
 * O ROTEIRO, do jeito que o Studio o entende: o contrato do passo 2 do
 * assistente "Gerar recap" (Episodio -> Roteiro -> Voz -> Cenas).
 *
 * Fonte unica da verdade para os dois lados:
 *   - o cerebro (electron/services/gerar/*): prompts, chamadas ao Gemini,
 *     cache, rascunho em disco;
 *   - a interface (src/components/gerar/*, src/store/gerar*.ts): mostra,
 *     edita, pede outra versao e aprova.
 *
 * O caminho: o indice do episodio (shared/episodio.ts) -> EVENTOS (o que
 * acontece, cada um preso as falas que o provam) -> ROTEIRO (secoes com papel,
 * frases que citam eventos). Tudo fica num RASCUNHO DO RECAP gravado em
 * <userData>/recaps/<id>.json, versionado, para fechar e reabrir o app e
 * voltar onde parou. Na parte 4 o roteiro aprovado vira o roteiro do projeto
 * (a fonte da verdade das legendas, como no Dangai).
 *
 * REGRA DURA: tempo nunca vem do LLM. O LLM cita cueIds; t0/t1 saem das cues
 * do indice (montarEventos). Uma frase sabe "de que momento do episodio ela
 * fala" pelos eventos que cita (momentoDaFrase).
 *
 * Os tipos saem de z.infer, como em episodio.ts. channels.ts so importa TIPOS
 * daqui (`import type`): este arquivo puxa zod, e o preload tem que ficar
 * pequeno. As funcoes puras do fim rodam igual no main e no renderer.
 */

/**
 * Sobe quando a forma do <id>.json muda de um jeito que o leitor antigo nao entende.
 * 2 = ganhou `voz` (o passo 3, shared/voz.ts). O v1 ainda abre: le como v2 com
 * `voz: null` e e gravado como v2 na proxima mudanca.
 */
export const RASCUNHO_VERSAO = 2 as const

/** As versoes que o leitor entende; todas sobem para RASCUNHO_VERSAO ao ler. */
const versaoDoRascunhoSchema = z.literal([1, RASCUNHO_VERSAO]).transform((): typeof RASCUNHO_VERSAO => RASCUNHO_VERSAO)

/**
 * Ritmo da narracao falada em PT-BR, medido no AniRecap: ~2,7 palavras por
 * segundo. 60 s ~ 162 palavras, 90 s ~ 243.
 */
export const PALAVRAS_POR_SEGUNDO = 2.7

/** Quantos eventos pedir ao LLM. Fora disso e aviso, nao erro. */
export const EVENTOS_MIN = 15
export const EVENTOS_MAX = 40

/**
 * Texto de tela: 1 ou 2 palavras DE CONTEUDO (o Levi prefere pouco texto na
 * tela). Artigo e preposicao nao contam: "MAQUINA DO TEMPO" e "RUMO A LUA"
 * sao 2 -- contados como 3, o rotulo natural do episodio era apagado.
 */
export const TEXTO_DE_TELA_MAX_PALAVRAS = 2

/** Teto da instrucao curta do "Refazer esta parte" ("mais forte", "mais curto"). */
export const INSTRUCAO_MAX = 200

// --------------------------------------------------------------------- alvo

/** Duracao-alvo do short, em segundos. So estas duas por enquanto. */
export const ALVOS_SEC = [60, 90] as const
export const alvoSecSchema = z.union([z.literal(60), z.literal(90)])
export type AlvoSec = z.infer<typeof alvoSecSchema>
export const ALVO_PADRAO: AlvoSec = 60

/**
 * A faixa de palavras aceita para um alvo. `alvo` e o que se pede ao LLM;
 * fora de [min, max] o validarRoteiro avisa (nao bloqueia a aprovacao). O
 * minimo e 92% do alvo (149 em 60 s, 224 em 90 s): com 85% um roteiro de
 * ~51 s passava como "60 s" sem aviso.
 */
export function faixaDePalavras(alvoSec: AlvoSec): { min: number; alvo: number; max: number } {
  const alvo = Math.round(alvoSec * PALAVRAS_POR_SEGUNDO)
  return { min: Math.round(alvo * 0.92), alvo, max: Math.round(alvo * 1.12) }
}

// ------------------------------------------------------------------- eventos

/**
 * Um ACONTECIMENTO do episodio, preso ao TRECHO de falas que o prova.
 *
 * `cueIds` so de cues de FALA fora das exclusoes (OP/ED, previa...), em ordem
 * de tempo: TODAS as do trecho, da primeira a ultima que o LLM citou (ver
 * montarEventos). `t0`/`t1` (segundos de reproducao do .mkv, a mesma base do
 * indice) sao o inicio da primeira e o fim da ultima dessas cues -- calculados
 * por montarEventos, nunca pelo LLM.
 */
export const eventoSchema = z.object({
  /** 'e01', 'e02'... na ordem de t0. Estavel dentro do rascunho. */
  id: z.string().regex(/^e\d{2,}$/),
  cueIds: z.array(z.string().regex(/^c\d{4,}$/)).min(1),
  /**
   * Impressao do texto das cues (assinaturaDasFalas). O id da cue e POSICIONAL
   * ('c0012' = 12a fala): trocar a faixa de legenda no passo 1 faz o mesmo id
   * apontar para outra fala, e so o texto denuncia. Ausente = evento de antes
   * desta marca (cueIds esparsos, sem como conferir o texto).
   */
  assinatura: z.string().optional(),
  t0: z.number().nonnegative(),
  t1: z.number().nonnegative(),
  /** Uma ou duas frases neutras, em PT-BR: o que acontece. */
  resumo: z.string().min(1),
  /** Quem esta envolvido, com o nome como aparece nas falas/elenco. */
  personagens: z.array(z.string()),
  /** 1 = detalhe, 5 = o momento que segura o episodio. */
  peso: z.number().int().min(1).max(5),
})
export type Evento = z.infer<typeof eventoSchema>

// ------------------------------------------------------------------- roteiro

/**
 * O papel de cada secao no arco do short. Gancho abre; fechamento deixa o
 * gancho para o proximo. Pode repetir (dois "desenvolvimento" seguidos).
 */
export const papelDaSecaoSchema = z.enum(['gancho', 'contexto', 'desenvolvimento', 'virada', 'climax', 'fechamento'])
export type PapelDaSecao = z.infer<typeof papelDaSecaoSchema>
export const PAPEIS: readonly PapelDaSecao[] = papelDaSecaoSchema.options

/** Rotulos de tela (ASCII, como o resto da interface). */
export const ROTULO_DO_PAPEL: Record<PapelDaSecao, string> = {
  gancho: 'Gancho',
  contexto: 'Contexto',
  desenvolvimento: 'Desenvolvimento',
  virada: 'Virada',
  climax: 'Climax',
  fechamento: 'Fechamento',
}

/**
 * Quantas FRASES pedir por papel. O modelo nao conta palavras, conta frases:
 * pedindo so "243 palavras" o de 90 s saia com 149 e, no ajuste, 196 (18
 * frases contra ~25). Frase media de ~9-10 palavras: 18 frases ~ 162, 25 ~ 243.
 */
export const FRASES_POR_PAPEL: Record<AlvoSec, Record<PapelDaSecao, number>> = {
  60: { gancho: 2, contexto: 2, desenvolvimento: 7, virada: 2, climax: 3, fechamento: 2 },
  90: { gancho: 2, contexto: 3, desenvolvimento: 11, virada: 3, climax: 4, fechamento: 2 },
}

/** Uma frase FALADA do roteiro. Um ponto final encerra uma frase (regra do Dangai). */
export const fraseSchema = z.object({
  /** 'f01', 'f02'... unico no roteiro inteiro (nao por secao). Ver proximoId. */
  id: z.string().regex(/^f\d{2,}$/),
  /** O que o narrador fala. Pode estar vazio so durante a edicao (validarRoteiro barra). */
  texto: z.string(),
  /**
   * De onde vem a informacao. O PRIMEIRO e o que a tela mostra. Vazio = frase
   * generica (aviso, herda a vizinha na parte 4).
   */
  eventoIds: z.array(z.string()),
  /**
   * A fala do INSTANTE que a tela deve mostrar enquanto a frase e dita, entre
   * as cues dos eventos citados. Sem ela o momento era a primeira fala do
   * primeiro evento -- muitas vezes outra cena ("casaram" caia na conversa de
   * antes do casamento). null = a primeira fala do evento. Rascunho de antes
   * desta marca le como null.
   */
  cueDoMomento: z.string().nullable().default(null),
  /** O que deveria aparecer na tela ("close no Senku sorrindo"). Guia a escolha de cena. */
  intencaoVisual: z.string(),
  /** 1-2 palavras queimadas na tela. null = nada. */
  textoDeTela: z.string().nullable(),
  /** Quando a frase cita uma fala literal: a cue dela. null = nao cita. */
  citacaoCueId: z.string().nullable(),
})
export type Frase = z.infer<typeof fraseSchema>

export const secaoSchema = z.object({
  /** 's1', 's2'... unico no roteiro. */
  id: z.string().regex(/^s\d+$/),
  papel: papelDaSecaoSchema,
  /** Vazio so durante a edicao (validarRoteiro barra). */
  frases: z.array(fraseSchema),
})
export type Secao = z.infer<typeof secaoSchema>

/** O que gerou uma versao 'ia'. null numa versao 'editado'. */
export const pedidoDaVersaoSchema = z.object({
  /** inteiro = "Outra versao" (ou a primeira); secao = "Refazer esta parte". */
  tipo: z.enum(['inteiro', 'secao']),
  secaoId: z.string().nullable(),
  /** A instrucao curta que veio junto ("mais forte"). null = sem instrucao. */
  instrucao: z.string().nullable(),
})
export type PedidoDaVersao = z.infer<typeof pedidoDaVersaoSchema>

/**
 * Uma VERSAO do roteiro. O rascunho guarda todas (historico) e aponta a da
 * tela em `atual`.
 */
export const roteiroSchema = z.object({
  /** Numero da versao no historico do rascunho: 1, 2, 3... nunca reaproveitado. */
  versao: z.number().int().positive(),
  alvoSec: alvoSecSchema,
  secoes: z.array(secaoSchema),
  /** O modelo que escreveu (numa 'editado', o da versao de onde ela saiu). */
  modelo: z.string(),
  /** ISO. Numa 'editado', quando foi gravada a ultima edicao. */
  criadoEm: z.string(),
  /** ia = como o LLM devolveu (ja reparado). editado = mexido a mao. */
  origem: z.enum(['ia', 'editado']),
  /** A versao de onde esta saiu (edicao ou "Refazer esta parte"). null = do zero. */
  derivadoDe: z.number().int().positive().nullable().default(null),
  pedido: pedidoDaVersaoSchema.nullable().default(null),
})
export type Roteiro = z.infer<typeof roteiroSchema>

// ------------------------------------------------------------------ rascunho

/**
 * O RASCUNHO DO RECAP: tudo que os passos 2 (roteiro) e 3 (voz) produzem, gravado em
 * <userData>/recaps/<id>.json (escrita atomica, como o episodio.json).
 *
 * Um rascunho por episodio por enquanto: abrirRascunho(episodioId) reabre o
 * mais recente daquele episodio, ou cria.
 */
const rascunhoBase = z.object({
  versao: versaoDoRascunhoSchema,
  /** 'rc_' + 12 hex do episodio + '_' + carimbo base36. Seguro para nome de arquivo. */
  id: z.string().regex(/^rc_[0-9a-z_]+$/),
  episodioId: z.string().regex(/^ep_[0-9a-f]{40}$/),
  /**
   * Onde o episodio.json estava quando o rascunho foi gravado. E so dica: se
   * a biblioteca mudou de lugar, o main acha pelo episodioId (abrirIndicePorId).
   */
  indicePath: z.string(),
  /** Para a lista de rascunhos: 'Dr STONE S04E24'. */
  titulo: z.string(),
  /** O ultimo alvo pedido (o seletor 60/90 da tela comeca nele). */
  alvoSec: alvoSecSchema,
  /**
   * Vazio = ainda nao gerados. Fixos depois de gerados: os roteiros citam
   * estes ids. Falas trocadas (eventosOrfaos) = um rascunho NOVO, nunca
   * eventos novos aqui -- as versoes antigas passariam a citar outro evento
   * com o mesmo id.
   */
  eventos: z.array(eventoSchema),
  /** Modelo e hora dos eventos. null = ainda nao gerados. */
  eventosMeta: z.object({ modelo: z.string(), criadoEm: z.string() }).nullable(),
  /**
   * Historico, em ordem de versao. So encolhe num caso: a 'editado' do fim
   * que volta a ser igual a versao de onde saiu (60 -> 90 -> 60) sai, em vez
   * de ficar como copia (aplicarEdicao). Voltar so muda `atual`.
   */
  roteiros: z.array(roteiroSchema),
  /** A versao na tela. null = nenhum roteiro ainda. */
  atual: z.number().int().positive().nullable(),
  /** O roteiro `atual` foi aprovado. Qualquer edicao ou troca de versao desaprova. */
  aprovado: z.boolean(),
  aprovadoEm: z.string().nullable(),
  criadoEm: z.string(),
  atualizadoEm: z.string(),
  /**
   * O passo 3 (Voz): takes, o atual e a aprovacao. null = o passo 3 nunca
   * rodou (e como um rascunho v1 le). As transicoes daqui (editar, trocar de
   * versao, aprovar o roteiro) NAO mexem nela: quem diz se ela ficou velha e
   * situacaoDaVoz/frasesMudadas, pelo texto falado.
   */
  voz: estadoDaVozSchema.nullable().default(null),
})

export const rascunhoDoRecapSchema = rascunhoBase.superRefine((r, ctx) => {
  const versoes = new Set<number>()
  for (const [i, rot] of r.roteiros.entries()) {
    if (versoes.has(rot.versao)) {
      ctx.addIssue({ code: 'custom', path: ['roteiros', i, 'versao'], message: `versao repetida: ${rot.versao}` })
    }
    versoes.add(rot.versao)
  }
  if (r.atual !== null && !versoes.has(r.atual)) {
    ctx.addIssue({ code: 'custom', path: ['atual'], message: `versao atual inexistente: ${r.atual}` })
  }
  if (r.aprovado && r.atual === null) {
    ctx.addIssue({ code: 'custom', path: ['aprovado'], message: 'aprovado sem roteiro' })
  }
  const eventos = new Set<string>()
  for (const [i, ev] of r.eventos.entries()) {
    if (eventos.has(ev.id)) ctx.addIssue({ code: 'custom', path: ['eventos', i, 'id'], message: `evento repetido: ${ev.id}` })
    eventos.add(ev.id)
    if (ev.t1 < ev.t0) ctx.addIssue({ code: 'custom', path: ['eventos', i], message: `evento ${ev.id} termina antes de comecar` })
  }
})
export type RascunhoDoRecap = z.infer<typeof rascunhoDoRecapSchema>

/** Le um <id>.json cru. Lanca com a mensagem do zod quando nao confere. */
export function lerRascunho(cru: unknown): RascunhoDoRecap {
  return rascunhoDoRecapSchema.parse(cru)
}

/** Uma linha da lista de rascunhos (para reabrir onde parou). */
export interface ResumoDoRascunho {
  id: string
  episodioId: string
  titulo: string
  atualizadoEm: string
  eventos: number
  versoes: number
  /** Palavras do roteiro atual. null = sem roteiro. */
  palavras: number | null
  aprovado: boolean
}

// ------------------------------------------------------------ modelo reserva

/**
 * Os modelos RESERVA do Gemini: lite, nano, 8b e parecidos, pelo id. O resto e
 * "bom". Quando a cota gratis dos bons acaba, o automatico do llm.ts desce ate
 * eles -- e o roteiro do 3.5-flash-lite sai chapado, lista de fatos (o Levi
 * comparou lado a lado em 13/10/2026). Por isso o passo 2 pergunta antes de
 * usar um.
 *
 * A palavra tem que vir separada por hifen/ponto: "gemini" tem "mini" dentro.
 * Mora aqui, e nao no llm.ts, porque a tela marca "Modelo reserva" pelo mesmo
 * criterio.
 */
export function ehModeloReserva(modelo: string): boolean {
  return /(?:^|[-_./])(?:lite|nano|mini|tiny|\d+b)(?=$|[-_./])/i.test(modelo)
}

// ------------------------------------------------------- pedidos e respostas

/**
 * O pedido de gerarRoteiro.
 * - sem `secaoId`: "Outra versao" (ou a primeira) -- o roteiro inteiro de novo;
 * - com `secaoId`: "Refazer esta parte" -- so aquela secao da versao atual, o
 *   resto igual. `alvoSec` vale para o tamanho da secao.
 */
export const pedidoDeRoteiroSchema = z.object({
  alvoSec: alvoSecSchema,
  /** Instrucao curta opcional ("mais forte", "mais curto"). */
  instrucao: z.string().max(INSTRUCAO_MAX).nullable().optional(),
  secaoId: z.string().nullable().optional(),
  /**
   * O roteiro como esta NA TELA, quando a tela tem edicao ainda nao gravada.
   * O main grava antes (mesma regra do salvarRoteiro) e so depois gera: assim
   * o "Refazer esta parte" nunca joga fora o que foi digitado.
   */
  base: roteiroSchema.nullable().optional(),
  /**
   * Quem pediu, para o Cancelar (cancelarRoteiro): a resposta de um pedido
   * cancelado vai SO para o historico, sem trocar a versao da tela nem tirar
   * a aprovacao.
   */
  pedidoId: z.string().max(64).nullable().optional(),
  /**
   * O usuario aceitou o modelo reserva (o "Usar modelo reserva" da tela). Sem
   * isto, quando so sobra reserva, o pedido PARA antes de chamar a IA e volta
   * como ParadoNoReserva. Vale para o pedido inteiro: eventos e roteiro.
   */
  aceitouReserva: z.boolean().optional(),
})
export type PedidoDeRoteiro = z.infer<typeof pedidoDeRoteiroSchema>

/** O que abrirRascunho devolve: o rascunho e o indice do episodio (caminhos ja corrigidos). */
export interface RascunhoAberto {
  rascunho: RascunhoDoRecap
  indice: EpisodeIndex
  /**
   * Recados para a tela, em ASCII: eventos que citam fala que nao existe mais
   * no indice (legenda trocada no passo 1), indice que mudou de lugar...
   */
  avisos: string[]
}

/**
 * O pedido PAROU antes de chamar o modelo reserva: os bons estao sem cota (ou
 * lotados) e o pedido nao trazia `aceitouReserva`. Nada foi gravado -- o
 * rascunho, a versao atual e a aprovacao ficam como estavam. A tela pergunta
 * ("Usar modelo reserva" / "Esperar") e, se ele aceitar, refaz o MESMO pedido
 * com `aceitouReserva: true`.
 *
 * Volta como resposta (e nao como erro) para atravessar o IPC com tipo: o
 * erro vira so texto no caminho.
 */
export interface ParadoNoReserva {
  motivo: 'so-reserva'
  /** Onde parou: lendo o episodio (eventos), escrevendo, ou refazendo uma parte. */
  etapa: EtapaDoRoteiro
  /**
   * Date.now() de quando um modelo bom deve voltar: a cota do dia renova a
   * meia-noite do Pacifico (~4h em Brasilia no horario de verao dos EUA, 5h
   * fora dele); lotado volta em minutos.
   */
  renovaEm: number
  /** true = acabou a cota do dia; false = lotados ou lentos agora (volta em minutos). */
  porCota: boolean
  /** O reserva que atenderia ("gemini-3.5-flash-lite"), para o tooltip. */
  reserva: string
}

/** A resposta e a parada no reserva? (gerarEventos e gerarRoteiro devolvem as duas). */
export function ehParadaNoReserva(x: object): x is ParadoNoReserva {
  return (x as { motivo?: unknown }).motivo === 'so-reserva'
}

/** Um horario em "~4h" ou "~4h30", na hora local (a de quem esta na frente da tela). */
function horaCurta(quando: number): string {
  const d = new Date(Math.round(quando / 60_000) * 60_000)
  const m = d.getMinutes()
  return `~${d.getHours()}h${m === 0 ? '' : String(m).padStart(2, '0')}`
}

/**
 * A frase da parada no reserva: por que parou e quando os modelos bons
 * voltam. A cota do dia renova a meia-noite do Pacifico (~4h no Brasil com o
 * horario de verao dos EUA); lotado volta em minutos. `curto` = a do cartao
 * "Sem roteiro", depois do "Esperar".
 */
export function textoDaParada(
  p: Pick<ParadoNoReserva, 'porCota' | 'renovaEm'>,
  curto = false,
  agora = Date.now(),
): string {
  const minutos = Math.max(1, Math.ceil((p.renovaEm - agora) / 60_000))
  if (p.porCota) {
    const quando = horaCurta(p.renovaEm)
    return curto ? `Modelos bons sem cota hoje (renova ${quando})` : `Os modelos bons acabaram a cota de hoje (renova ${quando})`
  }
  const volta = minutos > 60 ? horaCurta(p.renovaEm) : `em ~${minutos} min`
  return curto ? `Modelos bons lotados (voltam ${volta})` : `Os modelos bons estao lotados (voltam ${volta})`
}

export type EventosGerados = EventosProntos | ParadoNoReserva

export interface EventosProntos {
  rascunho: RascunhoDoRecap
  /** Veio do cache de IA (nao gastou cota). */
  doCache: boolean
  /** O que montarEventos descartou ou consertou, em ASCII. */
  avisos: string[]
}

export type RoteiroGerado = RoteiroPronto | ParadoNoReserva

export interface RoteiroPronto {
  rascunho: RascunhoDoRecap
  /** A versao nova (ja e a `atual` do rascunho, menos com `soNoHistorico`). */
  roteiro: Roteiro
  doCache: boolean
  /**
   * O pedido foi cancelado antes de a resposta chegar: a versao entrou so no
   * historico (Versoes), e a `atual` e a aprovacao ficaram como estavam.
   */
  soNoHistorico: boolean
  /** Reparos feitos na saida do LLM + os avisos do validarRoteiro, em ASCII. */
  avisos: string[]
}

/** Etapas que o andamento mostra. */
export const ROTULO_DA_ETAPA_DO_ROTEIRO = {
  eventos: 'Lendo o episodio',
  roteiro: 'Escrevendo o roteiro',
  secao: 'Refazendo a parte',
} as const
export type EtapaDoRoteiro = keyof typeof ROTULO_DA_ETAPA_DO_ROTEIRO

/** main -> renderer, varias vezes por chamada lenta (gerarEventos/gerarRoteiro). */
export interface ProgressoDoRoteiro {
  rascunhoId: string
  etapa: EtapaDoRoteiro
  /** Frase pronta, ASCII: "Pedindo os eventos ao Gemini...", "Modelo lotado, tentando outro...". */
  mensagem: string
}

// ---------------------------------------------------------- saida do LLM

/*
 * O que o LLM devolve. FECHADO e SEM default (saida estruturada exige isso nos
 * dois provedores, ver llm.ts) e FROUXO: a resposta inteira passa pelo zod, e
 * um peso 6 nao pode derrubar a chamada. Quem aperta e montarEventos /
 * roteiroDaIa, que consertam o que der e avisam.
 */

export const eventosDaIaSchema = z.object({
  eventos: z.array(
    z.object({
      cueIds: z.array(z.string()),
      resumo: z.string(),
      personagens: z.array(z.string()),
      peso: z.number(),
    }),
  ),
})
export type EventosDaIa = z.infer<typeof eventosDaIaSchema>

export const fraseDaIaSchema = z.object({
  texto: z.string(),
  eventoIds: z.array(z.string()),
  cueDoMomento: z.string().nullable(),
  intencaoVisual: z.string(),
  textoDeTela: z.string().nullable(),
  citacaoCueId: z.string().nullable(),
})
export type FraseDaIa = z.infer<typeof fraseDaIaSchema>

export const roteiroDaIaSchema = z.object({
  secoes: z.array(z.object({ papel: papelDaSecaoSchema, frases: z.array(fraseDaIaSchema) })),
})
export type RoteiroDaIa = z.infer<typeof roteiroDaIaSchema>

/** "Refazer esta parte": so as frases novas; o papel e o da secao refeita. */
export const secaoDaIaSchema = z.object({ frases: z.array(fraseDaIaSchema) })
export type SecaoDaIa = z.infer<typeof secaoDaIaSchema>

// ============================================================ funcoes puras

// ------------------------------------------------------------------ contagem

/** Palavras faladas: pedacos separados por espaco com pelo menos uma letra ou numero. */
export function contarPalavras(texto: string): number {
  let n = 0
  for (const pedaco of texto.split(/\s+/)) if (/[\p{L}\p{N}]/u.test(pedaco)) n += 1
  return n
}

/** Artigo, preposicao e contracao: nao contam como palavra do texto de tela. */
const PALAVRAS_DE_LIGACAO = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
  'ao', 'aos', 'pra', 'pro', 'para', 'por', 'pelo', 'pela', 'com', 'e',
])

/** Minusculas, sem acento: a forma de comparar texto em portugues e ingles. */
export function semAcentos(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** As palavras (letras e numeros) de um texto, na forma de comparar. */
function palavrasDe(texto: string): string[] {
  return semAcentos(texto).match(/[\p{L}\p{N}]+/gu) ?? []
}

/**
 * Palavras DE CONTEUDO do texto de tela: "MAQUINA DO TEMPO" = 2, "RUMO A
 * LUA" = 2. E esta a conta do limite de 2 (TEXTO_DE_TELA_MAX_PALAVRAS).
 */
export function palavrasDeTela(texto: string): number {
  return palavrasDe(texto).filter((p) => !PALAVRAS_DE_LIGACAO.has(p)).length
}

/** Abreviacoes que terminam em ponto e NAO encerram frase. */
const ABREVIACOES = /(?:^|\s)(?:Dr|Dra|Sr|Sra|Srta|Prof|Profa|Mr|Mrs|Ms|St|Jr|vs|etc)\.$/i

/**
 * As frases de um texto, pela regra do Dangai (o ponto final encerra a frase
 * e a cena). Divide depois de . ! ? ou reticencias seguidos de espaco e de
 * letra maiuscula, numero ou aspas -- menos depois de abreviacao de titulo
 * ("Dr. Stone"). Mora aqui (e nao so no main) porque a tela usa para avisar
 * de uma edicao com duas frases num item.
 */
export function dividirEmFrases(texto: string): string[] {
  const limpo = texto.replace(/\s+/g, ' ').trim()
  if (!limpo) return []
  const partes: string[] = []
  let inicio = 0
  const fim = /[.!?…]+["”']?\s+(?=["“']?[\p{Lu}\p{N}])/gu
  for (let m = fim.exec(limpo); m; m = fim.exec(limpo)) {
    const corte = m.index + m[0].trimEnd().length
    const pedaco = limpo.slice(inicio, corte)
    if (ABREVIACOES.test(pedaco)) continue
    partes.push(pedaco.trim())
    inicio = m.index + m[0].length
  }
  const resto = limpo.slice(inicio).trim()
  if (resto) partes.push(resto)
  return partes
}

/** Palavras do roteiro inteiro (todas as frases de todas as secoes). */
export function palavrasDoRoteiro(roteiro: Pick<Roteiro, 'secoes'>): number {
  let n = 0
  for (const secao of roteiro.secoes) for (const frase of secao.frases) n += contarPalavras(frase.texto)
  return n
}

/** Segundos de narracao estimados para N palavras (sem arredondar; a tela arredonda). */
export function duracaoEstimada(palavras: number): number {
  return palavras / PALAVRAS_POR_SEGUNDO
}

/** 723.4 -> '12:03'. Tempo de tela, para frase e evento. */
export function formatarTempo(seg: number): string {
  const s = Math.max(0, Math.floor(seg))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ------------------------------------------------------------------- ids

/**
 * O proximo id livre com o prefixo: proximoId('f', ['f01', 'f07']) -> 'f08'.
 * Eventos e frases com 2 digitos no minimo ('f01'); secoes sem preenchimento ('s3').
 */
export function proximoId(prefixo: 'e' | 'f' | 's', usados: Iterable<string>): string {
  let maior = 0
  for (const id of usados) {
    if (!id.startsWith(prefixo)) continue
    const n = Number(id.slice(1))
    if (Number.isInteger(n) && n > maior) maior = n
  }
  const n = maior + 1
  return prefixo === 's' ? `s${n}` : `${prefixo}${String(n).padStart(2, '0')}`
}

/** Todos os ids de frase do roteiro, para proximoId('f', ...). */
export function idsDeFrase(roteiro: Pick<Roteiro, 'secoes'>): string[] {
  return roteiro.secoes.flatMap((s) => s.frases.map((f) => f.id))
}

/** Uma frase em branco com id livre (o "+ Frase" da tela). */
export function fraseVazia(roteiro: Pick<Roteiro, 'secoes'>): Frase {
  return {
    id: proximoId('f', idsDeFrase(roteiro)),
    texto: '',
    eventoIds: [],
    cueDoMomento: null,
    intencaoVisual: '',
    textoDeTela: null,
    citacaoCueId: null,
  }
}

/** 'rc_' + 12 hex do episodio + '_' + carimbo base36 (ms). */
export function idDoRascunho(episodioId: string, agoraMs: number): string {
  return `rc_${episodioId.slice(3, 15)}_${Math.max(0, Math.floor(agoraMs)).toString(36)}`
}

// ------------------------------------------------------------- cues e eventos

/** A cue cai numa exclusao: o meio dela esta dentro do trecho. */
export function cueExcluida(cue: Pick<Cue, 'start' | 'end'>, exclusoes: readonly Pick<Exclusao, 'start' | 'end'>[]): boolean {
  const meio = (cue.start + cue.end) / 2
  return exclusoes.some((e) => meio >= e.start && meio < e.end)
}

/**
 * As cues que podem provar um evento: so FALA (placa e musica ficam de fora)
 * e fora das exclusoes do indice. Valem as exclusoes que a regua mostra --
 * sugeridas e confirmadas: o que o passo 1 deixou marcado e o que fica de fora.
 */
export function cuesElegiveis(indice: Pick<EpisodeIndex, 'cues' | 'exclusoes'>): Cue[] {
  return indice.cues.filter((c) => c.tipo === 'fala' && !cueExcluida(c, indice.exclusoes))
}

/**
 * O id de uma cue citada pelo LLM. Ele copia do jeito que o prompt mostra
 * ("c0012 0:31", "[c0012]"): fica so o id. Sem id nenhum, o texto aparado
 * (vai ser recusado como inexistente).
 */
export function idDaCueCitada(citado: string): string {
  return /c\d{4,}/.exec(citado)?.[0] ?? citado.trim()
}

/**
 * Pontuacao que fecha a fala. Sem ela a legenda partiu a frase no meio
 * ("Concerns about public safety" / "have been on the rise..."), e a fala
 * seguinte e a que da o sentido. Travessao conta: e fala interrompida.
 */
const FECHA_A_FALA = /[.!?…\-—–♪]["'”’)\]]*$/

/** Ate quantas falas seguintes completam uma fala cortada no meio, e com que folga entre elas. */
const COMPLETAR_ATE = 2
const COMPLETAR_FOLGA_SEC = 4

/**
 * O TRECHO das falas citadas: todas as cues elegiveis da primeira a ultima
 * citada (em ordem de tempo), e a ultima completada com a seguinte quando
 * termina sem pontuacao. O LLM citava falas salteadas e cortava a frase da
 * legenda no meio -- o roteirista lia "Concerns about public safety" sem o
 * "have been on the rise" e escrevia o contrario.
 */
export function cuesDoTrecho(cueIds: readonly string[], indice: Pick<EpisodeIndex, 'cues' | 'exclusoes'>): Cue[] {
  return trechoNasElegiveis(cueIds, cuesElegiveis(indice))
}

function trechoNasElegiveis(cueIds: readonly string[], elegiveis: readonly Cue[]): Cue[] {
  const pos = new Map(elegiveis.map((c, i) => [c.id, i]))
  let ini = Infinity
  let fim = -1
  for (const id of cueIds) {
    const i = pos.get(id.trim())
    if (i === undefined) continue
    if (i < ini) ini = i
    if (i > fim) fim = i
  }
  if (fim < 0) return []
  for (let extra = 0; extra < COMPLETAR_ATE && fim + 1 < elegiveis.length; extra++) {
    const ultima = elegiveis[fim]!
    const seguinte = elegiveis[fim + 1]!
    if (FECHA_A_FALA.test(ultima.texto.trim()) || seguinte.start - ultima.end > COMPLETAR_FOLGA_SEC) break
    fim += 1
  }
  return elegiveis.slice(ini, fim + 1)
}

/**
 * As cues de um evento, para a tela e para o prompt. O evento com assinatura
 * ja guarda o trecho inteiro; o de antes dela (cueIds esparsos) e completado
 * na hora, do mesmo jeito que o montarEventos faz hoje.
 */
export function cuesDoEvento(
  evento: Pick<Evento, 'cueIds' | 'assinatura'>,
  indice: Pick<EpisodeIndex, 'cues' | 'exclusoes'>,
): Cue[] {
  if (evento.assinatura === undefined) return cuesDoTrecho(evento.cueIds, indice)
  const porId = new Map(indice.cues.map((c) => [c.id, c]))
  return evento.cueIds.map((id) => porId.get(id)).filter((c): c is Cue => c !== undefined)
}

/**
 * Impressao do texto das cues (FNV-1a de 32 bits, em hex). Roda igual no main
 * e no renderer (sem crypto do Node). E o que denuncia a faixa de legenda
 * trocada: o mesmo id com outro texto.
 */
export function assinaturaDasFalas(cues: readonly Pick<Cue, 'id' | 'texto'>[]): string {
  const texto = cues.map((c) => `${c.id}\u0001${c.texto}`).join('\u0002')
  let h = 0x811c9dc5
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * Falas citadas dos dois lados de uma exclusao (a OP no meio do evento): fica
 * o lado com mais falas (empate: o primeiro). Sem isto o t0..t1 englobava a
 * abertura inteira (87 s no S04E24), e a parte 4 podia buscar cena dentro dela.
 */
function ladoSemExclusao(citadas: readonly Cue[], exclusoes: readonly Pick<Exclusao, 'start' | 'end'>[]): Cue[] {
  const grupos: Cue[][] = [[]]
  for (const [i, cue] of citadas.entries()) {
    const anterior = citadas[i - 1]
    if (anterior && exclusoes.some((e) => e.start >= anterior.start && e.start < cue.start)) grupos.push([])
    grupos[grupos.length - 1]!.push(cue)
  }
  return grupos.reduce((maior, g) => (g.length > maior.length ? g : maior))
}

/**
 * Saida do LLM -> eventos do rascunho. E AQUI que o tempo nasce:
 * - cueIds inexistentes, de placa/musica ou dentro de exclusao saem;
 * - evento sem nenhuma cue valida sai inteiro;
 * - citadas dos dois lados de uma exclusao: fica o lado maior (com aviso);
 * - o evento guarda o TRECHO inteiro (cuesDoTrecho): da primeira a ultima
 *   citada, completando a fala cortada no meio; t0 = inicio da primeira, t1 =
 *   fim da ultima; `assinatura` = impressao do texto delas;
 * - peso arredondado e preso em 1-5; resumo e nomes aparados, nomes sem repetir;
 * - ordenados por t0 (empate: t1) e numerados e01, e02...
 * `avisos` diz o que foi descartado, em ASCII, para log e tela.
 */
export function montarEventos(
  bruto: EventosDaIa,
  indice: Pick<EpisodeIndex, 'cues' | 'exclusoes'>,
): { eventos: Evento[]; avisos: string[] } {
  const elegiveis = cuesElegiveis(indice)
  const validas = new Map(elegiveis.map((c) => [c.id, c]))
  const avisos: string[] = []
  let citacoesRuins = 0
  let semCue = 0
  let semResumo = 0
  let cortados = 0

  const montados: Omit<Evento, 'id'>[] = []
  for (const ev of bruto.eventos) {
    const citadas: Cue[] = []
    for (const id of new Set(ev.cueIds.map(idDaCueCitada))) {
      const cue = validas.get(id)
      if (cue) citadas.push(cue)
      else citacoesRuins += 1
    }
    const resumo = ev.resumo.trim()
    if (citadas.length === 0) {
      semCue += 1
      continue
    }
    if (!resumo) {
      semResumo += 1
      continue
    }
    citadas.sort((a, b) => a.start - b.start || a.end - b.end)
    const lado = ladoSemExclusao(citadas, indice.exclusoes)
    if (lado.length < citadas.length) cortados += 1
    const cues = trechoNasElegiveis(
      lado.map((c) => c.id),
      elegiveis,
    )
    const nomes: string[] = []
    for (const nome of ev.personagens.map((s) => s.trim())) if (nome && !nomes.includes(nome)) nomes.push(nome)
    montados.push({
      cueIds: cues.map((c) => c.id),
      assinatura: assinaturaDasFalas(cues),
      t0: cues[0]!.start,
      t1: Math.max(...cues.map((c) => c.end)),
      resumo,
      personagens: nomes,
      peso: Math.min(5, Math.max(1, Math.round(Number.isFinite(ev.peso) ? ev.peso : 3))),
    })
  }
  montados.sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1)

  if (citacoesRuins > 0) {
    avisos.push(`${citacoesRuins} fala(s) citada(s) fora do episodio, de placa/musica ou de OP/ED: ignoradas.`)
  }
  if (semCue > 0) avisos.push(`${semCue} evento(s) sem fala valida: descartados.`)
  if (semResumo > 0) avisos.push(`${semResumo} evento(s) sem resumo: descartados.`)
  if (cortados > 0) avisos.push(`${cortados} evento(s) atravessavam a abertura ou o encerramento: ficou o lado com mais falas.`)
  if (montados.length < EVENTOS_MIN || montados.length > EVENTOS_MAX) {
    avisos.push(`${montados.length} eventos (o esperado e de ${EVENTOS_MIN} a ${EVENTOS_MAX}).`)
  }
  return {
    eventos: montados.map((ev, i) => ({ id: `e${String(i + 1).padStart(2, '0')}`, ...ev })),
    avisos,
  }
}

// ------------------------------------------------------------ roteiro da IA

/** A frase traz a fala citada: aspas ou o "fulano solta: ..." da fala direta. */
const TRAZ_A_FALA = /["“”«»]|:\s/

/** O que repararFrase consertou, para o aviso dizer o que e onde. */
interface Reparos {
  eventos: number
  citacoes: number
  momentos: number
  /** '"MAQUINA DO TEMPO JA" (f02)': qual texto saiu e de qual frase. */
  telas: string[]
  vazias: number
}

function reparosVazios(): Reparos {
  return { eventos: 0, citacoes: 0, momentos: 0, telas: [], vazias: 0 }
}

/** Os eventos do rascunho e as cues de cada um (o trecho inteiro), para conferir a frase. */
interface MapaDosEventos {
  porId: ReadonlyMap<string, Evento>
  cues: ReadonlyMap<string, readonly Cue[]>
}

function mapaDosEventos(eventos: readonly Evento[], indice: Pick<EpisodeIndex, 'cues' | 'exclusoes'>): MapaDosEventos {
  return {
    porId: new Map(eventos.map((e) => [e.id, e])),
    cues: new Map(eventos.map((e) => [e.id, cuesDoEvento(e, indice)])),
  }
}

/** Os ids das cues dos eventos citados (o trecho de cada um). */
function cuesDosEventos(eventoIds: readonly string[], mapa: MapaDosEventos): Set<string> {
  const ids = new Set<string>()
  for (const e of eventoIds) for (const c of mapa.cues.get(e) ?? []) ids.add(c.id)
  return ids
}

/**
 * Conserta uma frase do LLM contra os eventos e o indice. null = descartar.
 * A citacao e a cue do momento tem que ser de uma fala DOS EVENTOS CITADOS
 * (o modelo citava "This is exhilarating!" numa frase que nao trazia fala
 * nenhuma, e o momento pulava para ela); a citacao, alem disso, so vale
 * quando o texto traz a fala (aspas ou dois-pontos).
 */
function repararFrase(bruta: FraseDaIa, id: string, mapa: MapaDosEventos, contar: Reparos): Frase | null {
  const texto = bruta.texto.replace(/\s+/g, ' ').trim()
  if (!texto) return null
  const eventoIds: string[] = []
  for (const e of bruta.eventoIds.map((s) => s.trim())) {
    if (!mapa.porId.has(e)) contar.eventos += 1
    else if (!eventoIds.includes(e)) eventoIds.push(e)
  }
  const doEvento = cuesDosEventos(eventoIds, mapa)
  let citacaoCueId = bruta.citacaoCueId ? idDaCueCitada(bruta.citacaoCueId) || null : null
  if (citacaoCueId && (!doEvento.has(citacaoCueId) || !TRAZ_A_FALA.test(texto))) {
    contar.citacoes += 1
    citacaoCueId = null
  }
  let cueDoMomento = bruta.cueDoMomento ? idDaCueCitada(bruta.cueDoMomento) || null : null
  if (cueDoMomento && !doEvento.has(cueDoMomento)) {
    contar.momentos += 1
    cueDoMomento = null
  }
  let textoDeTela = bruta.textoDeTela?.replace(/\s+/g, ' ').trim() || null
  if (textoDeTela && palavrasDeTela(textoDeTela) > TEXTO_DE_TELA_MAX_PALAVRAS) {
    contar.telas.push(`"${textoDeTela}" (${id})`)
    textoDeTela = null
  }
  return { id, texto, eventoIds, cueDoMomento, intencaoVisual: bruta.intencaoVisual.trim(), textoDeTela, citacaoCueId }
}

function avisosDosReparos(contar: Reparos): string[] {
  const avisos: string[] = []
  if (contar.eventos > 0) avisos.push(`${contar.eventos} citacao(oes) de evento inexistente: removidas.`)
  if (contar.citacoes > 0) avisos.push(`${contar.citacoes} citacao(oes) de fala fora dos eventos ou sem a fala no texto: removidas.`)
  if (contar.momentos > 0) avisos.push(`${contar.momentos} momento(s) fora dos eventos da frase: removidos.`)
  if (contar.telas.length > 0) {
    avisos.push(`Texto de tela com mais de ${TEXTO_DE_TELA_MAX_PALAVRAS} palavras removido: ${contar.telas.join(', ')}.`)
  }
  if (contar.vazias > 0) avisos.push(`${contar.vazias} frase(s) ou secao(oes) vazia(s): removidas.`)
  return avisos
}

export interface ContextoDaVersao {
  eventos: readonly Evento[]
  indice: Pick<EpisodeIndex, 'cues' | 'exclusoes'>
  alvoSec: AlvoSec
  modelo: string
  /** O numero que a versao nova recebe (proximaVersao do rascunho). */
  versao: number
  pedido: PedidoDaVersao
  derivadoDe: number | null
  agoraIso: string
}

/**
 * Saida do LLM (roteiro inteiro) -> versao 'ia' do rascunho, ja consertada:
 * ids s1.. e f01.., eventoIds so dos eventos que existem, citacao e momento
 * so de fala dos eventos citados, texto de tela com mais de 2 palavras de
 * conteudo vira null, frase vazia e secao vazia saem. Nao valida tamanho:
 * isso e validarRoteiro.
 */
export function roteiroDaIa(bruto: RoteiroDaIa, ctx: ContextoDaVersao): { roteiro: Roteiro; avisos: string[] } {
  const mapa = mapaDosEventos(ctx.eventos, ctx.indice)
  const contar = reparosVazios()
  const secoes: Secao[] = []
  let nFrase = 0
  for (const s of bruto.secoes) {
    const frases: Frase[] = []
    for (const f of s.frases) {
      const id = `f${String(nFrase + 1).padStart(2, '0')}`
      const frase = repararFrase(f, id, mapa, contar)
      if (frase) {
        frases.push(frase)
        nFrase += 1
      } else contar.vazias += 1
    }
    if (frases.length === 0) {
      contar.vazias += 1
      continue
    }
    secoes.push({ id: `s${secoes.length + 1}`, papel: s.papel, frases })
  }
  return {
    roteiro: {
      versao: ctx.versao,
      alvoSec: ctx.alvoSec,
      secoes,
      modelo: ctx.modelo,
      criadoEm: ctx.agoraIso,
      origem: 'ia',
      derivadoDe: ctx.derivadoDe,
      pedido: ctx.pedido,
    },
    avisos: avisosDosReparos(contar),
  }
}

/**
 * "Refazer esta parte": a versao `base` com a secao `secaoId` trocada pelas
 * frases novas do LLM (consertadas como em roteiroDaIa). As outras secoes e
 * os ids delas ficam iguais; as frases novas ganham ids que a base nao usa. Lanca se a
 * secao nao existe; se nao sobrar frase nenhuma, lanca tambem (melhor pedir de
 * novo do que apagar a secao).
 */
export function trocarSecao(
  base: Roteiro,
  secaoId: string,
  bruto: SecaoDaIa,
  ctx: ContextoDaVersao,
): { roteiro: Roteiro; avisos: string[] } {
  const alvo = base.secoes.find((s) => s.id === secaoId)
  if (!alvo) throw new Error(`Secao ${secaoId} nao existe nesta versao.`)
  const mapa = mapaDosEventos(ctx.eventos, ctx.indice)
  const contar = reparosVazios()
  // Ids da secao velha tambem ficam reservados: o mesmo 'f03' com outro texto
  // em duas versoes confundiria quem compara versoes.
  const usados = idsDeFrase(base)
  const frases: Frase[] = []
  for (const f of bruto.frases) {
    const id = proximoId('f', [...usados, ...frases.map((x) => x.id)])
    const frase = repararFrase(f, id, mapa, contar)
    if (frase) frases.push(frase)
    else contar.vazias += 1
  }
  if (frases.length === 0) throw new Error('A IA devolveu a parte vazia. Tente de novo.')
  return {
    roteiro: {
      versao: ctx.versao,
      alvoSec: ctx.alvoSec,
      secoes: base.secoes.map((s) => (s.id === secaoId ? { ...s, frases } : s)),
      modelo: ctx.modelo,
      criadoEm: ctx.agoraIso,
      origem: 'ia',
      derivadoDe: ctx.derivadoDe,
      pedido: ctx.pedido,
    },
    avisos: avisosDosReparos(contar),
  }
}

// ---------------------------------------------------------------- validacao

export type CodigoDoProblema =
  | 'sem-secoes'
  | 'secao-vazia'
  | 'frase-vazia'
  | 'id-repetido'
  | 'evento-inexistente'
  | 'citacao-inexistente'
  | 'palavras-fora'
  | 'frase-sem-evento'
  | 'texto-de-tela-longo'
  | 'sem-intencao'
  | 'gancho-fora-do-comeco'
  | 'sem-gancho'
  | 'sem-fechamento'
  | 'duas-frases'
  | 'termo-proibido'
  | 'frase-partida'
  | 'cta'
  | 'muleta'
  | 'pronome-ambiguo'
  | 'hipotese-como-fato'
  | 'copia-do-resumo'
  | 'repete-frase'
  | 'sem-cena'
  | 'tela-fora-do-evento'
  | 'tela-impossivel'

/**
 * Um problema do roteiro. `erro` bloqueia "Aprovar roteiro"; `aviso` so
 * aparece. `mensagem` e curta, ASCII, pronta para a tela.
 */
export interface ProblemaDoRoteiro {
  nivel: 'erro' | 'aviso'
  codigo: CodigoDoProblema
  mensagem: string
  secaoId?: string
  fraseId?: string
}

/**
 * Os avisos que fazem o main pedir a resposta de novo (uma tentativa so): o
 * texto que o prompt ja proibe pelo nome e voltou mesmo assim. Os outros
 * avisos de fidelidade sao heuristicos demais para gastar cota -- ficam na
 * tela, para o Levi decidir.
 */
export const CODIGOS_PARA_REFAZER: ReadonlySet<CodigoDoProblema> = new Set(['termo-proibido', 'frase-partida', 'cta'])

/**
 * Palavras que o prompt veta pelo nome e que voltavam mesmo assim ("O Gen
 * ficou em choque", "projeto secreto", "convenceu", tela "TRAIDOR ALIEN").
 * Valem quando o evento citado NAO diz o mesmo: `pt` procura no resumo dele,
 * `en` nas falas (a legenda costuma vir em ingles). Giria vetada nunca vale.
 * As regex rodam no texto sem acento e em minusculas.
 */
const TERMOS_VIGIADOS: readonly { rotulo: string; pt: RegExp; en: RegExp | null }[] = [
  { rotulo: 'em choque', pt: /\b(em choque|chocad[oa]s?)\b/, en: /\bshock/ },
  { rotulo: 'chorou', pt: /\b(chor(ou|a|am|aram|ando|ar)|lagrimas?)\b/, en: /\b(cry|cries|cried|crying|tears?|sobb?\w*)\b/ },
  { rotulo: 'surtou', pt: /\bsurt(ou|a|am|aram|ando|ar)\b/, en: null },
  { rotulo: 'secreto', pt: /\bsecret[oa]s?\b/, en: /\bsecret/ },
  { rotulo: 'escondido', pt: /\b(escondid[oa]s?|as escondidas)\b/, en: /\b(hid|hide|hidden|hiding|conceal\w*)\b/ },
  { rotulo: 'proibido', pt: /\bproibid[oa]s?\b/, en: /\b(forbid\w*|prohibit\w*|banned)\b/ },
  { rotulo: 'convenceu', pt: /\bconvenc\w*/, en: /\b(convinc\w*|persuad\w*)\b/ },
  { rotulo: 'traidor', pt: /\b(trai(u|r|dor|dora|dores|cao)|traid\w*)\b/, en: /\b(betray\w*|traitor\w*)\b/ },
  { rotulo: 'manipulou', pt: /\bmanipul\w*/, en: /\bmanipulat\w*/ },
  { rotulo: 'giria', pt: /\b(tank(ou|a|ar|ando)|largou a braba|entrega o ouro|baguncar o coreto)\b/, en: null },
]

/** Pedido de like/comentario: nao e narracao do episodio. */
const CTA = /\b(comenta|comente|comentem|curte|curta|curtam|se inscreve|se inscreva|inscreva-se|inscrevam|deixa o like|deixe o like|deixa seu like|segue o canal|siga o canal|ativa o sininho|ative o sininho)\b/

/** Abre retomando alguem: "Ele", "Ela", "O cara"... (texto sem acento). */
const ABRE_COM_PRONOME = /^(e |mas |so que |ai |entao |e ai )?(ele|ela|eles|elas|o cara|a garota|o moleque|o velho|a mina|o mano)\b/

/**
 * Resumo de evento que conta uma hipotese, ideia ou proposta de alguem. O
 * "propoe casamento" e pedido feito, nao hipotese: fica de fora.
 */
const RESUMO_DE_HIPOTESE =
  /\b(cogita\w*|sugere|sugerem|propoem?(?! (casamento|namoro))|hipotese\w*|talvez|acha que|acham que|imagina que|imaginam que|teoriza\w*|especula\w*|levanta a ideia|tem a ideia|ideia de|poderia|poderiam)\b/

/** A frase marca a duvida ou o dono da ideia. */
const MARCA_DE_DUVIDA =
  /\b(acha|acham|achar|achando|ideia|talvez|pode|podem|poderia|poderiam|propoe|propoem|sugere|sugerem|cogita|cogitam|hipotese|teoria|imagina|imaginam|chance|sera que|quem sabe|pensa em|pensam em|plano d[oa]|se der)\b/

/** Imagem que o episodio nao tem: logo, mapa, grafico, flashback, ou duas opcoes ("X ou Y"). */
const TELA_IMPOSSIVEL = /\b(logo d[aoe]|logotipo|mapa|grafico|diagrama|infografico|flashback|ou)\b/

/** Palavras que nao dizem o fato (para comparar frases de partes diferentes). */
const PALAVRAS_VAZIAS = new Set([
  'para', 'mais', 'como', 'quando', 'isso', 'esse', 'essa', 'este', 'esta', 'eles', 'elas', 'agora', 'ainda',
  'tudo', 'todo', 'toda', 'todos', 'todas', 'muito', 'muita', 'cara', 'mano', 'entao', 'aqui', 'onde', 'porque',
  'sobre', 'depois', 'antes', 'estao', 'seus', 'suas', 'dele', 'dela', 'deles', 'delas', 'numa', 'nesse', 'nessa',
  'pelo', 'pela', 'pelos', 'pelas', 'desse', 'dessa', 'qual', 'quem', 'mesmo', 'mesma', 'coisa', 'cada', 'fazer',
  'ficou', 'fica', 'tinha', 'tambem', 'nunca', 'sempre', 'nada', 'outro', 'outra', 'outros', 'outras', 'entre',
  'seja', 'vira', 'virou', 'vamos', 'vai', 'esta', 'sera', 'tipo', 'olha', 'pior', 'simplesmente',
])

/** Palavras de conteudo (4+ letras, fora as vazias) de um texto. */
function palavrasDeConteudo(texto: string): Set<string> {
  return new Set(palavrasDe(texto).filter((p) => p.length >= 4 && !PALAVRAS_VAZIAS.has(p)))
}

/** Seis palavras seguidas iguais ao resumo: a frase copiou o resumo em vez de recontar. */
const COPIA_MINIMA = 6

function sequencias(palavras: readonly string[], n: number): Set<string> {
  const saida = new Set<string>()
  for (let i = 0; i + n <= palavras.length; i++) saida.add(palavras.slice(i, i + n).join(' '))
  return saida
}

/** Um nome do elenco e a forma de achar no texto ("Why-Man" -> "why man"). */
interface NomeNoTexto {
  nome: string
  forma: string
}

function formasDosNomes(nomes: Iterable<string>): NomeNoTexto[] {
  const vistos = new Set<string>()
  const saida: NomeNoTexto[] = []
  for (const nome of nomes) {
    const forma = palavrasDe(nome.replace(/-(kun|chan|san|sama|senpai|sensei|dono)$/i, '')).join(' ')
    if (forma.length < 2 || vistos.has(forma)) continue
    vistos.add(forma)
    saida.push({ nome, forma })
  }
  return saida
}

function nomesNoTexto(texto: string, nomes: readonly NomeNoTexto[]): NomeNoTexto[] {
  const t = ` ${palavrasDe(texto).join(' ')} `
  return nomes.filter((n) => t.includes(` ${n.forma} `))
}

/**
 * Confere um roteiro (da IA ou editado) contra os eventos do rascunho e, se
 * vier, o indice (para conferir a citacao e a cena de cada frase).
 *
 * Erros: sem secoes, secao sem frase, frase sem texto, id repetido, evento
 * citado que nao existe, citacao de fala que nao existe no indice.
 * Avisos de forma: palavras fora da faixa do alvo, frase sem evento, texto de
 * tela com mais de 2 palavras, frase sem intencao visual, gancho fora do
 * comeco, sem gancho ou sem fechamento, duas frases num item (o ponto final
 * vira duas cenas), pedido de like, "mano/cara" demais.
 * Avisos de FIDELIDADE (heuristicos, saidos dos erros reais dos roteiros
 * julgados em 13/10/2026): termo que o prompt veta e o evento nao diz,
 * reticencias partindo frase, pronome logo depois de frase com dois nomes,
 * hipotese do evento dita como fato, frase que copia o resumo, fato repetido
 * em outra parte, frase sem cena no episodio, e intencao visual que pede quem
 * nao esta no evento ou algo que o episodio nao mostra.
 */
export function validarRoteiro(
  roteiro: Pick<Roteiro, 'secoes' | 'alvoSec'>,
  eventos: readonly Evento[],
  indice?: Pick<EpisodeIndex, 'cues'> & Partial<Pick<EpisodeIndex, 'exclusoes' | 'planos'>>,
): ProblemaDoRoteiro[] {
  const problemas: ProblemaDoRoteiro[] = []
  const eventoExiste = new Set(eventos.map((e) => e.id))
  const cueExiste = indice ? new Set(indice.cues.map((c) => c.id)) : null
  const comExclusoes = indice ? { cues: indice.cues, exclusoes: indice.exclusoes ?? [] } : null
  const mapa = comExclusoes ? mapaDosEventos(eventos, comExclusoes) : null
  const elenco = formasDosNomes(eventos.flatMap((e) => e.personagens))
  const comPlanos = indice?.planos && indice.planos.length > 0 ? { ...comExclusoes!, planos: indice.planos } : null

  if (roteiro.secoes.length === 0) {
    problemas.push({ nivel: 'erro', codigo: 'sem-secoes', mensagem: 'Roteiro sem partes' })
  }
  const idsSecao = new Set<string>()
  const idsFrase = new Set<string>()
  /** As frases ja vistas, em ordem de narracao, para o pronome e a repeticao. */
  const vistas: { frase: Frase; secao: Secao; conteudo: Set<string> }[] = []
  let muletas = 0

  for (const [i, secao] of roteiro.secoes.entries()) {
    if (idsSecao.has(secao.id)) {
      problemas.push({ nivel: 'erro', codigo: 'id-repetido', mensagem: `Parte ${secao.id} repetida`, secaoId: secao.id })
    }
    idsSecao.add(secao.id)
    if (secao.papel === 'gancho' && i > 0) {
      problemas.push({ nivel: 'aviso', codigo: 'gancho-fora-do-comeco', mensagem: 'Gancho fora do comeco', secaoId: secao.id })
    }
    if (secao.frases.length === 0) {
      problemas.push({ nivel: 'erro', codigo: 'secao-vazia', mensagem: 'Parte vazia', secaoId: secao.id })
    }
    for (const frase of secao.frases) {
      const onde = { secaoId: secao.id, fraseId: frase.id }
      const aviso = (codigo: CodigoDoProblema, mensagem: string): void => {
        problemas.push({ nivel: 'aviso', codigo, mensagem, ...onde })
      }
      if (idsFrase.has(frase.id)) {
        problemas.push({ nivel: 'erro', codigo: 'id-repetido', mensagem: `Frase ${frase.id} repetida`, ...onde })
      }
      idsFrase.add(frase.id)
      const vazia = contarPalavras(frase.texto) === 0
      if (vazia) {
        problemas.push({ nivel: 'erro', codigo: 'frase-vazia', mensagem: 'Frase vazia', ...onde })
      }
      for (const e of frase.eventoIds) {
        if (!eventoExiste.has(e)) {
          problemas.push({ nivel: 'erro', codigo: 'evento-inexistente', mensagem: `Evento ${e} nao existe`, ...onde })
        }
      }
      if (frase.citacaoCueId && cueExiste && !cueExiste.has(frase.citacaoCueId)) {
        problemas.push({
          nivel: 'erro',
          codigo: 'citacao-inexistente',
          mensagem: `Fala ${frase.citacaoCueId} nao existe`,
          ...onde,
        })
      }
      if (frase.eventoIds.length === 0) aviso('frase-sem-evento', 'Sem evento')
      if (frase.textoDeTela && palavrasDeTela(frase.textoDeTela) > TEXTO_DE_TELA_MAX_PALAVRAS) {
        aviso('texto-de-tela-longo', 'Texto de tela longo')
      }
      if (!frase.intencaoVisual.trim()) aviso('sem-intencao', 'Sem intencao visual')
      if (vazia) continue

      const texto = semAcentos(frase.texto.trim())
      const citados = frase.eventoIds.map((id) => eventos.find((e) => e.id === id)).filter((e): e is Evento => !!e)

      if (dividirEmFrases(frase.texto).length > 1) aviso('duas-frases', 'Duas frases: o ponto vira duas cenas')
      if (/^\s*(\.\.\.|…)/.test(frase.texto)) aviso('frase-partida', 'Comeca com reticencias')
      if (CTA.test(texto)) aviso('cta', 'Pedido de like ou comentario')
      if (/^(mano|cara)\b/.test(texto)) muletas += 1

      // Termo que o prompt veta pelo nome, sem o evento dizer o mesmo.
      const resumos = semAcentos(citados.map((e) => e.resumo).join(' \n '))
      const falas = mapa ? semAcentos(citados.flatMap((e) => mapa.cues.get(e.id) ?? []).map((c) => c.texto).join(' \n ')) : ''
      const comTela = frase.textoDeTela ? `${texto} ${semAcentos(frase.textoDeTela)}` : texto
      for (const termo of TERMOS_VIGIADOS) {
        if (!termo.pt.test(comTela)) continue
        const dito = termo.rotulo !== 'giria' && (termo.pt.test(resumos) || (termo.en !== null && termo.en.test(falas)))
        if (!dito) aviso('termo-proibido', `Termo vigiado: ${termo.rotulo}`)
      }

      // "Ele" logo depois de uma frase com dois personagens: de quem?
      const anterior = vistas[vistas.length - 1]
      if (anterior && ABRE_COM_PRONOME.test(texto) && nomesNoTexto(anterior.frase.texto, elenco).length >= 2) {
        aviso('pronome-ambiguo', 'Pronome ambiguo: repita o nome')
      }

      // O evento que a frase conta e uma ideia de alguem, e a frase diz como fato.
      const primeiro = citados[0]
      if (primeiro && RESUMO_DE_HIPOTESE.test(semAcentos(primeiro.resumo)) && !MARCA_DE_DUVIDA.test(texto)) {
        aviso('hipotese-como-fato', 'Hipotese dita como fato')
      }

      // Copiou o resumo do evento em vez de recontar.
      const minhas = sequencias(palavrasDe(frase.texto), COPIA_MINIMA)
      if (minhas.size > 0 && citados.some((e) => [...sequencias(palavrasDe(e.resumo), COPIA_MINIMA)].some((s) => minhas.has(s)))) {
        aviso('copia-do-resumo', 'Copia o resumo do evento')
      }

      // O mesmo fato dito em outra parte (gancho e climax podem ecoar: e o arco).
      const conteudo = palavrasDeConteudo(frase.texto)
      const eco = (a: PapelDaSecao, b: PapelDaSecao): boolean =>
        (a === 'gancho' && b === 'climax') || (a === 'climax' && b === 'gancho')
      const repetida = vistas.find(
        (v) => v.secao.id !== secao.id && !eco(v.secao.papel, secao.papel) && [...conteudo].filter((p) => v.conteudo.has(p)).length >= 4,
      )
      if (repetida) aviso('repete-frase', `Repete a parte ${ROTULO_DO_PAPEL[repetida.secao.papel]}`)

      // A cena do momento: fora de todo plano, a parte 4 nao tem o que mostrar.
      if (comPlanos && citados.length > 0) {
        const momento = momentoDaFrase(frase, eventos, comPlanos)
        if (momento && momento.planoId === null) aviso('sem-cena', 'Sem cena no episodio')
      }

      // O que a tela pede: so quem esta no evento, uma cena so, do episodio.
      const intencao = frase.intencaoVisual.trim()
      if (intencao && citados.length > 0) {
        const presentes = formasDosNomes([
          ...citados.flatMap((e) => e.personagens),
          ...(mapa ? citados.flatMap((e) => mapa.cues.get(e.id) ?? []).flatMap((c) => (c.falante ? [c.falante] : [])) : []),
        ])
        // "Why-Man" esta presente quando o evento tem o "Why-Man A" (e o contrario).
        const mesmo = (a: string, b: string): boolean => a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `)
        const fora = nomesNoTexto(intencao, elenco).filter((n) => !presentes.some((p) => mesmo(p.forma, n.forma)))
        if (fora.length > 0) aviso('tela-fora-do-evento', `Na tela: ${fora.map((n) => n.nome).join(', ')} nao esta no evento`)
        if (TELA_IMPOSSIVEL.test(semAcentos(intencao))) aviso('tela-impossivel', 'Na tela: so uma cena do episodio')
      }

      vistas.push({ frase, secao, conteudo })
    }
  }

  if (roteiro.secoes.length > 0) {
    if (!roteiro.secoes.some((s) => s.papel === 'gancho')) {
      problemas.push({ nivel: 'aviso', codigo: 'sem-gancho', mensagem: 'Sem gancho' })
    }
    if (!roteiro.secoes.some((s) => s.papel === 'fechamento')) {
      problemas.push({ nivel: 'aviso', codigo: 'sem-fechamento', mensagem: 'Sem fechamento' })
    }
  }
  if (muletas > 1) problemas.push({ nivel: 'aviso', codigo: 'muleta', mensagem: `"Mano"/"cara" abrindo ${muletas} frases` })

  const palavras = palavrasDoRoteiro(roteiro)
  const faixa = faixaDePalavras(roteiro.alvoSec)
  if (roteiro.secoes.length > 0 && (palavras < faixa.min || palavras > faixa.max)) {
    problemas.push({
      nivel: 'aviso',
      codigo: 'palavras-fora',
      mensagem:
        palavras < faixa.min
          ? `Curto: ${palavras} palavras (min ${faixa.min})`
          : `Longo: ${palavras} palavras (max ${faixa.max})`,
    })
  }
  return problemas
}

/** Sem nenhum `erro`: o botao "Aprovar roteiro" liga. */
export function podeAprovar(problemas: readonly ProblemaDoRoteiro[]): boolean {
  return !problemas.some((p) => p.nivel === 'erro')
}

// --------------------------------------------------- o momento de cada frase

/**
 * O plano (cena) que contem o instante `t`; fora de todos, o mais proximo ate
 * `folgaSec` de distancia. null sem planos ou longe demais: a pasta pode nao
 * ter cena naquele trecho (no Corte Cenas do S4 - 37 os primeiros 88 s foram
 * tirados), e mostrar a cena de um minuto depois seria pior que nada.
 */
export function planoNoTempo(indice: Pick<EpisodeIndex, 'planos'>, t: number, folgaSec = Infinity): Plano | null {
  let melhor: Plano | null = null
  let distancia = Infinity
  for (const plano of indice.planos) {
    if (t >= plano.start && t < plano.end) return plano
    const d = t < plano.start ? plano.start - t : t - plano.end
    if (d < distancia) {
      distancia = d
      melhor = plano
    }
  }
  return distancia <= folgaSec ? melhor : null
}

/** Ate quanto fora de toda cena o momento de uma frase ainda ganha a cena vizinha. */
export const FOLGA_DO_MOMENTO_SEC = 3

/** De que momento do episodio a frase fala: o que a tela mostra ao lado dela. */
export interface MomentoDaFrase {
  /** O instante que representa a frase (segundos do .mkv): meio da cue ancora. */
  t: number
  /** O trecho do evento do momento. */
  t0: number
  t1: number
  /** O evento citado que contem a cue ancora (senao, o primeiro citado que existe). */
  eventoId: string
  /** A cue ancora: a citacao; senao a cue do momento; senao a primeira cue do primeiro evento. */
  cueId: string
  /** A cena que contem `t` (para a miniatura: miniaturasDasCenas). null = nenhuma cena ali. */
  planoId: string | null
}

/**
 * O momento da frase, nesta ordem: a citacao literal (o instante em que a fala
 * e dita); a cue do momento que o roteirista escolheu; a primeira cue do
 * primeiro evento citado. null = frase sem evento valido (generica).
 */
export function momentoDaFrase(
  frase: Pick<Frase, 'eventoIds' | 'citacaoCueId'> & Partial<Pick<Frase, 'cueDoMomento'>>,
  eventos: readonly Evento[],
  indice: Pick<EpisodeIndex, 'cues' | 'planos' | 'exclusoes'>,
): MomentoDaFrase | null {
  const porId = new Map(eventos.map((e) => [e.id, e]))
  const citados = frase.eventoIds.map((id) => porId.get(id)).filter((e): e is Evento => e !== undefined)
  const primeiro = citados[0]
  if (!primeiro) return null
  const cuePorId = new Map(indice.cues.map((c) => [c.id, c]))
  const escolhida = [frase.citacaoCueId, frase.cueDoMomento]
    .map((id) => (id ? cuePorId.get(id) : undefined))
    .find((c): c is Cue => c !== undefined)
  const dono = escolhida ? citados.find((e) => cuesDoEvento(e, indice).some((c) => c.id === escolhida.id)) : undefined
  const evento = dono ?? primeiro
  const ancora = escolhida ?? cuePorId.get(primeiro.cueIds[0] ?? '')
  const t = ancora ? (ancora.start + ancora.end) / 2 : evento.t0
  return {
    t,
    t0: evento.t0,
    t1: evento.t1,
    eventoId: evento.id,
    cueId: ancora?.id ?? evento.cueIds[0] ?? '',
    planoId: planoNoTempo(indice, t, FOLGA_DO_MOMENTO_SEC)?.id ?? null,
  }
}

/**
 * As falas originais por tras da frase (o clique "ver falas"): o TRECHO de
 * cada evento citado (cuesDoEvento: evento antigo, de cueIds salteados, e
 * completado na hora), sem repetir, em ordem de tempo, mais a citacao e a
 * cue do momento se estiverem fora deles.
 */
export function falasDaFrase(
  frase: Pick<Frase, 'eventoIds' | 'citacaoCueId'> & Partial<Pick<Frase, 'cueDoMomento'>>,
  eventos: readonly Evento[],
  indice: Pick<EpisodeIndex, 'cues' | 'exclusoes'>,
): Cue[] {
  const porId = new Map(eventos.map((e) => [e.id, e]))
  const ids = new Set<string>()
  for (const id of frase.eventoIds) {
    const evento = porId.get(id)
    if (evento) for (const c of cuesDoEvento(evento, indice)) ids.add(c.id)
  }
  if (frase.citacaoCueId) ids.add(frase.citacaoCueId)
  if (frase.cueDoMomento) ids.add(frase.cueDoMomento)
  return indice.cues.filter((c) => ids.has(c.id)).sort((a, b) => a.start - b.start)
}

/**
 * O texto corrido do roteiro: frases separadas por espaco, secoes por linha em
 * branco. E o que vira o roteiro do projeto na parte 4 (fonte da verdade das
 * legendas) e o que a tela copia.
 */
export function textoDoRoteiro(roteiro: Pick<Roteiro, 'secoes'>): string {
  return roteiro.secoes
    .map((s) => s.frases.map((f) => f.texto.trim()).filter(Boolean).join(' '))
    .filter(Boolean)
    .join('\n\n')
}

// ------------------------------------------------- transicoes do rascunho

/** A versao na tela. null = sem roteiro. */
export function roteiroAtual(r: Pick<RascunhoDoRecap, 'roteiros' | 'atual'>): Roteiro | null {
  if (r.atual === null) return null
  return r.roteiros.find((x) => x.versao === r.atual) ?? null
}

/** O numero da proxima versao (maior + 1). */
export function proximaVersao(r: Pick<RascunhoDoRecap, 'roteiros'>): number {
  return r.roteiros.reduce((m, x) => Math.max(m, x.versao), 0) + 1
}

/** Mesmo conteudo (secoes e alvo), ignorando versao, datas e origem. */
export function mesmoConteudo(a: Pick<Roteiro, 'secoes' | 'alvoSec'>, b: Pick<Roteiro, 'secoes' | 'alvoSec'>): boolean {
  return a.alvoSec === b.alvoSec && JSON.stringify(a.secoes) === JSON.stringify(b.secoes)
}

/**
 * Poe uma versao NOVA no historico (gerada pela IA) e aponta `atual` para ela.
 * Desaprova. `roteiro.versao` tem que ser proximaVersao(r).
 */
export function adicionarVersao(r: RascunhoDoRecap, roteiro: Roteiro, agoraIso: string): RascunhoDoRecap {
  if (roteiro.versao !== proximaVersao(r)) throw new Error(`Versao ${roteiro.versao} fora de ordem.`)
  return {
    ...r,
    roteiros: [...r.roteiros, roteiro],
    atual: roteiro.versao,
    alvoSec: roteiro.alvoSec,
    aprovado: false,
    aprovadoEm: null,
    atualizadoEm: agoraIso,
  }
}

/**
 * Grava a EDICAO da tela (a regra do salvarRoteiro):
 * - mesmo conteudo da atual: nada muda (devolve `r` igual);
 * - a atual e a ultima do historico, ja e 'editado' e a tela partiu DESTA
 *   gravacao dela (`versao` e `criadoEm` do `editado` iguais aos do disco):
 *   troca no lugar. Se a troca deixa a versao igual a de onde ela saiu (alvo
 *   60 -> 90 -> 60), a copia sai do historico e a de origem volta a ser a atual;
 * - senao (a atual e da IA, e uma versao antiga, ou o disco mudou desde que a
 *   tela leu -- outra janela gravou no meio): versao nova 'editado', derivada
 *   da atual. Nem a versao da IA nem a edicao da outra janela se perdem.
 * Qualquer mudanca desaprova. Sem `versao`/`criadoEm` no `editado`, confia.
 */
export function aplicarEdicao(
  r: RascunhoDoRecap,
  editado: Pick<Roteiro, 'secoes' | 'alvoSec'> & Partial<Pick<Roteiro, 'versao' | 'criadoEm'>>,
  agoraIso: string,
): RascunhoDoRecap {
  const atual = roteiroAtual(r)
  if (!atual) throw new Error('Nao ha roteiro para editar. Gere um primeiro.')
  if (mesmoConteudo(atual, editado)) return r
  const ultima = r.roteiros[r.roteiros.length - 1]
  const mesmaBase =
    editado.versao === undefined ||
    editado.criadoEm === undefined ||
    (editado.versao === atual.versao && editado.criadoEm === atual.criadoEm)
  const noLugar = ultima !== undefined && ultima.versao === atual.versao && atual.origem === 'editado' && mesmaBase
  const origem = noLugar && atual.derivadoDe !== null ? r.roteiros.find((x) => x.versao === atual.derivadoDe) : undefined
  if (origem && mesmoConteudo(origem, editado)) {
    return {
      ...r,
      roteiros: r.roteiros.filter((x) => x.versao !== atual.versao),
      atual: origem.versao,
      alvoSec: origem.alvoSec,
      aprovado: false,
      aprovadoEm: null,
      atualizadoEm: agoraIso,
    }
  }
  const versao: Roteiro = {
    versao: noLugar ? atual.versao : proximaVersao(r),
    alvoSec: editado.alvoSec,
    secoes: editado.secoes,
    modelo: atual.modelo,
    criadoEm: agoraIso,
    origem: 'editado',
    derivadoDe: noLugar ? atual.derivadoDe : atual.versao,
    pedido: null,
  }
  return {
    ...r,
    roteiros: noLugar ? r.roteiros.map((x) => (x.versao === versao.versao ? versao : x)) : [...r.roteiros, versao],
    atual: versao.versao,
    alvoSec: editado.alvoSec,
    aprovado: false,
    aprovadoEm: null,
    atualizadoEm: agoraIso,
  }
}

/**
 * Poe uma versao NOVA so no HISTORICO: a `atual` e a aprovacao ficam como
 * estao. E o destino da resposta de um pedido que a tela cancelou
 * (cancelarRoteiro) -- antes ela virava a atual e tirava a aprovacao minutos
 * depois do Cancelar. Sem roteiro nenhum ainda, nao ha o que proteger: ela
 * vira a atual.
 */
export function guardarNoHistorico(r: RascunhoDoRecap, roteiro: Roteiro, agoraIso: string): RascunhoDoRecap {
  if (roteiro.versao !== proximaVersao(r)) throw new Error(`Versao ${roteiro.versao} fora de ordem.`)
  if (r.atual === null) return adicionarVersao(r, roteiro, agoraIso)
  return { ...r, roteiros: [...r.roteiros, roteiro], atualizadoEm: agoraIso }
}

/** "Voltar para a versao N". Trocar de versao desaprova. */
export function voltarParaVersao(r: RascunhoDoRecap, versao: number, agoraIso: string): RascunhoDoRecap {
  const alvo = r.roteiros.find((x) => x.versao === versao)
  if (!alvo) throw new Error(`A versao ${versao} nao existe.`)
  if (r.atual === versao) return r
  return { ...r, atual: versao, alvoSec: alvo.alvoSec, aprovado: false, aprovadoEm: null, atualizadoEm: agoraIso }
}

/** Aprova a atual. Lanca se o roteiro tem `erro` (validarRoteiro). */
export function marcarAprovado(
  r: RascunhoDoRecap,
  agoraIso: string,
  indice?: Pick<EpisodeIndex, 'cues'> & Partial<Pick<EpisodeIndex, 'exclusoes' | 'planos'>>,
): RascunhoDoRecap {
  const atual = roteiroAtual(r)
  if (!atual) throw new Error('Nao ha roteiro para aprovar.')
  const erro = validarRoteiro(atual, r.eventos, indice).find((p) => p.nivel === 'erro')
  if (erro) throw new Error(`Corrija antes de aprovar: ${erro.mensagem}.`)
  return { ...r, aprovado: true, aprovadoEm: agoraIso, atualizadoEm: agoraIso }
}

export function desmarcarAprovado(r: RascunhoDoRecap, agoraIso: string): RascunhoDoRecap {
  if (!r.aprovado) return r
  return { ...r, aprovado: false, aprovadoEm: null, atualizadoEm: agoraIso }
}

/** A linha da lista de rascunhos. */
export function resumirRascunho(r: RascunhoDoRecap): ResumoDoRascunho {
  const atual = roteiroAtual(r)
  return {
    id: r.id,
    episodioId: r.episodioId,
    titulo: r.titulo,
    atualizadoEm: r.atualizadoEm,
    eventos: r.eventos.length,
    versoes: r.roteiros.length,
    palavras: atual ? palavrasDoRoteiro(atual) : null,
    aprovado: r.aprovado,
  }
}

/**
 * Eventos cujas falas nao conferem com o indice: cue que nao existe mais ou,
 * no evento com assinatura, cue com OUTRO TEXTO no mesmo id (o id e
 * posicional; trocar a faixa de legenda no passo 1 faz 'c0012' virar outra
 * fala, e o momento e as "falas originais" de cada frase passariam a mostrar
 * o que nao foi dito). Vazio = tudo confere. A tela avisa e oferece um
 * rascunho novo (abrirRascunho com `novo`).
 */
export function eventosOrfaos(eventos: readonly Evento[], indice: Pick<EpisodeIndex, 'cues'>): string[] {
  const porId = new Map(indice.cues.map((c) => [c.id, c]))
  return eventos
    .filter((e) => {
      const cues = e.cueIds.map((id) => porId.get(id))
      if (cues.some((c) => c === undefined)) return true
      return e.assinatura !== undefined && assinaturaDasFalas(cues as Cue[]) !== e.assinatura
    })
    .map((e) => e.id)
}
