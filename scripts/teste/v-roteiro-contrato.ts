/**
 * O CONTRATO do passo 2 (Roteiro), sem IA e sem interface:
 *
 * 1. funcoes puras de shared/roteiro.ts com o indice REAL do Dr. Stone S4 - 37
 *    (o de _indices, so lido): cues elegiveis, montarEventos (t0/t1 das cues,
 *    placa/musica/OP fora), roteiroDaIa (reparos), validarRoteiro, contagem,
 *    momentoDaFrase, falasDaFrase, trocarSecao e as transicoes do rascunho
 *    (versao nova, edicao no lugar ou nova, voltar, aprovar);
 * 2. a biblioteca do Studio que mudou de lugar (OneDrive -> G:/AniRecap
 *    Studio/Biblioteca): abrirIndicePorId acha o S04E24 pelo id e corrige os
 *    caminhos (so le); e indexarEpisodio, numa COPIA sintetica da pasta movida
 *    para uma pasta temporaria, reaproveita o indice em vez de refazer;
 *    salvarExclusoes num indice movido grava os caminhos corrigidos;
 * 3. as correcoes de 13/10/2026: evento = trecho inteiro (sem fala cortada,
 *    sem atravessar a OP), assinatura das falas, citacao/momento so dos
 *    eventos, texto de tela por palavra de conteudo, avisos de fidelidade do
 *    validarRoteiro, edicao com base velha, alvo que volta, historico do
 *    cancelado.
 *
 * Grava so na pasta temporaria (userData e copia). Rodar da raiz do projeto:
 *   npx esbuild scripts/teste/v-roteiro-contrato.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json | node
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lerIndice, type EpisodeIndex } from '../../shared/episodio'
import {
  adicionarVersao,
  aplicarEdicao,
  assinaturaDasFalas,
  cuesDoTrecho,
  cuesElegiveis,
  contarPalavras,
  eventosOrfaos,
  guardarNoHistorico,
  idDaCueCitada,
  palavrasDeTela,
  duracaoEstimada,
  faixaDePalavras,
  falasDaFrase,
  fraseVazia,
  idDoRascunho,
  lerRascunho,
  marcarAprovado,
  momentoDaFrase,
  montarEventos,
  palavrasDoRoteiro,
  podeAprovar,
  proximaVersao,
  proximoId,
  RASCUNHO_VERSAO,
  roteiroAtual,
  roteiroDaIa,
  trocarSecao,
  validarRoteiro,
  voltarParaVersao,
  type Evento,
  type Frase,
  type RascunhoDoRecap,
  type Roteiro,
  type RoteiroDaIa,
} from '../../shared/roteiro'
import { configureSettings, saveSettings, type Cofre } from '../../electron/services/settings'
import { configurarEpisodios, indexarEpisodio, salvarExclusoes } from '../../electron/services/episodio/indice'
import { abrirIndicePorId } from '../../electron/services/episodio/abrir-indice'

const BIBLIOTECA = 'G:\\AniRecap Studio\\Biblioteca'
const INDICE_37 = join(BIBLIOTECA, '_indices', 'ep_25d63d4babd6dd9145aae70912d5b5b2b1fcb067', 'episodio.json')
const PASTA_24 = join(BIBLIOTECA, 'Dr STONE', 'S04E24')
const ID_24 = 'ep_7f20fe8a8728a5329c365e2b81648155cd2336e7'
const NOVO = 'C:/Users/levic/Downloads/Dr.STONE.S04E24.Whole.New.World.1080p.NF.WEB-DL.AAC2.0.H.264-VARYG.mkv'

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
function lancou(fn: () => unknown): boolean {
  try {
    fn()
    return false
  } catch {
    return true
  }
}

/** mtime de cada arquivo da pasta (so o primeiro nivel e metadata/), para provar que nada mudou. */
function fotografar(pasta: string): string {
  const linhas: string[] = []
  for (const sub of ['', 'metadata']) {
    const dir = join(pasta, sub)
    for (const nome of readdirSync(dir)) {
      const s = statSync(join(dir, nome))
      if (s.isFile()) linhas.push(`${sub}/${nome}|${s.size}|${s.mtimeMs}`)
    }
  }
  return linhas.sort().join('\n')
}

async function main(): Promise<void> {
  // ------------------------------------------------------------ 1. puras
  secao('1. Funcoes puras com o indice real do S4 - 37')
  const indice: EpisodeIndex = lerIndice(JSON.parse(readFileSync(INDICE_37, 'utf8')))
  const elegiveis = cuesElegiveis(indice)
  const op = indice.exclusoes.find((e) => e.motivo === 'op')!
  const placa = indice.cues.find((c) => c.tipo !== 'fala')
  const naOp = indice.cues.find((c) => c.tipo === 'fala' && (c.start + c.end) / 2 >= op.start && (c.start + c.end) / 2 < op.end)
  console.log(`  ${indice.cues.length} cues, ${elegiveis.length} elegiveis, OP ${op.start}-${op.end}`)
  confere(elegiveis.every((c) => c.tipo === 'fala'), 'elegiveis so de fala')
  confere(!naOp || !elegiveis.includes(naOp), 'cue dentro da OP fica de fora')

  const f = elegiveis
  const bruto = {
    eventos: [
      // fora de ordem, com repeticao, inexistente, placa e OP misturados
      { cueIds: [f[12]!.id, f[10]!.id, f[10]!.id, 'c9999'], resumo: ' Senku explica o plano ', personagens: ['Senku', 'Senku', ' Chrome '], peso: 7 },
      { cueIds: [f[2]!.id, f[3]!.id, ...(placa ? [placa.id] : []), ...(naOp ? [naOp.id] : [])], resumo: 'Abertura', personagens: [], peso: 0.4 },
      { cueIds: ['c9998'], resumo: 'Inventado', personagens: [], peso: 3 },
      { cueIds: [f[20]!.id], resumo: '   ', personagens: [], peso: 3 },
    ],
  }
  const { eventos, avisos } = montarEventos(bruto, indice)
  console.log(`  avisos: ${avisos.join(' | ')}`)
  confere(eventos.length === 2, '2 eventos validos de 4')
  confere(eventos[0]!.id === 'e01' && eventos[1]!.id === 'e02', 'ids e01, e02')
  const trecho01 = cuesDoTrecho([f[2]!.id, f[3]!.id], indice)
  confere(eventos[0]!.t0 === f[2]!.start && eventos[0]!.t1 === trecho01.at(-1)!.end, 'e01: t0/t1 das cues do trecho (inicio da 1a, fim da ultima)')
  const trecho02 = cuesDoTrecho([f[10]!.id, f[12]!.id], indice)
  confere(trecho02[0]!.id === f[10]!.id && trecho02.some((c) => c.id === f[11]!.id), 'trecho: da 1a a ultima citada, com a do meio (f11)')
  confere(JSON.stringify(eventos[1]!.cueIds) === JSON.stringify(trecho02.map((c) => c.id)), 'e02: o trecho inteiro, sem repetir, em ordem, sem a inexistente')
  confere(eventos.every((e) => e.assinatura === assinaturaDasFalas(cuesDoTrecho(e.cueIds, indice))) && eventosOrfaos(eventos, indice).length === 0, 'assinatura das falas confere com o indice')
  // Fala cortada no meio: a que termina sem pontuacao puxa a seguinte.
  const cortada = elegiveis.findIndex((c, i) => i + 1 < elegiveis.length && !/[.!?…\-—–♪]["'”’)\]]*$/.test(c.texto.trim()) && elegiveis[i + 1]!.start - c.end < 4)
  if (cortada >= 0) {
    const t = cuesDoTrecho([elegiveis[cortada]!.id], indice)
    console.log(`  fala cortada: [${elegiveis[cortada]!.id}] "${elegiveis[cortada]!.texto}" -> ${t.map((c) => c.id).join(',')}`)
    confere(t.length >= 2 && t[1]!.id === elegiveis[cortada + 1]!.id, 'fala sem pontuacao final e completada com a seguinte')
  }
  // Um evento que atravessa a OP fica com o lado maior, e o t0..t1 nao engole a abertura.
  const antesDaOp = elegiveis.filter((c) => c.end <= op.start).slice(-1)
  const depoisDaOp = elegiveis.filter((c) => c.start >= op.end).slice(0, 3)
  const atravessa = montarEventos({ eventos: [{ cueIds: [...antesDaOp, ...depoisDaOp].map((c) => c.id), resumo: 'Cruza a OP', personagens: [], peso: 3 }] }, indice)
  confere(atravessa.eventos.length === 1 && atravessa.eventos[0]!.t0 >= op.end && atravessa.avisos.some((a) => /atravessavam/.test(a)), `evento que cruza a OP: fica o lado maior (${atravessa.avisos.at(-1)})`)
  confere(idDaCueCitada('c0012 0:31') === 'c0012' && idDaCueCitada('[c0012]') === 'c0012' && idDaCueCitada(' x ') === 'x', 'id da cue copiado com o tempo vira so o id')
  confere(palavrasDeTela('MÁQUINA DO TEMPO') === 2 && palavrasDeTela('RUMO À LUA') === 2 && palavrasDeTela('tres palavras aqui') === 3, 'texto de tela: artigo e preposicao nao contam')
  confere(eventos[1]!.peso === 5 && eventos[0]!.peso === 1, 'peso preso em 1-5')
  confere(JSON.stringify(eventos[1]!.personagens) === JSON.stringify(['Senku', 'Chrome']), 'personagens aparados e sem repetir')
  confere(eventos[1]!.resumo === 'Senku explica o plano', 'resumo aparado')

  confere(contarPalavras('  Mano, o Senku -- fez 10 bombas!  ') === 6, 'contarPalavras ignora pontuacao solta')
  confere(Math.abs(duracaoEstimada(162) - 60) < 0.01, '162 palavras ~ 60 s')
  const f60 = faixaDePalavras(60)
  const f90 = faixaDePalavras(90)
  console.log(`  faixa 60s: ${f60.min}-${f60.max} (alvo ${f60.alvo}); 90s: ${f90.min}-${f90.max} (alvo ${f90.alvo})`)
  confere(f60.alvo === 162 && f90.alvo === 243, 'alvos 162 e 243 palavras')
  confere(proximoId('f', ['f01', 'f09', 's3']) === 'f10' && proximoId('s', ['s1', 's2']) === 's3', 'proximoId')

  const iaBruta: RoteiroDaIa = {
    secoes: [
      {
        papel: 'gancho',
        frases: [
          { texto: ' Mano,  o Senku acabou de mudar tudo. ', eventoIds: ['e02', 'e77'], cueDoMomento: `${f[11]!.id} 0:40`, intencaoVisual: 'close no Senku', textoDeTela: 'MUDOU TUDO', citacaoCueId: f[10]!.id },
          { texto: 'E ninguem esperava.', eventoIds: [], cueDoMomento: f[10]!.id, intencaoVisual: '', textoDeTela: 'tres palavras aqui', citacaoCueId: 'c9999' },
        ],
      },
      { papel: 'contexto', frases: [{ texto: '   ', eventoIds: ['e01'], cueDoMomento: null, intencaoVisual: 'x', textoDeTela: null, citacaoCueId: null }] },
      {
        papel: 'desenvolvimento',
        frases: [{ texto: 'E ele solta: "tudo comecou aqui."', eventoIds: ['e01'], cueDoMomento: null, intencaoVisual: 'plano aberto', textoDeTela: 'MÁQUINA DO TEMPO', citacaoCueId: f[3]!.id }],
      },
    ],
  }
  const agora = '2026-10-13T21:00:00.000Z'
  const v1 = roteiroDaIa(iaBruta, {
    eventos,
    indice,
    alvoSec: 60,
    modelo: 'gemini-teste',
    versao: 1,
    pedido: { tipo: 'inteiro', secaoId: null, instrucao: null },
    derivadoDe: null,
    agoraIso: agora,
  })
  console.log(`  reparos: ${v1.avisos.join(' | ')}`)
  const r1 = v1.roteiro
  confere(r1.secoes.length === 2 && r1.secoes[1]!.id === 's2' && r1.secoes[1]!.papel === 'desenvolvimento', 'secao vazia sai, ids s1/s2')
  confere(r1.secoes.flatMap((s) => s.frases.map((x) => x.id)).join(',') === 'f01,f02,f03', 'frases f01..f03 (a vazia saiu)')
  const g = r1.secoes[0]!.frases
  confere(g[0]!.texto === 'Mano, o Senku acabou de mudar tudo.', 'texto com espacos normalizados')
  confere(JSON.stringify(g[0]!.eventoIds) === '["e02"]', 'evento inexistente sai da frase')
  confere(g[1]!.citacaoCueId === null && g[1]!.textoDeTela === null, 'citacao invalida e texto de tela longo viram null')
  confere(g[0]!.textoDeTela === 'MUDOU TUDO', 'texto de tela de 2 palavras fica')
  confere(r1.secoes[1]!.frases[0]!.textoDeTela === 'MÁQUINA DO TEMPO', 'MAQUINA DO TEMPO fica (2 de conteudo)')
  confere(v1.avisos.some((a) => a.includes('"tres palavras aqui" (f02)')), 'o aviso diz qual texto de tela saiu e de qual frase')
  confere(g[0]!.citacaoCueId === null, 'citacao sem a fala no texto (sem aspas) sai')
  confere(g[0]!.cueDoMomento === f[11]!.id, 'cueDoMomento copiado com o tempo vira o id (e e do evento citado)')
  confere(g[1]!.cueDoMomento === null, 'cueDoMomento de frase sem evento sai')

  const problemas = validarRoteiro(r1, eventos, indice)
  console.log(`  problemas: ${problemas.map((p) => `${p.nivel}:${p.codigo}`).join(', ')}`)
  confere(podeAprovar(problemas), 'so avisos: pode aprovar')
  confere(problemas.some((p) => p.codigo === 'palavras-fora' && p.mensagem.startsWith('Curto')), 'aviso de roteiro curto')
  confere(problemas.some((p) => p.codigo === 'frase-sem-evento' && p.fraseId === 'f02'), 'aviso de frase sem evento')
  const quebrado = { ...r1, secoes: [{ id: 's1', papel: 'gancho' as const, frases: [{ ...g[0]!, texto: ' ', eventoIds: ['e99'] }] }, { id: 's2', papel: 'contexto' as const, frases: [] }] }
  const ruins = validarRoteiro(quebrado, eventos, indice)
  confere(!podeAprovar(ruins), 'frase vazia/evento inexistente/secao vazia bloqueiam')
  confere(['frase-vazia', 'evento-inexistente', 'secao-vazia'].every((c) => ruins.some((p) => p.codigo === c)), 'os tres erros aparecem')

  const m = momentoDaFrase(r1.secoes[1]!.frases[0]!, eventos, indice)
  confere(r1.secoes[1]!.frases[0]!.citacaoCueId === f[3]!.id && m !== null && m.cueId === f[3]!.id && m.eventoId === 'e01', 'momento: a citacao (com a fala no texto) manda')
  const mm = momentoDaFrase(g[0]!, eventos, indice)
  confere(mm !== null && mm.cueId === f[11]!.id && mm.eventoId === 'e02', 'momento: a cue do momento manda sobre a 1a fala do evento')
  const plano = m ? indice.planos.find((p) => p.id === m.planoId) : undefined
  // A pasta do Corte Cenas do S4 - 37 nao tem cena antes de 88 s: a fala f[3]
  // (~34 s) fica sem cena, e nao com a de um minuto depois.
  console.log(`  momento f03: t=${m?.t.toFixed(2)} plano ${m?.planoId ?? '-'} (1a cena em ${indice.planos[0]!.start}s)`)
  confere(m !== null && m.t < indice.planos[0]!.start - 3 ? m.planoId === null : !!plano && m!.t >= plano.start - 3 && m!.t < plano.end + 3, 'momento: sem cena ali, sem miniatura')
  const comFala = new Set(elegiveis.map((c) => c.id))
  const noMeio = indice.planos.slice(50).find((p) => p.cueIds.some((id) => comFala.has(id)))!
  const evNoMeio = { ...eventos[0]!, id: 'e09', cueIds: [noMeio.cueIds.find((id) => comFala.has(id))!] }
  const m2 = momentoDaFrase({ eventoIds: ['e09'], citacaoCueId: null }, [evNoMeio], indice)
  const p2 = indice.planos.find((p) => p.id === m2?.planoId)
  confere(!!p2 && m2!.t >= p2.start && m2!.t < p2.end, `momento: plano ${m2?.planoId} contem o instante ${m2?.t.toFixed(2)}`)
  confere(momentoDaFrase(g[1]!, eventos, indice) === null, 'frase sem evento: sem momento')
  const falas = falasDaFrase(g[0]!, eventos, indice)
  confere(falas.map((c) => c.id).join(',') === eventos[1]!.cueIds.join(','), 'falasDaFrase = o trecho do evento, em ordem')
  // Evento de antes da assinatura (cueIds salteados): a tela completa o trecho na hora.
  const velho: Evento = { id: 'e05', cueIds: [f[10]!.id, f[12]!.id], t0: f[10]!.start, t1: f[12]!.end, resumo: 'velho', personagens: [], peso: 3 }
  confere(falasDaFrase({ eventoIds: ['e05'], citacaoCueId: null }, [velho], indice).some((c) => c.id === f[11]!.id), 'evento velho, salteado: falasDaFrase mostra o trecho inteiro')

  // -------------------------------------------------- transicoes do rascunho
  secao('2. Versoes do rascunho')
  const vazio: RascunhoDoRecap = lerRascunho({
    versao: RASCUNHO_VERSAO,
    id: idDoRascunho(indice.id, Date.parse(agora)),
    episodioId: indice.id,
    indicePath: INDICE_37,
    titulo: 'Dr. Stone S04E37',
    alvoSec: 60,
    eventos,
    eventosMeta: { modelo: 'gemini-teste', criadoEm: agora },
    roteiros: [],
    atual: null,
    aprovado: false,
    aprovadoEm: null,
    criadoEm: agora,
    atualizadoEm: agora,
  })
  console.log(`  id ${vazio.id}`)
  confere(proximaVersao(vazio) === 1, 'primeira versao = 1')
  let r = adicionarVersao(vazio, r1, agora)
  confere(r.atual === 1 && roteiroAtual(r)?.origem === 'ia', 'v1 da IA na tela')
  const semMomento = JSON.parse(JSON.stringify(r)) as { eventos: Partial<Evento>[]; roteiros: { secoes: { frases: Partial<Frase>[] }[] }[] }
  delete semMomento.roteiros[0]!.secoes[0]!.frases[0]!.cueDoMomento
  delete semMomento.eventos[0]!.assinatura
  const relido = lerRascunho(semMomento)
  confere(relido.roteiros[0]!.secoes[0]!.frases[0]!.cueDoMomento === null && relido.eventos[0]!.assinatura === undefined, 'rascunho velho (sem cueDoMomento nem assinatura) abre')
  confere(aplicarEdicao(r, r1, agora) === r, 'salvar sem mudar nada nao cria versao')

  const editada = structuredClone(r1)
  editada.secoes[0]!.frases[0]!.texto = 'Mano, o Senku virou o jogo.'
  r = aplicarEdicao(r, editada, agora)
  confere(r.roteiros.length === 2 && r.atual === 2 && roteiroAtual(r)?.origem === 'editado' && roteiroAtual(r)?.derivadoDe === 1, '1a edicao: v2 editado, v1 da IA intacta')
  confere(r.roteiros[0]!.secoes[0]!.frases[0]!.texto.startsWith('Mano, o Senku acabou'), 'v1 nao mudou')
  const maisUma = structuredClone(roteiroAtual(r)!)
  maisUma.secoes[1]!.frases.push({ ...fraseVazia(maisUma), texto: 'Frase nova.', eventoIds: ['e01'] })
  r = aplicarEdicao(r, maisUma, agora)
  confere(r.roteiros.length === 2 && roteiroAtual(r)!.secoes[1]!.frases.at(-1)!.id === 'f04', '2a edicao: no lugar (v2), frase nova f04')

  r = marcarAprovado(r, agora, indice)
  confere(r.aprovado && r.aprovadoEm === agora, 'aprovado')
  r = voltarParaVersao(r, 1, agora)
  confere(r.atual === 1 && !r.aprovado, 'voltar para v1 desaprova')
  const daV1 = structuredClone(roteiroAtual(r)!)
  daV1.alvoSec = 90
  r = aplicarEdicao(r, daV1, agora)
  confere(r.roteiros.length === 3 && r.atual === 3 && r.alvoSec === 90 && roteiroAtual(r)!.derivadoDe === 1, 'editar a v1 (trocar alvo) cria v3')
  const volta60 = { ...structuredClone(roteiroAtual(r)!), alvoSec: 60 as const }
  const voltou = aplicarEdicao(r, volta60, agora)
  confere(voltou.roteiros.length === 2 && voltou.atual === 1 && voltou.alvoSec === 60, '60 -> 90 -> 60: a copia sai, a v1 volta a ser a atual')

  const refeita = trocarSecao(roteiroAtual(r)!, 's2', { frases: [{ texto: 'Parte refeita.', eventoIds: ['e01'], intencaoVisual: 'x', textoDeTela: null, citacaoCueId: null }] }, {
    eventos,
    indice,
    alvoSec: 90,
    modelo: 'gemini-teste',
    versao: proximaVersao(r),
    pedido: { tipo: 'secao', secaoId: 's2', instrucao: 'mais forte' },
    derivadoDe: 3,
    agoraIso: agora,
  })
  r = adicionarVersao(r, refeita.roteiro, agora)
  const v4 = roteiroAtual(r)!
  // Outra janela gravou no meio: a tela com a base velha vira versao nova, nada se perde.
  const daTela = structuredClone(v4)
  const daOutra = structuredClone(v4)
  daOutra.secoes[0]!.frases[0]!.texto = 'Da outra janela.'
  const outraJanela = aplicarEdicao(r, daOutra, '2026-10-13T21:05:00.000Z')
  daTela.secoes[1]!.frases[0]!.texto = 'Desta janela.'
  const desta = aplicarEdicao(outraJanela, daTela, '2026-10-13T21:06:00.000Z')
  const editadaNaOutra = desta.roteiros.find((x) => x.versao === 5)
  confere(editadaNaOutra?.secoes[0]!.frases[0]!.texto === 'Da outra janela.' && desta.atual === 6, 'tela de base velha (outra janela gravou): vira v6, a edicao da outra fica na v5')
  const daV5 = structuredClone(roteiroAtual(outraJanela)!)
  daV5.secoes[1]!.frases[0]!.texto = 'Mesma janela.'
  confere(aplicarEdicao(outraJanela, daV5, '2026-10-13T21:07:00.000Z').roteiros.length === outraJanela.roteiros.length, 'tela com a base certa: troca no lugar')
  // Cancelado: so no historico, a atual e a aprovacao ficam.
  const aprovadoV4 = marcarAprovado(r, agora, indice)
  const tarde: Roteiro = { ...v4, versao: proximaVersao(aprovadoV4), criadoEm: agora }
  const comTarde = guardarNoHistorico(aprovadoV4, tarde, agora)
  confere(comTarde.atual === 4 && comTarde.aprovado && comTarde.roteiros.length === aprovadoV4.roteiros.length + 1, 'resposta de pedido cancelado: entra no historico, atual e aprovacao ficam')
  confere(v4.versao === 4 && v4.secoes[0]!.frases.map((x) => x.id).join() === 'f01,f02', 'refazer s2: s1 igual')
  confere(v4.secoes[1]!.frases.length === 1 && v4.secoes[1]!.frases[0]!.id === 'f04', 'refazer s2: frase nova com id que a base nao usa')
  confere(lancou(() => trocarSecao(v4, 's9', { frases: [] }, { ...refeita.roteiro, eventos, indice, versao: 5, agoraIso: agora, derivadoDe: 4, pedido: null as never })), 'secao inexistente lanca')
  confere(lerRascunho(JSON.parse(JSON.stringify(r))).roteiros.length === 4, 'rascunho volta pelo zod (JSON ida e volta)')
  console.log(`  ${palavrasDoRoteiro(v4)} palavras na v4`)

  // ------------------------------------------- avisos de fidelidade
  secao('2b. Avisos de fidelidade (validarRoteiro)')
  {
    const e = (id: string, cue: number, resumo: string, personagens: string[]): Evento => {
      const cues = cuesDoTrecho([f[cue]!.id], indice)
      return { id, cueIds: cues.map((c) => c.id), assinatura: assinaturaDasFalas(cues), t0: cues[0]!.start, t1: cues.at(-1)!.end, resumo, personagens, peso: 3 }
    }
    const evs: Evento[] = [
      e('e01', 100, 'O Gen e o Chrome discutem o plano.', ['Gen', 'Chrome']),
      e('e02', 110, 'O Ukyo cogita mandar um feixe ao passado.', ['Ukyo']),
      e('e03', 120, 'Os cientistas estudam o dispositivo de petrificacao no laboratorio.', ['Senku']),
      e('e04', 5, 'Abertura sem cena.', ['Senku']),
    ]
    const fr = (id: string, texto: string, eventoIds: string[], extra: Partial<Frase> = {}): Frase => ({
      id, texto, eventoIds, cueDoMomento: null, intencaoVisual: 'close no Gen', textoDeTela: null, citacaoCueId: null, ...extra,
    })
    const rot = {
      alvoSec: 60 as const,
      secoes: [
        { id: 's1', papel: 'gancho' as const, frases: [fr('f01', 'Mano, o Gen ficou em choque com o Chrome.', ['e01']), fr('f02', 'Ele decidiu tudo sozinho.', ['e01'])] },
        { id: 's2', papel: 'contexto' as const, frases: [fr('f03', 'Eles vao mandar um feixe pro passado.', ['e02']), fr('f04', 'Os cientistas estudam o dispositivo de petrificacao no laboratorio.', ['e03'])] },
        { id: 's3', papel: 'desenvolvimento' as const, frases: [fr('f05', 'Cara, os cientistas estudam o dispositivo de petrificacao.', ['e03']), fr('f06', 'Foi assim. Depois mudou.', ['e03'], { intencaoVisual: 'logo do anime ou o Chrome' }), fr('f07', '...e ai ele foi.', ['e04'], { intencaoVisual: 'o Ukyo pensando' }), fr('f08', 'Comenta ai o que voce achou.', [])] },
      ],
    }
    const p = validarRoteiro(rot, evs, indice)
    const tem = (codigo: string, fraseId?: string): boolean => p.some((x) => x.codigo === codigo && (!fraseId || x.fraseId === fraseId))
    console.log(`  ${p.filter((x) => x.nivel === 'aviso').map((x) => `${x.fraseId ?? '-'}:${x.codigo}`).join(' ')}`)
    confere(podeAprovar(p), 'avisos de fidelidade nao bloqueiam a aprovacao')
    confere(tem('termo-proibido', 'f01'), '"em choque" sem o evento dizer: termo vigiado')
    confere(tem('pronome-ambiguo', 'f02'), '"Ele" depois de frase com Gen e Chrome: pronome ambiguo')
    confere(tem('hipotese-como-fato', 'f03'), 'evento "cogita" contado como fato')
    confere(tem('copia-do-resumo', 'f04'), 'frase que copia o resumo do evento')
    confere(tem('repete-frase', 'f05'), 'fato repetido em outra parte')
    confere(tem('duas-frases', 'f06') && tem('tela-impossivel', 'f06'), 'duas frases num item; "logo ... ou ..." na tela')
    confere(tem('frase-partida', 'f07') && tem('tela-fora-do-evento', 'f07') && tem('sem-cena', 'f07'), 'reticencias no comeco; Ukyo fora do evento; evento sem cena (antes de 88 s)')
    confere(tem('cta', 'f08') && tem('muleta') && tem('sem-fechamento'), 'pedido de like; mano/cara demais; sem fechamento')
    confere(!tem('termo-proibido', 'f05') && !tem('pronome-ambiguo', 'f04'), 'sem falso alarme nas frases limpas')
    const ok = validarRoteiro({ alvoSec: 60, secoes: [{ id: 's1', papel: 'gancho', frases: [fr('f01', 'O Ukyo acha que da pra mandar um feixe pro passado.', ['e02'], { intencaoVisual: 'close no Ukyo' })] }, { id: 's2', papel: 'fechamento', frases: [fr('f02', 'E agora?', [])] }] }, evs, indice)
    confere(!ok.some((x) => ['hipotese-como-fato', 'tela-fora-do-evento', 'termo-proibido', 'sem-fechamento'].includes(x.codigo)), 'hipotese com dono e duvida: sem aviso')
  }

  // -------------------------------------------- 3. biblioteca que mudou de lugar
  secao('3. Biblioteca do Studio movida (S04E24)')
  const temp = mkdtempSync(join(tmpdir(), 'v-roteiro-contrato-'))
  const userData = join(temp, 'userData')
  mkdirSync(userData, { recursive: true })
  const cofreFalso: Cofre = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' }
  configureSettings(userData, cofreFalso)
  saveSettings({ bibliotecaStudio: BIBLIOTECA, libraryDir: '' })
  configurarEpisodios(userData)

  const antes = fotografar(PASTA_24)
  try {
    const cru = lerIndice(JSON.parse(readFileSync(join(PASTA_24, 'episodio.json'), 'utf8')))
    console.log(`  no disco: pasta ${cru.biblioteca.pasta}`)
    const aberto = abrirIndicePorId(ID_24, 'C:\\pasta\\que\\nao\\existe\\episodio.json')
    console.log(`  aberto: ${aberto.caminho} movido=${aberto.movido}`)
    confere(aberto.caminho.toLowerCase() === join(PASTA_24, 'episodio.json').toLowerCase(), 'achou pelo id (dica velha ignorada)')
    const precisaCorrigir = !cru.biblioteca.pasta.toLowerCase().startsWith(BIBLIOTECA.toLowerCase())
    confere(aberto.movido === precisaCorrigir, `movido = ${precisaCorrigir}`)
    confere(aberto.indice.biblioteca.pasta.toLowerCase() === PASTA_24.toLowerCase(), 'pasta corrigida')
    const amostra = [aberto.indice.planos[0]!, aberto.indice.planos[100]!, aberto.indice.planos.at(-1)!]
    confere(amostra.every((p) => existsSync(p.arquivo)), 'mp4 das cenas existem nos caminhos corrigidos')
    confere(amostra.every((p) => p.keyframe !== null && existsSync(p.keyframe)), 'keyframes existem nos caminhos corrigidos')
    confere(aberto.indice.fonte.path === cru.fonte.path, 'fonte.path (o .mkv) intacto')

    // indexarEpisodio numa copia sintetica: metadata/ e episodio.json de
    // verdade (mtime preservado), shots/*.mp4 vazios, sem keyframes.
    const copia = join(temp, 'Biblioteca', 'Dr STONE', 'S04E24')
    mkdirSync(join(copia, 'shots'), { recursive: true })
    cpSync(join(PASTA_24, 'metadata'), join(copia, 'metadata'), { recursive: true, preserveTimestamps: true })
    cpSync(join(PASTA_24, 'episodio.json'), join(copia, 'episodio.json'), { preserveTimestamps: true })
    for (const nome of readdirSync(join(PASTA_24, 'shots'))) writeFileSync(join(copia, 'shots', nome), '')
    const mensagens: string[] = []
    const t = Date.now()
    const reindexado = await indexarEpisodio(
      {
        path: NOVO,
        pastaDoEpisodio: copia,
        origem: 'studio',
        palpite: { anime: cru.anime, temporada: cru.temporada, episodio: cru.episodio, kind: cru.kind },
        faixaLegenda: cru.faixaLegenda?.index ?? null,
      },
      (msg) => mensagens.push(msg),
    )
    console.log(`  indexar na copia (${Date.now() - t} ms): ${mensagens.join(' > ')}`)
    confere(mensagens.includes('Falas ja lidas antes.'), 'reaproveitou o indice (nao releu a legenda)')
    confere(reindexado.biblioteca.pasta === copia, 'indice regravado com a pasta nova')
    confere(reindexado.planos[0]!.arquivo.toLowerCase() === join(copia, 'shots', '0000.mp4').toLowerCase(), 'planos apontam para a pasta nova')
    confere(JSON.stringify(reindexado.exclusoes) === JSON.stringify(cru.exclusoes) && reindexado.cues.length === cru.cues.length, 'exclusoes e cues iguais')
    const gravado = lerIndice(JSON.parse(readFileSync(join(copia, 'episodio.json'), 'utf8')))
    confere(gravado.biblioteca.pasta === copia && readdirSync(copia).filter((n) => n.startsWith('episodio.')).length === 1, 'gravou no lugar, sem copia de backup')

    // O "voltar onde parou" abre o indice movido so em memoria; salvar OP/ED
    // tem que gravar os caminhos corrigidos, nao os da pasta velha.
    const userData2 = join(temp, 'userData2')
    mkdirSync(userData2, { recursive: true })
    configureSettings(userData2, cofreFalso)
    const biblioteca2 = join(temp, 'Biblioteca2')
    saveSettings({ bibliotecaStudio: biblioteca2, libraryDir: '' })
    configurarEpisodios(userData2)
    const movida = join(biblioteca2, 'Dr STONE', 'S04E24')
    mkdirSync(movida, { recursive: true })
    cpSync(join(PASTA_24, 'episodio.json'), join(movida, 'episodio.json'))
    const salvo = await salvarExclusoes(ID_24, cru.exclusoes)
    confere(
      salvo.biblioteca.pasta === movida && salvo.planos[0]!.arquivo.toLowerCase().startsWith(movida.toLowerCase()),
      'salvarExclusoes num indice movido grava os caminhos da pasta nova',
    )
  } finally {
    confere(fotografar(PASTA_24) === antes, 'a pasta real do S04E24 nao mudou')
    rmSync(temp, { recursive: true, force: true })
  }

  console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
  process.exitCode = falhas === 0 ? 0 : 1
}

void main()
