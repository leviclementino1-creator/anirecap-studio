/**
 * A reserva de fotos do elenco (electron/services/elenco-reserva.ts) e o
 * motor com ela (electron/services/motor.ts), de verdade, sem a interface.
 *
 * Cinco modos:
 * - unidade (~1 s): bancos SINTETICOS numa pasta temporaria. Acha o id pelo
 *   indice e pelo titulo, copia, poe o banco ruim de lado, nao troca banco bom,
 *   recusa metadata velho e titulo ambiguo, converte o fetched_at e nao mexe
 *   na origem.
 * - antes: o motor no episodio NOVO (S04E24), com reconhecimento, numa pasta
 *   de dados VAZIA e as origens padrao (o Corte Cenas, so leitura). A reserva
 *   acha o id pelo indice do Corte Cenas e copia ANTES de o motor subir.
 * - depois: o mesmo episodio, outra pasta de dados vazia e uma origem
 *   sintetica (copia do banco do Corte Cenas com outro titulo e sem indice):
 *   antes do motor nada casa, o motor monta o elenco online (Jikan fora, 1
 *   foto cada), volta sem referencias, a reserva copia pelo id que ele
 *   resolveu e o motor roda de novo no mesmo job.
 * - real: como o app esta hoje -- copia do index.db e da memoria de pastas do
 *   motor do Studio, com os nomes da AniList da rodada sem fotos. O id sai da
 *   memoria do proprio motor e a reserva copia antes de ele subir.
 * - cancelar: cancelar durante a copia da reserva entrega o fim uma vez, o
 *   motor nem sobe e a vaga fica livre.
 *
 * Nos modos com motor, o corte e o do Studio: a pasta Dr STONE/S04E24 da
 * biblioteca do Studio e COPIADA para uma biblioteca temporaria (o motor
 * reaproveita os clipes; a biblioteca de verdade fica de fora porque o app esta
 * aberto com outro agente). G:\App Corte Cenas e %LOCALAPPDATA%\CorteCenas sao
 * listados com mtime antes e depois: nada pode mudar.
 *
 * Rodar da raiz do projeto:
 *   npx esbuild scripts/teste/v-elenco-reserva.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json --outfile=out/teste/v-elenco-reserva.cjs
 *   node out/teste/v-elenco-reserva.cjs unidade|antes|depois|real|cancelar [pasta-base]
 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { FimDaAnalise, ProgressoDaAnalise } from '../../shared/episodio'
import { fotosDoElenco, idDaPastaDeRefs, reservarElenco } from '../../electron/services/elenco-reserva'
import { analisarEpisodio, cancelarAnalise, configurarMotor, encerrarMotor, pastaDeDadosDoMotor } from '../../electron/services/motor'
import { configureSettings, saveSettings, type Cofre } from '../../electron/services/settings'

const NOVO = 'C:/Users/levic/Downloads/Dr.STONE.S04E24.Whole.New.World.1080p.NF.WEB-DL.AAC2.0.H.264-VARYG.mkv'
const EPISODIO_CORTADO = 'C:/Users/levic/OneDrive/Documentos/AniRecap Studio/Biblioteca/Dr STONE/S04E24'
const BANCO_DO_CORTE_CENAS = 'G:/App Corte Cenas/cache/anime_db/Dr. STONE_ SCIENCE FUTURE [al105333]'

const modo = process.argv[2] ?? 'unidade'
const base = resolve(process.argv[3] ?? join(tmpdir(), 'anirecap-v-elenco-reserva'))
const raiz = process.cwd()

let falhas = 0
function confere(cond: unknown, msg: string): void {
  if (cond) console.log(`  ok   ${msg}`)
  else {
    falhas += 1
    console.log(`  FALHA ${msg}`)
  }
}

// ------------------------------------------------------------ fotografia

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

const PROTEGIDAS = ['G:\\App Corte Cenas', join(process.env['LOCALAPPDATA'] ?? '', 'CorteCenas')]

// ---------------------------------------------------------------- unidade

/** image_downloader._name_for, para montar banco sintetico com o nome certo. */
function nomeDoDownload(url: string): string {
  const ext = /\.(jpg|jpeg|png|webp)$/i.exec(url.split('?')[0] ?? '')?.[0]?.toLowerCase() ?? '.jpg'
  return `${createHash('sha1').update(url).digest('hex').slice(0, 16)}${ext}`
}

interface Personagem {
  nome: string
  urls: string[]
  /** Quantas das URLs ja estao no disco. */
  noDisco: number
  /** Fotos postas a mao (nome livre). */
  aMao?: number
}

function montarBanco(pasta: string, meta: Record<string, unknown>, elenco: Personagem[]): void {
  mkdirSync(join(pasta, 'characters'), { recursive: true })
  writeFileSync(
    join(pasta, 'metadata.json'),
    JSON.stringify({
      ...meta,
      characters: elenco.map((p) => ({ mal_id: null, anilist_id: null, name: p.nome, role: 'Main', image_urls: p.urls })),
    }),
  )
  for (const p of elenco) {
    const dir = join(pasta, 'characters', p.nome.replace(/[<>:"/\\|?*]/g, '_'))
    mkdirSync(dir, { recursive: true })
    for (const u of p.urls.slice(0, p.noDisco)) writeFileSync(join(dir, nomeDoDownload(u)), 'jpg')
    for (let i = 0; i < (p.aMao ?? 0); i++) writeFileSync(join(dir, `print_${i}.jpg`), 'jpg')
  }
}

function elencoBom(): Personagem[] {
  return [
    { nome: 'Ishigami, Senkuu', urls: ['https://cdn.x/a/1.jpg?s=1', 'https://cdn.y/b/2.png'], noDisco: 2 },
    { nome: 'Kohaku', urls: ['https://cdn.x/a/3.jpg'], noDisco: 1, aMao: 2 },
    { nome: 'Chrome', urls: ['https://cdn.x/a/4.jpg', 'https://cdn.y/b/5'], noDisco: 1 },
  ]
}

async function unidade(): Promise<void> {
  const pasta = join(base, 'unidade')
  rmSync(pasta, { recursive: true, force: true })
  const origem = join(pasta, 'origem', 'anime_db')
  const dados = join(pasta, 'dados')
  process.env['ANIRECAP_ELENCO_RESERVA'] = origem

  montarBanco(
    join(origem, 'Foo Bar Science [al999]'),
    { version: 4, anilist_id: 1001, mal_id: 5, title: 'Foo Bar: Science', title_english: 'Foo Bar Science', franchise_root_id: 999, fetched_at: 1785530328 },
    elencoBom(),
  )
  montarBanco(join(origem, 'Velho [al777]'), { version: 3, title: 'Velho Anime' }, elencoBom())
  const fotoOrigem = fotografar(join(pasta, 'origem'))

  console.log('\n[id pelo titulo, cache do Studio vazio]')
  let r = await reservarElenco(dados, { anime: 'Foo Bar', temporada: 2 })
  console.log(`  ${r.linha}`)
  confere(r.reserva?.cacheId === 'al999' && r.reserva.como === 'titulo', 'achou al999 pelo titulo (prefixo em palavra inteira)')
  confere(r.reserva?.comFotos === 2, `2 personagens com fotos (Senkuu pelas URLs, Kohaku pelas postas a mao): ${r.reserva?.comFotos}`)
  const copiada = join(dados, 'cache', 'anime_db', 'Foo Bar Science [al999]')
  confere(existsSync(join(copiada, 'characters', 'Kohaku', 'print_1.jpg')), 'fotos copiadas')
  const meta = JSON.parse(readFileSync(join(copiada, 'metadata.json'), 'utf8')) as { fetched_at: unknown }
  confere(meta.fetched_at === '2026-07-31T20:38:48+00:00', `fetched_at numerico vira ISO (${String(meta.fetched_at)})`)
  confere(fotosDoElenco(dados, 'Foo Bar', 2, 'al999')?.origem === 'Corte Cenas', 'fotosDoElenco = Corte Cenas')
  confere(!existsSync(join(dados, 'cache', 'anime_db', 'busca_resolvida.json')), 'palpite de titulo NAO ensina a busca do motor')
  confere(readdirSync(join(dados, 'cache', 'anime_db')).every((n) => !n.startsWith('.reserva-')), 'sem pasta temporaria sobrando')

  console.log('\n[banco do Studio ja reconhece alguem: fica]')
  r = await reservarElenco(dados, { anime: 'Foo Bar', temporada: 2 })
  console.log(`  ${r.linha}`)
  confere(r.reserva === null && r.linha.includes('ja tem 2'), 'nada copiado')

  console.log('\n[banco ruim do Studio + indice do Corte Cenas: troca e ensina a busca]')
  rmSync(dados, { recursive: true, force: true })
  montarBanco(
    join(dados, 'cache', 'anime_db', 'Foo Bar Science [al999]'),
    { version: 4, title: 'Foo Bar: Science', partial: true, missing_gallery: [] },
    [
      { nome: 'Senkuu Ishigami', urls: ['https://anilist/1.png'], noDisco: 1 },
      { nome: 'Kohaku', urls: ['https://anilist/2.png'], noDisco: 1 },
    ],
  )
  writeFileSync(join(origem, 'index.json'), JSON.stringify({ 'foo bar|s4': 'al999' }))
  let avisos = 0
  r = await reservarElenco(dados, { anime: 'Foo Bar', temporada: 4, aoCopiar: () => (avisos += 1) })
  console.log(`  ${r.linha}`)
  confere(r.reserva?.como === 'indice', 'id pelo index.json do Corte Cenas')
  confere(avisos === 1, 'aoCopiar chamado uma vez')
  confere(r.reserva?.postosDeLado.length === 1 && existsSync(r.reserva.postosDeLado[0] ?? ''), 'banco ruim posto de lado, nao apagado')
  confere(
    (r.reserva?.postosDeLado[0] ?? '').startsWith(join(dados, 'cache', 'elenco-posto-de-lado')),
    'posto de lado FORA do anime_db (o motor nao ve)',
  )
  const atalho = JSON.parse(readFileSync(join(dados, 'cache', 'anime_db', 'busca_resolvida.json'), 'utf8')) as Record<string, string>
  confere(atalho['foo bar|s4'] === 'al999', 'busca_resolvida.json do motor aprendeu foo bar|s4 -> al999')

  console.log('\n[id pela refsDir do needs-input]')
  confere(idDaPastaDeRefs(join(dados, 'cache', 'anime_db', 'Dr. STONE_ SCIENCE FUTURE [al105333]', 'characters')) === 'al105333', 'refsDir -> al105333')
  confere(idDaPastaDeRefs('C:\\x\\anime_db\\al101280\\characters\\') === 'al101280', 'pasta antiga so com o id')

  console.log('\n[metadata velho (v3) e titulo ambiguo]')
  rmSync(dados, { recursive: true, force: true })
  r = await reservarElenco(dados, { anime: 'Velho Anime', temporada: 1 })
  confere(r.reserva === null, `v3 nao casa pelo titulo: ${r.linha}`)
  r = await reservarElenco(dados, { anime: 'Velho Anime', temporada: 1, cacheId: 'al777' })
  confere(r.reserva === null && r.linha.includes('sem banco com fotos'), `v3 recusado mesmo pelo id: ${r.linha}`)
  montarBanco(join(origem, 'Foo Bar Outro [al998]'), { version: 4, title: 'Foo Bar: Outro' }, elencoBom())
  rmSync(join(origem, 'index.json'))
  r = await reservarElenco(dados, { anime: 'Foo Bar', temporada: 1 })
  confere(r.reserva === null, `dois animes casando pelo titulo = nenhum: ${r.linha}`)
  rmSync(join(origem, 'Foo Bar Outro [al998]'), { recursive: true, force: true })

  console.log('\n[origem intocada]')
  const mudou = diferencas(fotoOrigem, fotografar(join(pasta, 'origem')))
  // O index.json e a pasta al998 foram criados e removidos pelo proprio teste.
  const deVerdade = mudou.filter((m) => !m.includes('index.json') && !m.includes('al998') && !m.endsWith('anime_db'))
  confere(deVerdade.length === 0, `${deVerdade.length} mudancas na origem${deVerdade.length ? `: ${deVerdade.join('; ')}` : ''}`)
  delete process.env['ANIRECAP_ELENCO_RESERVA']
}

// ------------------------------------------------------------ com o motor

const cofreFalso: Cofre = {
  isEncryptionAvailable: () => false,
  encryptString: (s: string) => Buffer.from(s, 'utf8'),
  decryptString: (b: Buffer) => b.toString('utf8'),
}

/** Pasta de dados vazia e biblioteca temporaria com a copia do corte do Studio. */
function preparar(nome: string): { userData: string; biblioteca: string } {
  const userData = join(base, nome, 'userData')
  rmSync(userData, { recursive: true, force: true })
  mkdirSync(userData, { recursive: true })
  const biblioteca = join(base, 'Biblioteca')
  const episodio = join(biblioteca, 'Dr STONE', 'S04E24')
  if (!existsSync(join(episodio, 'metadata', 'shot_bounds.json'))) {
    console.log(`  copiando o corte do Studio para ${episodio}...`)
    const t = Date.now()
    cpSync(EPISODIO_CORTADO, episodio, { recursive: true, preserveTimestamps: true })
    console.log(`  copiado em ${((Date.now() - t) / 1000).toFixed(1)} s`)
  }
  configureSettings(userData, cofreFalso)
  saveSettings({ bibliotecaStudio: biblioteca })
  configurarMotor({ userData, appPath: raiz, empacotado: false })
  return { userData, biblioteca }
}

function mtimesDosClipes(pasta: string): Map<string, number> {
  const m = new Map<string, number>()
  try {
    // So os clipes: as marcas .cor e .export_mode o motor regrava a cada rodada.
    for (const n of readdirSync(join(pasta, 'shots')).filter((x) => x.toLowerCase().endsWith('.mp4'))) {
      m.set(n, statSync(join(pasta, 'shots', n)).mtimeMs)
    }
  } catch {
    /* sem shots */
  }
  return m
}

async function rodar(rotulo: string): Promise<void> {
  console.log(`\n[${rotulo}] motor ${pastaDeDadosDoMotor()}`)
  const episodio = join(base, 'Biblioteca', 'Dr STONE', 'S04E24')
  const clipesAntes = mtimesDosClipes(episodio)
  const t0 = Date.now()
  let etapa = ''
  const mensagens: string[] = []
  let resolver: (f: FimDaAnalise) => void = () => {}
  const esperarFim = new Promise<FimDaAnalise>((r) => (resolver = r))
  let fins = 0
  await analisarEpisodio(
    { path: NOVO, anime: 'Dr STONE', temporada: 4, episodio: 24, kind: '', motor: 'studio', reconhecer: true },
    {
      progresso(p: ProgressoDaAnalise) {
        const s = ((Date.now() - t0) / 1000).toFixed(0).padStart(4)
        if (p.etapaDoMotor !== etapa || p.etapaDoMotor === 'studio_reserva_elenco') {
          etapa = p.etapaDoMotor
          console.log(`  [${s} s] ${p.etapa} (${p.etapaDoMotor}): ${p.mensagem}`)
        } else if (p.etapa === 'elenco' && p.fracao === null && !/^Coletando|^Refs \(|^Embeddando/.test(p.mensagem)) {
          console.log(`  [${s} s]   ${p.mensagem}`)
        }
        mensagens.push(p.mensagem)
      },
      fim(f: FimDaAnalise) {
        fins += 1
        resolver(f)
      },
    },
  )
  const fim = await esperarFim
  const parede = (Date.now() - t0) / 1000
  console.log(`  fim: ${JSON.stringify({ ...fim, ...(fim.ok ? { personagens: `${fim.personagens.length} nomes` } : {}) })}`)
  confere(fim.ok, 'analise terminou ok')
  await new Promise((r) => setTimeout(r, 2000))
  confere(fins === 1, `fim entregue uma vez (${fins})`)
  if (!fim.ok) return

  const linhas = JSON.parse(readFileSync(join(fim.pastaDoEpisodio, 'metadata', 'shots.json'), 'utf8')) as {
    characters: { name: string }[]
  }[]
  const com = linhas.filter((l) => l.characters.length > 0)
  const porNome = new Map<string, number>()
  for (const l of com) for (const c of l.characters) porNome.set(c.name, (porNome.get(c.name) ?? 0) + 1)
  confere(com.length > 0, `${com.length} de ${linhas.length} cenas com personagem`)
  console.log(`  personagens (${porNome.size}): ${[...porNome.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} (${c})`).join(', ')}`)

  const clipesDepois = mtimesDosClipes(fim.pastaDoEpisodio)
  const recortados = [...clipesDepois].filter(([n, m]) => clipesAntes.get(n) !== m).length
  confere(clipesAntes.size > 0 && recortados === 0, `corte reaproveitado (${clipesDepois.size} clipes, ${recortados} recortados)`)

  const fotos = fotosDoElenco(pastaDeDadosDoMotor(), 'Dr STONE', 4)
  confere(fotos?.origem === 'Corte Cenas', `fotos do elenco: ${fotos?.origem ?? 'busca online'} (${fotos?.comFotos} com fotos, id ${fotos?.cacheId} pelo ${fotos?.como})`)
  const log = readFileSync(join(pastaDeDadosDoMotor(), 'logs', 'ultima-analise.log'), 'utf8')
  confere(/\[studio\] fotos do elenco: Corte Cenas/.test(log), 'log: "[studio] fotos do elenco: Corte Cenas"')
  for (const l of log.split('\n').filter((x) => /reserva do elenco|Jikan|motor de novo|posto de lado|Ignorados/.test(x))) {
    console.log(`  log> ${l.slice(0, 260)}`)
  }
  try {
    const tempos = JSON.parse(readFileSync(join(fim.pastaDoEpisodio, 'metadata', 'timings.json'), 'utf8')) as {
      total_seconds?: number
      stages?: Record<string, number>
    }
    console.log(`  timings.json (ultima rodada do motor): total ${tempos.total_seconds?.toFixed(1)} s`)
    for (const [k, v] of Object.entries(tempos.stages ?? {})) console.log(`    ${k.padEnd(18)} ${Number(v).toFixed(1)} s`)
  } catch {
    /* sem timings */
  }
  console.log(`  TEMPO TOTAL (pedido ate o fim): ${fim.segundos.toFixed(1)} s (parede ${parede.toFixed(1)} s)`)
  if (rotulo === 'depois') {
    confere(mensagens.some((m) => m.startsWith('Sem fotos online do elenco')), 'progresso avisou a reserva depois do motor')
    confere(/motor de novo, com as fotos do elenco da reserva/.test(log), 'motor rodou de novo no mesmo job')
    confere(existsSync(join(pastaDeDadosDoMotor(), 'cache', 'elenco-posto-de-lado')), 'banco online (1 foto cada) posto de lado')
  } else {
    confere(mensagens.some((m) => m.startsWith('Copiando as fotos do elenco do Corte Cenas')), 'progresso avisou a copia antes do motor')
    confere(!/motor de novo/.test(log), 'motor rodou uma vez so')
  }
}

async function antes(): Promise<void> {
  preparar('antes')
  delete process.env['ANIRECAP_ELENCO_RESERVA']
  await rodar('antes')
}

/**
 * Como o app do Levi esta agora: uma COPIA do index.db e da memoria de pastas
 * do motor do Studio (%APPDATA%\AniRecap Studio\motor\cache), que ja tem os 50
 * personagens com nome da AniList da rodada sem fotos. O id sai da memoria do
 * proprio motor (pastas_de_anime.json) e os nomes da AniList no banco nao podem
 * esconder os do MyAnimeList do banco copiado.
 */
async function real(): Promise<void> {
  const { userData } = preparar('real')
  delete process.env['ANIRECAP_ELENCO_RESERVA']
  const deLa = join(process.env['APPDATA'] ?? '', 'AniRecap Studio', 'motor', 'cache')
  const cache = join(userData, 'motor', 'cache')
  mkdirSync(cache, { recursive: true })
  for (const n of ['index.db', 'pastas_de_anime.json']) {
    if (existsSync(join(deLa, n))) cpSync(join(deLa, n), join(cache, n))
  }
  console.log(`  copiados index.db e pastas_de_anime.json de ${deLa}`)
  await rodar('real')
}

async function depois(): Promise<void> {
  preparar('depois')
  // Origem sintetica: o banco do Corte Cenas COPIADO (lido de la), com outro
  // titulo e sem indice de buscas, para nada casar antes do motor.
  const origem = join(base, 'depois', 'origem', 'anime_db')
  const banco = join(origem, 'Banco Sintetico [al105333]')
  if (!existsSync(join(banco, 'metadata.json'))) {
    rmSync(origem, { recursive: true, force: true })
    cpSync(join(BANCO_DO_CORTE_CENAS, 'characters'), join(banco, 'characters'), { recursive: true })
    const meta = JSON.parse(readFileSync(join(BANCO_DO_CORTE_CENAS, 'metadata.json'), 'utf8')) as Record<string, unknown>
    writeFileSync(join(banco, 'metadata.json'), JSON.stringify({ ...meta, title: 'Banco Sintetico', title_english: 'Banco Sintetico' }, null, 2))
  }
  process.env['ANIRECAP_ELENCO_RESERVA'] = origem
  await rodar('depois')
  delete process.env['ANIRECAP_ELENCO_RESERVA']
}

/**
 * Cancelar no meio da reserva (antes de o motor subir): o fim chega UMA vez,
 * cancelado, nenhum processo sobe e a vaga fica livre para o proximo job.
 */
async function cancelar(): Promise<void> {
  preparar('cancelar')
  delete process.env['ANIRECAP_ELENCO_RESERVA']
  console.log('\n[cancelar durante a copia da reserva]')
  const fins: FimDaAnalise[] = []
  let resolver: () => void = () => {}
  const fim = new Promise<void>((r) => (resolver = r))
  let etapas = ''
  const id = await analisarEpisodio(
    { path: NOVO, anime: 'Dr STONE', temporada: 4, episodio: 24, kind: '', motor: 'studio', reconhecer: true },
    {
      progresso(p) {
        etapas += ` ${p.etapaDoMotor}`
        if (p.etapaDoMotor === 'studio_reserva_elenco') void cancelarAnalise(p.jobId)
      },
      fim(f) {
        fins.push(f)
        resolver()
      },
    },
  )
  await Promise.race([fim, new Promise((r) => setTimeout(r, 30_000))])
  await new Promise((r) => setTimeout(r, 1500))
  confere(fins.length === 1 && !fins[0]?.ok && fins[0]?.cancelado, `fim cancelado uma vez (${JSON.stringify(fins)})`)
  confere(etapas.trim() === 'studio_reserva_elenco', `nenhum andamento do motor depois do cancelar (${etapas.trim()})`)
  confere(!existsSync(join(pastaDeDadosDoMotor(), 'logs', 'ultima-analise.log')), 'o motor nem subiu (sem log)')
  const id2 = await analisarEpisodio(
    { path: NOVO, anime: 'Dr STONE', temporada: 4, episodio: 24, kind: '', motor: 'studio', reconhecer: false },
    { progresso() {}, fim() {} },
  )
  await cancelarAnalise(id2)
  confere(id2 !== id, 'a vaga ficou livre: outro job subiu')
  await new Promise((r) => setTimeout(r, 3000))
}

// --------------------------------------------------------------------- main

async function main(): Promise<void> {
  console.log(`v-elenco-reserva ${modo} | base ${base}`)
  const t = Date.now()
  const fotos = PROTEGIDAS.map(fotografar)
  console.log(`  fotografadas ${fotos.reduce((n, f) => n + f.size, 0)} entradas das pastas protegidas (${((Date.now() - t) / 1000).toFixed(1)} s)`)
  try {
    if (modo === 'antes') await antes()
    else if (modo === 'real') await real()
    else if (modo === 'cancelar') await cancelar()
    else if (modo === 'depois') await depois()
    else await unidade()
  } finally {
    encerrarMotor()
  }
  console.log('\n[Corte Cenas intocado]')
  PROTEGIDAS.forEach((p, i) => {
    const mudou = diferencas(fotos[i] ?? new Map(), fotografar(p))
    confere(mudou.length === 0, `${p}: ${fotos[i]?.size} entradas, ${mudou.length} mudancas${mudou.length ? `: ${mudou.slice(0, 5).join('; ')}` : ''}`)
  })
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\ntudo certo')
  process.exitCode = falhas ? 1 : 0
}

void main()
