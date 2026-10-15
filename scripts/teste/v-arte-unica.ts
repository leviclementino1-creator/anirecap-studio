/**
 * O aviso "uma foto so" (electron/services/descoberta/arte-unica.ts), sem a
 * interface: quem foi reconhecido com UMA arte do elenco contada duas vezes
 * (o retrato do MyAnimeList e o da AniList em dois recortes).
 *
 * Dois modos:
 * - sintetico <characters> (~2 s): numa pasta TEMPORARIA, monta personagens
 *   com duas fotos tiradas de <characters> (pasta characters/ de um banco do
 *   motor, so leitura): a mesma arte recortada e reescalada (avisa), duas artes
 *   diferentes (nao avisa), a mesma arte com foto do batismo (fica para o
 *   refs.ts), uma foto so (abaixo do minimo) e um arquivo quebrado no meio.
 * - banco <characters> [esperados] : roda em todos os personagens da pasta e
 *   imprime quem tem uma arte so; com `esperados` ("A;B;C", nomes das pastas),
 *   confere a lista exata.
 *
 * Rodar da raiz do projeto:
 *   npx esbuild scripts/teste/v-arte-unica.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json --outfile=out/teste/v-arte-unica.cjs
 *   node out/teste/v-arte-unica.cjs sintetico "<dados>/cache/anime_db/<anime>/characters"
 *   node out/teste/v-arte-unica.cjs banco "<dados>/cache/anime_db/<anime>/characters" "Anzel;Fressa"
 */
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { nomesDeUmaArte, ORIGEM_DO_BATISMO, origemDeUmaArte } from '../../shared/descoberta'
import { soUmaArte } from '../../electron/services/descoberta/arte-unica'

const modo = process.argv[2] ?? ''
const pasta = process.argv[3] ? resolve(process.argv[3]) : ''

let falhas = 0
function confere(cond: unknown, msg: string): void {
  if (cond) console.log(`  ok   ${msg}`)
  else {
    falhas += 1
    console.log(`  FALHA ${msg}`)
  }
}

const IMAGEM = /\.(jpe?g|png|webp)$/i

function fotosDe(dir: string): string[] {
  return readdirSync(dir)
    .filter((n) => IMAGEM.test(n) && !n.startsWith('auto_disc_'))
    .map((n) => join(dir, n))
    .filter((f) => statSync(f).size > 0)
}

async function sintetico(): Promise<void> {
  // Duas artes diferentes de personagens diferentes do banco dado.
  const fontes = readdirSync(pasta)
    .filter((n) => !n.startsWith('_'))
    .map((n) => fotosDe(join(pasta, n))[0])
    .filter((f): f is string => Boolean(f))
  if (fontes.length < 2) throw new Error(`preciso de 2 personagens com foto em ${pasta}`)
  const [a, b] = fontes as [string, string]
  const tmp = mkdtempSync(join(tmpdir(), 'v-arte-unica-'))
  try {
    const criar = (nome: string): string => {
      const d = join(tmp, nome)
      mkdirSync(d, { recursive: true })
      return d
    }
    // Recorte de 85% no alto (como o da AniList contra o do MAL) e outra escala.
    const recorte = async (origem: string, destino: string): Promise<void> => {
      const img = sharp(readFileSync(origem))
      const { width = 0, height = 0 } = await img.metadata()
      await sharp(readFileSync(origem))
        .extract({ left: Math.round(width * 0.08), top: 0, width: Math.round(width * 0.85), height: Math.round(height * 0.85) })
        .resize({ width: 230, height: 345, fit: 'cover' })
        .png()
        .toFile(destino)
    }
    const mesma = criar('Mesma, Arte')
    copyFileSync(a, join(mesma, '1.jpg'))
    await recorte(a, join(mesma, '2.png'))
    const duas = criar('Duas Artes')
    copyFileSync(a, join(duas, '1.jpg'))
    copyFileSync(b, join(duas, '2.jpg'))
    const batismo = criar('Com Batismo')
    copyFileSync(a, join(batismo, '1.jpg'))
    await recorte(a, join(batismo, '2.png'))
    copyFileSync(b, join(batismo, 'auto_disc_01.jpg'))
    const uma = criar('Uma Foto')
    copyFileSync(a, join(uma, '1.jpg'))
    const quebrada = criar('Com Quebrada')
    copyFileSync(a, join(quebrada, '1.jpg'))
    writeFileSync(join(quebrada, '2.jpg'), 'nao sou jpeg')
    await recorte(a, join(quebrada, '3.png'))
    const so2Quebradas = criar('So Quebradas')
    writeFileSync(join(so2Quebradas, '1.jpg'), 'x')
    writeFileSync(join(so2Quebradas, '2.jpg'), 'y')

    const t0 = Date.now()
    const nomes = [
      'Arte Mesma', // outra grafia da pasta "Mesma, Arte"
      'Duas Artes',
      'Com Batismo',
      'Uma Foto',
      'Com Quebrada',
      'So Quebradas',
      'Nao Existe',
    ]
    const r = await soUmaArte(tmp, nomes)
    console.log(`  (${Date.now() - t0} ms) -> ${JSON.stringify(r)}`)
    confere(r.includes('Arte Mesma'), 'mesma arte recortada e reescalada: avisa (casando a grafia "Mesma, Arte")')
    confere(!r.includes('Duas Artes'), 'duas artes diferentes: nao avisa')
    confere(!r.includes('Com Batismo'), 'com foto do batismo: fica para o refs.ts')
    confere(!r.includes('Uma Foto'), 'uma foto so (abaixo do minimo): fora da conta')
    confere(r.includes('Com Quebrada'), 'arquivo quebrado no meio fica de fora da conta')
    confere(!r.includes('So Quebradas'), 'so arquivos quebrados: nao avisa')
    confere(r.length === 2, `exatamente 2 avisos (veio ${r.length})`)
    confere((await soUmaArte(null, nomes)).length === 0, 'sem refsDir: ninguem')
    confere((await soUmaArte(join(tmp, 'nao-existe'), nomes)).length === 0, 'refsDir sumida: ninguem, sem lancar')
    confere((await soUmaArte(tmp, [])).length === 0, 'sem nomes: ninguem')
    // O caminho ate a tela: o fotosDoElenco leva os nomes do motor (com virgula) e volta igual.
    const ida = origemDeUmaArte(['Liston, Nia', 'Anzel'])
    confere(JSON.stringify(nomesDeUmaArte(ida)) === JSON.stringify(['Liston, Nia', 'Anzel']), `fotosDoElenco ida e volta: "${ida}"`)
    confere(nomesDeUmaArte(ORIGEM_DO_BATISMO) === null && nomesDeUmaArte('Corte Cenas') === null && nomesDeUmaArte(null) === null, 'outras origens nao viram aviso')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

async function banco(): Promise<void> {
  const nomes = readdirSync(pasta).filter((n) => !n.startsWith('_'))
  const t0 = Date.now()
  const r = await soUmaArte(pasta, nomes)
  console.log(`  ${nomes.length} personagens, ${Date.now() - t0} ms`)
  console.log(`  uma arte so (${r.length}): ${r.join('; ') || 'ninguem'}`)
  const esperados = process.argv[4]
  if (esperados !== undefined) {
    const lista = esperados.split(';').filter(Boolean).sort()
    confere(JSON.stringify([...r].sort()) === JSON.stringify(lista), `lista exata: ${lista.join('; ') || 'ninguem'}`)
  }
}

async function main(): Promise<void> {
  if (!pasta || (modo !== 'sintetico' && modo !== 'banco')) {
    console.log('uso: node out/teste/v-arte-unica.cjs sintetico|banco <characters> [esperados]')
    process.exit(2)
  }
  console.log(`== ${modo} ${pasta}`)
  if (modo === 'sintetico') await sintetico()
  else await banco()
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO OK')
  process.exit(falhas ? 1 : 0)
}

void main()
