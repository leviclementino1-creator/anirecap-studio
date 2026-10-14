/**
 * A TELA DE CENAS (passo 4) e a navegacao dos passos, nas stores DE VERDADE
 * (src/store/gerar-cenas.ts, gerar-passos.ts), com um main falso em memoria
 * (v-cenas-tela-janela.ts) que anota as chamadas. Nao escreve nada: o
 * rascunho real do Dr. Stone S04E37 (v1 no %APPDATA%) e o indice dele sao so
 * LIDOS; a voz e um take sintetico (sem custo nenhum).
 *
 * Confere:
 *   1. passos: passoAoRestaurar (2, 3 e 4), passoLiberado e avisoDoPasso;
 *   2. segundo plano: sem planos, nada; o corte termina (onCorteProgresso com
 *      o indice) e sugerirCenas roda sozinho, UMA vez, e encaixarNaVoz logo
 *      depois (voz aprovada); de novo, nada;
 *   3. clique: troca a cena alvo (travada, hash do texto de agora, encaixada);
 *      o mesmo cartao de novo tira; dois cliques seguidos = uma gravacao;
 *   4. Shift+clique: mais uma cena no meio do ultimo pedaco; barrinha com
 *      limites; reordenar mantem as palavras de inicio;
 *   5. resposta atrasada nao apaga o clique mais novo;
 *   6. avisos: sem cena, repetida, emendada; resumo do rodape;
 *   7. "Sugerir de novo" (uma frase travada) volta para a sugestao;
 *   8. outro take aprovado: o encaixe se refaz sozinho;
 *   9. "Abrir no editor": pergunta com frase sem cena e com projeto por
 *      salvar; monta, abre e fecha o assistente.
 *
 * Rodar da raiz do projeto:
 *   npx esbuild scripts/teste/v-cenas-tela.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.web.json --define:import.meta.env.DEV=false | node
 */
import { atrasos, chamadas, disco, ouvintesDoCorte, quantas } from './v-cenas-tela-janela'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { lerIndice, type EpisodeIndex } from '../../shared/episodio'
import { lerRascunho, roteiroAtual, type RascunhoDoRecap } from '../../shared/roteiro'
import { hashDoTexto, palavrasDaFrase, textoFalado, type TakeDaVoz } from '../../shared/voz'
import { cenasDoRascunho, escolhaDaFrase, frasesDoRoteiro, palavrasNaFrase, type CandidatoDeCena } from '../../shared/cenas'
import { avisoDoPasso, passoAoRestaurar, passoLiberado } from '../../src/store/gerar-passos'
import { avisosDasFrases, cenasNaTela, escutarCenas, indiceDasCenas, mesmaCena, resumoDasCenas, useCenas } from '../../src/store/gerar-cenas'
import { useGerar } from '../../src/store/gerar'
import { useRoteiro } from '../../src/store/gerar-roteiro'
import { useProject } from '../../src/store/project'

let falhas = 0
function confere(ok: boolean, mensagem: string): void {
  if (ok) console.log(`  ok  ${mensagem}`)
  else {
    falhas += 1
    console.log(`  FALHOU  ${mensagem}`)
  }
}
const espera = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- os dados

const RECAPS = join(process.env.APPDATA ?? '', 'AniRecap Studio', 'recaps')
const cru = JSON.parse(readFileSync(join(RECAPS, 'rc_25d63d4babd6_mv7cxp1z.json'), 'utf8'))
const base = lerRascunho(cru)
const indiceCru = JSON.parse(
  readFileSync('G:/AniRecap Studio/Biblioteca/_indices/ep_25d63d4babd6dd9145aae70912d5b5b2b1fcb067/episodio.json', 'utf8'),
)
const indice: EpisodeIndex = lerIndice(indiceCru)
const roteiro = roteiroAtual(base)!
const frases = frasesDoRoteiro(roteiro)

/** Um take sintetico: 0,38 s por palavra e 0,3 s de pausa, trechos cobrindo o arquivo. */
function takeSintetico(id: string, ritmo = 0.38): TakeDaVoz {
  const palavras: TakeDaVoz['palavras'] = []
  const trechos: TakeDaVoz['trechos'] = []
  let t = 0
  for (const f of frases) {
    const offset = t
    const ps = palavrasDaFrase(f.texto)
    let w = offset + 0.15
    for (const texto of ps) {
      palavras.push({ texto, start: w, end: w + ritmo - 0.04, fraseId: f.id })
      w += ritmo
    }
    const duracao = w - offset + 0.15
    trechos.push({ fraseId: f.id, offset, duracao, hashTexto: hashDoTexto(f.texto), texto: textoFalado(f.texto) })
    t = offset + duracao
  }
  return {
    id,
    config: { fonte: 'importado', audio: { nome: 'sintetico.wav', hash: 'x' }, velocidade: 1, cortarPausas: false },
    arquivo: 'narracao-0123456789abcdef.wav',
    duracao: t,
    palavras,
    trechos,
    origemDoAlinhamento: 'alinhador',
    qualidade: null,
    caracteres: 0,
    cobrados: 0,
    chamadas: [],
    criadoEm: '2026-10-14T19:00:00.000Z',
    roteiroVersao: roteiro.versao,
    derivadoDe: null,
    regravadas: [],
    avisos: [],
    volume: null,
  } as unknown as TakeDaVoz
}

const t1 = takeSintetico('t1')
const comVoz: RascunhoDoRecap = {
  ...base,
  voz: { versao: 1, takes: [t1], atual: 't1', aprovado: true, aprovadoEm: '2026-10-14T19:30:00.000Z' },
  cenas: null,
  atualizadoEm: '2026-10-14T19:30:00.000Z',
}

async function main(): Promise<void> {
  console.log(`Rascunho ${base.id} (v${cru.versao} lido como v${base.versao}): ${frases.length} frases; indice ${indice.planos.length} planos.`)

  // ------------------------------------------------------------ 1. passos
  console.log('1. passos')
  confere(passoAoRestaurar({ ...base, voz: null }) === 2, 'roteiro aprovado sem voz: volta no 2')
  confere(passoAoRestaurar({ ...comVoz, voz: { ...comVoz.voz!, aprovado: false } }) === 3, 'voz nao aprovada: volta no 3')
  confere(passoAoRestaurar(comVoz) === 4, 'voz aprovada e em dia: volta no 4')
  confere(passoAoRestaurar({ ...comVoz, aprovado: false }) === 2, 'roteiro desaprovado: volta no 2')
  const tudo = { episodioPronto: true, roteiroAprovado: true, vozAprovada: true }
  confere(passoLiberado(4, tudo) && !passoLiberado(4, { ...tudo, vozAprovada: false }), 'passo 4 so com a voz aprovada')
  confere(!passoLiberado(3, { ...tudo, roteiroAprovado: false }) && passoLiberado(1, { episodioPronto: false, roteiroAprovado: false, vozAprovada: false }), 'passo 3 pede o roteiro; o 1 sempre')
  confere(
    avisoDoPasso(3, { vozDesatualizada: true, cenasEncaixadas: false, vozAprovada: false, cenasForaDaVoz: false }) !== null &&
      avisoDoPasso(4, { vozDesatualizada: false, cenasEncaixadas: true, vozAprovada: false, cenasForaDaVoz: false }) !== null &&
      avisoDoPasso(4, { vozDesatualizada: false, cenasEncaixadas: true, vozAprovada: true, cenasForaDaVoz: false }) === null,
    'aviso curto: voz velha (3) e cenas fora da voz (4)',
  )
  confere(
    avisoDoPasso(4, { vozDesatualizada: false, cenasEncaixadas: false, vozAprovada: false, cenasForaDaVoz: false }) === null,
    'primeira passada (cenas sugeridas antes da voz, nunca encaixadas): sem aviso',
  )

  // ------------------------------------------------- 2. segundo plano
  console.log('2. segundo plano')
  const semPlanos: EpisodeIndex = { ...indice, planos: [] }
  disco.rascunho = comVoz
  disco.indice = semPlanos
  useGerar.setState({ indice: semPlanos, passo: 4, aberto: true, fase: 'pronto' })
  useRoteiro.setState({ episodioId: comVoz.episodioId, rascunho: comVoz, indice: semPlanos, sujo: false, aprovando: false, abrindo: false })
  const desligar = escutarCenas()
  await espera(30)
  confere(quantas('sugerirCenas') === 0, 'sem planos (corte rodando): nao sugere')

  // O corte termina: o evento traz o indice com os planos.
  disco.indice = indice
  for (const o of ouvintesDoCorte) {
    o({ episodioId: indice.id, estado: { status: 'pronto', jobId: null, progresso: 1, etapa: null, mensagem: '', motor: 'studio', reconhecer: true, erro: null, inicio: null, atualizadoEm: '' }, indice })
  }
  await espera(60)
  confere(quantas('sugerirCenas') === 1, 'o corte acabou: sugerirCenas sozinho, uma vez')
  confere(quantas('encaixarNaVoz') === 1, 'voz aprovada: encaixarNaVoz logo depois')
  const depois = useRoteiro.getState().rascunho!
  const cenas1 = cenasDoRascunho(depois)
  confere(cenas1.escolhas.length === frases.length, `uma escolha por frase (${cenas1.escolhas.length})`)
  confere(cenas1.takeId === 't1' && cenas1.encaixadoEm !== null, 'encaixado no t1')
  useGerar.setState({ indice })
  await espera(40)
  confere(quantas('sugerirCenas') === 1 && quantas('encaixarNaVoz') === 1, 'em dia: nada de novo')

  // ------------------------------------------------------- 3. clique
  console.log('3. clique')
  useCenas.getState().entrar()
  const f0 = frases[0]!
  const fAtiva = useCenas.getState().fraseAtiva
  confere(fAtiva !== null, `frase inicial: ${fAtiva}`)
  useCenas.getState().escolherFrase(f0.id)
  const escolha0 = escolhaDaFrase(cenas1, f0.id)!
  const outro: CandidatoDeCena = escolha0.fita[2] ?? escolha0.fita[1]!
  const salvasAntes = quantas('salvarCenas')
  useCenas.getState().trocarCena(outro)
  const pend = useCenas.getState().pendentes[f0.id]
  confere(pend !== undefined && pend.travada && pend.hashTexto === hashDoTexto(f0.texto), 'pendente: travada, com o hash do texto de agora')
  confere(pend !== undefined && pend.cenas.length === 1 && mesmaCena(pend.cenas[0]!.candidato, outro), 'a cena alvo virou o cartao clicado')
  // Segundo clique logo em seguida (outra cena): uma gravacao so.
  const terceiro = escolha0.fita[3] ?? escolha0.fita[0]!
  useCenas.getState().trocarCena(terceiro)
  await espera(600)
  confere(quantas('salvarCenas') === salvasAntes + 1, 'dois cliques seguidos = uma gravacao')
  confere(Object.keys(useCenas.getState().pendentes).length === 0, 'gravado: sem pendentes')
  const gravada = escolhaDaFrase(cenasDoRascunho(useRoteiro.getState().rascunho!), f0.id)!
  confere(mesmaCena(gravada.cenas[0]!.candidato, terceiro) && gravada.travada, 'o disco tem o ultimo clique, travado')
  // O mesmo cartao de novo tira a cena.
  useCenas.getState().trocarCena(terceiro)
  confere((useCenas.getState().pendentes[f0.id]?.cenas.length ?? -1) === 0, 'o mesmo cartao de novo tira a cena')
  useCenas.getState().trocarCena(terceiro)
  await espera(600)

  // ---------------------------------------------- 4. mais cenas e barrinha
  console.log('4. Shift+clique, barrinha, reordenar')
  const longa = frases.find((f) => palavrasNaFrase(f.texto) >= 8) ?? f0
  useCenas.getState().escolherFrase(longa.id)
  const fitaLonga = escolhaDaFrase(cenasDoRascunho(useRoteiro.getState().rascunho!), longa.id)!.fita
  const n = palavrasNaFrase(longa.texto)
  useCenas.getState().adicionarCena(fitaLonga[1]!)
  let e = useCenas.getState().pendentes[longa.id]!
  confere(e.cenas.length === 2 && e.cenas[1]!.palavraInicio === Math.floor(n / 2), `2 cenas; a nova entra na palavra ${Math.floor(n / 2)} de ${n}`)
  confere(useCenas.getState().cenaAlvo === 1, 'a nova vira a cena alvo')
  useCenas.getState().adicionarCena(fitaLonga[1]!)
  confere(useCenas.getState().pendentes[longa.id]!.cenas.length === 2, 'a mesma cena de novo nao entra duas vezes')
  useCenas.getState().moverCorte(longa.id, 1, 0)
  e = useCenas.getState().pendentes[longa.id]!
  confere(e.cenas[1]!.palavraInicio === 1, 'barrinha no comeco: para na palavra 1')
  useCenas.getState().moverCorte(longa.id, 1, 999)
  e = useCenas.getState().pendentes[longa.id]!
  confere(e.cenas[1]!.palavraInicio === n - 1, 'barrinha no fim: para na ultima palavra')
  useCenas.getState().moverCorte(longa.id, 1, 3)
  const antes = useCenas.getState().pendentes[longa.id]!
  useCenas.getState().reordenarCenas(longa.id, [1, 0])
  e = useCenas.getState().pendentes[longa.id]!
  confere(
    mesmaCena(e.cenas[0]!.candidato, antes.cenas[1]!.candidato) && e.cenas[0]!.palavraInicio === 0 && e.cenas[1]!.palavraInicio === 3,
    'reordenar troca as cenas e mantem os cortes nas mesmas palavras',
  )
  useCenas.getState().removerCena(longa.id, 0)
  e = useCenas.getState().pendentes[longa.id]!
  confere(e.cenas.length === 1 && e.cenas[0]!.palavraInicio === 0, 'remover a primeira: a que sobra comeca na palavra 0')
  await espera(600)

  // ---------------------------------------- 5. resposta atrasada
  console.log('5. resposta atrasada')
  const f1 = frases[1]!
  useCenas.getState().escolherFrase(f1.id)
  const fita1 = escolhaDaFrase(cenasDoRascunho(useRoteiro.getState().rascunho!), f1.id)!.fita
  atrasos.salvarCenas = 300
  useCenas.getState().trocarCena(fita1[1]!)
  await espera(450) // a gravacao saiu e esta no ar
  useCenas.getState().trocarCena(fita1[2]!)
  await espera(250) // a primeira volta agora
  const naTela = escolhaDaFrase(cenasNaTela(useRoteiro.getState().rascunho!, roteiroAtual(useRoteiro.getState().rascunho!)!, useCenas.getState().pendentes), f1.id)!
  confere(mesmaCena(naTela.cenas[0]!.candidato, fita1[2]!), 'a resposta do primeiro clique nao apaga o segundo na tela')
  await espera(900)
  atrasos.salvarCenas = 0
  const noDisco = escolhaDaFrase(cenasDoRascunho(disco.rascunho!), f1.id)!
  confere(mesmaCena(noDisco.cenas[0]!.candidato, fita1[2]!) && Object.keys(useCenas.getState().pendentes).length === 0, 'no fim, o disco tem o segundo')

  // ------------------------------------------------------- 6. avisos
  console.log('6. avisos')
  const r6 = useRoteiro.getState().rascunho!
  const c6 = cenasNaTela(r6, roteiroAtual(r6)!, {})
  const a6 = avisosDasFrases(roteiro, c6, t1)
  confere([...a6.values()].every((a) => !a.estimada), 'com o take: nenhuma duracao estimada')
  // Repete a cena da frase 1 na frase 2 (f1 -> f2).
  const f2 = frases[2]!
  useCenas.getState().escolherFrase(f2.id)
  useCenas.getState().trocarCena(noDisco.cenas[0]!.candidato)
  await espera(600)
  const r6b = useRoteiro.getState().rascunho!
  const a6b = avisosDasFrases(roteiro, cenasDoRascunho(r6b), t1)
  confere((a6b.get(f1.id)?.repetidos.length ?? 0) > 0 && (a6b.get(f2.id)?.repetidos.length ?? 0) > 0, 'a mesma cena em duas frases: as duas avisam')
  confere(resumoDasCenas(a6b).repetidas >= 2, `resumo: ${resumoDasCenas(a6b).repetidas} repetidas`)
  const semTake = avisosDasFrases(roteiro, cenasDoRascunho(r6b), null)
  confere([...semTake.values()].every((a) => a.estimada), 'sem take: tudo estimado')

  // ------------------------------------------ 7. sugerir de novo
  console.log('7. Sugerir de novo (uma frase)')
  const sugeridasAntes = quantas('sugerirCenas')
  await useCenas.getState().sugerirDeNovo(f2.id)
  const r7 = useRoteiro.getState().rascunho!
  const e7 = escolhaDaFrase(cenasDoRascunho(r7), f2.id)!
  confere(quantas('sugerirCenas') === sugeridasAntes + 1, 'um sugerirCenas')
  confere(!e7.travada && e7.hashTexto === hashDoTexto(f2.texto), 'a frase voltou para a sugestao (destravada, hash em dia)')
  confere(mesmaCena(e7.cenas[0]!.candidato, e7.fita[0]!), 'a cena e a primeira da fita')
  confere(escolhaDaFrase(cenasDoRascunho(r7), f0.id)!.travada, 'as outras travadas ficaram')
  await espera(40)
  const encaixesAntes = quantas('encaixarNaVoz')
  await espera(40)
  confere(quantas('encaixarNaVoz') === encaixesAntes, 'depois do sugerir+encaixar: nada pendente')

  // ---------------------------------------- 8. outro take
  console.log('8. outro take aprovado')
  const t2 = takeSintetico('t2', 0.45)
  const r8: RascunhoDoRecap = { ...disco.rascunho!, voz: { versao: 1, takes: [t1, t2], atual: 't2', aprovado: true, aprovadoEm: '2026-10-14T21:00:00.000Z' }, atualizadoEm: new Date(disco.relogio + 500).toISOString() }
  disco.rascunho = r8
  useRoteiro.setState({ rascunho: r8 })
  await espera(60)
  const c8 = cenasDoRascunho(useRoteiro.getState().rascunho!)
  confere(c8.takeId === 't2', 'o encaixe foi refeito no t2 sozinho')
  confere(
    c8.escolhas.every((x) => Math.abs(x.duracao - (t2.trechos.find((t) => t.fraseId === x.fraseId)?.duracao ?? -1)) < 0.05),
    'cada escolha com a duracao do t2',
  )

  // --------------------------------------- 9. abrir no editor
  console.log('9. Abrir no editor')
  const fSem = frases[3]!
  useCenas.getState().escolherFrase(fSem.id)
  const atualSem = escolhaDaFrase(cenasDoRascunho(useRoteiro.getState().rascunho!), fSem.id)!
  useCenas.getState().trocarCena(atualSem.cenas[0]!.candidato) // tira: frase sem cena
  await useCenas.getState().abrirNoEditor()
  confere(useCenas.getState().confirmando === 'sem-cena' && quantas('montarProjeto') === 0, 'frase sem cena: pergunta antes, nao monta')
  // Um projeto DE VERDADE aberto (com narracao) e por salvar.
  useProject.setState({
    projectDirty: true,
    audio: { path: 'C:/proj/narracao.wav', fileName: 'narracao.wav', url: 'http://x', durationSec: 10, peaks: [0.1] },
  })
  await useCenas.getState().abrirNoEditor(true)
  confere(useCenas.getState().confirmando === 'nao-salvo' && quantas('montarProjeto') === 0, 'projeto aberto por salvar: pergunta tambem')
  let aberto: string | null = null
  useProject.setState({
    openProject: async (p?: string) => {
      aberto = p ?? null
      useProject.setState({ projectPath: p ?? null, projectDirty: false })
    },
  })
  const salvasAntesDeAbrir = quantas('salvarCenas')
  await useCenas.getState().abrirNoEditor(true)
  confere(quantas('salvarCenas') === salvasAntesDeAbrir + 1, 'a frase sem cena foi gravada antes de montar')
  confere(quantas('montarProjeto') === 1 && aberto === 'C:/teste/recap.anirecap', 'montou e abriu o .anirecap')
  confere(useGerar.getState().aberto === false && !useCenas.getState().montando, 'o assistente fechou')
  confere(useProject.getState().projectDirty === false, 'o projeto recem-montado abre salvo (as legendas refeitas nao contam)')

  // O "Limpar" da tela inicial deixa o flag ligado sem projeto nenhum (sem narracao): nao pergunta do projeto.
  useGerar.setState({ aberto: true })
  useProject.setState({ projectDirty: true, audio: null, projectPath: null })
  await useCenas.getState().abrirNoEditor()
  confere(useCenas.getState().confirmando === 'sem-cena', 'de novo: a frase sem cena pergunta')
  await useCenas.getState().abrirNoEditor(true)
  confere(useCenas.getState().confirmando !== 'nao-salvo' && quantas('montarProjeto') === 2, 'sujo sem narracao (o Limpar): monta sem perguntar do projeto')

  // ------------------------------------ 10. cadeado, trechos, corte refeito, chips
  console.log('10. cadeado, trechos, corte refeito, chips')
  const r10 = useRoteiro.getState().rascunho!
  const f3 = frases[3]!
  useCenas.getState().escolherFrase(f3.id)
  const e10 = escolhaDaFrase(cenasNaTela(r10, roteiroAtual(r10)!, useCenas.getState().pendentes), f3.id)
  if (e10) {
    useCenas.getState().travar(f3.id, !e10.travada)
    const p10 = useCenas.getState().pendentes[f3.id]
    confere(p10?.travada === !e10.travada && JSON.stringify(p10?.cenas) === JSON.stringify(e10.cenas), 'cadeado: so a trava muda (as cenas ficam)')
    useCenas.getState().travar(f3.id, e10.travada)
    confere(useCenas.getState().pendentes[f3.id]?.travada === e10.travada, 'cadeado de novo: volta')
    await espera(600)
  }
  // Mesmo plano LONGO em duas frases, trechos diferentes: nao e repetida; sobrepostos, e.
  const longo = indice.planos.find((p) => p.end - p.start > 20)!
  const fa = frases[5]!
  const fb = frases[8]!
  const cand = (de: number): CandidatoDeCena => ({ planoIds: [longo.id], episodioId: indice.id, inSec: de, outSec: longo.end, nota: 0, porque: [], origem: 'usuario', keyframe: null })
  const escolhaCom = (fraseId: string, de: number) => ({ ...escolhaDaFrase(cenasDoRascunho(r10), fraseId)!, cenas: [{ candidato: cand(de), palavraInicio: 0 }] })
  const separados = { escolhas: [escolhaCom(fa.id, longo.start), escolhaCom(fb.id, longo.start + 12)] }
  const juntos = { escolhas: [escolhaCom(fa.id, longo.start), escolhaCom(fb.id, longo.start + 1)] }
  const tLongo = takeSintetico('t9')
  confere((avisosDasFrases(roteiro, separados, tLongo).get(fb.id)?.repetidos.length ?? -1) === 0, `plano longo ${longo.id} em trechos separados: nao e repetida`)
  const aJuntos = avisosDasFrases(roteiro, juntos, tLongo)
  confere((aJuntos.get(fb.id)?.repetidos.length ?? 0) > 0 && (aJuntos.get(fb.id)?.repetidaCom ?? []).includes(fa.id), 'trechos sobrepostos: repetida, e diz com qual frase')
  // Corte refeito: o passo 1 tem o indice novo sem planos; o do corte anterior nao vale.
  const refazendo: EpisodeIndex = { ...indice, planos: [], corte: { status: 'cortando', jobId: 'j', progresso: 0.04, etapa: null, mensagem: '', motor: 'studio', reconhecer: true, erro: null, inicio: null, atualizadoEm: '' } }
  const gerarAntes = useGerar.getState().indice
  useGerar.setState({ indice: refazendo })
  useCenas.setState({ indiceDoCorte: indice })
  confere(indiceDasCenas() === refazendo, 'corte refeito rodando: o passo 4 espera (nao usa os planos velhos)')
  useGerar.setState({ indice: gerarAntes })
  confere(indiceDasCenas() !== null && indiceDasCenas()!.planos.length > 0, 'corte pronto: volta a ter planos')
  // Os chips sao do episodio: trocar de rascunho zera.
  useCenas.setState({ personagens: [{ nome: 'Ishigami, Senkuu', cenas: 46 }] })
  const outroRascunho = { ...r10, id: 'rc_4c4a139629d1_mv8gkgw1', episodioId: `ep_${'4'.repeat(40)}` }
  useRoteiro.setState({ rascunho: outroRascunho })
  useCenas.getState().entrar()
  confere(useCenas.getState().personagens.length === 0 && useCenas.getState().filtros.personagem === null, 'outro rascunho: chips e filtro zerados')
  useRoteiro.setState({ rascunho: r10 })
  useCenas.getState().entrar()

  desligar()
  const metodos = [...new Set(chamadas.map((c) => c.metodo))].sort().join(', ')
  console.log(`\nChamadas ao main falso: ${metodos}`)
  console.log(falhas === 0 ? '\nTUDO CERTO' : `\n${falhas} FALHA(S)`)
  process.exit(falhas === 0 ? 0 : 1)
}

void main()
