/**
 * A janela falsa do v-cenas-tela.ts: um `window.dangai` que faz o papel do
 * main do passo 4 EM MEMORIA (nada vai para o disco) e ANOTA cada chamada.
 * Mora num modulo proprio porque precisa existir ANTES de as stores serem
 * avaliadas (o import deste vem primeiro).
 *
 * O "main" falso segue o contrato de shared/cenas.ts: salvarCenas troca pelo
 * fraseId (aplicarEscolhas), sugerirCenas preenche semEscolha + textoMudou
 * nao travadas (a fita = os planos mais perto do momento), encaixarNaVoz passa
 * o encaixarEscolha com o take atual e grava o takeId. Tudo devolve o
 * rascunho inteiro, como o de verdade.
 */
import type { EpisodeIndex, EventoDoCorte } from '../../shared/episodio'
import { temPlanos } from '../../shared/episodio'
import { cueExcluida, momentoDaFrase, roteiroAtual, type RascunhoDoRecap } from '../../shared/roteiro'
import { hashDoTexto, takeAtual } from '../../shared/voz'
import {
  FITA_MAX,
  aplicarEscolhas,
  candidatoDosPlanos,
  cenasDoRascunho,
  duracaoDaFrase,
  escolhaDaFrase,
  escolhasDesatualizadas,
  frasesDoRoteiro,
  listaDeEscolhasSchema,
  type CandidatoDeCena,
  type EscolhaDaFrase,
} from '../../shared/cenas'
import { encaixarEscolha } from '../../shared/encaixe'

export const chamadas: { metodo: string; args: unknown[] }[] = []

export function quantas(metodo: string): number {
  return chamadas.filter((c) => c.metodo === metodo).length
}

/** O "disco" do main falso. */
export const disco: { rascunho: RascunhoDoRecap | null; indice: EpisodeIndex | null; relogio: number } = {
  rascunho: null,
  indice: null,
  relogio: Date.parse('2026-10-14T20:00:00.000Z'),
}

/** Atraso artificial por metodo (ms), para testar respostas fora de ordem. */
export const atrasos: Record<string, number> = {}

/** Os ouvintes do onCorteProgresso (o teste dispara o fim do corte por aqui). */
export const ouvintesDoCorte: ((e: EventoDoCorte) => void)[] = []

function agora(): string {
  disco.relogio += 1000
  return new Date(disco.relogio).toISOString()
}

function gravar(r: RascunhoDoRecap): RascunhoDoRecap {
  const novo = { ...r, atualizadoEm: agora() }
  disco.rascunho = novo
  return novo
}

function fitaDa(r: RascunhoDoRecap, fraseId: string): CandidatoDeCena[] {
  const indice = disco.indice!
  const roteiro = roteiroAtual(r)!
  const frase = frasesDoRoteiro(roteiro).find((f) => f.id === fraseId)!
  const m = momentoDaFrase(frase, r.eventos, indice)
  if (!m) return []
  const dist = (p: { start: number; end: number }): number => (m.t < p.start ? p.start - m.t : m.t > p.end ? m.t - p.end : 0)
  return indice.planos
    .filter((p) => !cueExcluida(p, indice.exclusoes))
    .sort((a, b) => dist(a) - dist(b))
    .slice(0, FITA_MAX)
    .map((p, i) => candidatoDosPlanos([p], indice.id, 'sugestao', { nota: FITA_MAX - i, porque: ['perto do momento'] }))
}

const implementados: Record<string, (...args: unknown[]) => unknown> = {
  salvarCenas: (id, escolhas) => {
    const r = disco.rascunho!
    if (r.id !== id) throw new Error('outro rascunho')
    const lista = listaDeEscolhasSchema.parse(escolhas)
    const roteiro = roteiroAtual(r)!
    const ids = new Set(frasesDoRoteiro(roteiro).map((f) => f.id))
    const fora = lista.filter((e) => !ids.has(e.fraseId))
    if (fora.length > 0) throw new Error(`Frase(s) fora do roteiro: ${fora.map((e) => e.fraseId).join(', ')}.`)
    return { rascunho: gravar({ ...r, cenas: aplicarEscolhas(cenasDoRascunho(r), lista, roteiro) }), avisos: [] }
  },
  sugerirCenas: (id) => {
    const r = disco.rascunho!
    if (r.id !== id) throw new Error('outro rascunho')
    if (!disco.indice || !temPlanos(disco.indice)) throw new Error('As cenas do episodio ainda estao sendo cortadas.')
    const roteiro = roteiroAtual(r)!
    const take = takeAtual(r)
    const atual = cenasDoRascunho(r)
    const d = escolhasDesatualizadas(roteiro, take, atual)
    const refazer = new Set([...d.semEscolha, ...d.textoMudou.filter((f) => !escolhaDaFrase(atual, f)?.travada)])
    const novas: EscolhaDaFrase[] = []
    for (const f of frasesDoRoteiro(roteiro)) {
      if (!refazer.has(f.id)) continue
      const fita = fitaDa(r, f.id)
      novas.push({
        fraseId: f.id,
        cenas: fita[0] ? [{ candidato: fita[0], palavraInicio: 0 }] : [],
        fita,
        confianca: 0,
        travada: false,
        hashTexto: hashDoTexto(f.texto),
        duracao: duracaoDaFrase(f, take).duracao,
        avisos: [],
      })
    }
    const quando = agora()
    const cenas = { ...aplicarEscolhas(atual, novas, roteiro), sugeridasEm: quando, roteiroVersao: roteiro.versao }
    return { rascunho: gravar({ ...r, cenas }), avisos: [] }
  },
  encaixarNaVoz: (id) => {
    const r = disco.rascunho!
    if (r.id !== id) throw new Error('outro rascunho')
    const roteiro = roteiroAtual(r)!
    const take = takeAtual(r)
    const atual = cenasDoRascunho(r)
    const porId = new Map(frasesDoRoteiro(roteiro).map((f) => [f.id, f]))
    const escolhas = atual.escolhas.map((e) => {
      const frase = porId.get(e.fraseId)
      return frase ? encaixarEscolha(e, { indice: disco.indice!, frase, take }).escolha : e
    })
    const quando = agora()
    return { rascunho: gravar({ ...r, cenas: { ...atual, escolhas, takeId: take?.id ?? null, encaixadoEm: quando } }), avisos: [] }
  },
  candidatosDaFrase: (_id, fraseId) => {
    const r = disco.rascunho!
    const fita = escolhaDaFrase(cenasDoRascunho(r), String(fraseId))?.fita ?? []
    const naFita = new Set(fita.map((c) => c.planoIds[0]))
    const resto = disco.indice!.planos.filter((p) => !naFita.has(p.id))
    return {
      fraseId,
      sugestoes: fita,
      vizinhas: resto.slice(0, 4).map((p) => candidatoDosPlanos([p], disco.indice!.id, 'vizinha')),
      outras: resto.slice(4).map((p) => candidatoDosPlanos([p], disco.indice!.id, 'busca')),
      personagens: [{ nome: 'Ishigami, Senkuu', cenas: 3 }],
      momento: 100,
    }
  },
  montarProjeto: () => ({ projetoPath: 'C:/teste/recap.anirecap', avisos: [] }),
  estadoDoCorte: () => null,
  miniaturasDasCenas: (_ep, ids) => Object.fromEntries((ids as string[]).map((id) => [id, `http://127.0.0.1/m/${id}`])),
  libraryClipUrl: (p) => `http://127.0.0.1/v/${String(p)}`,
  urlDoAudio: (_r, t) => ({ takeId: t, url: 'http://127.0.0.1/a', duracao: 60, peaks: [], rms: [] }),
}

const dangai = new Proxy(
  {},
  {
    get(_alvo, nome) {
      if (typeof nome !== 'string') return undefined
      // As escutas devolvem o "desligar" na hora (nao uma promessa).
      if (/^on[A-Z]/.test(nome)) {
        return (ouvinte: (e: unknown) => void) => {
          chamadas.push({ metodo: nome, args: [] })
          if (nome === 'onCorteProgresso') ouvintesDoCorte.push(ouvinte as (e: EventoDoCorte) => void)
          return () => undefined
        }
      }
      return async (...args: unknown[]) => {
        chamadas.push({ metodo: nome, args })
        const espera = atrasos[nome] ?? 0
        if (espera > 0) await new Promise((r) => setTimeout(r, espera))
        const f = implementados[nome]
        try {
          return { ok: true, value: f ? f(...args) : null }
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) }
        }
      }
    },
  },
)

Reflect.set(globalThis, 'window', { dangai, addEventListener: () => undefined, removeEventListener: () => undefined })
