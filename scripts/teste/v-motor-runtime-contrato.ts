/**
 * RUNTIME DO MOTOR, so o contrato: o lock (motor/studio-runtime.json), a
 * impressao, o requirements com hash, o diff de uma atualizacao, o backend e
 * o ambiente do processo. Sem rede e sem uv. Grava so numa pasta temporaria.
 * Rodar da raiz:
 *   npx esbuild scripts/teste/v-motor-runtime-contrato.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json | node
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import {
  bytesDaInstalacaoCompleta,
  mudancasDoRuntime,
  textoDoTamanho,
  type ImpressaoGravada,
  type LockDoRuntime,
} from '../../shared/motor-runtime'
import { impressaoDoLock, lerLock, requisitosDoLock, versoesDoLock } from '../../electron/services/motor-runtime/lock'
import { caminhosDoRuntime, configurarMotorRuntime } from '../../electron/services/motor-runtime/pastas'
import { ambienteDoRuntime, backendDoRuntime } from '../../electron/services/motor-runtime/index'

const raiz = resolve('.')
const temp = mkdtempSync(join(tmpdir(), 'v-motor-runtime-'))
process.env['ANIRECAP_MOTOR_RUNTIME'] = '1'
process.env['ANIRECAP_MOTOR_RUNTIME_PASTA'] = join(temp, 'runtime')
configurarMotorRuntime({ userData: join(temp, 'ud'), appPath: raiz, resourcesPath: join(temp, 'res'), empacotado: false, versaoDoApp: '0.0.0' })

try {
  // 1. o lock do repositorio
  const lock = lerLock()
  assert.equal(lock.python, '3.12.13')
  assert.ok(lock.pacotes.length > 40)
  assert.ok(!lock.pacotes.some((p) => /pyside6|shiboken6/.test(p.nome)), 'o Qt nao entra no runtime')
  assert.ok(!lock.pacotes.some((p) => p.nome === 'torch' || p.nome === 'torchvision'), 'torch vem das rodas')
  const cu = bytesDaInstalacaoCompleta(lock, 'cu128')
  const cpu = bytesDaInstalacaoCompleta(lock, 'cpu')
  assert.equal(textoDoTamanho(cu), '~3 GB', `cu128 baixa ${cu}`)
  assert.ok(cpu < 0.5e9, `cpu baixa ${cpu}`)
  console.log(`ok lock: ${lock.pacotes.length} pacotes, cu128 ${textoDoTamanho(cu)}, cpu ${textoDoTamanho(cpu)}`)

  // 2. impressao: estavel, por variante, so nome/versao
  const a = impressaoDoLock(lock, 'cu128')
  assert.equal(a, impressaoDoLock(lock, 'cu128'))
  assert.notEqual(a, impressaoDoLock(lock, 'cpu'))
  const outroEspelho: LockDoRuntime = JSON.parse(JSON.stringify(lock))
  outroEspelho.torch.cu128[0]!.url = 'https://outro/torch.whl'
  outroEspelho.pacotes.reverse()
  assert.equal(impressaoDoLock(outroEspelho, 'cu128'), a, 'url e ordem nao mudam a impressao')
  console.log(`ok impressao ${a.slice(0, 12)}`)

  // 3. requirements com hash (formato pip, sem barra no fim da ultima linha de cada pacote)
  const req = requisitosDoLock(lock)
  assert.match(req, /^numpy==\S+ \\\n {4}--hash=sha256:[0-9a-f]{64}/m)
  assert.ok(!/\\\n(?! {4}--hash)/.test(req), 'barra de continuacao seguida de algo que nao e hash')
  console.log('ok requisitos')

  // 4. diff de uma atualizacao do app
  const gravada: ImpressaoGravada = {
    formato: 1, impressao: a, variante: 'cu128', python: lock.python, ...versoesDoLock(lock, 'cu128'),
    cudaOk: true, gpu: 'RTX', uv: '0.11.7', app: '0.1.0', instaladoEm: new Date().toISOString(),
  }
  assert.equal(mudancasDoRuntime(gravada, lock), null)
  const novo: LockDoRuntime = JSON.parse(JSON.stringify(lock))
  novo.pacotes.find((p) => p.nome === 'numpy')!.versao = '9.9.9'
  novo.pacotes.push({ nome: 'zz-novo', versao: '1.0', bytes: 1000, hashes: ['0'.repeat(64)] })
  const sem = { ...gravada, pacotes: { ...gravada.pacotes, 'velho-pkg': '2.0' } }
  const m = mudancasDoRuntime(sem, novo)!
  assert.equal(m.automatica, true)
  assert.equal(m.torch, false)
  assert.deepEqual(m.pacotes.sort(), [`+ zz-novo 1.0`, `- velho-pkg 2.0`, `numpy ${gravada.pacotes['numpy']} -> 9.9.9`].sort())
  const comTorch: LockDoRuntime = JSON.parse(JSON.stringify(lock))
  comTorch.torch.cu128[0]!.versao = '2.12.0+cu128'
  const mt = mudancasDoRuntime(gravada, comTorch)!
  assert.equal(mt.torch, true)
  assert.equal(mt.automatica, false)
  assert.ok(mt.bytes > 2e9)
  assert.equal(mudancasDoRuntime(gravada, lock, 'cpu')!.torch, true, 'trocar de variante e trocar o torch')
  console.log('ok mudancas')

  // 5. backend: ausente -> incompleto -> pronto -> desatualizado
  const c = caminhosDoRuntime(join(temp, 'runtime'))
  let b = backendDoRuntime()
  assert.ok('erro' in b && b.fase === 'ausente', JSON.stringify(b))
  mkdirSync(c.pasta, { recursive: true })
  writeFileSync(c.estado, '{}')
  b = backendDoRuntime()
  assert.ok('erro' in b && b.fase === 'incompleto', JSON.stringify(b))
  mkdirSync(join(c.venv, 'Scripts'), { recursive: true })
  writeFileSync(c.pythonDoVenv, '')
  writeFileSync(c.impressao, JSON.stringify(gravada))
  rmSync(c.estado)
  b = backendDoRuntime()
  assert.ok(!('erro' in b), JSON.stringify(b))
  assert.equal(b.python, c.pythonDoVenv)
  assert.equal(b.cwd, join(raiz, 'motor'))
  writeFileSync(c.impressao, JSON.stringify({ ...gravada, impressao: 'x'.repeat(64) }))
  b = backendDoRuntime()
  assert.ok('erro' in b && b.fase === 'desatualizado', JSON.stringify(b))
  console.log('ok backend')

  // 6. ambiente: ffmpeg do app na frente, ffprobe no fim, Python isolado
  const base = { Path: ['C:\\sistema\\bin', 'C:\\outro'].join(delimiter), PYTHONHOME: 'C:\\py', PYTHONPATH: 'x', ANIRECAP_MOTOR_DADOS: 'd' }
  const env = ambienteDoRuntime(base, { cudaOk: false })
  assert.equal(Object.keys(env).filter((k) => k.toUpperCase() === 'PATH').length, 1, 'uma chave de PATH so')
  const partes = env['Path']!.split(delimiter)
  assert.match(partes[0]!, /ffmpeg-static/)
  assert.match(partes[partes.length - 1]!, /compositor-/)
  assert.equal(partes[1], 'C:\\sistema\\bin')
  assert.equal(env['PYTHONHOME'], undefined)
  assert.equal(env['PYTHONPATH'], undefined)
  assert.equal(env['PYTHONDONTWRITEBYTECODE'], '1')
  assert.equal(env['PYTHONNOUSERSITE'], '1')
  assert.equal(env['CUDA_VISIBLE_DEVICES'], '-1')
  assert.equal(env['ANIRECAP_MOTOR_DADOS'], 'd')
  assert.equal(ambienteDoRuntime(base, { cudaOk: true })['CUDA_VISIBLE_DEVICES'], undefined)
  console.log('ok ambiente')
  console.log('\nTUDO OK')
} finally {
  rmSync(temp, { recursive: true, force: true })
}
