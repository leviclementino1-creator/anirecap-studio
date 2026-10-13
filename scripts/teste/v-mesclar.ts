/**
 * Mesclar cenas SEM TOCAR NO ANCUT: a pasta do episodio fica byte a byte
 * igual, a varredura troca os pedacos pelo clipe mesclado, e desfazer volta ao
 * original.
 *
 * Tudo numa biblioteca SINTETICA na pasta temporaria (ffmpeg testsrc), com um
 * userData descartavel -- nunca a biblioteca real nem o perfil do app. Sem o
 * Electron: o esbuild resolve o @shared e o sharp/ffmpeg-static vem do
 * node_modules.
 *
 *   npx esbuild scripts/teste/v-mesclar.ts --bundle --platform=node --format=cjs \
 *     --tsconfig=tsconfig.node.json --external:sharp --external:ffmpeg-static \
 *     --outfile=<tmp>/v-mesclar.cjs
 *   NODE_PATH=node_modules node <tmp>/v-mesclar.cjs
 *
 * MANTER=1 deixa a pasta temporaria para olhar depois.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import type { LibraryClip, LibraryIndex } from '../../shared/channels'
import { ffmpegPath } from '../../electron/services/ffmpeg-path'
import { configureLibrary, scanLibrary } from '../../electron/services/library'
import { desfazerMescla, mesclarClipes } from '../../electron/services/mesclar'
import { lerMesclas } from '../../electron/services/mesclas-studio'

let falhas = 0
function conferir(nome: string, obtido: unknown, esperado: unknown): void {
  const a = JSON.stringify(obtido)
  const b = JSON.stringify(esperado)
  if (a === b) console.log(`  ok   ${nome}`)
  else {
    falhas += 1
    console.log(`  FALHA ${nome}\n        obtido:   ${a}\n        esperado: ${b}`)
  }
}
const ok = (nome: string, c: boolean, d = ''): void => conferir(d ? `${nome}  -- ${d}` : nome, c, true)
const perto = (a: number, b: number, folga = 0.15): boolean => Math.abs(a - b) <= folga

async function recusa(nome: string, f: () => Promise<unknown>, trecho: string): Promise<void> {
  try {
    await f()
    ok(`${nome} (recusou)`, false, 'aceitou')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    ok(`${nome} (recusou)`, msg.includes(trecho), msg)
  }
}

// --------------------------------------------------- biblioteca sintetica

const base = mkdtempSync(join(tmpdir(), 'v-mesclar-'))
const biblio = join(base, 'biblioteca')
const userData = join(base, 'userData')
// O Dangai achava o index.db do AnCut pelo LOCALAPPDATA. Apontado para uma
// pasta vazia: se alguma coisa voltar a procurar o banco, ela deixa de estar vazia.
const localAppData = join(base, 'localappdata')
mkdirSync(localAppData, { recursive: true })
process.env['LOCALAPPDATA'] = localAppData

const DURACOES = [1.0, 1.5, 2.0, 1.25]
const PERSONAGENS: string[][] = [[], ['Ana'], ['Bruno'], ['Ana']]

function ffmpeg(args: string[]): void {
  execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true })
}

function criarEpisodio(ep: number, modo: string): string {
  const dir = join(biblio, 'Serie Teste', `S01E0${ep}`)
  for (const sub of ['shots', 'keyframes', 'metadata']) mkdirSync(join(dir, sub), { recursive: true })
  writeFileSync(join(dir, 'shots', '.export_mode'), modo)
  const linhas: unknown[] = []
  let t = 0
  for (const [i, d] of DURACOES.entries()) {
    const id = String(i + 1).padStart(4, '0')
    const shot = join(dir, 'shots', `${id}.mp4`)
    ffmpeg([
      '-f', 'lavfi', '-i', `testsrc=duration=${d}:size=320x180:rate=24000/1001`,
      '-f', 'lavfi', '-i', `sine=frequency=${300 + 100 * i}:duration=${d}`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', shot,
    ])
    ffmpeg(['-i', shot, '-frames:v', '1', '-update', '1', join(dir, 'keyframes', `${id}_1.jpg`)])
    linhas.push({
      shot_id: id,
      file: `shots/${id}.mp4`,
      keyframe: `keyframes/${id}_1.jpg`,
      start: t,
      end: t + d,
      duration: d,
      characters: PERSONAGENS[i]!.map((name, k) => ({ name, character_id: k + 1 })),
      pairs: [],
      anime: 'Serie Teste',
      season: 1,
      episode: ep,
    })
    t += d
  }
  writeFileSync(join(dir, 'metadata', 'shots.json'), JSON.stringify(linhas, null, 2))
  return dir
}

/** Tudo da pasta: caminho, tamanho, mtime e hash de cada arquivo, e o mtime de cada pasta. */
function retrato(raiz: string, comMtime = true): string[] {
  const linhas: string[] = []
  const andar = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      const st = statSync(p)
      const rel = relative(raiz, p)
      if (e.isDirectory()) {
        linhas.push(`${rel}/ ${comMtime ? st.mtimeMs : ''}`)
        andar(p)
      } else {
        const hash = createHash('sha1').update(readFileSync(p)).digest('hex')
        linhas.push(`${rel} ${st.size} ${hash} ${comMtime ? st.mtimeMs : ''}`)
      }
    }
  }
  andar(raiz)
  return linhas.sort()
}

function sondar(path: string): string {
  return spawnSync(ffmpegPath, ['-hide_banner', '-i', path], { encoding: 'utf8', windowsHide: true }).stderr
}

const doEp = (idx: LibraryIndex, ep: number): LibraryClip[] => idx.clips.filter((c) => c.episode === ep)
const ids = (clips: readonly LibraryClip[]): string[] => clips.map((c) => c.shot)
const essencia = (c: LibraryClip): unknown => [c.id, c.path, c.keyframe, c.start, c.duration, c.characters]

async function main(): Promise<void> {
  console.log(`biblioteca sintetica em ${base}`)
  const ep1 = criarEpisodio(1, 'compat')
  const ep2 = criarEpisodio(2, 'off')
  const shot = (ep: string, n: string): string => join(ep, 'shots', `${n}.mp4`)
  const antes = retrato(biblio)
  console.log(`  ${antes.length} entradas na biblioteca`)

  configureLibrary(userData)
  const varrer = (): Promise<LibraryIndex> => scanLibrary(biblio, (p) => `thumb:${p}`)

  console.log('\nvarredura original')
  const s1 = await varrer()
  conferir('S01E01 com as 4 cenas', ids(doEp(s1, 1)), ['0001', '0002', '0003', '0004'])
  conferir('S01E02 com as 4 cenas', ids(doEp(s1, 2)), ['0001', '0002', '0003', '0004'])

  console.log('\nas validacoes de sempre')
  await recusa('uma cena so', () => mesclarClipes([shot(ep1, '0001')]), 'pelo menos duas')
  await recusa('cenas com buraco', () => mesclarClipes([shot(ep1, '0001'), shot(ep1, '0003')]), 'SEGUIDAS')
  await recusa('episodios diferentes', () => mesclarClipes([shot(ep1, '0001'), shot(ep2, '0002')]), 'mesmo episodio')
  await recusa('fora de shots/', () => mesclarClipes([join(ep1, 'keyframes', '0001_1.jpg'), join(ep1, 'keyframes', '0002_1.jpg')]), 'pasta shots')
  conferir('recusar nao deixou rastro no registro', lerMesclas().length, 0)

  console.log('\nmesclar 0003 + 0002 (compat, fora de ordem)')
  const r1 = await mesclarClipes([shot(ep1, '0003'), shot(ep1, '0002')])
  ok('o clipe mora no userData do Studio', r1.path.startsWith(join(userData, 'biblioteca-studio', 'mesclas')), r1.path)
  conferir('nome NNNN-MMMM', basename(r1.path), '0002-0003.mp4')
  conferir('pedacos = os caminhos que sairam da grade', r1.pedacos, [shot(ep1, '0002'), shot(ep1, '0003')])
  conferir('banco do AnCut nao tocado', r1.ancut, 'sem-banco')
  ok('segundos = soma', perto(r1.segundos, 3.5), String(r1.segundos))
  const info = sondar(r1.path)
  ok('mesma saida do corte compat: h264 High', /Video: h264 \(High\)/.test(info))
  ok('mesma saida do corte compat: 23.98 fps', /23\.98 fps/.test(info))
  ok('com audio aac', /Audio: aac/.test(info))
  conferir('(a) pasta do AnCut byte a byte igual', retrato(biblio), antes)
  const reg1 = lerMesclas()
  conferir('registro: 1 linha', reg1.length, 1)
  conferir('registro: episodio, pedacos, arquivo', [reg1[0]?.episodio, reg1[0]?.pedacos, reg1[0]?.arquivo], [ep1, ['0002', '0003'], r1.path])
  ok('registro: segundos e criadoEm', perto(reg1[0]?.segundos ?? 0, 3.5) && !Number.isNaN(Date.parse(reg1[0]?.criadoEm ?? '')))

  console.log('\n(b) a varredura mostra a cena mesclada no lugar dos pedacos')
  const s2 = await varrer()
  conferir('so o episodio mexido foi relido', s2.scanned, 1)
  conferir('S01E01', ids(doEp(s2, 1)), ['0001', '0002-0003', '0004'])
  const m = doEp(s2, 1).find((c) => c.shot === '0002-0003')!
  conferir('id no formato do Dangai', m.id, 'Serie Teste/S01E01/0002-0003')
  conferir('path = clipe do Studio', m.path, r1.path)
  conferir('keyframe do 1o pedaco', m.keyframe, join(ep1, 'keyframes', '0002_1.jpg'))
  conferir('start do 1o pedaco', m.start, 1.0)
  conferir('duracao somada', m.duration, 3.5)
  conferir('personagens dos dois', m.characters, ['Ana', 'Bruno'])
  ok('miniatura no userData', m.thumbPath.startsWith(join(userData, 'thumbs')), m.thumbPath)
  conferir('S01E02 intacto', doEp(s2, 2).map(essencia), doEp(s1, 2).map(essencia))
  const s2b = await varrer()
  conferir('varrer de novo usa o cache', s2b.scanned, 0)
  conferir('e devolve o mesmo', s2b.clips.map(essencia), s2.clips.map(essencia))

  console.log('\npedaco escondido nao entra em outra mescla')
  await recusa('0001 + 0002 (0002 ja mesclada)', () => mesclarClipes([shot(ep1, '0001'), shot(ep1, '0002')]), 'ja esta mesclada')

  console.log('\nmesclar a mescla: 0002-0003 + 0004')
  const r2 = await mesclarClipes([r1.path, shot(ep1, '0004')])
  conferir('nome', basename(r2.path), '0002-0004.mp4')
  ok('a mescla velha (nossa) foi apagada', !existsSync(r1.path))
  conferir('pedacos devolvidos', r2.pedacos, [r1.path, shot(ep1, '0004')])
  conferir('registro: uma linha com os pedacos originais', lerMesclas().map((x) => x.pedacos), [['0002', '0003', '0004']])
  ok('segundos', perto(r2.segundos, 4.75), String(r2.segundos))
  conferir('pasta do AnCut byte a byte igual', retrato(biblio), antes)
  const s3 = await varrer()
  conferir('S01E01', ids(doEp(s3, 1)), ['0001', '0002-0004'])
  conferir('duracao', doEp(s3, 1)[1]?.duration, 4.75)

  console.log('\nmodo off (-c copy) no S01E02')
  const r3 = await mesclarClipes([shot(ep2, '0001'), shot(ep2, '0002')])
  ok('segundos', perto(r3.segundos, 2.5), String(r3.segundos))
  ok('copiado sem reencodar: continua sem o perfil High', !/Video: h264 \(High\)/.test(sondar(r3.path)))
  conferir('pasta do AnCut byte a byte igual', retrato(biblio), antes)
  conferir('S01E02', ids(doEp(await varrer(), 2)), ['0001-0002', '0003', '0004'])

  console.log('\n(c) desfazer volta ao original')
  const d2 = desfazerMescla(r2.path)
  conferir('devolve os pedacos', d2.pedacos, [shot(ep1, '0002'), shot(ep1, '0003'), shot(ep1, '0004')])
  ok('clipe do Studio apagado', !existsSync(r2.path))
  desfazerMescla(r3.path)
  conferir('registro vazio', lerMesclas().length, 0)
  conferir('pastas de mescla vazias somem', readdirSync(join(userData, 'biblioteca-studio', 'mesclas')), [])
  const s4 = await varrer()
  conferir('a grade volta igual a original', s4.clips.map(essencia), s1.clips.map(essencia))
  conferir('pasta do AnCut byte a byte igual', retrato(biblio), antes)
  await recusa('desfazer o que nao e mescla', async () => desfazerMescla(shot(ep1, '0001')), 'nao e uma mescla')

  console.log('\nregistro velho nao quebra a varredura')
  const r4 = await mesclarClipes([shot(ep1, '0001'), shot(ep1, '0002')])
  rmSync(r4.path)
  conferir('clipe do Studio sumiu: pedacos voltam', ids(doEp(await varrer(), 1)), ['0001', '0002', '0003', '0004'])
  const r5 = await mesclarClipes([shot(ep1, '0001'), shot(ep1, '0002')])
  conferir('mesclar de novo troca a linha velha', lerMesclas().length, 1)
  conferir('e aparece', ids(doEp(await varrer(), 1)), ['0001-0002', '0003', '0004'])
  // Daqui para baixo a biblioteca sintetica e mexida de proposito (o pedaco "some").
  const fora = join(base, 'fora.mp4')
  renameSync(shot(ep1, '0002'), fora)
  conferir('pedaco sumiu do disco: a mescla e ignorada', ids(doEp(await varrer(), 1)), ['0001', '0003', '0004'])
  renameSync(fora, shot(ep1, '0002'))
  conferir('pedaco voltou: a mescla volta', ids(doEp(await varrer(), 1)), ['0001-0002', '0003', '0004'])
  ok('registro: uma assinatura por pedaco', lerMesclas()[0]?.assinaturas?.length === 2)

  // O AnCut recorta regravando shots/0002.mp4 com o mesmo numero: a mescla velha
  // nao pode esconder o corte novo atras de um clipe feito do antigo.
  const original = join(base, 'original-0002.mp4')
  copyFileSync(shot(ep1, '0002'), original)
  ffmpeg([
    '-f', 'lavfi', '-i', 'testsrc2=duration=0.75:size=320x180:rate=24000/1001',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', shot(ep1, '0002'),
  ])
  conferir('pedaco recortado: a mescla cai e os cortes voltam soltos', ids(doEp(await varrer(), 1)), ['0001', '0002', '0003', '0004'])
  const r6 = await mesclarClipes([shot(ep1, '0001'), shot(ep1, '0002')])
  conferir('mesclar de novo troca a linha velha', lerMesclas().length, 1)
  ok('a mescla velha nao trava a nova (o clipe e regravado no mesmo lugar)', existsSync(r6.path) && r6.path === r5.path)
  conferir('a mescla nova vale', ids(doEp(await varrer(), 1)), ['0001-0002', '0003', '0004'])
  desfazerMescla(r6.path)
  // Os bytes de antes voltam, para a conferencia final da biblioteca.
  copyFileSync(original, shot(ep1, '0002'))
  rmSync(original)

  const registro = join(userData, 'biblioteca-studio', 'mesclas.json')
  writeFileSync(registro, '{ isto nao e json')
  conferir('registro quebrado: nenhuma mescla', lerMesclas().length, 0)
  conferir('e a grade original', (await varrer()).clips.map(essencia), s1.clips.map(essencia))

  // Uma linha editada a mao apontando para um arquivo do AnCut nao pode virar
  // apagamento nem cena duplicada.
  writeFileSync(
    registro,
    JSON.stringify({ version: 1, mesclas: [{ episodio: ep1, pedacos: ['0001', '0002'], arquivo: shot(ep1, '0004'), segundos: 1, criadoEm: '' }] }),
  )
  conferir('linha apontando para shots/: ignorada na grade', ids(doEp(await varrer(), 1)), ['0001', '0002', '0003', '0004'])
  desfazerMescla(shot(ep1, '0004'))
  ok('e desfazer nao apaga o arquivo do AnCut', existsSync(shot(ep1, '0004')))

  console.log('\nnada do AnCut foi procurado nem escrito')
  conferir('LOCALAPPDATA vazio', readdirSync(localAppData), [])
  conferir('nenhum index.db criado', retrato(base, false).filter((l) => /index\.db/i.test(l)), [])
  conferir('conteudo da biblioteca igual ao do inicio', retrato(biblio, false), antes.map((l) => l.replace(/ [\d.]+$/, ' ')))

  if (process.env['MANTER']) console.log(`\n(pasta mantida em ${base})`)
  else rmSync(base, { recursive: true, force: true })

  console.log(falhas === 0 ? '\ntudo certo' : `\n${falhas} falha(s)`)
  process.exitCode = falhas === 0 ? 0 : 1
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
