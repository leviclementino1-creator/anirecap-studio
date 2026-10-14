import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { roteiroAtual, type RascunhoDoRecap } from '@shared/roteiro'
import { podeIrParaCenas, takeAtual } from '@shared/voz'
import {
  cenasDoRascunho,
  frasesDoRoteiro,
  type CenasGravadas,
  type EstadoDasCenas,
  type PedidoDeMontagem,
  type ProjetoMontado,
} from '@shared/cenas'
import { encaixarEscolha } from '@shared/encaixe'
import type { EpisodeIndex } from '@shared/episodio'
import { gravarRascunho, indiceDoRascunho, lerRascunhoDoDisco } from '../gerar/rascunho'
import { saveProjectFile } from '../project'
import { arquivoDaVoz } from '../voz/pastas'
import { aquecerMiniaturas } from './abertura'
import { focosDosPedacos } from './foco'
import { arquivoDoProjeto, conferirPastaPedida, nomeDoProjeto, pastaPadraoDoProjeto } from './pasta'
import { montarArquivoDoProjeto, pedacosDaMontagem } from './projeto'

/**
 * O ENCAIXE NA VOZ e a MONTAGEM do projeto (agente B).
 *
 * - encaixarNaVoz: cada escolha do rascunho passa pelo encaixarEscolha
 *   (shared/encaixe.ts) com o take ATUAL, e `cenas.takeId` vira o dele. E
 *   chamado pela tela ao entrar no passo 4 e sempre que
 *   escolhasDesatualizadas diz encaixeVelho/duracaoMudou (regravou frase,
 *   trocou de take). De graca.
 * - montarProjeto: o "Abrir no editor". Encaixa de novo no take aprovado
 *   (grava no rascunho se mudou), copia a narracao para a pasta do projeto,
 *   acha o rosto de cada bloco (melhor esforco, com teto) e grava o .anirecap
 *   v1 (montarArquivoDoProjeto em ./projeto.ts: audio, transcript alinhado,
 *   script, cenas = mp4 dos planos com sourceStart, Ken Burns, corte seco na
 *   secao e zoom curto na virada, gancho, legendas do editor e `studio`, que
 *   liga a guarda de reanalise do store). Validado pelo zod e gravado atomico
 *   pelo saveProjectFile do Dangai (o mesmo `rel` de um Ctrl+S). Nunca escreve
 *   em biblioteca externa (./pasta.ts).
 *
 * Mesma regra do rascunho.ts: ler -> aplicar -> gravar SEM await no meio. A
 * montagem trabalha sobre o que foi lido e encaixado; a parte lenta (rostos)
 * vem depois da gravacao do rascunho e nao relê nem grava o rascunho.
 */

function agora(): string {
  return new Date().toISOString()
}

/**
 * Onde a copia da narracao fica: <pasta>/<nome>.wav. Ja existindo com o MESMO
 * conteudo (montar de novo na mesma pasta), reaproveita; com outro, ganha
 * " (2)" -- nunca grava por cima de um audio que outro projeto usa.
 */
function narracaoNaPasta(pasta: string, nome: string, origem: string): string {
  const tamanho = statSync(origem).size
  for (let n = 1; ; n++) {
    const caminho = join(pasta, n === 1 ? `${nome}.wav` : `${nome} (${n}).wav`)
    if (!existsSync(caminho)) return caminho
    if (statSync(caminho).size === tamanho && readFileSync(caminho).equals(readFileSync(origem))) return caminho
  }
}

/** As escolhas encaixadas no take dado (puro; orfas e frases sem escolha ficam como estao). */
function encaixarTudo(
  cenas: EstadoDasCenas,
  roteiro: NonNullable<ReturnType<typeof roteiroAtual>>,
  indice: EpisodeIndex,
  take: ReturnType<typeof takeAtual>,
): { escolhas: EstadoDasCenas['escolhas']; avisos: string[] } {
  const porId = new Map(frasesDoRoteiro(roteiro).map((f) => [f.id, f]))
  const avisos: string[] = []
  const escolhas = cenas.escolhas.map((e) => {
    const frase = porId.get(e.fraseId)
    if (!frase) return e
    const feito = encaixarEscolha(e, { indice, frase, take })
    avisos.push(...feito.avisos)
    return feito.escolha
  })
  return { escolhas, avisos }
}

export async function encaixarNaVoz(rascunhoId: string): Promise<CenasGravadas> {
  const r = lerRascunhoDoDisco(rascunhoId)
  const roteiro = roteiroAtual(r)
  if (!roteiro) throw new Error('Nao ha roteiro.')
  const { indice } = indiceDoRascunho(r)
  const take = takeAtual(r)
  const atual = cenasDoRascunho(r)
  const { escolhas, avisos } = encaixarTudo(atual, roteiro, indice, take)
  const quando = agora()
  const novo: RascunhoDoRecap = {
    ...r,
    cenas: { ...atual, escolhas, takeId: take?.id ?? null, encaixadoEm: quando },
    atualizadoEm: quando,
  }
  gravarRascunho(novo)
  return { rascunho: novo, avisos }
}

/** Opcoes que a tela nao manda (os testes usam). */
export interface OpcoesDaMontagem {
  /** Procurar o rosto de cada bloco. Padrao: sim. */
  rostos?: boolean
  /** Teto da busca de rostos, em ms. */
  tetoDosRostosMs?: number
}

export async function montarProjeto(
  rascunhoId: string,
  pedido: PedidoDeMontagem,
  opcoes: OpcoesDaMontagem = {},
): Promise<ProjetoMontado> {
  // 1. Ler, conferir e encaixar no take aprovado -- sem await ate gravar.
  const r = lerRascunhoDoDisco(rascunhoId)
  const roteiro = roteiroAtual(r)
  if (!roteiro || !r.aprovado) throw new Error('Aprove o roteiro antes de abrir no editor.')
  if (!podeIrParaCenas(r, roteiro)) throw new Error('Aprove a voz antes de abrir no editor.')
  const take = takeAtual(r)
  if (!take) throw new Error('Aprove a voz antes de abrir no editor.')
  const { indice } = indiceDoRascunho(r)
  const atual = cenasDoRascunho(r)
  const { escolhas } = encaixarTudo(atual, roteiro, indice, take)
  const cenas: EstadoDasCenas = { ...atual, escolhas, takeId: take.id }
  const precisaGravar =
    atual.takeId !== take.id || JSON.stringify(atual.escolhas) !== JSON.stringify(escolhas)
  if (precisaGravar) {
    const quando = agora()
    gravarRascunho({ ...r, cenas: { ...cenas, encaixadoEm: quando }, atualizadoEm: quando })
  }

  // Os pedacos antes do disco: sem nenhuma cena, nada e criado.
  const previa = pedacosDaMontagem({ rascunho: r, roteiro, take, indice, cenas })
  if (previa.pedacos.length === 0) throw new Error('Nenhuma frase tem cena. Escolha as cenas antes de abrir no editor.')

  // 2. A pasta: a pedida (conferida) ou a padrao; nunca numa biblioteca externa.
  const nome = nomeDoProjeto(indice)
  const pasta = conferirPastaPedida(pedido.pasta ?? pastaPadraoDoProjeto(nome, new Date()))
  const origem = arquivoDaVoz(r.id, take.arquivo)
  if (!existsSync(origem)) throw new Error('O audio da voz aprovada sumiu. Gere ou importe a voz de novo.')
  mkdirSync(pasta, { recursive: true })

  // 3. A narracao vai junto do projeto (o projeto nao aponta para o userData),
  // com o NOME do projeto: o render do Dangai grava ao lado do audio, com o
  // nome dele ("Dr. Stone S04E37-short.mp4"), e o "Salvar" sugere esse nome.
  const narracaoPath = narracaoNaPasta(pasta, nome, origem)
  if (!existsSync(narracaoPath)) copyFileSync(origem, narracaoPath)

  // 4. O rosto de cada bloco (melhor esforco) e as miniaturas prontas para o
  // openProject (o mesmo mp4 em dois blocos nao pode correr no import).
  const focos = opcoes.rostos === false ? new Map() : await focosDosPedacos(previa.pedacos, opcoes.tetoDosRostosMs)
  await aquecerMiniaturas(previa.pedacos.map((p) => p.arquivo))

  // 5. O .anirecap: zod + gravacao atomica do Dangai.
  const { file, avisos } = montarArquivoDoProjeto({
    rascunho: r,
    roteiro,
    take,
    indice,
    cenas,
    narracaoPath,
    focos,
    agora: agora(),
  })
  const projetoPath = arquivoDoProjeto(pasta, nome)
  saveProjectFile(projetoPath, file)
  return { projetoPath, avisos }
}
