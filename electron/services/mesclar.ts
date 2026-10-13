import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { ffmpegPath } from './ffmpeg-path'
import {
  apagarMesclado,
  assinaturaDoPedaco,
  gravarMesclas,
  lerMesclas,
  mesclasQueValem,
  mesmoCaminho,
  pastaDasMesclas,
  type Mescla,
} from './mesclas-studio'

/**
 * MESCLAR CENAS DA BIBLIOTECA, como o AnCut faz.
 *
 * "No AnCut eu tenho a opcao de selecionar alguns clipes e mesclar... quero a
 * mesma opcao no Dangai, pra nao ter que voltar la, mesclar e sincronizar."
 *
 * Para quem usa, continua igual ao Dangai: o clipe novo se chama
 * `<primeira>-<ultima>.mp4`, a grade mostra uma cena so no lugar dos pedacos, e
 * a saida tem a qualidade do corte do AnCut:
 *
 * - episodio cortado em modo "compat"/"intra" e REENCODADO com os mesmos
 *   parametros do corte (render_output_params): emendar sem reencodar quebra o
 *   CFR, e o AnCut mediu isso. Em "off", emenda sem reencodar (-c copy).
 *
 * O que mudou no Studio e ONDE a mescla mora. O Dangai escrevia o clipe em
 * shots/, movia os pedacos para a _lixeira e reescrevia o index.db do AnCut --
 * que aqui e o banco do Corte Cenas do usuario, com um esquema que ja divergiu.
 * Agora nada e criado, movido ou apagado na pasta do episodio e o banco nunca e
 * aberto: o clipe vai para a pasta do Studio e uma linha no registro diz quais
 * pedacos ele substitui (ver mesclas-studio). Quem aplica isso na grade e a
 * varredura (library.ts). Desfazer e tirar a linha e apagar o clipe nosso.
 *
 * So CENAS SEGUIDAS: o nome "0010-0015" diz ao indexador que as cenas 11 a 14
 * estao dentro -- mesclar 10 com 15 pularia as do meio e a duracao e os
 * personagens sairiam errados.
 */

export interface ResultadoDaMescla {
  /** O caminho do clipe mesclado (na pasta do Studio). */
  path: string
  /** Os caminhos que sairam da grade. Continuam no disco, so deixam de aparecer. */
  pedacos: string[]
  /**
   * O que aconteceu no banco do AnCut. No Studio e sempre 'sem-banco': o banco
   * nao e tocado. O tipo continua o mesmo porque e o contrato do IPC.
   */
  ancut: 'atualizado' | 'sem-banco' | 'episodio-nao-encontrado'
  segundos: number
}

/** "0010" -> [10, 10]; "0010-0012" -> [10, 12]. */
function faixaDoNome(nome: string): [number, number] | null {
  const m = /^(\d+)(?:-(\d+))?\.mp4$/i.exec(nome)
  if (!m) return null
  const a = Number(m[1])
  const b = m[2] === undefined ? a : Number(m[2])
  return b >= a ? [a, b] : null
}

const quatro = (n: number): string => String(n).padStart(4, '0')

/** Os parametros de saida do AnCut para cada modo (keyframe_extractor.render_output_params, sem NVENC). */
function parametrosDoModo(modo: string): string[] {
  if (modo === 'compat' || modo === 'intra') {
    return [
      '-vf', 'fps=24000/1001', '-fps_mode', 'cfr',
      '-c:v', 'libx264', '-crf', '20', '-preset', 'superfast', '-profile:v', 'high',
      ...(modo === 'intra' ? ['-g', '1', '-bf', '0'] : []),
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-f', 'mp4',
    ]
  }
  return ['-c', 'copy']
}

function rodarFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true })
    let erro = ''
    child.stderr.on('data', (c: Buffer) => {
      erro += c.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(erro.trim().split(/\r?\n/).slice(-2).join(' ') || `ffmpeg saiu com ${code}`))
    })
  })
}

/** Duracao de um mp4, pelo ffmpeg (so para dizer quantos segundos ficou). */
function duracao(path: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-i', path], { windowsHide: true })
    let saida = ''
    child.stderr.on('data', (c: Buffer) => {
      saida += c.toString()
    })
    child.on('close', () => {
      const m = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(saida)
      resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0)
    })
    child.on('error', () => resolve(0))
  })
}

/** Os arquivos de shots/, pelo nome em minusculas -> o nome de verdade. */
function arquivosDe(shots: string): Map<string, string> {
  try {
    return new Map(
      readdirSync(shots, { withFileTypes: true })
        .filter((e) => e.isFile() && !e.name.startsWith('.'))
        .map((e) => [e.name.toLowerCase(), e.name]),
    )
  } catch {
    return new Map()
  }
}

export async function mesclarClipes(paths: readonly string[]): Promise<ResultadoDaMescla> {
  if (paths.length < 2) throw new Error('Escolha pelo menos duas cenas para mesclar.')

  // Uma cena da grade e um clipe do AnCut (em shots/) ou uma mescla nossa. A
  // nossa vale pelos pedacos dela, que continuam no episodio: e deles que o
  // clipe novo sai, para mesclar de novo nao reencodar duas vezes.
  const registro = lerMesclas()
  const resolvidos = paths.map((p) => {
    const nossa = registro.find((m) => mesmoCaminho(m.arquivo, p)) ?? null
    return nossa
      ? { p, shots: join(nossa.episodio, 'shots'), pedacos: nossa.pedacos, nossa }
      : { p, shots: dirname(p), pedacos: [basename(p).replace(/\.mp4$/i, '')], nossa }
  })

  const shots = resolvidos[0]!.shots
  if (basename(shots).toLowerCase() !== 'shots') throw new Error('So da para mesclar cenas cortadas pelo AnCut (pasta shots).')
  if (resolvidos.some((r) => !mesmoCaminho(r.shots, shots))) {
    throw new Error('As cenas precisam ser do mesmo episodio.')
  }
  const episodio = dirname(shots)

  const itens = resolvidos
    .map((r) => ({ ...r, faixa: faixaDoNome(basename(r.p)) }))
    .sort((a, b) => (a.faixa?.[0] ?? 0) - (b.faixa?.[0] ?? 0))
  if (itens.some((i) => i.faixa === null)) throw new Error('Alguma cena tem um nome que o AnCut nao gera.')
  for (let k = 1; k < itens.length; k++) {
    if (itens[k]!.faixa![0] !== itens[k - 1]!.faixa![1] + 1) {
      throw new Error(
        'So da para mesclar cenas SEGUIDAS do episodio (ex.: 0010, 0011, 0012). O nome do clipe mesclado diz ao Studio quais cenas estao dentro, e um buraco no meio deixaria duracao e personagens errados.',
      )
    }
  }

  const naPasta = arquivosDe(shots)
  const pedacos = itens.flatMap((i) => i.pedacos)
  const faltando = pedacos.find((p) => !naPasta.has(`${p}.mp4`.toLowerCase()))
  if (faltando !== undefined) throw new Error(`Essa cena nao esta mais no disco: ${faltando}.mp4`)
  // Tiradas ANTES do ffmpeg ler: se o AnCut regravar um pedaco no meio da
  // mescla, a assinatura ja nao bate e ela cai na proxima varredura. O '' de
  // um pedaco que sumiu agora nunca bate: os pedacos ficam soltos.
  const assinaturas = pedacos.map((p) => assinaturaDoPedaco(episodio, p) ?? '')

  // Um pedaco escondido por outra mescla que esta valendo nao entra em duas:
  // a grade so mostraria uma e a outra viraria um clipe fantasma.
  const doEpisodio = registro.filter((m) => mesmoCaminho(m.episodio, episodio))
  const escolhidos = new Set(pedacos.map((p) => p.toLowerCase()))
  const ocupada = mesclasQueValem(doEpisodio, new Set(naPasta.values())).find(
    (m) => !itens.some((i) => i.nossa === m) && m.pedacos.some((p) => escolhidos.has(p.toLowerCase())),
  )
  if (ocupada) throw new Error(`Essa cena ja esta mesclada em ${basename(ocupada.arquivo)}.`)

  const de = itens[0]!.faixa![0]
  const ate = itens.at(-1)!.faixa![1]
  const nome = `${quatro(de)}-${quatro(ate)}.mp4`
  if (naPasta.has(nome.toLowerCase())) throw new Error(`Ja existe ${nome} nesse episodio.`)
  const pasta = pastaDasMesclas(episodio)
  mkdirSync(pasta, { recursive: true })
  // Se sobrou um arquivo com este nome sem linha no registro (o app caiu no
  // meio), ele e lixo nosso: o ffmpeg escreve por cima.
  const destino = join(pasta, nome)

  let modo = 'off'
  try {
    modo = readFileSync(join(shots, '.export_mode'), 'utf8').trim()
  } catch {
    /* sem marca: o AnCut tambem trata como "off" */
  }

  // A lista do demuxer concat num arquivo; aspa simples se escapa fechando a string.
  const entradas = pedacos.map((p) => join(shots, naPasta.get(`${p}.mp4`.toLowerCase())!))
  const lista = join(tmpdir(), `dangai-mescla-${Date.now()}.txt`)
  writeFileSync(lista, entradas.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n', 'utf8')
  try {
    await rodarFfmpeg([
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'concat', '-safe', '0', '-i', lista,
      ...parametrosDoModo(modo),
      destino,
    ])
  } catch (err) {
    rmSync(destino, { force: true })
    throw new Error(`Nao deu para mesclar: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    rmSync(lista, { force: true })
  }
  // So entra no registro DEPOIS de o mesclado existir com conteudo.
  if (!existsSync(destino) || statSync(destino).size === 0) {
    rmSync(destino, { force: true })
    throw new Error('O ffmpeg terminou sem gerar o clipe mesclado.')
  }
  const segundos = await duracao(destino)

  /*
   * Saem do registro as mesclas que esta engoliu (a escolhida na grade) e as
   * velhas que dividiam pedaco com ela e ja nao valiam (pedaco ou clipe tinha
   * sumido). Relido agora: o ffmpeg levou tempo, e o registro e a verdade.
   */
  const saem = doEpisodio.filter((m) => m.pedacos.some((p) => escolhidos.has(p.toLowerCase())))
  const nova: Mescla = { episodio, pedacos, assinaturas, arquivo: destino, segundos, criadoEm: new Date().toISOString() }
  gravarMesclas([...lerMesclas().filter((m) => !saem.some((s) => mesmoCaminho(s.arquivo, m.arquivo))), nova])
  for (const m of saem) if (!mesmoCaminho(m.arquivo, destino)) apagarMesclado(m.arquivo)

  return { path: destino, pedacos: itens.map((i) => i.p), ancut: 'sem-banco', segundos }
}

export interface ResultadoDoDesfazer {
  /** O clipe mesclado que saiu. */
  path: string
  /** Os clipes do AnCut que voltam a aparecer na grade, em ordem. */
  pedacos: string[]
}

/**
 * DESFAZER UMA MESCLA. O Dangai nao tinha (os pedacos ficavam na _lixeira e a
 * volta era a mao); aqui sai de graca, porque os pedacos nunca sairam do lugar:
 * tira a linha do registro e apaga o clipe nosso. A pasta do episodio nao e
 * tocada -- ela ja esta como estava.
 */
export function desfazerMescla(path: string): ResultadoDoDesfazer {
  const registro = lerMesclas()
  const mescla = registro.find((m) => mesmoCaminho(m.arquivo, path))
  if (!mescla) throw new Error('Essa cena nao e uma mescla do Studio.')
  // O registro primeiro: se o clipe estiver preso no preview e nao apagar, a
  // grade ja volta certa e o arquivo que sobrou nao aparece em lugar nenhum.
  gravarMesclas(registro.filter((m) => m !== mescla))
  apagarMesclado(mescla.arquivo)
  const shots = join(mescla.episodio, 'shots')
  const naPasta = arquivosDe(shots)
  return {
    path: mescla.arquivo,
    pedacos: mescla.pedacos.map((p) => join(shots, naPasta.get(`${p}.mp4`.toLowerCase()) ?? `${p}.mp4`)),
  }
}
