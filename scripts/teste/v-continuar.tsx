/**
 * "NOVO RECAP | CONTINUAR" (decisao do Levi, 15/10), sem app e sem navegador:
 * as regras puras (src/store/gerar-continuar.ts), o passo no resumo do main
 * (shared/roteiro.ts, passoDoRascunho, pelo listarRascunhos DE VERDADE sobre
 * uma pasta temporaria), a porta e o abrir no store DE VERDADE
 * (src/store/gerar.ts: abrirOuEscolher, novoRecap, continuar) com a janela
 * falsa do v-continuar-janela.ts, e uma fumaca do cartao (react-dom/server).
 *
 * Confere:
 *   1. titulo -> anime + episodio; "ha 2 h"; lista: mais recente primeiro, UMA
 *      linha por episodio, no maximo 6, nome do passo;
 *   2. o resumo do main sai com o passo, igual ao passoAoRestaurar do rascunho
 *      (os rascunhos reais do Levi so LIDOS, copiados para a pasta temporaria);
 *   3. porta: sem rascunho vai direto ao dialogo; com rascunho abre a escolha
 *      (e nao o dialogo); segundo clique nao lista de novo; episodio aberto ou
 *      analise rodando reabre como antes, sem listar; lista que falha = dialogo;
 *   4. continuar: abre no passo onde parou (o rascunho vai para o passo 2 sem
 *      pedir de novo); outra linha no meio e ignorada; episodio sem dados =
 *      a escolha fica com o recado do main; video que sumiu abre igual;
 *   5. novo: cancelar o dialogo deixa a escolha; escolher ou soltar fecha e
 *      abre com o arquivo; .mkv solto no botao enquanto a lista vinha manda;
 *   6. o cartao: "Novo recap", "Continuar", as linhas e o recado, em ASCII.
 *
 * Nao escreve nada fora da pasta temporaria. Rodar da raiz do projeto:
 *   npx esbuild scripts/teste/v-continuar.tsx --bundle --platform=node --packages=external --jsx=automatic --tsconfig=tsconfig.web.json | node
 */
import { atrasos, chamadas, quantas, respostas, ultima } from './v-continuar-janela'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { lerIndice, type EpisodeIndex } from '../../shared/episodio'
import { idDoRascunho, lerRascunho, resumirRascunho, type RascunhoDoRecap } from '../../shared/roteiro'
import { configurarEpisodios } from '../../electron/services/episodio/perfil'
import { listarRascunhos } from '../../electron/services/gerar/rascunho'
import {
  haQuantoTempo,
  nomeDoPasso,
  partesDoTitulo,
  recapsParaContinuar,
  RECAPS_PARA_CONTINUAR,
} from '../../src/store/gerar-continuar'
import { passoAoRestaurar } from '../../src/store/gerar-passos'
import { useGerar } from '../../src/store/gerar'
import { CartaoDaEscolha } from '../../src/components/gerar/EscolhaDoRecap'

let falhas = 0
function confere(ok: boolean, mensagem: string): void {
  if (ok) console.log(`  ok  ${mensagem}`)
  else {
    falhas += 1
    console.log(`  FALHOU  ${mensagem}`)
  }
}
const espera = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const texto = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

// ---------------------------------------------------------------- os dados

/** Os rascunhos REAIS do Levi: so lidos (copiados para a pasta temporaria). */
const RECAPS_REAIS = join(process.env.APPDATA ?? '', 'AniRecap Studio', 'recaps')
const INDICE_REAL = 'G:/AniRecap Studio/Biblioteca/_indices/ep_25d63d4babd6dd9145aae70912d5b5b2b1fcb067/episodio.json'

const TMP = mkdtempSync(join(tmpdir(), 'v-cont-'))
const RECAPS = join(TMP, 'recaps')
mkdirSync(RECAPS, { recursive: true })

function idDoEpisodio(nome: string): string {
  return `ep_${createHash('sha1').update(nome).digest('hex')}`
}

/** Grava um rascunho na pasta temporaria (passa pelo zod, como o main). */
function gravar(r: RascunhoDoRecap): void {
  writeFileSync(join(RECAPS, `${r.id}.json`), JSON.stringify(lerRascunho(r), null, 2))
}

/** O mais recente do episodio, lido da pasta temporaria (o que o abrirRascunho de verdade faz). */
function maisRecente(episodioId: string): RascunhoDoRecap | null {
  const todos = readdirSync(RECAPS)
    .filter((n) => n.endsWith('.json'))
    .map((n) => lerRascunho(JSON.parse(readFileSync(join(RECAPS, n), 'utf8'))))
    .filter((r) => r.episodioId === episodioId)
    .sort((a, b) => b.atualizadoEm.localeCompare(a.atualizadoEm))
  return todos[0] ?? null
}

async function main(): Promise<void> {
  // ------------------------------------------------------------ 1. regras puras
  console.log('1. regras puras')
  const p = (t: string): string => {
    const x = partesDoTitulo(t)
    return `${x.anime}|${x.episodio}`
  }
  confere(p('Dr STONE S04E24') === 'Dr STONE|S04E24', 'Dr STONE S04E24')
  confere(p('Dr. Stone S04E37') === 'Dr. Stone|S04E37', 'Dr. Stone S04E37 (ponto no nome)')
  confere(p('Oshi no Ko S02-OP1') === 'Oshi no Ko|S02-OP1', 'abertura: S02-OP1')
  confere(p('Kimi no Na wa Filme (2016)') === 'Kimi no Na wa|Filme (2016)' && p('Akira Filme') === 'Akira|Filme', 'filme, com e sem ano')
  confere(p('Re:Zero S03E10') === 'Re:Zero|S03E10' && p('Titulo fora do padrao') === 'Titulo fora do padrao|', 'Re:Zero; fora do padrao tudo no anime')
  confere(nomeDoPasso(2) === 'Roteiro' && nomeDoPasso(3) === 'Voz' && nomeDoPasso(4) === 'Cenas', 'nome do passo: Roteiro, Voz, Cenas')

  const AGORA = Date.parse('2026-10-15T20:00:00.000Z')
  const antes = (ms: number): string => new Date(AGORA - ms).toISOString()
  confere(haQuantoTempo(antes(20_000), AGORA) === 'agora', 'agora')
  confere(haQuantoTempo(antes(5 * 60_000), AGORA) === 'ha 5 min', 'ha 5 min')
  confere(haQuantoTempo(antes(2 * 3600_000), AGORA) === 'ha 2 h', 'ha 2 h')
  confere(haQuantoTempo(antes(26 * 3600_000), AGORA) === 'ontem', 'ontem')
  confere(haQuantoTempo(antes(3 * 86400_000), AGORA) === 'ha 3 dias', 'ha 3 dias')
  confere(/^\d{2}\/\d{2}$/.test(haQuantoTempo(antes(9 * 86400_000), AGORA)), `depois de uma semana, o dia (${haQuantoTempo(antes(9 * 86400_000), AGORA)})`)
  confere(haQuantoTempo('lixo', AGORA) === '', 'data que nao le: vazio')

  const resumo = (episodioId: string, titulo: string, atualizadoEm: string, passo: 2 | 3 | 4) => ({
    id: `rc_${episodioId.slice(3, 15)}_${atualizadoEm.length}`,
    episodioId,
    titulo,
    atualizadoEm,
    eventos: 0,
    versoes: 0,
    palavras: null,
    aprovado: false,
    passo,
  })
  const crus = [
    resumo('ep_a', 'A S01E01', '2026-10-10T10:00:00.000Z', 2),
    resumo('ep_b', 'B S01E02', '2026-10-15T10:00:00.000Z', 3),
    resumo('ep_a', 'A S01E01', '2026-10-15T11:00:00.000Z', 4),
    ...Array.from({ length: 8 }, (_, i) => resumo(`ep_x${i}`, `X${i} S01E0${i}`, `2026-10-0${i + 1}T10:00:00.000Z`, 2)),
  ]
  const linhas = recapsParaContinuar(crus)
  confere(linhas.length === RECAPS_PARA_CONTINUAR && RECAPS_PARA_CONTINUAR === 6, `no maximo ${RECAPS_PARA_CONTINUAR} linhas (${linhas.length})`)
  confere(new Set(linhas.map((l) => l.episodioId)).size === linhas.length, 'uma linha por episodio')
  confere(linhas[0]?.episodioId === 'ep_a' && linhas[0]?.passo === 4 && linhas[0]?.nomeDoPasso === 'Cenas', 'o rascunho mais novo do episodio e o que vale (A, passo 4)')
  confere(linhas.every((l, i) => i === 0 || linhas[i - 1]!.atualizadoEm >= l.atualizadoEm), 'do mais recente para o mais antigo')
  confere(linhas[1]?.anime === 'B' && linhas[1]?.episodio === 'S01E02', 'anime e episodio separados')
  confere(recapsParaContinuar([]).length === 0, 'sem rascunho: lista vazia')
  {
    // O mesmo anime com duas grafias (titulo de cada rascunho): vale a do mais recente.
    const duas = recapsParaContinuar([
      resumo('ep_s37', 'Dr. Stone S04E37', '2026-10-15T12:00:00.000Z', 3),
      resumo('ep_s24', 'Dr STONE S04E24', '2026-10-15T09:00:00.000Z', 2),
    ])
    confere(duas.map((l) => l.anime).join('|') === 'Dr. Stone|Dr. Stone' && duas[1]?.episodio === 'S04E24', `uma grafia so por anime (${duas.map((l) => l.anime).join(' / ')})`)
  }

  // ------------------------------------------- 2. o passo no resumo do main
  console.log('2. passo no resumo (listarRascunhos de verdade, pasta temporaria)')
  const reais = existsSync(RECAPS_REAIS) ? readdirSync(RECAPS_REAIS).filter((n) => /^rc_[0-9a-z_]+\.json$/.test(n)) : []
  for (const nome of reais) copyFileSync(join(RECAPS_REAIS, nome), join(RECAPS, nome))
  console.log(`  (${reais.length} rascunhos reais copiados, so lidos)`)
  const base = reais.length > 0 ? lerRascunho(JSON.parse(readFileSync(join(RECAPS, reais[0]!), 'utf8'))) : null
  if (!base) {
    confere(false, 'precisa de pelo menos um rascunho real em %APPDATA%/AniRecap Studio/recaps')
    return
  }
  // Episodios sinteticos a partir de um real: outro id, outro titulo, outra hora.
  const sinteticos = [
    { nome: 'Frieren S01E05', quando: '2026-10-15T21:00:00.000Z' },
    { nome: 'Kimi no Na wa Filme (2016)', quando: '2026-10-12T08:00:00.000Z' },
    { nome: 'Re:Zero S03E10', quando: '2026-10-11T08:00:00.000Z' },
    { nome: 'Oshi no Ko S02-OP1', quando: '2026-10-10T08:00:00.000Z' },
    { nome: 'Titulo fora do padrao', quando: '2026-10-09T08:00:00.000Z' },
  ]
  for (const s of sinteticos) {
    const ep = idDoEpisodio(s.nome)
    gravar({ ...base, id: idDoRascunho(ep, Date.parse(s.quando)), episodioId: ep, titulo: s.nome, atualizadoEm: s.quando, criadoEm: s.quando })
  }
  // Um sem roteiro aprovado (passo 2) e um desaprovado com voz (passo 3 so com take).
  const EP_SEM_DADOS = idDoEpisodio('Sem Dados S01E01')
  gravar({ ...base, id: idDoRascunho(EP_SEM_DADOS, Date.parse('2026-10-15T22:00:00.000Z')), episodioId: EP_SEM_DADOS, titulo: 'Sem Dados S01E01', atualizadoEm: '2026-10-15T22:00:00.000Z' })

  configurarEpisodios(TMP)
  const lista = await listarRascunhos()
  confere(lista.length === reais.length + sinteticos.length + 1, `listarRascunhos le todos (${lista.length})`)
  let todosIguais = true
  for (const r of lista) {
    const cru = lerRascunho(JSON.parse(readFileSync(join(RECAPS, `${r.id}.json`), 'utf8')))
    if (r.passo !== passoAoRestaurar(cru) || ![2, 3, 4].includes(r.passo)) todosIguais = false
  }
  confere(todosIguais, `cada resumo sai com o passo do passoAoRestaurar (${[...new Set(lista.map((r) => r.passo))].sort().join(', ')})`)
  confere(resumirRascunho({ ...base, aprovado: false, aprovadoEm: null }).passo === 2, 'roteiro nao aprovado: passo 2')
  confere(resumirRascunho({ ...base, voz: null }).passo === 2, 'sem voz: passo 2')
  const comVozReal = lista.map((r) => lerRascunho(JSON.parse(readFileSync(join(RECAPS, `${r.id}.json`), 'utf8')))).find((r) => (r.voz?.takes.length ?? 0) > 0)
  if (comVozReal) {
    const p4 = resumirRascunho(comVozReal).passo
    const semAprovar = resumirRascunho({ ...comVozReal, voz: { ...comVozReal.voz!, aprovado: false, aprovadoEm: null } }).passo
    confere(semAprovar === 3, `com take e voz nao aprovada: passo 3 (${comVozReal.titulo})`)
    console.log(`  (${comVozReal.titulo}: passo ${p4} como esta no disco)`)
  }

  // ------------------------------------------------------- 3. a porta
  console.log('3. porta (abrirOuEscolher)')
  const indiceBase: EpisodeIndex = lerIndice(JSON.parse(readFileSync(INDICE_REAL, 'utf8')))
  const fontes = new Map<string, string>()
  const VIDEO_SUMIU = 'Z:/sumiu/episodio.mkv'
  respostas.listar = async () => ({ ok: true, value: await listarRascunhos() })
  respostas.abrir = async (episodioId) => {
    // O que o main diz quando o episodio.json nao esta em lugar nenhum (abrirIndicePorId).
    if (episodioId === EP_SEM_DADOS) return { ok: false, error: 'Nao achei os dados desse episodio. Abra o episodio de novo no passo 1.' }
    const rascunho = maisRecente(episodioId)
    if (!rascunho) return { ok: false, error: 'sem rascunho' }
    const path = fontes.get(episodioId) ?? `C:/eps/${episodioId}.mkv`
    const indice: EpisodeIndex = { ...indiceBase, id: episodioId, fonte: { ...indiceBase.fonte, path } }
    return { ok: true, value: { rascunho, indice, avisos: [] } }
  }

  const zerar = (): void => {
    useGerar.setState({ job: null })
    useGerar.getState().recomecar()
    useGerar.setState({ aberto: false, escolha: null, erro: null })
    chamadas.length = 0
    for (const k of Object.keys(atrasos)) delete atrasos[k]
    respostas.escolhido = null
  }

  // 3a. sem rascunho nenhum: direto ao dialogo, como antes.
  zerar()
  const listarDeVerdade = respostas.listar
  respostas.listar = async () => ({ ok: true, value: [] })
  await useGerar.getState().abrirOuEscolher()
  confere(quantas('escolherEpisodio') === 1 && useGerar.getState().escolha === null, 'sem rascunho: vai direto ao dialogo, sem escolha')
  respostas.escolhido = 'C:/eps/primeiro.mkv'
  await useGerar.getState().abrirOuEscolher()
  confere(useGerar.getState().aberto && ultima('sondarEpisodio')?.[0] === 'C:/eps/primeiro.mkv', 'escolheu no dialogo: o assistente abre com o arquivo')

  // 3b. lista que falha = dialogo.
  zerar()
  respostas.listar = async () => ({ ok: false, error: 'disco fora' })
  await useGerar.getState().abrirOuEscolher()
  confere(quantas('escolherEpisodio') === 1 && useGerar.getState().escolha === null, 'lista que falha: o dialogo de sempre')
  respostas.listar = listarDeVerdade

  // 3c. com rascunhos: a escolha, e nao o dialogo.
  zerar()
  await useGerar.getState().abrirOuEscolher()
  const escolha = useGerar.getState().escolha
  confere(escolha !== null && quantas('escolherEpisodio') === 0 && !useGerar.getState().aberto, 'com rascunho: abre a escolha (sem dialogo, assistente fechado)')
  const recaps = escolha?.recaps ?? []
  console.log(`  linhas: ${recaps.map((r) => `${r.anime} ${r.episodio} [${r.nomeDoPasso}]`).join(' | ')}`)
  confere(recaps.length === Math.min(6, new Set(lista.map((r) => r.episodioId)).size), `no maximo 6, uma por episodio (${recaps.length})`)
  confere(recaps[0]?.episodioId === EP_SEM_DADOS && recaps[1]?.anime === 'Frieren', 'o mais recente primeiro')
  // So o S04E37: o S04E24 (titulo "Dr STONE") agora aparece com a mesma grafia, "Dr. Stone".
  const stone = recaps.filter((r) => r.anime === 'Dr. Stone' && r.episodio === 'S04E37')
  if (reais.some((n) => n.startsWith('rc_25d63d4babd6'))) {
    const maisNovoStone = maisRecente('ep_25d63d4babd6dd9145aae70912d5b5b2b1fcb067')
    confere(stone.length <= 1 && (stone.length === 0 || stone[0]!.atualizadoEm === maisNovoStone?.atualizadoEm), 'Dr. Stone S04E37 (dois rascunhos) aparece uma vez, com o mais novo')
  }

  // 3d. segundo clique com a escolha aberta: nada (nem lista de novo).
  const listasAntes = quantas('listarRascunhos')
  await useGerar.getState().abrirOuEscolher()
  confere(quantas('listarRascunhos') === listasAntes && useGerar.getState().escolha === escolha, 'segundo clique com a escolha na tela: nada muda')

  // 3e. dois cliques seguidos com a lista no ar: lista uma vez so.
  zerar()
  atrasos.listarRascunhos = 30
  const c1 = useGerar.getState().abrirOuEscolher()
  const c2 = useGerar.getState().abrirOuEscolher()
  await Promise.all([c1, c2])
  confere(quantas('listarRascunhos') === 1 && quantas('escolherEpisodio') === 0 && useGerar.getState().escolha !== null, 'dois cliques rapidos: uma lista, uma escolha')

  // 3f. episodio aberto na sessao: reabre como antes, sem listar.
  zerar()
  useGerar.setState({ arquivo: 'C:/eps/aberto.mkv', fase: 'pronto' })
  await useGerar.getState().abrirOuEscolher()
  confere(useGerar.getState().aberto && quantas('listarRascunhos') === 0 && useGerar.getState().escolha === null, 'episodio aberto: so reabre o assistente')

  // 3g. analise rodando: idem.
  zerar()
  useGerar.setState({ job: { id: 'j1', motor: 'studio', reconhecer: true, inicio: Date.now(), cancelando: false } })
  await useGerar.getState().abrirOuEscolher()
  confere(useGerar.getState().aberto && quantas('listarRascunhos') === 0, 'analise rodando: so reabre o assistente')
  useGerar.setState({ job: null })

  // 3h. .mkv solto no botao enquanto a lista vinha: ele manda, sem escolha nem dialogo.
  zerar()
  atrasos.listarRascunhos = 40
  atrasos.sondarEpisodio = 200
  respostas.existem.add('C:/eps/solto.mkv')
  const porta = useGerar.getState().abrirOuEscolher()
  useGerar.getState().abrir('C:/eps/solto.mkv')
  await porta
  confere(useGerar.getState().escolha === null && quantas('escolherEpisodio') === 0 && useGerar.getState().arquivo === 'C:/eps/solto.mkv', 'soltou o .mkv no botao com a lista no ar: vale o arquivo')
  await espera(250)

  // ------------------------------------------------------- 4. continuar
  console.log('4. continuar')
  zerar()
  await useGerar.getState().abrirOuEscolher()

  // 4a. episodio sem dados: a escolha fica, com o recado do main.
  atrasos.abrirRascunho = 30
  const semDados = useGerar.getState().continuar(EP_SEM_DADOS)
  confere(useGerar.getState().escolha?.abrindo === EP_SEM_DADOS, 'clicou: a linha fica "abrindo"')
  const outro = recaps.find((r) => r.episodioId !== EP_SEM_DADOS)!.episodioId
  await useGerar.getState().continuar(outro)
  await semDados
  confere(quantas('abrirRascunho') === 1, 'outra linha clicada no meio: ignorada')
  const depois = useGerar.getState().escolha
  confere(
    depois !== null &&
      depois.abrindo === null &&
      // O "Abra o episodio de novo no passo 1" do main, dito para a escolha (nela nao ha passo 1).
      depois.erro === 'Episodio nao encontrado. Use Novo recap.' &&
      depois.falhou === EP_SEM_DADOS &&
      !useGerar.getState().aberto,
    'nao abriu: a escolha fica, com o recado (para esta tela) e a linha marcada',
  )
  delete atrasos.abrirRascunho

  // 4b. um recap que abre: no passo onde parou, e o rascunho vai pronto para o passo 2.
  const alvo = comVozReal ?? base
  fontes.set(alvo.episodioId, 'C:/eps/alvo.mkv')
  respostas.existem.add('C:/eps/alvo.mkv')
  await useGerar.getState().continuar(alvo.episodioId)
  const g = useGerar.getState()
  const esperado = passoAoRestaurar(maisRecente(alvo.episodioId)!)
  confere(g.escolha === null && g.aberto && g.fase === 'pronto', 'abriu: a escolha sai e o assistente abre no resumo do episodio')
  confere(g.passo === esperado, `no passo onde parou (${g.passo}, esperado ${esperado})`)
  confere(g.arquivo === 'C:/eps/alvo.mkv' && g.indice?.id === alvo.episodioId && g.erro === null, 'o episodio do rascunho, sem erro')
  confere(g.palpite?.anime === indiceBase.anime && g.exclusoes.length === indiceBase.exclusoes.length, 'palpite e marcacoes vem do indice')
  const tomado = useGerar.getState().tomarRascunhoRestaurado(alvo.episodioId)
  confere(tomado?.rascunho.episodioId === alvo.episodioId && useGerar.getState().rascunhoRestaurado === null, 'o passo 2 pega o rascunho aberto (sem pedir de novo)')

  // 4c. video que sumiu: abre igual (o roteiro e a voz moram no rascunho).
  zerar()
  await useGerar.getState().abrirOuEscolher()
  const frieren = idDoEpisodio('Frieren S01E05')
  fontes.set(frieren, VIDEO_SUMIU)
  await useGerar.getState().continuar(frieren)
  await espera(10)
  const s = useGerar.getState()
  confere(s.escolha === null && s.aberto && s.fase === 'pronto' && s.arquivo === VIDEO_SUMIU && s.sonda === null && s.erro === null, 'video que sumiu: abre no passo, sem sonda e sem erro')
  confere(ultima('sondarEpisodio')?.[0] === VIDEO_SUMIU, 'a sonda tentou (e falhou em silencio)')

  // ------------------------------------------------------- 5. novo
  console.log('5. novo recap')
  zerar()
  await useGerar.getState().abrirOuEscolher()
  respostas.escolhido = null
  await useGerar.getState().novoRecap()
  confere(useGerar.getState().escolha !== null && quantas('escolherEpisodio') === 1 && !useGerar.getState().aberto, 'cancelou o dialogo: a escolha continua')
  respostas.escolhido = 'C:/eps/novo.mkv'
  await useGerar.getState().novoRecap()
  confere(useGerar.getState().escolha === null && useGerar.getState().aberto && ultima('sondarEpisodio')?.[0] === 'C:/eps/novo.mkv', 'escolheu: a escolha sai e o assistente abre com o arquivo')

  zerar()
  await useGerar.getState().abrirOuEscolher()
  await useGerar.getState().novoRecap('C:/eps/solto-na-escolha.mkv')
  confere(useGerar.getState().escolha === null && useGerar.getState().aberto && quantas('escolherEpisodio') === 0 && ultima('sondarEpisodio')?.[0] === 'C:/eps/solto-na-escolha.mkv', 'soltou o .mkv na escolha: direto, sem dialogo')

  zerar()
  await useGerar.getState().abrirOuEscolher()
  useGerar.getState().fecharEscolha()
  confere(useGerar.getState().escolha === null && !useGerar.getState().aberto, 'fechar (Esc, X, fora): nada abre')

  // ------------------------------------------------------- 6. o cartao
  console.log('6. cartao (react-dom/server)')
  const linhasDoCartao = recapsParaContinuar(lista)
  const html = renderToStaticMarkup(<CartaoDaEscolha recaps={linhasDoCartao} abrindo={null} erro={null} fechar={() => {}} />)
  const t = texto(html)
  confere(t.includes('Novo recap') && t.includes('Continuar') && t.includes('Gerar recap'), '"Novo recap", "Continuar" e o titulo')
  confere(linhasDoCartao.every((l) => t.includes(l.anime) && t.includes(l.nomeDoPasso)), 'cada linha com anime e passo')
  confere((html.match(/data-foco="novo-recap"/g) ?? []).length === 1 && html.includes('bg-accent-dim'), 'um so principal (rosa), com o foco')
  confere(!/[^\x00-\x7F]/.test(t), 'texto da tela em ASCII')
  const comErro = texto(renderToStaticMarkup(<CartaoDaEscolha recaps={linhasDoCartao} abrindo={linhasDoCartao[0]!.episodioId} erro="Nao achei os dados desse episodio." fechar={() => {}} />))
  confere(comErro.includes('Nao achei os dados desse episodio.'), 'o recado aparece embaixo')
  const desligadas = (renderToStaticMarkup(<CartaoDaEscolha recaps={linhasDoCartao} abrindo={linhasDoCartao[0]!.episodioId} erro={null} fechar={() => {}} />).match(/disabled=""/g) ?? []).length
  confere(desligadas === linhasDoCartao.length + 1, `abrindo: as linhas e o "Novo recap" esperam (${desligadas})`)
}

main()
  .catch((e: unknown) => {
    falhas += 1
    console.error('  ERRO', e)
  })
  .finally(() => {
    rmSync(TMP, { recursive: true, force: true })
    console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
    process.exit(falhas === 0 ? 0 : 1)
  })
