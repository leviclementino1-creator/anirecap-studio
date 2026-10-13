/**
 * A cifra DE VERDADE das chaves: safeStorage (DPAPI no Windows), ida e volta e
 * migracao do settings antigo, pelo settings.ts do app.
 *
 * Precisa do Electron porque fora dele o safeStorage nao existe (o v-llm.ts
 * cobre o resto com um cofre falso). Nao abre janela nenhuma, e o userData vai
 * para uma pasta temporaria: nem o settings do app nem o "Local State" do
 * Electron sao tocados. Rodar da raiz do projeto:
 *   npx esbuild scripts/teste/v-cofre.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json --outfile=out/teste/v-cofre.cjs
 *   npx electron out/teste/v-cofre.cjs
 */
import { app, safeStorage } from 'electron'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureSettings, decifrar, getSettings, saveSettings } from '../../electron/services/settings'

let falhas = 0
function conferir(nome: string, obtido: unknown, esperado: unknown): void {
  const a = JSON.stringify(obtido)
  const b = JSON.stringify(esperado)
  if (a === b) {
    console.log(`  ok   ${nome}`)
  } else {
    falhas += 1
    console.log(`  FALHA ${nome}\n        obtido:   ${a}\n        esperado: ${b}`)
  }
}

/*
 * Nome fixo, limpo no COMECO de cada rodada: o Electron grava o "Local State"
 * no userData depois do ultimo evento que o script ve, entao apagar no fim
 * sempre deixava sobra. Assim sobra no maximo uma pasta, da ultima rodada.
 */
const pasta = join(tmpdir(), 'anirecap-v-cofre')
rmSync(pasta, { recursive: true, force: true })
mkdirSync(pasta, { recursive: true })
// Antes do ready: e daqui que o Electron tira onde guardar a chave do cofre.
app.setPath('userData', pasta)

void app.whenReady().then(() => {
  const arquivo = join(pasta, 'settings.json')
  const ler = (): Record<string, unknown> => JSON.parse(readFileSync(arquivo, 'utf8')) as Record<string, unknown>

  console.log('safeStorage de verdade')
  conferir('cifra disponivel depois do ready', safeStorage.isEncryptionAvailable(), true)

  configureSettings(pasta)
  saveSettings({ geminiApiKey: 'AIza-falsa-cofre-0001', anthropicApiKey: 'sk-ant-falsa-cofre-0002' })
  const texto = readFileSync(arquivo, 'utf8')
  conferir('nada em texto puro no disco', [texto.includes('falsa-cofre')], [false])
  const disco = ler()
  conferir('campos *Enc em base64', [typeof disco['geminiApiKeyEnc'], typeof disco['anthropicApiKeyEnc']], ['string', 'string'])
  conferir(
    'o base64 abre pelo safeStorage',
    safeStorage.decryptString(Buffer.from(String(disco['geminiApiKeyEnc']), 'base64')),
    'AIza-falsa-cofre-0001',
  )

  configureSettings(pasta)
  conferir('ida e volta pelo settings', [getSettings().geminiApiKey, getSettings().anthropicApiKey], [
    'AIza-falsa-cofre-0001',
    'sk-ant-falsa-cofre-0002',
  ])

  console.log('migracao do settings antigo')
  writeFileSync(arquivo, JSON.stringify({ anthropicApiKey: 'sk-ant-velha-cofre-0003', whisperModel: 'base' }), 'utf8')
  configureSettings(pasta)
  conferir('a chave antiga abre', getSettings().anthropicApiKey, 'sk-ant-velha-cofre-0003')
  const migrado = ler()
  conferir('e o arquivo ja vem cifrado', ['anthropicApiKey' in migrado, decifrar(String(migrado['anthropicApiKeyEnc']))], [
    false,
    'sk-ant-velha-cofre-0003',
  ])

  console.log(falhas === 0 ? '\ntudo certo' : `\n${falhas} falha(s)`)
  rmSync(arquivo, { force: true })
  app.exit(falhas === 0 ? 0 : 1)
})
