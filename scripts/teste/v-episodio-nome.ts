/**
 * O palpite pelo nome (electron/services/episodio/nome.ts) contra o original
 * em Python (motor/app/video_ingest.py parse_filename), nome a nome.
 *
 * Usa TODOS os .mkv de C:/Users/levic/Downloads (so o nome: nenhum arquivo e
 * aberto) mais uma lista de casos dificeis tirados dos comentarios do motor.
 * Passa quando os dois lados dao exatamente o mesmo anime, temporada,
 * episodio e kind.
 *
 * Rodar da raiz do projeto:
 *   npx esbuild scripts/teste/v-episodio-nome.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json | node
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { palpitePeloNome } from '../../electron/services/episodio/nome'

const DOWNLOADS = 'C:/Users/levic/Downloads'
const MOTOR = join(process.cwd(), 'motor')
const PYTHON = join(MOTOR, '.venv', 'Scripts', 'python.exe')

const reais = readdirSync(DOWNLOADS)
  .filter((n) => n.toLowerCase().endsWith('.mkv'))
  .map((n) => join(DOWNLOADS, n))

// Casos dos comentarios do motor e variacoes que costumam quebrar regex.
const sinteticos = [
  'D:/Animes/Mushoku Tensei/Season 1/S01E01-Jobless Reincarnation V2.mkv',
  'D:/Animes/Tensura/Tensura S2 NCOP1.mkv',
  'D:/x/Black Clover - OP Opening 2 v1 PAiNT it BLACK.mkv',
  'D:/x/Cyberpunk EDgerunners S01E02.mkv',
  'D:/x/Matrix 1999.mkv',
  'D:/x/Filme.2019.1080p.WEB-DL.mkv',
  'D:/x/Bleach S17E05 (2022).mkv',
  'D:/x/[Erai-raws] Re Zero kara Hajimeru Isekai Seikatsu 4th Season - 19 [1080p].mkv',
  'D:/x/Anime Qualquer Temporada 2 Episodio 7.mkv',
  'D:/x/Anime Qualquer Episódio 7.mkv',
  'D:/x/Show 3x07.mkv',
  'D:/x/Show Season 2 Episode 5.mkv',
  'D:/x/Show - 12v2 [720p].mkv',
  'D:/x/Show Ep. 4.mkv',
  'D:/x/Show #05.mkv',
  'D:/x/Anime Ｘ - ３.mkv',
  'D:/x/Downloads/S02E03.mkv',
  'D:/x/One Piece - 1100 (1080p).mkv',
  'D:/x/Naruto_Shippuden_-_045_[720p].mkv',
  'D:/x/[Group] Show - NCED2 [BD].mkv',
  'D:/x/Show ED 3.mkv',
]

const casos = [...reais, ...sinteticos]

const codigoPython = `
import json, sys
from app.video_ingest import parse_filename
saida = []
for p in json.load(sys.stdin):
    i = parse_filename(p)
    saida.append({"anime": i.anime, "temporada": i.season, "episodio": i.episode, "kind": i.kind})
sys.stdout.write(json.dumps(saida, ensure_ascii=False))
`

const py = spawnSync(PYTHON, ['-c', codigoPython], {
  cwd: MOTOR,
  input: JSON.stringify(casos),
  encoding: 'utf8',
  env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
})
if (py.status !== 0) {
  console.error(py.stderr)
  throw new Error('o Python do motor nao rodou')
}
const esperados = JSON.parse(py.stdout) as ReturnType<typeof palpitePeloNome>[]

let falhas = 0
for (const [i, caso] of casos.entries()) {
  const ts = palpitePeloNome(caso)
  const py = esperados[i]!
  const igual =
    ts.anime === py.anime && ts.temporada === py.temporada && ts.episodio === py.episodio && ts.kind === py.kind
  const nome = caso.split(/[\\/]/).pop()
  const mostrar = (p: typeof ts): string => `${p.anime} | S${p.temporada} E${p.episodio}${p.kind ? ` ${p.kind}` : ''}`
  if (!igual) {
    falhas += 1
    console.log(`DIFERENTE  ${nome}\n   TS: ${mostrar(ts)}\n   PY: ${mostrar(py)}`)
  } else {
    console.log(`ok  ${mostrar(ts).padEnd(70)} <- ${nome}`)
  }
}

console.log(`\n${casos.length} nomes (${reais.length} reais, ${sinteticos.length} sinteticos), ${falhas} diferentes.`)
if (falhas > 0) process.exit(1)
console.log('tudo certo')
