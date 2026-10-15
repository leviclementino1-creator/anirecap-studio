#!/usr/bin/env node
/**
 * Baixa e confere o uv.exe que vai junto do instalador (resources/uv).
 *
 *   npm run uv                 baixa se faltar e confere (idempotente)
 *   node scripts/baixar-uv.mjs --conferir <pasta>
 *                              so confere uma pasta pronta (o release.mjs usa
 *                              em release/win-unpacked/resources/uv)
 *
 * POR QUE O uv: o runtime do motor (Python + torch, ~5 GB) nao cabe no .exe --
 * o GitHub limita a 2 GB por arquivo de release, e o NSIS e 32-bit (a licao
 * do AnCut HUB). O app instala o runtime no primeiro uso, das fontes
 * oficiais, e o uv faz isso sem depender de Python nenhum na maquina: baixa o
 * Python 3.12 (python-build-standalone), cria o venv e instala os pacotes.
 *
 * PINADO POR VERSAO E POR HASH: o zip da release oficial do astral-sh/uv tem o
 * sha256 publicado ao lado (uv-x86_64-pc-windows-msvc.zip.sha256), e o uv.exe
 * de dentro dele tem o seu, conferido aqui na extracao. A versao e a mesma que
 * criou o motor/.venv do dev (pyvenv.cfg: uv = 0.11.7), entao o runtime do
 * app instalado sai do mesmo uv que o Levi ja usa.
 *
 * Trocar de versao: atualizar VERSAO, SHA256_ZIP (do .sha256 da release),
 * SHA256_EXE (rodar com --hash-novo para ver o do exe extraido) e as licencas.
 *
 * Saida em build/uv/ (fora do git, ver .gitignore): uv.exe, LICENSE-MIT,
 * LICENSE-APACHE e uv.json. O electron-builder copia a pasta para
 * resources/uv no Windows (win.extraResources).
 */
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const VERSAO = '0.11.7'
export const ZIP = 'uv-x86_64-pc-windows-msvc.zip'
export const URL_ZIP = `https://github.com/astral-sh/uv/releases/download/${VERSAO}/${ZIP}`
/** Do uv-x86_64-pc-windows-msvc.zip.sha256 da release 0.11.7. */
export const SHA256_ZIP = 'fe0c7815acf4fc45f8a5eff58ed3cf7ae2e15c3cf1dceadbd10c816ec1690cc1'
/** O uv.exe de dentro do zip acima (conferido na extracao). */
export const SHA256_EXE = '831730243cf7bbd496ff96353dcdba6f5d4dcbd22576af398130381ab44ac160'
/** uv e MIT OU Apache-2.0: as duas licencas vao junto, da mesma tag. */
export const LICENCAS = {
  'LICENSE-MIT': '860e3d7a86b84e6a7012c7a635fc64df475cebc6cce34dfeb73a5982ec58176c',
  'LICENSE-APACHE': 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4',
}
export const PASTA = join(ROOT, 'build', 'uv')

function log(msg) {
  process.stdout.write(`  • ${msg}\n`)
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

/**
 * Confere uma pasta com o uv pronto. Devolve a lista do que esta errado
 * (vazia = tudo certo). Le o exe inteiro (68 MB): ~0,2 s.
 */
export function conferirPasta(pasta) {
  const erros = []
  const exe = join(pasta, 'uv.exe')
  if (!existsSync(exe)) erros.push(`falta ${exe}`)
  else if (sha256(readFileSync(exe)) !== SHA256_EXE) erros.push(`${exe} nao e o uv ${VERSAO} (sha256 diferente)`)
  for (const [nome, hash] of Object.entries(LICENCAS)) {
    const p = join(pasta, nome)
    if (!existsSync(p)) erros.push(`falta ${p}`)
    else if (sha256(readFileSync(p)) !== hash) erros.push(`${p} diferente do da tag ${VERSAO}`)
  }
  const meta = join(pasta, 'uv.json')
  if (!existsSync(meta)) erros.push(`falta ${meta}`)
  return erros
}

/** fetch com 3 tentativas: o GitHub as vezes derruba a conexao no meio. */
async function baixar(url) {
  let ultimo
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const r = await fetch(url, { redirect: 'follow' })
      if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`)
      return Buffer.from(await r.arrayBuffer())
    } catch (e) {
      ultimo = e
      if (tentativa < 3) await new Promise((ok) => setTimeout(ok, 1500 * tentativa))
    }
  }
  throw ultimo
}

/**
 * Tira UM arquivo de um zip, sem ferramenta de fora.
 *
 * O `tar` do runner do GitHub pode ser o GNU do Git (nao abre zip) e o
 * Expand-Archive so existe no PowerShell; ler o diretorio central na mao sao
 * vinte linhas e funciona igual em qualquer lugar. So os metodos 0 (guardado)
 * e 8 (deflate), que sao os que o zip do uv usa.
 */
function tirarDoZip(zip, nome) {
  // Fim do diretorio central: assinatura 0x06054b50 nos ultimos ~64 KB.
  let fim = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      fim = i
      break
    }
  }
  if (fim < 0) throw new Error('zip sem diretorio central')
  const total = zip.readUInt16LE(fim + 10)
  let p = zip.readUInt32LE(fim + 16)
  for (let n = 0; n < total; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('diretorio central torto')
    const metodo = zip.readUInt16LE(p + 10)
    const comprimido = zip.readUInt32LE(p + 20)
    const tamNome = zip.readUInt16LE(p + 28)
    const tamExtra = zip.readUInt16LE(p + 30)
    const tamComent = zip.readUInt16LE(p + 32)
    const local = zip.readUInt32LE(p + 42)
    const nomeAqui = zip.subarray(p + 46, p + 46 + tamNome).toString('utf8')
    p += 46 + tamNome + tamExtra + tamComent
    if (nomeAqui !== nome && !nomeAqui.endsWith(`/${nome}`)) continue
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error('cabecalho local torto')
    const ini = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const dados = zip.subarray(ini, ini + comprimido)
    if (metodo === 0) return Buffer.from(dados)
    if (metodo === 8) return inflateRawSync(dados)
    throw new Error(`metodo de compressao ${metodo} nao suportado`)
  }
  throw new Error(`${nome} nao esta no zip`)
}

async function main() {
  const args = process.argv.slice(2)
  const iConferir = args.indexOf('--conferir')
  if (iConferir >= 0) {
    const pasta = resolve(args[iConferir + 1] ?? PASTA)
    const erros = conferirPasta(pasta)
    if (erros.length) {
      for (const e of erros) process.stderr.write(`  ERRO: ${e}\n`)
      process.exit(1)
    }
    log(`uv ${VERSAO} conferido em ${pasta}`)
    return
  }
  const hashNovo = args.includes('--hash-novo')

  if (!hashNovo && conferirPasta(PASTA).length === 0) {
    log(`uv ${VERSAO} ja esta em build/uv (conferido)`)
    return
  }

  log(`baixando o uv ${VERSAO} da release oficial (~23 MB)...`)
  const zip = await baixar(URL_ZIP)
  const hz = sha256(zip)
  if (hz !== SHA256_ZIP) {
    throw new Error(`o zip baixado nao confere.\n  esperado ${SHA256_ZIP}\n  veio     ${hz}`)
  }
  const exe = tirarDoZip(zip, 'uv.exe')
  const he = sha256(exe)
  if (hashNovo) {
    log(`sha256 do uv.exe extraido: ${he}`)
    return
  }
  if (he !== SHA256_EXE) {
    throw new Error(`o uv.exe extraido nao confere.\n  esperado ${SHA256_EXE}\n  veio     ${he}`)
  }

  const licencas = {}
  for (const [nome, hash] of Object.entries(LICENCAS)) {
    const buf = await baixar(`https://raw.githubusercontent.com/astral-sh/uv/${VERSAO}/${nome}`)
    if (sha256(buf) !== hash) throw new Error(`${nome} da tag ${VERSAO} nao confere`)
    licencas[nome] = buf
  }

  // Monta numa pasta ao lado e troca de uma vez: um build no meio nunca ve
  // uma pasta pela metade.
  const temp = join(dirname(PASTA), `uv.novo-${randomBytes(3).toString('hex')}`)
  mkdirSync(temp, { recursive: true })
  writeFileSync(join(temp, 'uv.exe'), exe)
  for (const [nome, buf] of Object.entries(licencas)) writeFileSync(join(temp, nome), buf)
  writeFileSync(
    join(temp, 'uv.json'),
    `${JSON.stringify({ versao: VERSAO, sha256Exe: SHA256_EXE, origem: URL_ZIP, sha256Zip: SHA256_ZIP }, null, 2)}\n`,
  )
  rmSync(PASTA, { recursive: true, force: true })
  renameSync(temp, PASTA)
  const erros = conferirPasta(PASTA)
  if (erros.length) throw new Error(erros.join('\n'))
  log(`uv ${VERSAO} em build/uv (${(exe.length / 1e6).toFixed(1)} MB), conferido`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    process.stderr.write(`\n  ERRO: ${e instanceof Error ? e.message : String(e)}\n\n`)
    process.exit(1)
  })
}
