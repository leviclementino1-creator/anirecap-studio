import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/**
 * AS MESCLAS DO STUDIO, fora da biblioteca do AnCut.
 *
 * O Dangai mesclava DENTRO do episodio do AnCut: escrevia shots/NNNN-MMMM.mp4,
 * movia os pedacos para a _lixeira e reescrevia o index.db. Aqui a pasta e o
 * banco sao do Corte Cenas do usuario -- o esquema do banco dele ja divergiu do
 * que o Dangai escrevia, e um DELETE/INSERT com o esquema errado estraga a
 * biblioteca que ele usa todo dia. Entao a mescla mora no perfil do Studio:
 *
 *   <userData>/biblioteca-studio/
 *     mesclas.json                              <- o registro
 *     mesclas/<chave do episodio>/0010-0012.mp4 <- o clipe mesclado
 *
 * Os pedacos continuam onde estavam. Quem os esconde e poe o mesclado no lugar
 * e a varredura (library.ts), lendo este registro -- para quem usa, a grade fica
 * igual a do Dangai. Desfazer e tirar a linha daqui e apagar o arquivo nosso.
 */

export interface Mescla {
  /** A pasta absoluta do episodio no AnCut (a que tem shots/). */
  episodio: string
  /**
   * Os nomes dos arquivos de shots/ sem o .mp4, em ordem: "0010", "0011" ou
   * "0010-0012" quando o proprio AnCut ja tinha juntado. Sempre arquivos do
   * AnCut, nunca outra mescla do Studio -- mesclar uma mescla expande a lista.
   */
  pedacos: string[]
  /**
   * Tamanho e mtime de cada pedaco na hora de mesclar, na ordem de `pedacos`
   * (ver assinaturaDoPedaco). Ausente numa linha escrita a mao: sem ela nao da
   * para provar que os pedacos sao os mesmos, e a mescla nao vale.
   */
  assinaturas?: string[]
  /** O clipe mesclado, caminho absoluto dentro da pasta do Studio. */
  arquivo: string
  segundos: number
  /** ISO. Entra na assinatura do cache da biblioteca: refazer a mesma faixa rele o episodio. */
  criadoEm: string
}

interface Registro {
  version: number
  mesclas: Mescla[]
}

const VERSAO = 1

let raiz: string | null = null

/** Chamada pelo configureLibrary: e o mesmo userData, e o main.ts nao precisa saber disto. */
export function configurarMesclas(userDataDir: string): void {
  raiz = join(userDataDir, 'biblioteca-studio')
}

function raizDasMesclas(): string {
  if (!raiz) throw new Error('Mesclas do Studio nao configuradas')
  return raiz
}

/** Barra e caixa nao importam no Windows: "D:/x" e "d:\\x\\" sao a mesma pasta. */
export function mesmoCaminho(a: string, b: string): boolean {
  const normal = (p: string): string => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  return normal(a) === normal(b)
}

/**
 * A pasta das mesclas de um episodio. Legivel ("Serie-S01E01-...") para quem
 * abrir o perfil, com um pedaco do hash do caminho para dois "S01E01" de
 * series ou raizes diferentes nao cairem juntos.
 */
export function pastaDasMesclas(episodio: string): string {
  const limpo = (s: string): string => s.replace(/[^A-Za-z0-9._ -]+/g, '_').trim().slice(0, 40) || '_'
  const hash = createHash('sha1')
    .update(episodio.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase())
    .digest('hex')
    .slice(0, 10)
  return join(raizDasMesclas(), 'mesclas', `${limpo(basename(dirname(episodio)))}-${limpo(basename(episodio))}-${hash}`)
}

function caminhoDoRegistro(): string {
  return join(raizDasMesclas(), 'mesclas.json')
}

/** O registro inteiro. Faltando ou quebrado = nenhuma mescla, nunca erro: a biblioteca tem que abrir. */
export function lerMesclas(): Mescla[] {
  if (!raiz) return []
  let cru: unknown
  try {
    cru = JSON.parse(readFileSync(caminhoDoRegistro(), 'utf8'))
  } catch {
    return []
  }
  const lista = (cru as Partial<Registro> | null)?.mesclas
  if (!Array.isArray(lista)) return []
  // Linha torta e ignorada sozinha; o resto do registro continua valendo.
  return lista.filter(
    (m): m is Mescla =>
      typeof m === 'object' &&
      m !== null &&
      typeof m.episodio === 'string' &&
      typeof m.arquivo === 'string' &&
      Array.isArray(m.pedacos) &&
      m.pedacos.every((p: unknown) => typeof p === 'string'),
  )
}

export function gravarMesclas(mesclas: readonly Mescla[]): void {
  const caminho = caminhoDoRegistro()
  mkdirSync(dirname(caminho), { recursive: true })
  // Temporario e rename, como o cache: morrer no meio nao deixa json pela metade.
  const temp = `${caminho}.tmp`
  writeFileSync(temp, JSON.stringify({ version: VERSAO, mesclas: [...mesclas] } satisfies Registro, null, 2), 'utf8')
  renameSync(temp, caminho)
}

/**
 * Apaga um clipe mesclado. So dentro da pasta do Studio: o registro e um json
 * que da para editar a mao, e uma linha apontando para shots/ nao pode virar
 * um arquivo do AnCut apagado.
 *
 * Falhar nao e erro: no Windows o clipe pode estar aberto no preview, e um
 * arquivo que sobrou sem linha no registro nao aparece em lugar nenhum.
 */
export function apagarMesclado(arquivo: string): void {
  const base = raizDasMesclas().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase() + '\\'
  if (!arquivo.replace(/\//g, '\\').toLowerCase().startsWith(base)) return
  try {
    rmSync(arquivo, { force: true })
  } catch (err) {
    console.warn('[mesclar] clipe mesclado nao apagado:', err)
    return
  }
  try {
    // A pasta do episodio some junto quando fica vazia; com algo dentro, fica.
    rmdirSync(dirname(arquivo))
  } catch {
    /* ainda tem outra mescla do episodio */
  }
}

/**
 * Como um pedaco esta no disco agora: tamanho e mtime de shots/<pedaco>.mp4,
 * ou null se ele nao esta la.
 *
 * O nome nao basta. O AnCut recorta um episodio regravando shots/NNNN.mp4 por
 * cima com o MESMO numero (mudar a cor, por exemplo, refaz todos), e uma mescla
 * que so conferisse nomes esconderia os cortes novos atras de um clipe feito
 * dos antigos. Mover para a lixeira e voltar preserva os dois, entao a mescla
 * volta junto.
 */
export function assinaturaDoPedaco(episodio: string, pedaco: string): string | null {
  try {
    const st = statSync(join(episodio, 'shots', `${pedaco}.mp4`))
    return `${st.size}@${st.mtimeMs}`
  } catch {
    return null
  }
}

/**
 * As mesclas de um episodio que podem ser aplicadas AGORA.
 *
 * `naPasta` sao os arquivos que existem em shots/. Uma mescla so vale com todos
 * os pedacos ainda la, sem terem sido regravados, e o clipe nosso no disco: se
 * o usuario apagou ou recortou um pedaco no AnCut, ou limpou o perfil do
 * Studio, ela e ignorada e os pedacos voltam a aparecer soltos -- nada some da
 * grade por causa de um registro velho. Duas mesclas disputando o mesmo
 * pedaco: vale a primeira.
 */
export function mesclasQueValem(mesclas: readonly Mescla[], naPasta: ReadonlySet<string>): Mescla[] {
  const existentes = new Set([...naPasta].map((n) => n.toLowerCase()))
  const usados = new Set<string>()
  return mesclas.filter((m) => {
    const nomes = m.pedacos.map((p) => `${p}.mp4`.toLowerCase())
    const vale =
      nomes.length >= 2 &&
      nomes.every((n) => existentes.has(n) && !usados.has(n)) &&
      // O AnCut ja tem um arquivo com o mesmo nome: ele ganha, para nao haver duas cenas com o mesmo id.
      !existentes.has(basename(m.arquivo).toLowerCase()) &&
      existsSync(m.arquivo) &&
      // Por ultimo: e o unico teste que vai ao disco por pedaco.
      m.assinaturas?.length === m.pedacos.length &&
      m.pedacos.every((p, i) => assinaturaDoPedaco(m.episodio, p) === m.assinaturas![i])
    if (vale) for (const n of nomes) usados.add(n)
    return vale
  })
}
