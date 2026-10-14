/**
 * O CONTRATO do passo 4 (Cenas) e do que veio junto com ele (14/10), sem
 * motor, sem IA e sem interface:
 *
 * 1. os rascunhos de verdade (v1/v2 no %APPDATA%) abrem como v3, com `cenas:
 *    null`, sem perder roteiro nem voz -- LIDOS, nunca gravados;
 * 2. o modo Texto: textoDoRoteiro -> redividirRoteiro devolve o MESMO roteiro
 *    (nada muda, aplicarEdicao nao cria versao); frase mexida mantem id;
 *    frase nova ganha id livre; frase apagada sai; parte nova; "Usar meu
 *    roteiro" (tudo 'nova', ids antigos reservados);
 * 3. as cenas: duracaoDaFrase (take x estimativa), temposDasCenas, a barrinha
 *    (normalizarCortes), escolhasDesatualizadas (sem escolha, texto mudou,
 *    orfa, take trocado, frase regravada), aplicarEscolhas, frasesSemCena,
 *    cenasDepoisDaRedivisao, trechosDoCandidato, schema da escolha;
 * 4. o indice que nasce sem planos: os indices de verdade continuam abrindo
 *    ('pronto' sem o campo), anexarPlanos mantem cues e exclusoes;
 * 5. o projeto: `studio` opcional no .anirecap.
 *
 * Nao escreve nada. Rodar da raiz do projeto:
 *   npx esbuild scripts/teste/v-cenas-contrato.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json | node
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  aplicarEscolhas,
  candidatoDosPlanos,
  CENAS_VAZIAS,
  cenasDepoisDaRedivisao,
  cenasEmDia,
  duracaoDaFrase,
  escolhaDaFraseSchema,
  escolhasDesatualizadas,
  estadoDasCenasSchema,
  frasesDoRoteiro,
  frasesSemCena,
  janelaDaNarracao,
  mesmoCandidato,
  normalizarCortes,
  palavrasNaFrase,
  planosConsecutivos,
  temposDasCenas,
  trechosDoCandidato,
  type EscolhaDaFrase,
  type EstadoDasCenas,
} from '../../shared/cenas'
import { encaixarEscolha } from '../../shared/encaixe'
import {
  anexarPlanos,
  episodeIndexSchema,
  lerIndice,
  statusDoCorte,
  temPlanos,
  type EpisodeIndex,
  type Plano,
} from '../../shared/episodio'
import { projectFileSchema } from '../../shared/project-file'
import {
  aplicarEdicao,
  lerRascunho,
  mesmoConteudo,
  rascunhoDoRecapSchema,
  RASCUNHO_VERSAO,
  redividirRoteiro,
  roteiroAtual,
  similaridadeDeTexto,
  textoDoRoteiro,
  type Roteiro,
} from '../../shared/roteiro'
import {
  hashDoTexto,
  takeDaVozSchema,
  textoParaNarrar,
  type PalavraComTempo,
  type TakeDaVoz,
  type TrechoDaFrase,
} from '../../shared/voz'

let falhas = 0
function confere(ok: boolean, nome: string): void {
  console.log(`  ${ok ? 'ok ' : 'FALHOU'} ${nome}`)
  if (!ok) falhas++
}
function secao(nome: string): void {
  console.log(`\n== ${nome}`)
}
function lanca(fn: () => unknown): boolean {
  try {
    fn()
    return false
  } catch {
    return true
  }
}

const RECAPS = join(process.env['APPDATA'] ?? '', 'AniRecap Studio', 'recaps')
const BIBLIOTECA = 'G:/AniRecap Studio/Biblioteca'

// ------------------------------------------------------------ 1. migracao
secao('1. Rascunhos de verdade abrem como v3')
const arquivos = readdirSync(RECAPS)
  .filter((n) => /^rc_[0-9a-z_]+\.json$/.test(n))
  .map((n) => join(RECAPS, n))
confere(arquivos.length > 0, `${arquivos.length} rascunho(s) no %APPDATA%`)
let rot: Roteiro | null = null
for (const arquivo of arquivos) {
  const antes = statSync(arquivo)
  const cru = JSON.parse(readFileSync(arquivo, 'utf8')) as { versao: number; roteiros: unknown[]; voz?: unknown }
  const r = lerRascunho(cru)
  const nome = arquivo.split(/[\\/]/).pop()
  confere(
    r.versao === RASCUNHO_VERSAO && RASCUNHO_VERSAO === 3 && r.cenas === null && r.roteiros.length === cru.roteiros.length,
    `${nome}: v${cru.versao} -> v3, cenas null, ${r.roteiros.length} versoes de roteiro`,
  )
  confere((cru.voz ?? null) === null ? r.voz === null : r.voz !== null, `${nome}: voz preservada`)
  const depois = statSync(arquivo)
  confere(antes.mtimeMs === depois.mtimeMs && antes.size === depois.size, `${nome}: arquivo intocado`)
  if (!rot && r.aprovado && r.episodioId.startsWith('ep_25d63d4babd6')) rot = roteiroAtual(r)
}
confere(rot !== null, 'roteiro aprovado do S4 - 37 achado')
const roteiro = rot!
const base = lerRascunho(JSON.parse(readFileSync(arquivos[0]!, 'utf8')))
confere(lanca(() => lerRascunho({ ...base, versao: 4 })), 'versao 4 (futura) e recusada')
confere(rascunhoDoRecapSchema.safeParse({ ...base, cenas: CENAS_VAZIAS }).success, 'v3 com cenas vazias confere')

// ---------------------------------------------------------- 2. modo Texto
secao('2. Modo Texto: re-dividir')
const texto = textoDoRoteiro(roteiro)
const ida = redividirRoteiro(roteiro, texto)
const totalFrases = frasesDoRoteiro(roteiro).length
console.log(`  ${roteiro.secoes.length} partes, ${totalFrases} frases, ${texto.length} caracteres`)
confere(ida.frases.length === totalFrases && ida.frases.every((f) => f.destino === 'igual'), 'texto igual: todas "igual"')
confere(mesmoConteudo({ secoes: ida.secoes, alvoSec: roteiro.alvoSec }, roteiro), 'texto igual: o MESMO roteiro (ids, partes, vinculos)')
confere(ida.religar.length === 0 && ida.removidas.length === 0, 'nada a religar, nada removido')
const rRot = { ...base, roteiros: [roteiro], atual: roteiro.versao, aprovado: true }
confere(aplicarEdicao(rRot, { secoes: ida.secoes, alvoSec: roteiro.alvoSec }, 'x') === rRot, 'aplicarEdicao nao cria versao')

const f0 = roteiro.secoes[0]!.frases[0]!
const f1 = roteiro.secoes[0]!.frases[1] ?? roteiro.secoes[1]!.frases[0]!
const ultima = frasesDoRoteiro(roteiro).at(-1)!
const mexida = f0.texto.replace(/^\S+/, 'Cara')
confere(similaridadeDeTexto(f0.texto, mexida) >= 0.6, `"${mexida.slice(0, 40)}..." parecida (${similaridadeDeTexto(f0.texto, mexida).toFixed(2)})`)
const novaFrase = 'Essa frase aqui e totalmente nova no roteiro.'
const editado = texto
  .replace(f0.texto, mexida)
  .replace(f1.texto, `${f1.texto} ${novaFrase}`)
  .replace(` ${ultima.texto}`, '')
  .replace(`${ultima.texto}`, '')
const volta = redividirRoteiro(roteiro, editado)
const d0 = volta.frases.find((f) => f.deId === f0.id)
confere(d0?.destino === 'parecida' && d0.id === f0.id, 'frase mexida: "parecida", mesmo id')
const fr0 = volta.secoes.flatMap((s) => s.frases).find((f) => f.id === f0.id)!
confere(JSON.stringify(fr0.eventoIds) === JSON.stringify(f0.eventoIds) && fr0.intencaoVisual === f0.intencaoVisual, 'frase mexida: vinculos mantidos')
const nova = volta.frases.find((f) => f.destino === 'nova')
const maior = Math.max(...frasesDoRoteiro(roteiro).map((f) => Number(f.id.slice(1))))
confere(nova !== undefined && Number(nova.id.slice(1)) > maior && volta.religar.includes(nova.id), `frase nova: id livre ${nova?.id} (> f${maior}), na lista de religar`)
const frNova = volta.secoes.flatMap((s) => s.frases).find((f) => f.id === nova?.id)
confere(frNova?.eventoIds.length === 0 && frNova.textoDeTela === null, 'frase nova: sem vinculo')
confere(volta.removidas.includes(ultima.id), `frase apagada (${ultima.id}) em removidas`)
confere(volta.frases.find((f) => f.deId === f1.id)?.destino === 'igual', 'a vizinha que nao mudou continua "igual"')
confere(volta.frases.length === totalFrases, 'uma a mais, uma a menos')

const partido = texto.replace(`${f1.texto}`, `\n\n${f1.texto}`)
const comParte = redividirRoteiro(roteiro, partido)
confere(comParte.secoes.length === roteiro.secoes.length + 1, 'linha em branco no meio de uma parte: parte nova')
confere(new Set(comParte.secoes.map((s) => s.id)).size === comParte.secoes.length, 'ids de parte unicos')
confere(comParte.secoes[0]!.id === roteiro.secoes[0]!.id && comParte.secoes[0]!.papel === roteiro.secoes[0]!.papel, 'a 1a parte continua sendo a mesma (id e papel)')

const parte1 = roteiro.secoes[0]!.frases.map((f) => f.texto).join(' ')
const reescrita = redividirRoteiro(roteiro, texto.replace(parte1, 'Tudo novo no comeco. Outra frase nova.'))
confere(reescrita.secoes[0]!.id === roteiro.secoes[0]!.id && reescrita.secoes[0]!.papel === roteiro.secoes[0]!.papel && reescrita.religar.length === 2, 'parte reescrita inteira: continua a mesma parte (id e papel), 2 frases a religar')

const meu = redividirRoteiro(roteiro, 'Primeiro gancho aqui. Segunda frase.\n\nMeio da historia.\n\nFim de tudo.', { casar: false })
confere(meu.frases.every((f) => f.destino === 'nova') && meu.frases.length === 4, '"Usar meu roteiro": 4 frases, todas nova')
confere(meu.frases.every((f) => Number(f.id.slice(1)) > maior), 'ids de frase antigos reservados')
confere(meu.secoes.map((s) => `${s.id}:${s.papel}`).join(',') === 's1:gancho,s2:desenvolvimento,s3:fechamento', 'partes s1..s3: gancho, desenvolvimento, fechamento')
confere(meu.removidas.length === totalFrases, 'todas as antigas em removidas')

// --------------------------------------------------------------- 3. cenas
secao('3. Cenas')
/** Take falso: palavra 0,30 s, 0,05 s entre palavras, 0,50 s entre frases. */
function takeFalso(rt: Pick<Roteiro, 'secoes'>, id: string): TakeDaVoz {
  const { frases } = textoParaNarrar(rt)
  const palavras: PalavraComTempo[] = []
  const lim: { fraseId: string; fim: number }[] = []
  let t = 0.2
  for (const f of frases) {
    for (const [i, p] of f.palavras.entries()) {
      if (i > 0) t += 0.05
      palavras.push({ texto: p, start: t, end: t + 0.3, fraseId: f.fraseId })
      t += 0.3
    }
    lim.push({ fraseId: f.fraseId, fim: t })
    t += 0.5
  }
  const duracao = t - 0.5 + 0.2
  const trechos: TrechoDaFrase[] = lim.map((l, i) => {
    const offset = i === 0 ? 0 : lim[i - 1]!.fim + 0.25
    const fim = i === lim.length - 1 ? duracao : l.fim + 0.25
    return { fraseId: l.fraseId, offset, duracao: fim - offset, hashTexto: frases[i]!.hash, texto: frases[i]!.texto }
  })
  const audio = { duracao, palavras, trechos }
  return takeDaVozSchema.parse({
    id,
    config: { fonte: 'importado', velocidade: 1, cortarPausas: false, audio: { nome: 'x.wav', hash: 'a'.repeat(16) } },
    arquivo: `narracao-${'a'.repeat(16)}.wav`,
    ...audio,
    bruto: { arquivo: `bruto-${'b'.repeat(16)}.wav`, ...audio },
    origemDoAlinhamento: 'alinhador',
    caracteres: 0,
    criadoEm: '2026-10-14T12:00:00.000Z',
    roteiroVersao: 1,
  })
}
const take = takeFalso(roteiro, 't1')
const dReal = duracaoDaFrase(f0, take)
const dEst = duracaoDaFrase(f0, null)
confere(dReal.real && dReal.offset === 0 && Math.abs(dReal.duracao - take.trechos[0]!.duracao) < 1e-9, `duracao real de ${f0.id}: ${dReal.duracao.toFixed(2)} s (trecho)`)
confere(!dEst.real && Math.abs(dEst.duracao - palavrasNaFrase(f0.texto) / 2.7) < 1e-9, `estimada: ${dEst.duracao.toFixed(2)} s (palavras / 2,7)`)
confere(!duracaoDaFrase({ ...f0, texto: `${f0.texto} mais` }, take).real, 'texto mudou depois do take: volta a estimativa')
const j = janelaDaNarracao(take, f1.id)!
confere(j.inicio === take.trechos[1]!.offset && Math.abs(j.fim - j.inicio - take.trechos[1]!.duracao) < 1e-9, 'janelaDaNarracao = o trecho')

const planos: Plano[] = Array.from({ length: 6 }, (_, i) => ({
  id: String(i + 1).padStart(4, '0'),
  start: 100 + i * 2,
  end: 102 + i * 2,
  arquivo: `X:/shots/${String(i + 1).padStart(4, '0')}.mp4`,
  keyframe: null,
  cueIds: [],
  falantes: [],
  personagens: [],
}))
const EP = `ep_${'0'.repeat(40)}`
const c1 = candidatoDosPlanos([planos[0]!], EP, 'sugestao', { porque: ['fala citada'] })
const span = candidatoDosPlanos([planos[1]!, planos[2]!], EP, 'sugestao', { inSec: 103, outSec: 105.5 })
confere(planosConsecutivos({ planos }, span.planoIds) && !planosConsecutivos({ planos }, ['0001', '0003']), 'span so de planos consecutivos')
const tr = trechosDoCandidato(span, planos)
confere(tr.length === 2 && tr[0]!.de === 1 && tr[0]!.ate === 2 && tr[1]!.de === 0 && Math.abs(tr[1]!.ate - 1.5) < 1e-9, 'trechosDoCandidato: tempo dentro de cada mp4')
confere(mesmoCandidato(c1, { planoIds: ['0001'], inSec: 100.001, outSec: 102 }) && !mesmoCandidato(c1, span), 'mesmoCandidato')

const n0 = palavrasNaFrase(f0.texto)
const esc0: EscolhaDaFrase = {
  fraseId: f0.id,
  cenas: [
    { candidato: c1, palavraInicio: 0 },
    { candidato: span, palavraInicio: Math.min(3, n0 - 1) },
  ],
  fita: [c1, span],
  confianca: 0.5,
  travada: false,
  hashTexto: hashDoTexto(f0.texto),
  duracao: dEst.duracao,
  avisos: [],
}
confere(escolhaDaFraseSchema.safeParse(esc0).success, 'escolha com 2 cenas confere')
confere(!escolhaDaFraseSchema.safeParse({ ...esc0, cenas: [{ candidato: c1, palavraInicio: 1 }] }).success, 'primeira cena fora da palavra 0: recusada')
confere(!escolhaDaFraseSchema.safeParse({ ...esc0, cenas: [esc0.cenas[0]!, { candidato: span, palavraInicio: 0 }] }).success, 'palavraInicio fora de ordem: recusada')
confere(!escolhaDaFraseSchema.safeParse({ ...esc0, fita: [c1, c1, c1, c1, c1, c1, c1] }).success, 'fita com 7: recusada')
const tempos = temposDasCenas(esc0, f0, take)
const p3 = take.palavras.filter((p) => p.fraseId === f0.id)[Math.min(3, n0 - 1)]!
confere(tempos.length === 2 && tempos[0]!.inicio === 0 && Math.abs(tempos[1]!.inicio - p3.start) < 1e-9 && Math.abs(tempos[1]!.fim - dReal.duracao) < 1e-9, 'temposDasCenas: corte no inicio da palavra, soma = trecho')
const temposEst = temposDasCenas(esc0, f0, null)
confere(Math.abs(temposEst[1]!.fim - dEst.duracao) < 1e-9, 'temposDasCenas sem take: reparte a estimativa')
const norm = normalizarCortes({ cenas: [{ candidato: c1, palavraInicio: 4 }, { candidato: span, palavraInicio: 2 }, { candidato: c1, palavraInicio: 99 }] }, 5)
confere(norm.cenas.map((c) => c.palavraInicio).join(',') === '0,2', 'normalizarCortes: 1a em 0, sobe estrito, fora da frase sai')

const outra: EscolhaDaFrase = { ...esc0, fraseId: f1.id, cenas: [{ candidato: c1, palavraInicio: 0 }], hashTexto: hashDoTexto(f1.texto), duracao: duracaoDaFrase(f1, take).duracao }
let cenas: EstadoDasCenas = { ...CENAS_VAZIAS, takeId: 't1' }
cenas = aplicarEscolhas(cenas, [outra, { ...esc0, duracao: dReal.duracao }, { ...outra, fraseId: 'f999' }], roteiro)
confere(cenas.escolhas.map((e) => e.fraseId).join(',') === `${f0.id},${f1.id}`, 'aplicarEscolhas: ordem do roteiro, frase de fora sai')
confere(estadoDasCenasSchema.safeParse(cenas).success, 'estado das cenas confere')
confere(!estadoDasCenasSchema.safeParse({ ...cenas, escolhas: [outra, outra] }).success, 'escolha repetida: recusada')
const semCena = frasesSemCena(roteiro, cenas)
confere(semCena.length === totalFrases - 2 && !semCena.includes(f0.id), `frasesSemCena: ${semCena.length}`)
let d = escolhasDesatualizadas(roteiro, take, cenas)
confere(d.semEscolha.length === totalFrases - 2 && d.textoMudou.length === 0 && !d.encaixeVelho && d.duracaoMudou.length === 0, 'em dia, menos as sem escolha')
const t2 = takeFalso({ secoes: [{ ...roteiro.secoes[0]!, frases: [{ ...f0, texto: `${f0.texto} E mais um pouco.` }, ...roteiro.secoes[0]!.frases.slice(1)] }, ...roteiro.secoes.slice(1)] }, 't2')
d = escolhasDesatualizadas(roteiro, t2, cenas)
confere(d.encaixeVelho, 'outro take: encaixeVelho')
const rotMexido: Roteiro = { ...roteiro, secoes: roteiro.secoes.map((s, i) => (i === 0 ? { ...s, frases: s.frases.map((f, k) => (k === 0 ? { ...f, texto: mexida } : f)) } : s)) }
d = escolhasDesatualizadas(rotMexido, take, cenas)
confere(d.textoMudou.includes(f0.id) && d.duracaoMudou.includes(f0.id), 'texto mexido: textoMudou e duracao (volta a estimativa)')
d = escolhasDesatualizadas({ secoes: roteiro.secoes.map((s) => ({ ...s, frases: s.frases.filter((f) => f.id !== f1.id) })) }, take, cenas)
confere(d.orfas.includes(f1.id), 'frase removida: orfa')
const completo = aplicarEscolhas(cenas, frasesDoRoteiro(roteiro).map((f) => ({ ...outra, fraseId: f.id, hashTexto: hashDoTexto(f.texto), duracao: duracaoDaFrase(f, take).duracao })), roteiro)
confere(cenasEmDia(escolhasDesatualizadas(roteiro, take, completo)), 'todas escolhidas no take t1: em dia')

const red = cenasDepoisDaRedivisao(cenas, volta)!
confere(red.escolhas.some((e) => e.fraseId === f0.id) && red.escolhas.every((e) => e.fraseId !== nova?.id), 'redivisao: a parecida leva a escolha, a nova fica sem')
confere(red.escolhas.find((e) => e.fraseId === f0.id)!.cenas.every((c) => c.palavraInicio < palavrasNaFrase(mexida)), 'redivisao: barrinha cabe no texto novo')
confere(cenasDepoisDaRedivisao(null, volta) === null, 'sem cenas: continua null')

const indiceFalso = { id: EP, planos, cues: [], exclusoes: [] }
const enc = encaixarEscolha(esc0, { indice: indiceFalso, frase: f0, take })
confere(Math.abs(enc.escolha.duracao - dReal.duracao) < 1e-9 && escolhaDaFraseSchema.safeParse(enc.escolha).success, 'encaixarEscolha (stub): duracao do take, escolha valida')

// -------------------------------------------------------------- 4. indice
secao('4. Indice que nasce sem planos')
const reais = [join(BIBLIOTECA, 'Dr STONE', 'S04E24', 'episodio.json')]
const ext = join(BIBLIOTECA, '_indices')
if (existsSync(ext)) for (const n of readdirSync(ext)) reais.push(join(ext, n, 'episodio.json'))
let real: EpisodeIndex | null = null
for (const caminho of reais.filter(existsSync)) {
  const i = lerIndice(JSON.parse(readFileSync(caminho, 'utf8')))
  confere(statusDoCorte(i) === 'pronto' && temPlanos(i) && i.corte === undefined, `${i.anime} S${i.temporada}E${i.episodio}: abre, 'pronto' sem o campo, ${i.planos.length} planos`)
  real ??= i
}
if (real) {
  const pendente = episodeIndexSchema.parse({
    ...real,
    planos: [],
    biblioteca: { origem: 'studio', pasta: join(BIBLIOTECA, '_indices', real.id) },
    corte: { status: 'pendente', jobId: null, progresso: null, etapa: null, motor: 'studio', reconhecer: true, atualizadoEm: 'x' },
  })
  confere(statusDoCorte(pendente) === 'pendente' && !temPlanos(pendente), 'indice so com falas: pendente, sem planos')
  const exMexidas = pendente.exclusoes.map((e) => ({ ...e, confirmada: true }))
  const anexado = anexarPlanos(
    { ...pendente, exclusoes: exMexidas },
    { planos: real.planos, biblioteca: real.biblioteca, reconhecimento: real.reconhecimento, avisos: ['aviso do corte'] },
    '2026-10-14T13:00:00.000Z',
  )
  confere(statusDoCorte(anexado) === 'pronto' && anexado.planos.length === real.planos.length, 'anexarPlanos: pronto, com os planos')
  confere(anexado.id === real.id && JSON.stringify(anexado.cues) === JSON.stringify(pendente.cues) && JSON.stringify(anexado.exclusoes) === JSON.stringify(exMexidas), 'anexarPlanos: id, cues e regua mexida ficam')
  confere(anexado.avisos.includes('aviso do corte') && anexado.criadoEm === pendente.criadoEm, 'anexarPlanos: avisos somados, criadoEm fica')
  const planoTorto = { ...real.planos[0]!, cueIds: ['c9999999'] }
  confere(lanca(() => anexarPlanos(pendente, { planos: [planoTorto], biblioteca: real!.biblioteca, reconhecimento: 'feito' }, 'x')), 'plano citando cue que nao existe: recusado')
} else {
  confere(false, 'nenhum indice de verdade para conferir')
}

// ------------------------------------------------------------- 5. projeto
secao('5. Projeto: campo studio opcional')
const minimo = {
  version: 1,
  savedAt: 'x',
  audio: { path: 'a.wav', rel: null, fileName: 'a.wav' },
  images: [],
  script: null,
  subtitle: null,
  plan: null,
  planOrigin: null,
  planEdited: false,
  transcript: null,
  captions: [],
  captionsEdited: false,
  captionsEnabled: true,
  captionY: 0.42,
  captionScale: 1,
  sfxEnabled: true,
}
const semStudio = projectFileSchema.safeParse(minimo)
confere(semStudio.success && semStudio.data.studio === undefined, 'projeto do Dangai: sem studio, continua valido')
const studio = { rascunhoId: 'rc_25d63d4babd6_mv78ssvg', episodioId: EP, takeId: 't1', roteiroVersao: 3, vozAlinhada: true, geradoEm: 'x' }
const comStudio = projectFileSchema.safeParse({ ...minimo, studio })
confere(comStudio.success && comStudio.data.studio?.vozAlinhada === true, 'projeto do Studio: studio preservado no parse')

console.log(falhas === 0 ? '\nTUDO CERTO' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
