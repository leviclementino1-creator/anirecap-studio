/**
 * O PASSO 1 SEM ESPERAR O CORTE (electron/services/episodio/falas.ts e
 * corte-fundo.ts), sem interface, com episodios REAIS da pasta Downloads e
 * tudo gravado numa pasta TEMPORARIA (userData e biblioteca do Studio falsos).
 *
 * Modo `rapido` (padrao, ~1 min): motor FALSO (trocarMotorDoCorte), que manda
 * andamento e fim quando o teste quer. Confere:
 *  1. indexarFalas num episodio novo: indice so com as falas em segundos,
 *     planos [], corte 'pendente', em <bib>/_indices/<id>/episodio.json;
 *     de novo = reaproveita; salvarExclusoes funciona nele;
 *  2. iniciarCorte -> 'cortando' (gravado), andamento pelo evento, fim ok ->
 *     planos anexados com as cues DESTE indice, regua salva no meio fica,
 *     indice vai para <pasta>/episodio.json, o de _indices e renomeado (nao
 *     apagado), lembrado no perfil, evento com o indice; o indexarEpisodio
 *     reaproveita esse indice (planosDesde) e o indexarFalas o devolve;
 *  3. cancelar -> 'pendente'; needs-input -> 'falhou' com descoberta;
 *     'cortando' lido do disco sem job -> 'pendente';
 *  4. fila: o 2o episodio espera ("Na fila") e sobe sozinho; cancelar na fila;
 *  5. progressoDoCorte so anda para frente nas etapas do motor;
 *  6. G:/App Corte Cenas e %LOCALAPPDATA%/CorteCenas nao mudaram.
 *
 * Modo `real` (minutos): o motor DE VERDADE (motor/.venv) cortando o episodio
 * novo, `cutOnly` (ou com personagens: `real reconhecer`). Mede a legenda, a
 * subida e o corte, e confere os planos anexados.
 *
 * Rodar da raiz do projeto:
 *   npx esbuild scripts/teste/v-corte-fundo.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json --outfile=out/teste/v-corte-fundo.cjs
 *   node out/teste/v-corte-fundo.cjs rapido
 *   node out/teste/v-corte-fundo.cjs real [reconhecer]
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import {
  lerIndice,
  statusDoCorte,
  temPlanos,
  type EpisodeIndex,
  type EventoDoCorte,
  type FimDaAnalise,
  type PedidoDeAnalise,
} from '../../shared/episodio'
import { ffmpegPath } from '../../electron/services/ffmpeg-path'
import { configureSettings, saveSettings, type Cofre } from '../../electron/services/settings'
import { configurarMotor, encerrarMotor, type OuvintesDaAnalise } from '../../electron/services/motor'
import {
  configurarEpisodios,
  acharIndice,
  indexarEpisodio,
  salvarExclusoes,
} from '../../electron/services/episodio/indice'
import {
  cancelarCorte,
  estadoDoCorte,
  estadoLido,
  indexarFalas,
  iniciarCorte,
  progressoDoCorte,
  trocarMotorDoCorte,
} from '../../electron/services/episodio/corte-fundo'
import { indiceLembrado } from '../../electron/services/episodio/perfil'
import { sondarArquivo } from '../../electron/services/episodio/sondar'
import { elencoDoEpisodio } from '../../electron/services/gerar/nomes'
import { blocoDosEventos } from '../../electron/services/gerar/prompts'
import { lerRascunho, momentoDaFrase, validarRoteiro, type RascunhoDoRecap } from '../../shared/roteiro'

const NOVO = 'C:/Users/levic/Downloads/[Erai-raws] Kaoru Hana wa Rin to Saku - 13 (REPACK) [1080p NF WEBRip HEVC AAC][MultiSub][18E88ED0].mkv'
const OUTRO = 'C:/Users/levic/Downloads/[New-raws] Yuusha Party ni Kawaii Ko ga Ita node, Kokuhaku shitemita - 02 [1080p] [Bstation].mkv'
const PROTEGIDAS = ['G:\\App Corte Cenas', join(process.env['LOCALAPPDATA'] ?? '', 'CorteCenas')]

const modo = process.argv[2] ?? 'rapido'
const comPersonagens = process.argv[3] === 'reconhecer'

let falhas = 0
function confere(ok: unknown, mensagem: string): void {
  if (ok) console.log(`  ok  ${mensagem}`)
  else {
    falhas += 1
    console.log(`  FALHOU  ${mensagem}`)
  }
}
function secao(titulo: string): void {
  console.log(`\n== ${titulo}`)
}
const seg = (ms: number): string => `${(ms / 1000).toFixed(2)} s`
const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Cada arquivo e pasta com tamanho e mtime. So le. */
function fotografar(raiz: string): Map<string, string> {
  const mapa = new Map<string, string>()
  const andar = (pasta: string): void => {
    let entradas: import('node:fs').Dirent[]
    try {
      entradas = readdirSync(pasta, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entradas) {
      const caminho = join(pasta, e.name)
      try {
        const s = statSync(caminho)
        mapa.set(caminho, `${e.isDirectory() ? 'd' : s.size}|${s.mtimeMs}`)
      } catch {
        mapa.set(caminho, 'sumiu')
      }
      if (e.isDirectory()) andar(caminho)
    }
  }
  andar(raiz)
  return mapa
}

function diferencas(antes: Map<string, string>, depois: Map<string, string>): string[] {
  const saida: string[] = []
  for (const [k, v] of antes) if (depois.get(k) !== v) saida.push(`${depois.has(k) ? 'mudou' : 'sumiu'}: ${k}`)
  for (const k of depois.keys()) if (!antes.has(k)) saida.push(`novo: ${k}`)
  return saida
}

function lerJson(caminho: string): EpisodeIndex {
  return lerIndice(JSON.parse(readFileSync(caminho, 'utf8')))
}

/**
 * Uma pasta de episodio no formato do motor, com `n` cenas de `passo` s
 * cobrindo o comeco do episodio (mp4 de 1 s de cor: o conteudo nao importa).
 */
function pastaSintetica(pasta: string, anime: string, n: number, passo: number): void {
  mkdirSync(join(pasta, 'shots'), { recursive: true })
  mkdirSync(join(pasta, 'keyframes'), { recursive: true })
  mkdirSync(join(pasta, 'metadata'), { recursive: true })
  const molde = join(pasta, 'molde.mp4')
  spawnSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=64x36:d=1', '-pix_fmt', 'yuv420p', molde])
  const bytes = readFileSync(molde)
  const linhas = []
  for (let i = 1; i <= n; i += 1) {
    const id = String(i).padStart(4, '0')
    writeFileSync(join(pasta, 'shots', `${id}.mp4`), bytes)
    writeFileSync(join(pasta, 'keyframes', `${id}_1.jpg`), Buffer.alloc(16))
    linhas.push({
      shot_id: id,
      file: `shots/${id}.mp4`,
      keyframe: `keyframes/${id}_1.jpg`,
      start: (i - 1) * passo,
      end: i * passo,
      duration: passo,
      characters: [],
      anime,
      season: 1,
      episode: 13,
    })
  }
  writeFileSync(join(pasta, 'metadata', 'shots.json'), JSON.stringify(linhas, null, 2))
  writeFileSync(join(pasta, 'metadata', 'timings.json'), JSON.stringify({ stages: { cut_shots: 1 } }))
}

// ------------------------------------------------------------ motor falso

interface JobFalso {
  id: string
  pedido: PedidoDeAnalise
  ouvintes: OuvintesDaAnalise
}

/** O motor falso: guarda os jobs; o teste manda andamento e fim. */
function motorFalso(): { jobs: JobFalso[]; cancelados: string[]; ocupado: { sim: boolean } } {
  const jobs: JobFalso[] = []
  const cancelados: string[] = []
  const ocupado = { sim: false }
  let n = 0
  trocarMotorDoCorte({
    analisar: async (pedido, ouvintes) => {
      if (ocupado.sim) throw new Error('Ja existe uma analise rodando.')
      const id = `job_falso_${(n += 1)}`
      jobs.push({ id, pedido, ouvintes })
      return id
    },
    cancelar: async (jobId) => {
      cancelados.push(jobId)
      const job = jobs.find((j) => j.id === jobId)
      // Como o motor de verdade: o fim cancelado chega depois.
      if (job) setImmediate(() => job.ouvintes.fim({ jobId, ok: false, cancelado: true, erro: 'Analise cancelada.', precisaDescoberta: null }))
    },
  })
  return { jobs, cancelados, ocupado }
}

// =================================================================== rapido

async function rapido(temp: string, bib: string): Promise<void> {
  const eventos: EventoDoCorte[] = []
  const avisar = (e: EventoDoCorte): void => {
    eventos.push(e)
  }
  const falso = motorFalso()

  // ------------------------------------------------------------- 1. falas
  secao('1. indexarFalas num episodio novo')
  const mensagens: string[] = []
  const t0 = Date.now()
  const indice = await indexarFalas({ path: NOVO, palpite: { anime: 'Kaoru Hana wa Rin to Saku', temporada: 1, episodio: 13, kind: '' } }, (m) => mensagens.push(m))
  const msFalas = Date.now() - t0
  console.log(`  ${basename(NOVO)}`)
  console.log(`  falas em ${seg(msFalas)} (${mensagens.join(' > ')})`)
  console.log(`  ${indice.cues.length} cues, faixa ${indice.faixaLegenda?.index} ${indice.faixaLegenda?.idioma} ${indice.faixaLegenda?.nome}, ${indice.exclusoes.length} exclusoes sugeridas`)
  const pendentePath = join(bib, '_indices', indice.id, 'episodio.json')
  confere(msFalas < 15_000, `legenda + OP/ED em segundos (${seg(msFalas)})`)
  confere(indice.cues.length > 50, 'tem falas')
  confere(indice.planos.length === 0 && !temPlanos(indice), 'nasce sem planos')
  confere(statusDoCorte(indice) === 'pendente' && indice.corte?.descoberta === null, "corte 'pendente'")
  confere(indice.biblioteca.origem === 'studio' && indice.biblioteca.pasta === dirname(pendentePath), 'biblioteca = _indices/<id> (origem studio)')
  confere(existsSync(pendentePath), 'gravado em <bib>/_indices/<id>/episodio.json')
  confere(acharIndice(indice.id) === pendentePath && indiceLembrado(indice.id) === pendentePath, 'acharIndice e o perfil acham')
  confere((await estadoDoCorte(indice.id))?.status === 'pendente', "estadoDoCorte: 'pendente'")

  const t1 = Date.now()
  const deNovo = await indexarFalas({ path: NOVO, palpite: { anime: 'Kaoru Hana wa Rin to Saku', temporada: 1, episodio: 13, kind: '' } }, () => {})
  confere(deNovo.criadoEm === indice.criadoEm, `de novo: reaproveita (${seg(Date.now() - t1)})`)

  const exConfirmadas = indice.exclusoes.length > 0
    ? indice.exclusoes.map((e) => ({ ...e, confirmada: true }))
    : [{ start: 10, end: 40, motivo: 'manual' as const, origem: 'usuario' as const, confirmada: true, porque: '' }]
  const salvo = await salvarExclusoes(indice.id, exConfirmadas)
  confere(salvo.exclusoes.every((e) => e.confirmada) && statusDoCorte(salvo) === 'pendente' && !temPlanos(salvo), 'salvarExclusoes no indice sem cenas')

  // ------------------------------------------------------------- 2. corte ok
  secao('2. Corte em segundo plano (motor falso), fim ok')
  const estado = await iniciarCorte({ episodioId: indice.id, motor: 'studio', reconhecer: false }, avisar)
  confere(estado.status === 'cortando' && estado.jobId === 'job_falso_1' && estado.inicio !== null, "iniciarCorte -> 'cortando' na hora")
  confere(lerJson(pendentePath).corte?.status === 'cortando', "'cortando' gravado no indice")
  confere(falso.jobs[0]?.pedido.reconhecer === false && falso.jobs[0]?.pedido.anime === 'Kaoru Hana wa Rin to Saku', 'o motor recebeu o pedido do indice')
  const mesmo = await iniciarCorte({ episodioId: indice.id, motor: 'studio', reconhecer: false }, avisar)
  confere(mesmo.jobId === estado.jobId && falso.jobs.length === 1, 'segundo pedido: o mesmo corte, sem outro motor')

  const job = falso.jobs[0]!
  job.ouvintes.progresso({ jobId: job.id, etapa: 'detectando', etapaDoMotor: 'detect_shots', fracao: 0.5, mensagem: 'Achando os cortes...' })
  job.ouvintes.progresso({ jobId: job.id, etapa: 'cortando', etapaDoMotor: 'cut_shots', fracao: 0.5, mensagem: '150/300 cenas' })
  const vivo = await estadoDoCorte(indice.id)
  console.log(`  andamento: ${vivo?.etapa} ${vivo?.progresso} "${vivo?.mensagem}"`)
  confere(vivo?.etapa === 'cortando' && (vivo.progresso ?? 0) > 0.5 && vivo.mensagem === '150/300 cenas', 'andamento ao vivo (etapa, % do corte inteiro, frase)')
  confere(lerJson(pendentePath).corte?.progresso === 0, 'andamento NAO e gravado a cada passo')
  confere(eventos.some((e) => e.estado.etapa === 'cortando') && eventos.every((e) => e.indice === null), 'eventos de andamento, sem indice')

  // A regua salva DURANTE o corte tem que sobreviver ao anexar.
  const reguaDoMeio = [...exConfirmadas, { start: 1300, end: 1320, motivo: 'manual' as const, origem: 'usuario' as const, confirmada: true, porque: '' }]
  await salvarExclusoes(indice.id, reguaDoMeio)

  const pasta = join(bib, 'Kaoru Hana wa Rin to Saku', 'S01E13')
  pastaSintetica(pasta, 'Kaoru Hana wa Rin to Saku', 120, 12)
  await esperar(20)
  const antesDoFim = eventos.length
  job.ouvintes.fim({ jobId: job.id, ok: true, motor: 'studio', pastaDoEpisodio: pasta, totalCenas: 120, personagens: [], segundos: 42, fotosDoElenco: null })
  const fimEv = eventos.slice(antesDoFim).find((e) => e.indice !== null)
  const novoPath = join(pasta, 'episodio.json')
  confere(fimEv?.estado.status === 'pronto' && fimEv.indice?.planos.length === 120, "evento 'pronto' com o indice e os 120 planos")
  confere(existsSync(novoPath), 'indice em <pasta do episodio>/episodio.json')
  confere(!existsSync(pendentePath), 'o de _indices saiu do lugar')
  const guardados = readdirSync(dirname(pendentePath)).filter((n) => /^episodio\.\d{8}-\d{6}(-\d+)?\.json$/.test(n))
  confere(guardados.length >= 1, `...renomeado, nao apagado (${guardados.join(', ')})`)
  const anexado = lerJson(novoPath)
  confere(anexado.id === indice.id && anexado.criadoEm === indice.criadoEm, 'mesmo id e criadoEm')
  confere(JSON.stringify(anexado.cues) === JSON.stringify(indice.cues), 'as mesmas cues (legenda nao relida)')
  confere(JSON.stringify(anexado.exclusoes.map((e) => [e.start, e.end])) === JSON.stringify([...reguaDoMeio].sort((a, b) => a.start - b.start).map((e) => [e.start, e.end])), 'a regua salva no meio do corte ficou')
  const comFala = anexado.planos.filter((p) => p.cueIds.length > 0).length
  const cuesValidas = new Set(anexado.cues.map((c) => c.id))
  confere(comFala > 10 && anexado.planos.every((p) => p.cueIds.every((id) => cuesValidas.has(id))), `cueIds recalculados com as cues do indice (${comFala} planos com fala)`)
  confere(anexado.biblioteca.origem === 'studio' && anexado.biblioteca.pasta === pasta && anexado.reconhecimento === 'pulado', 'biblioteca = a pasta cortada; reconhecimento pulado (cutOnly)')
  confere(statusDoCorte(anexado) === 'pronto' && anexado.corte?.motor === 'studio' && anexado.corte.reconhecer === false, "corte 'pronto' com motor e reconhecer")
  confere(acharIndice(indice.id) === novoPath && indiceLembrado(indice.id) === novoPath, 'perfil aponta para o novo')
  confere((await estadoDoCorte(indice.id))?.status === 'pronto', "estadoDoCorte: 'pronto'")

  const msgs: string[] = []
  const reusado = await indexarEpisodio({ path: NOVO, pastaDoEpisodio: pasta, origem: 'studio', palpite: { anime: anexado.anime, temporada: 1, episodio: 13, kind: '' } }, (m) => msgs.push(m))
  confere(reusado.atualizadoEm === anexado.atualizadoEm && msgs.includes('Falas ja lidas antes.'), '"Usar essa analise" depois: reaproveita o indice anexado (nao refaz)')
  const pelasFalas = await indexarFalas({ path: NOVO, palpite: { anime: 'x', temporada: 1, episodio: 13, kind: '' } }, () => {})
  confere(pelasFalas.planos.length === 120 && pelasFalas.anime === anexado.anime, 'indexarFalas num episodio ja cortado devolve o indice com cenas')
  confere((await iniciarCorte({ episodioId: indice.id, motor: 'studio', reconhecer: true }, avisar)).status === 'pronto' && falso.jobs.length === 1, "iniciarCorte de quem ja tem cenas: 'pronto', sem motor")

  // ------------------------------------------------------- 3. parar e falhar
  secao('3. Cancelar, falhar, ler do disco')
  const outro = await indexarFalas({ path: OUTRO, palpite: { anime: 'Yuusha Party ni Kawaii Ko ga Ita node, Kokuhaku shitemita', temporada: 1, episodio: 2, kind: '' } }, () => {})
  console.log(`  ${basename(OUTRO)}: ${outro.cues.length} cues (${outro.faixaLegenda?.codec})`)
  const outroPath = join(bib, '_indices', outro.id, 'episodio.json')
  const e2 = await iniciarCorte({ episodioId: outro.id, motor: 'studio', reconhecer: true }, avisar)
  confere(e2.status === 'cortando', "outro episodio: 'cortando'")
  const ev0 = eventos.length
  confere(await cancelarCorte(outro.id), 'cancelarCorte: true')
  await esperar(20)
  const depoisDoCancelar = eventos.slice(ev0).map((e) => `${e.estado.status}:${e.estado.mensagem}`)
  console.log(`  eventos: ${depoisDoCancelar.join(' > ')}`)
  confere(depoisDoCancelar.includes('cortando:Cancelando...') && depoisDoCancelar.at(-1) === 'pendente:Cancelado', "'Cancelando...' e depois 'pendente' (sem vermelho)")
  confere(lerJson(outroPath).corte?.status === 'pendente', "'pendente' gravado")
  confere(!(await cancelarCorte(outro.id)), 'cancelar sem corte vivo: false')

  await iniciarCorte({ episodioId: outro.id, motor: 'studio', reconhecer: true }, avisar)
  const j3 = falso.jobs.at(-1)!
  j3.ouvintes.fim({ jobId: j3.id, ok: false, cancelado: false, erro: 'Nao achei "Yuusha" no AniList nem no MyAnimeList.', precisaDescoberta: 'anime-nao-encontrado' })
  const falhou = await estadoDoCorte(outro.id)
  confere(falhou?.status === 'falhou' && falhou.descoberta === 'anime-nao-encontrado' && /AniList/.test(falhou.erro ?? ''), "needs-input: 'falhou' com a descoberta e o porque")
  confere(lerJson(outroPath).corte?.status === 'falhou', "'falhou' gravado (o 'voltar onde parou' ve)")

  // O nome corrigido vai junto e fica no indice.
  await iniciarCorte({ episodioId: outro.id, motor: 'studio', reconhecer: false, palpite: { anime: 'Yuusha Party', temporada: 1, episodio: 2, kind: '' } }, avisar)
  const j4 = falso.jobs.at(-1)!
  confere(j4.pedido.anime === 'Yuusha Party' && j4.pedido.reconhecer === false && lerJson(outroPath).anime === 'Yuusha Party', 'palpite corrigido: vai ao motor e fica no indice')
  // App fechou no meio: o disco diz 'cortando', ninguem esta cortando.
  confere(estadoLido(lerJson(outroPath)).status === 'pendente', "'cortando' do disco sem job vivo: 'pendente'")
  j4.ouvintes.fim({ jobId: j4.id, ok: false, cancelado: false, erro: 'O motor parou com erro: CUDA out of memory', precisaDescoberta: null })
  confere((await estadoDoCorte(outro.id))?.status === 'falhou', 'erro do motor: falhou')

  // ------------------------------------------------------------------ 4. fila
  secao('4. Fila: um corte por vez')
  const terceiro = await indexarFalas({ path: OUTRO, palpite: { anime: 'Yuusha Party', temporada: 1, episodio: 2, kind: '' } }, () => {})
  confere(terceiro.id === outro.id && statusDoCorte(terceiro) === 'falhou', 'indexarFalas de novo: o mesmo indice, o estado do corte fica')
  // Um 2o episodio pendente: o S4-37 (so as falas; a biblioteca temporaria nao o tem).
  const drstone = 'C:/Users/levic/Downloads/[SubsPlease] Dr. Stone S4 - 37 (1080p) [477E9A74].mkv'
  const ds = await indexarFalas({ path: drstone, palpite: { anime: 'Dr. Stone', temporada: 4, episodio: 37, kind: '' } }, () => {})
  const a = await iniciarCorte({ episodioId: outro.id, motor: 'studio', reconhecer: false }, avisar)
  const b = await iniciarCorte({ episodioId: ds.id, motor: 'studio', reconhecer: true }, avisar)
  confere(a.status === 'cortando' && b.status === 'pendente' && b.mensagem === 'Na fila', "o 2o espera: 'pendente', \"Na fila\"")
  const jobsAntes = falso.jobs.length
  const jA = falso.jobs.at(-1)!
  jA.ouvintes.fim({ jobId: jA.id, ok: false, cancelado: true, erro: 'Analise cancelada.', precisaDescoberta: null })
  await esperar(30)
  confere(falso.jobs.length === jobsAntes + 1 && falso.jobs.at(-1)!.pedido.path.endsWith('477E9A74].mkv'), 'o 1o acabou: o da fila subiu sozinho')
  confere((await estadoDoCorte(ds.id))?.status === 'cortando', "o da fila: 'cortando'")
  // Motor ocupado por uma analise em primeiro plano: o pedido volta com erro claro.
  falso.ocupado.sim = true
  let erroOcupado = ''
  try {
    await iniciarCorte({ episodioId: outro.id, motor: 'studio', reconhecer: false }, avisar)
  } catch (e) {
    erroOcupado = e instanceof Error ? e.message : String(e)
  }
  // (o do S4-37 esta rodando: este entra na fila, nao bate no motor)
  confere(erroOcupado === '' && (await estadoDoCorte(outro.id))?.mensagem === 'Na fila', 'com um corte rodando, o pedido entra na fila')
  confere(await cancelarCorte(outro.id), 'cancelar na fila')
  confere((await estadoDoCorte(outro.id))?.status === 'pendente', "saiu da fila: volta ao que o disco diz ('pendente' do cancelar)")
  const jDs = falso.jobs.at(-1)!
  jDs.ouvintes.fim({ jobId: jDs.id, ok: false, cancelado: true, erro: '', precisaDescoberta: null })
  await esperar(30)
  try {
    await iniciarCorte({ episodioId: outro.id, motor: 'studio', reconhecer: false }, avisar)
  } catch (e) {
    erroOcupado = e instanceof Error ? e.message : String(e)
  }
  confere(/motor esta ocupado/.test(erroOcupado), `analise em primeiro plano com a vaga: erro claro ("${erroOcupado}")`)
  falso.ocupado.sim = false

  // -------------------------------------------------------------- 5. andamento
  secao('5. progressoDoCorte')
  const seq: [Parameters<typeof progressoDoCorte>[0], number | null, boolean][] = [
    ['preparando', null, false],
    ['elenco', 0.5, false],
    ['detectando', 0.5, true],
    ['cortando', 0.5, true],
    ['elenco', 0.5, true],
    ['personagens', 0.5, true],
    ['organizando', 1, true],
  ]
  const com = seq.map(([e, f, j]) => progressoDoCorte(e, f, true, j))
  const sem = seq.filter(([e]) => e !== 'elenco' && e !== 'personagens').map(([e, f, j]) => progressoDoCorte(e, f, false, j))
  console.log(`  com personagens: ${com.join(' ')}   so corte: ${sem.join(' ')}`)
  confere(com.every((v, i) => i === 0 || v >= com[i - 1]!) && com.at(-1) === 1, 'com personagens: so anda para frente, termina em 1')
  confere(sem.every((v, i) => i === 0 || v >= sem[i - 1]!) && sem.at(-1) === 1, 'so corte: so anda para frente, termina em 1')

  // ------------------------------------------------------ 6. passo 2 sem planos
  secao('6. Passo 2 com o indice sem planos (S4-37 real, so leitura)')
  passo2SemPlanos()
  void temp
}

/**
 * O que o passo 2 usa do indice, com e sem planos, sobre o rascunho REAL do
 * S4-37 (roteiro v3 aprovado) e o indice real dele -- os dois so lidos. Sem
 * planos (corte rodando) nada pode quebrar: o prompt so perde o "em cena" dos
 * rostos, o momento de cada frase fica sem miniatura e a validacao nao inventa
 * erro de "frase sem cena".
 */
function passo2SemPlanos(): void {
  const recaps = join(process.env['APPDATA'] ?? '', 'AniRecap Studio', 'recaps')
  const indiceReal = 'G:\\AniRecap Studio\\Biblioteca\\_indices\\ep_25d63d4babd6dd9145aae70912d5b5b2b1fcb067\\episodio.json'
  let rascunho: RascunhoDoRecap | null = null
  try {
    for (const nome of readdirSync(recaps).filter((n) => n.startsWith('rc_25d63d4babd6') && n.endsWith('.json'))) {
      const r = lerRascunho(JSON.parse(readFileSync(join(recaps, nome), 'utf8')))
      if (r.aprovado && r.atual !== null && (!rascunho || r.atualizadoEm > rascunho.atualizadoEm)) rascunho = r
    }
  } catch (e) {
    console.log(`  (rascunho do S4-37 nao abriu: ${e instanceof Error ? e.message : String(e)})`)
  }
  if (!rascunho || !existsSync(indiceReal)) {
    confere(false, 'rascunho aprovado e indice do S4-37 para conferir')
    return
  }
  const comPlanos = lerJson(indiceReal)
  // O indice como ele fica enquanto o corte roda: as mesmas falas, sem planos.
  const semPlanos: EpisodeIndex = { ...comPlanos, planos: [] }
  const roteiro = rascunho.roteiros.find((r) => r.versao === rascunho!.atual)!
  const eventos = rascunho.eventos

  const elencoCom = elencoDoEpisodio(comPlanos)
  const elencoSem = elencoDoEpisodio(semPlanos)
  console.log(`  elenco: ${elencoSem.personagens.length} sem planos, ${elencoCom.personagens.length} com`)
  confere(elencoSem.personagens.length > 0 && elencoSem.comFalante, 'elenco sai das falas sem os planos')

  const blocoCom = blocoDosEventos(eventos, comPlanos, elencoCom)
  const blocoSem = blocoDosEventos(eventos, semPlanos, elencoSem)
  const semCena = (b: string): number => b.split('\n').filter((l) => l.includes('sem cena no epis')).length
  console.log(`  prompt dos eventos: ${blocoSem.length} caracteres sem planos (${semCena(blocoCom)} "sem cena" com planos, ${semCena(blocoSem)} sem)`)
  confere(blocoSem.length > 1000 && semCena(blocoSem) === 0, 'prompt do roteiro sem planos: monta, sem marcar "sem cena" em tudo')

  const erros = (i: EpisodeIndex): string[] =>
    validarRoteiro(roteiro, eventos, i).filter((p) => p.nivel === 'erro').map((p) => p.codigo)
  confere(JSON.stringify(erros(semPlanos)) === JSON.stringify(erros(comPlanos)), `validarRoteiro: os mesmos erros com e sem planos (${erros(semPlanos).length})`)

  const frases = roteiro.secoes.flatMap((s) => s.frases)
  const momentosSem = frases.map((f) => momentoDaFrase(f, eventos, semPlanos))
  const momentosCom = frases.map((f) => momentoDaFrase(f, eventos, comPlanos))
  console.log(`  ${frases.length} frases: ${momentosCom.filter((m) => m?.planoId).length} com miniatura com planos, ${momentosSem.filter((m) => m?.planoId).length} sem`)
  confere(momentosSem.every((m, i) => (m === null) === (momentosCom[i] === null) && (m === null || m.planoId === null)), 'momento de cada frase: o mesmo instante, sem miniatura ate os planos chegarem')
  confere(momentosCom.some((m) => m?.planoId), '...e com os planos, a miniatura aparece')
}

// ===================================================================== real

async function real(bib: string, userData: string): Promise<void> {
  trocarMotorDoCorte(null)
  configurarMotor({ userData, appPath: process.cwd(), empacotado: false })
  const eventos: { t: number; e: EventoDoCorte }[] = []
  let pronto: (() => void) | null = null
  const acabou = new Promise<void>((r) => {
    pronto = r
  })
  const t0 = Date.now()
  const avisar = (e: EventoDoCorte): void => {
    eventos.push({ t: Date.now() - t0, e })
    if (e.estado.status !== 'cortando' && e.estado.mensagem !== 'Na fila') pronto?.()
  }

  secao(`Real: ${basename(NOVO)} (${comPersonagens ? 'com personagens' : 'so corte'})`)
  const sonda = await sondarArquivo(NOVO)
  console.log(`  ${Math.round(sonda.duracaoSec)} s de video, ${sonda.codec} ${sonda.largura}x${sonda.altura}`)
  const tFalas = Date.now()
  const indice = await indexarFalas({ path: NOVO, palpite: { anime: 'Kaoru Hana wa Rin to Saku', temporada: 1, episodio: 13, kind: '' } }, () => {})
  const msFalas = Date.now() - tFalas
  console.log(`  falas + OP/ED: ${seg(msFalas)} (${indice.cues.length} cues, ${indice.exclusoes.length} exclusoes)`)
  confere(msFalas < 15_000 && !temPlanos(indice), 'legenda pronta em segundos, sem planos')

  const tCorte = Date.now()
  const e = await iniciarCorte({ episodioId: indice.id, motor: 'studio', reconhecer: comPersonagens }, avisar)
  console.log(`  iniciarCorte respondeu em ${seg(Date.now() - tCorte)}: ${e.status} ${e.jobId}`)
  confere(e.status === 'cortando', "'cortando' na hora (o roteiro ja estaria liberado)")

  // Um retrato a cada 15 s, para o log.
  const relogio = setInterval(() => {
    const ultimo = eventos.at(-1)?.e.estado
    if (ultimo) console.log(`  ${seg(Date.now() - tCorte)}  ${ultimo.etapa} ${ultimo.progresso} ${ultimo.mensagem}`)
  }, 15_000)
  await acabou
  clearInterval(relogio)
  const fim = eventos.at(-1)!.e
  const msCorte = Date.now() - tCorte
  console.log(`  corte terminou em ${seg(msCorte)}: ${fim.estado.status} ${fim.estado.erro ?? ''}`)
  // As etapas na ordem em que o andamento passou, e o % so subindo.
  const etapas: string[] = []
  let sobe = true
  let antes = 0
  for (const { e: ev } of eventos) {
    if (ev.estado.etapa && etapas.at(-1) !== ev.estado.etapa) etapas.push(ev.estado.etapa)
    if (ev.estado.status === 'cortando' && ev.estado.progresso !== null) {
      if (ev.estado.progresso < antes) sobe = false
      antes = ev.estado.progresso
    }
  }
  console.log(`  ${eventos.length} eventos; etapas: ${etapas.join(' > ')}`)
  confere(sobe, 'o % do corte so sobe')
  confere(fim.estado.status === 'pronto' && fim.indice !== null, "fim: 'pronto' com o indice")
  if (fim.indice) {
    const novo = fim.indice
    const disco = lerJson(join(novo.biblioteca.pasta, 'episodio.json'))
    const comFala = novo.planos.filter((p) => p.cueIds.length > 0).length
    console.log(`  ${novo.planos.length} planos, ${comFala} com fala, reconhecimento ${novo.reconhecimento}, pasta ${novo.biblioteca.pasta}`)
    confere(novo.planos.length > 100 && comFala > 20, 'planos anexados, com as falas cruzadas')
    confere(disco.planos.length === novo.planos.length && JSON.stringify(disco.cues) === JSON.stringify(indice.cues), 'gravado na pasta do episodio, com as mesmas cues')
    confere(novo.planos.every((p) => existsSync(p.arquivo)), 'todo plano aponta para um mp4 que existe')
    confere(!existsSync(join(bib, '_indices', indice.id, 'episodio.json')), 'o de _indices foi renomeado')
  }
  console.log(`\n  TEMPOS: falas ${seg(msFalas)} | roteiro liberado em ${seg(msFalas)} | corte ${seg(msCorte)}`)
  encerrarMotor()
}

// ===================================================================== main

async function main(): Promise<void> {
  console.log('Fotografando as pastas protegidas (antes)...')
  const antes = PROTEGIDAS.map(fotografar)

  const temp = mkdtempSync(join(tmpdir(), 'v-corte-fundo-'))
  const userData = join(temp, 'userData')
  const bib = join(temp, 'Biblioteca')
  mkdirSync(userData, { recursive: true })
  const cofreFalso: Cofre = {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.alloc(0),
    decryptString: () => '',
  }
  configureSettings(userData, cofreFalso)
  saveSettings({ bibliotecaStudio: bib, libraryDir: '' })
  configurarEpisodios(userData)
  console.log(`Pasta temporaria: ${temp}`)

  try {
    if (modo === 'real') await real(bib, userData)
    else await rapido(temp, bib)
  } catch (e) {
    falhas += 1
    console.log(`  FALHOU com excecao: ${e instanceof Error ? e.stack : String(e)}`)
  }

  secao('Pastas protegidas')
  const depois = PROTEGIDAS.map(fotografar)
  PROTEGIDAS.forEach((raiz, i) => {
    const d = diferencas(antes[i]!, depois[i]!)
    confere(d.length === 0, `${raiz} intocada${d.length ? `: ${d.slice(0, 5).join('; ')}` : ''}`)
  })

  console.log(falhas === 0 ? '\nTUDO CERTO' : `\n${falhas} FALHA(S)`)
  process.exit(falhas === 0 ? 0 : 1)
}

void main()
