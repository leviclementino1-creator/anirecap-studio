#!/usr/bin/env node
/**
 * Confere o pacote do Windows que o electron-builder deixou em release/.
 *
 *   node scripts/conferir-pacote.mjs     depois de `npm run dist`
 *
 * O release.mjs chama o mesmo `conferirPacote` antes de subir qualquer
 * arquivo; aqui da para rodar sozinho, sem tag e sem publicar nada.
 *
 * O QUE CONFERE, e por que cada um:
 *
 * - O .exe existe com o nome do artifactName (AniRecap-Studio-Setup-<v>.exe)
 *   e tem MENOS de 1,9 GiB: o GitHub recusa arquivo de release acima de 2 GiB,
 *   e o NSIS e 32-bit. O runtime do motor (~5 GB) nao vai no .exe de proposito;
 *   se um dia o .venv escapar para dentro do pacote, e aqui que para.
 * - O latest.yml e desta versao, aponta para este .exe e tem o tamanho E o
 *   sha512 dele. `release/` nao e limpo entre execucoes, e um yml velho tem
 *   cara de novo (ver release.mjs). O sha512 e o que o updater confere depois
 *   de baixar: errado, todo mundo baixa e recusa.
 * - O .blockmap existe (a atualizacao diferencial le ele).
 * - resources/app-update.yml aponta para o repo do Studio: sem ele o updater
 *   do app instalado nao sabe onde procurar, e com o do Dangai ele "atualizaria"
 *   para o Dangai.
 * - resources/uv: o uv.exe da versao pinada, conferido pelo sha256, e as duas
 *   licencas (scripts/baixar-uv.mjs).
 * - resources/motor: SO o codigo (app/, run.py, requirements.txt,
 *   studio-runtime.json), igual byte a byte ao do repositorio, e nada de
 *   __pycache__, .pyc, .venv, python/, cache/, models/ -- o motor roda dali
 *   com PYTHONDONTWRITEBYTECODE e a pasta de instalacao e so leitura.
 * - ffmpeg e ffprobe desempacotados do asar: o motor do app instalado nao tem
 *   o PATH do Levi, e o runtime poe os dois no PATH dele
 *   (electron/services/motor-runtime/ambiente.ts).
 * - O onnxruntime-node so com o binario win32/x64 (files do electron-builder.yml).
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { conferirPasta as conferirUv } from './baixar-uv.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** O mesmo nome do nsis.artifactName do electron-builder.yml. */
export function nomeDoExe(versao) {
  return `AniRecap-Studio-Setup-${versao}.exe`
}

/** 1,9 GiB: folga abaixo do limite de 2 GiB por arquivo do GitHub. */
export const LIMITE_DO_EXE = Math.floor(1.9 * 1024 ** 3)

/**
 * Acima disto algo pesado entrou no pacote sem ninguem pedir (aviso, nao erro).
 * Medido em 15/10: 196 MB (Electron, onnxruntime win32, ffmpeg, compositor,
 * uv 66 MB e o codigo do motor 1 MB). Sem o `files` certo o asar levou o repo
 * inteiro, motor/.venv junto: 2,6 GB comprimidos, e o NSIS (32-bit) morreu com
 * "failed creating mmap" antes de chegar no limite do GitHub.
 */
const AVISO_MB = 350

const REPO = { owner: 'leviclementino1-creator', repo: 'anirecap-studio' }

/** O que pode existir no topo de resources/motor. */
const NO_MOTOR = new Set(['app', 'run.py', 'requirements.txt', 'studio-runtime.json'])

/** Nomes que nunca podem aparecer dentro de resources/motor. */
const PROIBIDOS_NO_MOTOR = new Set(['__pycache__', '.venv', 'python', 'cache', 'models', 'Output'])

function sha(algoritmo, buf, codificacao = 'hex') {
  return createHash(algoritmo).update(buf).digest(codificacao)
}

/** Todos os arquivos abaixo de `pasta` (caminhos absolutos). */
function arquivos(pasta) {
  const saida = []
  for (const e of readdirSync(pasta, { withFileTypes: true })) {
    const p = join(pasta, e.name)
    if (e.isDirectory()) saida.push(...arquivos(p))
    else saida.push(p)
  }
  return saida
}

/** Todas as pastas abaixo de `pasta`, ela inclusa. */
function pastas(pasta) {
  const saida = [pasta]
  for (const e of readdirSync(pasta, { withFileTypes: true })) {
    if (e.isDirectory()) saida.push(...pastas(join(pasta, e.name)))
  }
  return saida
}

/** O codigo do motor no repositorio, como o filtro do electron-builder.yml. */
function codigoDoMotorNoRepo(raiz) {
  const motor = join(raiz, 'motor')
  const lista = arquivos(join(motor, 'app')).filter(
    (p) => !p.split(sep).includes('__pycache__') && !/\.py[co]$/.test(p),
  )
  for (const f of ['run.py', 'requirements.txt', 'studio-runtime.json']) lista.push(join(motor, f))
  return lista.map((p) => relative(motor, p))
}

/**
 * Confere release/ inteira. Devolve { erros, info }: erros vazio = pode subir.
 * Nunca lanca por arquivo faltando; cada falta vira uma linha em `erros`.
 */
export function conferirPacote({ raiz = ROOT, versao } = {}) {
  const v = versao ?? JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8')).version
  const saida = join(raiz, 'release')
  const exe = nomeDoExe(v)
  const erros = []
  const info = []

  // ---------------------------------------------------------- o .exe e o yml
  const exePath = join(saida, exe)
  const ymlPath = join(saida, 'latest.yml')
  if (!existsSync(exePath)) erros.push(`nao achei ${exe} em release/`)
  if (!existsSync(ymlPath)) erros.push('nao achei release/latest.yml')
  if (!existsSync(`${exePath}.blockmap`)) erros.push(`nao achei ${exe}.blockmap em release/`)

  if (existsSync(exePath)) {
    const tamanho = statSync(exePath).size
    const mb = tamanho / 1024 ** 2
    info.push(`${exe}: ${mb.toFixed(1)} MB (${tamanho} bytes)`)
    if (tamanho >= LIMITE_DO_EXE) {
      erros.push(`${exe} tem ${mb.toFixed(0)} MB: passa de 1,9 GiB e o GitHub recusa (algo pesado entrou no pacote)`)
    } else if (mb > AVISO_MB) {
      info.push(`  AVISO: passa de ${AVISO_MB} MB; confira o que entrou em release/win-unpacked/resources`)
    }

    if (existsSync(ymlPath)) {
      const antes = erros.length
      const yml = readFileSync(ymlPath, 'utf8')
      const versaoNoYml = /^version:\s*(.+)$/m.exec(yml)?.[1]?.trim()
      const tamanhoNoYml = Number(/^\s*size:\s*(\d+)$/m.exec(yml)?.[1])
      const pathNoYml = /^path:\s*(.+)$/m.exec(yml)?.[1]?.trim()
      const sha512NoYml = /^sha512:\s*(.+)$/m.exec(yml)?.[1]?.trim()
      if (versaoNoYml !== v) {
        erros.push(`release/latest.yml e da versao ${versaoNoYml}, e o pacote e a ${v}. ` +
          'E o arquivo de uma execucao anterior: apague release/ e rode de novo.')
      }
      if (pathNoYml !== exe || !yml.includes(`url: ${exe}`)) {
        erros.push(`release/latest.yml nao aponta para ${exe} (path: ${pathNoYml})`)
      }
      if (tamanhoNoYml !== tamanho) {
        erros.push(`o tamanho no latest.yml (${tamanhoNoYml}) nao bate com o do arquivo (${tamanho})`)
      }
      const sha512 = sha('sha512', readFileSync(exePath), 'base64')
      if (sha512NoYml !== sha512) {
        erros.push('o sha512 no latest.yml nao e o do .exe: o updater baixaria e recusaria')
      }
      if (erros.length === antes) info.push(`latest.yml confere: ${v}, ${exe}, ${tamanho} bytes, sha512`)
    }
  }

  // -------------------------------------------------------------- resources
  const res = join(saida, 'win-unpacked', 'resources')
  if (!existsSync(res)) {
    erros.push('nao achei release/win-unpacked/resources (o electron-builder nao rodou?)')
    return { erros, info }
  }

  // O updater do app instalado le daqui.
  const appUpdate = join(res, 'app-update.yml')
  if (!existsSync(appUpdate)) {
    erros.push('falta resources/app-update.yml: o app instalado nao saberia onde procurar atualizacao')
  } else {
    const au = readFileSync(appUpdate, 'utf8')
    if (!/^provider:\s*github$/m.test(au) || !new RegExp(`^owner:\\s*${REPO.owner}$`, 'm').test(au) ||
      !new RegExp(`^repo:\\s*${REPO.repo}$`, 'm').test(au)) {
      erros.push(`resources/app-update.yml nao aponta para ${REPO.owner}/${REPO.repo}`)
    }
  }

  // uv
  for (const e of conferirUv(join(res, 'uv'))) erros.push(`uv: ${e}`)
  const extrasNoUv = existsSync(join(res, 'uv'))
    ? readdirSync(join(res, 'uv')).filter((n) => !['uv.exe', 'LICENSE-MIT', 'LICENSE-APACHE', 'uv.json'].includes(n))
    : []
  if (extrasNoUv.length) erros.push(`resources/uv tem arquivo a mais: ${extrasNoUv.join(', ')}`)

  // motor
  const motor = join(res, 'motor')
  if (!existsSync(motor)) {
    erros.push('falta resources/motor (extraResources do electron-builder.yml)')
  } else {
    const errosAntes = erros.length
    const topo = readdirSync(motor)
    const aMais = topo.filter((n) => !NO_MOTOR.has(n))
    if (aMais.length) erros.push(`resources/motor tem coisa a mais no topo: ${aMais.join(', ')}`)
    for (const p of pastas(motor)) {
      const nome = p.split(sep).at(-1)
      if (p !== motor && PROIBIDOS_NO_MOTOR.has(nome)) erros.push(`resources/motor nao pode ter ${relative(res, p)}`)
    }
    const empacotados = arquivos(motor)
    const pyc = empacotados.filter((p) => /\.py[co]$/.test(p))
    if (pyc.length) erros.push(`resources/motor tem ${pyc.length} .pyc (ex.: ${relative(res, pyc[0])})`)

    // Igual ao repositorio, nos dois sentidos.
    const doRepo = codigoDoMotorNoRepo(raiz)
    const noPacote = new Set(empacotados.map((p) => relative(motor, p)))
    const faltam = doRepo.filter((r) => !noPacote.has(r))
    if (faltam.length) erros.push(`faltam ${faltam.length} arquivos do motor no pacote (ex.: ${faltam[0]})`)
    const doRepoSet = new Set(doRepo)
    const sobram = [...noPacote].filter((r) => !doRepoSet.has(r))
    if (sobram.length) erros.push(`${sobram.length} arquivos no motor empacotado que o repo nao tem (ex.: ${sobram[0]})`)
    const diferentes = doRepo.filter(
      (r) => noPacote.has(r) && !readFileSync(join(raiz, 'motor', r)).equals(readFileSync(join(motor, r))),
    )
    if (diferentes.length) erros.push(`${diferentes.length} arquivos do motor diferentes do repo (ex.: ${diferentes[0]})`)
    for (const f of ['app/headless.py', 'studio-runtime.json']) {
      if (!existsSync(join(motor, f))) erros.push(`falta resources/motor/${f}`)
    }
    const bytes = empacotados.reduce((s, p) => s + statSync(p).size, 0)
    const igual = erros.length === errosAntes ? ', igual ao repo' : ''
    info.push(`resources/motor: ${empacotados.length} arquivos, ${(bytes / 1024 ** 2).toFixed(1)} MB${igual}`)
  }

  // ffmpeg e ffprobe para o motor, fora do asar
  const unpacked = join(res, 'app.asar.unpacked', 'node_modules')
  const ffmpeg = join(unpacked, 'ffmpeg-static', 'ffmpeg.exe')
  if (!existsSync(ffmpeg)) erros.push('falta o ffmpeg desempacotado (app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe)')
  const remotion = join(unpacked, '@remotion')
  const compositor = existsSync(remotion) ? readdirSync(remotion).find((n) => n.startsWith('compositor-win32')) : undefined
  if (!compositor || !existsSync(join(remotion, compositor, 'ffprobe.exe'))) {
    erros.push('falta o ffprobe do compositor do Remotion desempacotado (app.asar.unpacked/node_modules/@remotion/compositor-win32-*/ffprobe.exe)')
  } else {
    info.push(`ffmpeg: ffmpeg-static; ffprobe: @remotion/${compositor}`)
  }

  // onnxruntime-node so com o binario do Windows
  const napi = join(unpacked, 'onnxruntime-node', 'bin', 'napi-v6')
  if (existsSync(napi)) {
    const plataformas = readdirSync(napi)
    if (!plataformas.includes('win32')) erros.push('o onnxruntime-node empacotado nao tem o binario do Windows')
    const outras = plataformas.filter((n) => n !== 'win32')
    if (outras.length) erros.push(`o onnxruntime-node empacotado leva binarios de ${outras.join(', ')} (files do electron-builder.yml)`)
    const archs = existsSync(join(napi, 'win32')) ? readdirSync(join(napi, 'win32')) : []
    if (!archs.includes('x64')) erros.push('o onnxruntime-node empacotado nao tem o binario win32/x64')
    const outrasArchs = archs.filter((n) => n !== 'x64')
    if (outrasArchs.length) erros.push(`o onnxruntime-node empacotado leva win32/${outrasArchs.join(', ')} (files do electron-builder.yml)`)
  } else {
    erros.push('falta o onnxruntime-node desempacotado')
  }

  return { erros, info }
}

async function main() {
  const { erros, info } = conferirPacote()
  for (const linha of info) process.stdout.write(`  • ${linha}\n`)
  if (erros.length) {
    for (const e of erros) process.stderr.write(`  ERRO: ${e}\n`)
    process.exit(1)
  }
  process.stdout.write('  • pacote conferido\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    process.stderr.write(`\n  ERRO: ${e instanceof Error ? e.message : String(e)}\n\n`)
    process.exit(1)
  })
}
