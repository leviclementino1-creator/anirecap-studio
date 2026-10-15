/**
 * O "sem release ainda" do updater: a busca (automatica e manual) responde "em
 * dia" nesses casos (repo sem release, release sem latest.yml); no resto a
 * automatica fica quieta e a manual responde "erro".
 *
 *   npx esbuild scripts/teste/v-updater-sem-release.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json | node
 */
import { ATUALIZACAO_LIGADA, semReleaseAinda } from '../../electron/services/updater'

function erro(msg: string, code?: string): Error {
  const e = new Error(msg) as Error & { code?: string }
  if (code) e.code = code
  return e
}

const casos: Array<[string, unknown, boolean]> = [
  // Medido no app instalado em 15/10, com o repo ainda sem release.
  ['repo sem release (medido)', erro('No published versions on GitHub', 'ERR_XML_MISSED_ELEMENT'), true],
  ['sem versao publicada', erro('x', 'ERR_UPDATER_NO_PUBLISHED_VERSIONS'), true],
  ['sem /releases/latest', erro('Unable to find latest version on GitHub (...)', 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND'), true],
  ['release sem latest.yml', erro('Cannot find latest.yml in the latest release artifacts', 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'), true],
  ['sem internet', erro('net::ERR_INTERNET_DISCONNECTED'), false],
  ['sha512 errado', erro('sha512 checksum mismatch, expected ...', 'ERR_CHECKSUM_MISMATCH'), false],
  ['404 do .exe', erro('Cannot download "https://github.com/.../x.exe", status 404', 'ERR_UPDATER_ZIP_FILE_NOT_FOUND'), false],
  ['nao e Error', 'No published versions on GitHub', true],
  ['null', null, false],
]

let falhas = 0
for (const [nome, e, esperado] of casos) {
  const veio = semReleaseAinda(e)
  if (veio !== esperado) falhas++
  console.log(`${veio === esperado ? 'ok ' : 'FALHOU'} ${nome}: ${veio}`)
}
if (!ATUALIZACAO_LIGADA) {
  falhas++
  console.log('FALHOU ATUALIZACAO_LIGADA deveria ser true')
}
console.log(falhas ? `${falhas} FALHAS` : 'TUDO OK')
process.exit(falhas ? 1 : 0)
