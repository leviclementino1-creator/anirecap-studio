/**
 * O motor de personagens (electron/services/motor.ts + motor/), de verdade:
 * Python do venv, GPU e o episodio real, sem a interface.
 *
 * Dois modos:
 * - rapido (~1 min): probe (GPU e cache da sessao), parse do nome dos dois
 *   episodios de teste, os erros que voltam antes de subir processo (motor
 *   ocupado, biblioteca so leitura, video sumido, AnCut ausente) e um
 *   cancelamento no meio de um corte real, com o fim chegando UMA vez.
 * - completo (10 a 20 min na 1a vez de um anime): `run` com reconhecimento no
 *   episodio NOVO, numa biblioteca e numa pasta de dados TEMPORARIAS. Confere
 *   shots/, keyframes/, metadata/shots.json com personagens e os tempos de
 *   cada etapa (metadata/timings.json).
 *
 * Nos dois, a pasta %LOCALAPPDATA%\CorteCenas e listada com mtime antes e
 * depois: o motor do Studio nao pode encostar nela.
 *
 * Rodar da raiz do projeto (a pasta base e onde ficam a biblioteca e os dados
 * temporarios; o padrao e o temp do sistema):
 *   npx esbuild scripts/teste/v-motor.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json --outfile=out/teste/v-motor.cjs
 *   node out/teste/v-motor.cjs rapido [pasta-base]
 *   node out/teste/v-motor.cjs completo [pasta-base]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { FimDaAnalise, ProgressoDaAnalise } from '../../shared/episodio'
import {
  adivinharPeloMotor,
  analisarEpisodio,
  cancelarAnalise,
  configurarMotor,
  encerrarMotor,
  pastaDeDadosDoMotor,
  statusDoMotor,
  type OuvintesDaAnalise,
} from '../../electron/services/motor'
import { configureSettings, saveSettings, type Cofre } from '../../electron/services/settings'

const ACHADO = 'C:/Users/levic/Downloads/[SubsPlease] Dr. Stone S4 - 37 (1080p) [477E9A74].mkv'
const NOVO = 'C:/Users/levic/Downloads/Dr.STONE.S04E24.Whole.New.World.1080p.NF.WEB-DL.AAC2.0.H.264-VARYG.mkv'

const modo = process.argv[2] ?? 'rapido'
const base = resolve(process.argv[3] ?? join(tmpdir(), 'anirecap-v-motor'))
// A raiz do repositorio, onde mora motor/: o script roda dela.
const raiz = process.cwd()

let falhas = 0
function confere(cond: unknown, msg: string): void {
  if (cond) console.log(`  ok   ${msg}`)
  else {
    falhas += 1
    console.log(`  FALHA ${msg}`)
  }
}

async function lanca(fn: () => Promise<unknown>, trecho: string, msg: string): Promise<void> {
  try {
    await fn()
    confere(false, `${msg} (nao lancou)`)
  } catch (e) {
    const texto = e instanceof Error ? e.message : String(e)
    confere(texto.includes(trecho), `${msg}: "${texto}"`)
  }
}

// ---------------------------------------------------- %LOCALAPPDATA%\CorteCenas

type Foto = Map<string, string>

function fotografar(pasta: string): Foto {
  const foto: Foto = new Map()
  const andar = (dir: string): void => {
    let itens: string[]
    try {
      itens = readdirSync(dir)
    } catch {
      return
    }
    for (const nome of itens) {
      const p = join(dir, nome)
      try {
        const st = statSync(p)
        foto.set(p, `${st.size}|${st.mtimeMs}`)
        if (st.isDirectory()) andar(p)
      } catch {
        /* sumiu no meio */
      }
    }
  }
  foto.set(pasta, existsSync(pasta) ? String(statSync(pasta).mtimeMs) : 'ausente')
  andar(pasta)
  return foto
}

function diferencas(antes: Foto, depois: Foto): string[] {
  const out: string[] = []
  for (const [p, v] of depois) if (antes.get(p) !== v) out.push(`${antes.has(p) ? 'mudou' : 'novo'}: ${p}`)
  for (const p of antes.keys()) if (!depois.has(p)) out.push(`sumiu: ${p}`)
  return out
}

const CORTECENAS = join(process.env['LOCALAPPDATA'] ?? '', 'CorteCenas')

// ------------------------------------------------------------------ preparo

const cofreFalso: Cofre = {
  isEncryptionAvailable: () => false,
  encryptString: (s: string) => Buffer.from(s, 'utf8'),
  decryptString: (b: Buffer) => b.toString('utf8'),
}

function preparar(nome: string): { userData: string; biblioteca: string } {
  const pasta = join(base, nome)
  const userData = join(pasta, 'userData')
  const biblioteca = join(pasta, 'Biblioteca')
  mkdirSync(userData, { recursive: true })
  configureSettings(userData, cofreFalso)
  saveSettings({ bibliotecaStudio: biblioteca })
  configurarMotor({ userData, appPath: raiz, empacotado: false })
  return { userData, biblioteca }
}

interface Gravador extends OuvintesDaAnalise {
  eventos: ProgressoDaAnalise[]
  fins: FimDaAnalise[]
  /** Resolve no primeiro fim. */
  fim: (f: FimDaAnalise) => void
  esperarFim: Promise<FimDaAnalise>
}

function gravador(aoProgresso?: (p: ProgressoDaAnalise) => void): Gravador {
  let resolver: (f: FimDaAnalise) => void = () => {}
  const g: Gravador = {
    eventos: [],
    fins: [],
    esperarFim: new Promise((r) => {
      resolver = r
    }),
    progresso(p) {
      g.eventos.push(p)
      aoProgresso?.(p)
    },
    fim(f) {
      g.fins.push(f)
      resolver(f)
    },
  }
  return g
}

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
/** Prazo para um Promise.race: unref, para o relogio nao segurar o node aberto depois do fim. */
const prazo = (ms: number): Promise<null> => new Promise((r) => setTimeout(() => r(null), ms).unref())

// ------------------------------------------------------------------- rapido

async function rapido(): Promise<void> {
  const { biblioteca } = preparar('rapido')
  rmSync(biblioteca, { recursive: true, force: true })

  console.log('\n[probe]')
  let t = Date.now()
  const status = await statusDoMotor()
  const t1 = Date.now() - t
  console.log(`  ${JSON.stringify(status)} (${t1} ms)`)
  confere(status.studio.pronto, 'motor do Studio pronto')
  confere(/5080/.test(status.studio.gpu ?? ''), `GPU = RTX 5080 (${status.studio.gpu})`)
  confere(!status.ancut.instalado, 'AnCut HUB nao instalado nesta maquina')
  t = Date.now()
  await statusDoMotor()
  const t2 = Date.now() - t
  confere(t2 < 200, `2a chamada vem do cache (${t2} ms contra ${t1} ms)`)

  console.log('\n[parse]')
  for (const arquivo of [ACHADO, NOVO]) {
    t = Date.now()
    const palpite = await adivinharPeloMotor(arquivo)
    console.log(`  ${JSON.stringify(palpite)} (${Date.now() - t} ms)  <- ${arquivo.split('/').pop()}`)
    confere(palpite?.temporada === 4, 'temporada 4')
  }
  confere((await adivinharPeloMotor(ACHADO))?.episodio === 37, 'S4 - 37 -> episodio 37')
  confere((await adivinharPeloMotor(NOVO))?.episodio === 24, 'S04E24 -> episodio 24')

  console.log('\n[erros antes de subir processo]')
  const pedido = {
    path: ACHADO,
    anime: 'Dr. Stone',
    temporada: 4,
    episodio: 37,
    kind: '' as const,
    motor: 'studio' as const,
    reconhecer: false,
  }
  await lanca(
    () => analisarEpisodio({ ...pedido, path: 'C:/nao/existe.mkv' }, gravador()),
    'nao esta mais no disco',
    'video sumido',
  )
  await lanca(() => analisarEpisodio({ ...pedido, motor: 'ancut' }, gravador()), 'AnCut HUB', 'AnCut ausente')
  // Video inexistente DE PROPOSITO: se a guarda falhasse, o pedido parava no
  // video antes de criar pasta ou subir o motor na biblioteca protegida.
  saveSettings({ bibliotecaStudio: 'G:\\App Corte Cenas\\Output\\_v_motor_nao_existe' })
  await lanca(
    () => analisarEpisodio({ ...pedido, path: 'C:/nao/existe.mkv' }, gravador()),
    'nao grava',
    'biblioteca dentro do Corte Cenas recusada',
  )
  confere(!existsSync('G:\\App Corte Cenas\\Output\\_v_motor_nao_existe'), 'nada criado no Corte Cenas')
  saveSettings({ bibliotecaStudio: biblioteca })

  console.log('\n[cancelar no meio de um corte real]')
  let jobId = ''
  let eventoAntesDoId = false
  let cancelei = 0
  const g = gravador((p) => {
    if (!jobId) eventoAntesDoId = true
    if (p.etapa === 'detectando' && !cancelei) {
      cancelei = Date.now()
      console.log(`  cancelando em "${p.mensagem}"`)
      void cancelarAnalise(p.jobId)
      void cancelarAnalise(p.jobId) // 2o clique: no-op
    }
  })
  t = Date.now()
  jobId = await analisarEpisodio(pedido, g)
  console.log(`  jobId ${jobId}`)
  await lanca(() => analisarEpisodio(pedido, gravador()), 'Ja existe', 'segundo job recusado')
  await cancelarAnalise('job_que_nao_existe')
  const fim = await Promise.race([g.esperarFim, prazo(180_000)])
  console.log(`  fim: ${JSON.stringify(fim)} (${((Date.now() - (cancelei || t)) / 1000).toFixed(1)} s depois do cancelar)`)
  confere(!eventoAntesDoId, 'nenhum evento antes do jobId voltar')
  confere(g.eventos.length > 0 && g.eventos.every((e) => e.jobId === jobId), 'progresso com o jobId certo')
  confere(g.eventos.some((e) => e.etapa === 'preparando'), 'etapa preparando apareceu')
  confere(fim && !fim.ok && fim.cancelado, 'fim = cancelado')
  await esperar(3000)
  confere(g.fins.length === 1, `fim entregue uma vez (${g.fins.length})`)

  console.log('\n[depois do cancelar, outro job sobe]')
  const g2 = gravador()
  const id2 = await analisarEpisodio(pedido, g2)
  await esperar(1500)
  await cancelarAnalise(id2)
  const fim2 = await Promise.race([g2.esperarFim, prazo(60_000)])
  confere(fim2 && !fim2.ok && fim2.cancelado, `segundo job sobe e cancela (${g2.eventos.length} progressos)`)
  await esperar(1500)

  console.log('\n[pasta de dados do motor]')
  const dados = pastaDeDadosDoMotor()
  console.log(`  ${dados}: ${existsSync(dados) ? readdirSync(dados).join(', ') : '(nao criada)'}`)
  confere(existsSync(join(dados, 'logs', 'ultima-analise.log')), 'log da ultima analise no userData do Studio')
}

// ----------------------------------------------------------------- completo

function contar(pasta: string, ext: string): number {
  try {
    return readdirSync(pasta).filter((n) => n.toLowerCase().endsWith(ext)).length
  } catch {
    return 0
  }
}

async function completo(): Promise<void> {
  const { biblioteca } = preparar('completo')
  console.log(`  biblioteca temporaria: ${biblioteca}`)
  console.log(`  dados do motor: ${pastaDeDadosDoMotor()}`)
  const palpite = await adivinharPeloMotor(NOVO)
  console.log(`  palpite: ${JSON.stringify(palpite)}`)
  // O nome com que a biblioteca do Corte Cenas guarda a serie.
  const anime = 'Dr. Stone'

  let etapa = ''
  let ultimaFracao = -1
  const t0 = Date.now()
  const marcas: { etapa: string; s: number }[] = []
  const g = gravador((p) => {
    const s = (Date.now() - t0) / 1000
    if (p.etapaDoMotor !== etapa) {
      etapa = p.etapaDoMotor
      ultimaFracao = -1
      marcas.push({ etapa: p.etapaDoMotor, s })
      console.log(`  [${s.toFixed(0).padStart(5)} s] ${p.etapa} (${p.etapaDoMotor}): ${p.mensagem}`)
      return
    }
    if (p.fracao !== null && p.fracao - ultimaFracao >= 0.25) {
      ultimaFracao = p.fracao
      console.log(`  [${s.toFixed(0).padStart(5)} s]   ${Math.round(p.fracao * 100)}% ${p.mensagem}`)
    } else if (p.fracao === null && p.etapa === 'elenco') {
      console.log(`  [${s.toFixed(0).padStart(5)} s]   ${p.mensagem}`)
    }
  })
  const jobId = await analisarEpisodio(
    { path: NOVO, anime, temporada: 4, episodio: 24, kind: '', motor: 'studio', reconhecer: true },
    g,
  )
  console.log(`  jobId ${jobId}`)
  const fim = await g.esperarFim
  console.log(`\n  fim: ${JSON.stringify(fim)}`)
  confere(fim.ok, 'analise terminou ok')
  if (!fim.ok) return

  const pasta = fim.pastaDoEpisodio
  confere(resolve(pasta).toLowerCase().startsWith(resolve(biblioteca).toLowerCase()), `gravou dentro da biblioteca temporaria (${pasta})`)
  const shots = contar(join(pasta, 'shots'), '.mp4')
  const keyframes = contar(join(pasta, 'keyframes'), '.jpg')
  confere(shots > 100, `shots/: ${shots} mp4`)
  confere(keyframes >= shots, `keyframes/: ${keyframes} jpg`)
  confere(shots === fim.totalCenas, `totalCenas do fim (${fim.totalCenas}) = mp4 no disco`)

  const linhas = JSON.parse(readFileSync(join(pasta, 'metadata', 'shots.json'), 'utf8')) as {
    shot_id: string
    start: number
    end: number
    characters: { name: string; confidence: number }[]
  }[]
  const comPersonagem = linhas.filter((l) => l.characters.length > 0)
  const porNome = new Map<string, number>()
  for (const l of comPersonagem) for (const c of l.characters) porNome.set(c.name, (porNome.get(c.name) ?? 0) + 1)
  confere(linhas.length === shots, `metadata/shots.json: ${linhas.length} linhas`)
  confere(comPersonagem.length > 0, `${comPersonagem.length} cenas com personagem (${Math.round((100 * comPersonagem.length) / linhas.length)}%)`)
  console.log(
    `  personagens: ${[...porNome.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([n, c]) => `${n} (${c})`)
      .join(', ')}`,
  )
  console.log(`  identificados pelo motor: ${fim.personagens.join(', ')}`)

  let bytes = 0
  for (const n of readdirSync(join(pasta, 'shots'))) bytes += statSync(join(pasta, 'shots', n)).size
  console.log(`  tamanho de shots/: ${(bytes / 1024 ** 3).toFixed(2)} GB`)

  try {
    const tempos = JSON.parse(readFileSync(join(pasta, 'metadata', 'timings.json'), 'utf8')) as {
      total_seconds?: number
      stages?: Record<string, number>
    }
    console.log(`\n  timings.json: total ${tempos.total_seconds?.toFixed(1)} s`)
    for (const [k, v] of Object.entries(tempos.stages ?? {})) console.log(`    ${k.padEnd(18)} ${Number(v).toFixed(1)} s`)
  } catch (e) {
    confere(false, `timings.json legivel (${e instanceof Error ? e.message : e})`)
  }
  console.log(`  parede (do pedido ao fim): ${fim.segundos.toFixed(1)} s`)
  console.log(`  marcas: ${marcas.map((m) => `${m.etapa}@${m.s.toFixed(0)}s`).join(' ')}`)

  const dados = pastaDeDadosDoMotor()
  confere(existsSync(join(dados, 'cache', 'index.db')), `index.db do motor no userData do Studio (${join(dados, 'cache')})`)
}

// --------------------------------------------------------------------- main

async function main(): Promise<void> {
  console.log(`v-motor ${modo} | base ${base}`)
  const antes = fotografar(CORTECENAS)
  try {
    if (modo === 'completo') await completo()
    else await rapido()
  } finally {
    encerrarMotor()
  }
  console.log('\n[%LOCALAPPDATA%\\CorteCenas intocado]')
  const mudou = diferencas(antes, fotografar(CORTECENAS))
  confere(mudou.length === 0, `${antes.size} entradas, ${mudou.length} mudancas${mudou.length ? `: ${mudou.join('; ')}` : ''}`)
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\ntudo certo')
  process.exitCode = falhas ? 1 : 0
}

void main()
