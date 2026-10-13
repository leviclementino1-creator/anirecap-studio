/**
 * As correcoes da revisao da parte 1 (Episodio), com bibliotecas SINTETICAS
 * numa pasta temporaria -- e o .mkv real do S4 - 37 so onde precisa de sonda:
 *
 * 1. anime parecido: prefixo nao junta franquias ("Naruto" x "Naruto
 *    Shippuden"); o titulo do motor com dois-pontos ainda casa;
 * 2. grafias do mesmo personagem: a vogal longa do romaji ("Saionji, Ukyou" x
 *    "Ukyo Saionji") vira um nome so, no resumo e na busca;
 * 3. busca: 'nome' exige o mesmo anime e episodio (title_t00.mkv); indice de
 *    achado fraco nao vira 'source' nem 'impressao';
 * 4. indice: refazer nao herda exclusoes de um indice de OUTRO .mkv; source
 *    com o mesmo nome em outro lugar avisa;
 * 5. o desarme do corte de outro arquivo (marca .cor) so nas pastas certas;
 * 6. o elenco degradado do cache do motor posto de lado depois da tregua.
 *
 * Nada e escrito fora da pasta temporaria (o Corte Cenas e so lido pela busca).
 * Rodar da raiz do projeto:
 *   npx esbuild scripts/teste/v-episodio-busca.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json | node
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resumirIndice, type EpisodeIndex, type EpisodioEncontrado, type PalpiteDoEpisodio } from '../../shared/episodio'
import { canonizar } from '../../shared/nomes'
import { ffmpegPath } from '../../electron/services/ffmpeg-path'
import { configureLibrary } from '../../electron/services/library'
import { configureSettings, saveSettings, type Cofre } from '../../electron/services/settings'
import { porDeLadoElencoDegradado } from '../../electron/services/elenco-degradado'
import { animeParecido, tituloParecido } from '../../electron/services/episodio/anime-parecido'
import { desarmarCorteDeOutroArquivo } from '../../electron/services/episodio/corte-de-outro-arquivo'
import { configurarEpisodios, indexarEpisodio } from '../../electron/services/episodio/indice'
import { contarPersonagens, lerPastaDoEpisodio } from '../../electron/services/episodio/pasta-do-episodio'
import { procurarEpisodio } from '../../electron/services/episodio/procurar'
import { sondarEpisodio } from '../../electron/services/episodio/sondar'

const ACHADO = 'C:/Users/levic/Downloads/[SubsPlease] Dr. Stone S4 - 37 (1080p) [477E9A74].mkv'
const PASTA_DO_CORTE_CENAS = 'G:\\App Corte Cenas\\Output\\Dr. Stone\\S04E37'

let falhas = 0
function confere(ok: boolean, mensagem: string, detalhe?: unknown): void {
  if (ok) console.log(`  ok  ${mensagem}`)
  else {
    falhas += 1
    console.log(`  FALHOU  ${mensagem}`, detalhe === undefined ? '' : JSON.stringify(detalhe))
  }
}
function secao(titulo: string): void {
  console.log(`\n== ${titulo}`)
}

/** Uma pasta de episodio no formato do motor, com `n` cenas de 1 s (mp4 de verdade so quando pedido). */
function pastaSintetica(
  pasta: string,
  opcoes: { titulo: string; source?: string; cenas?: number; inicio?: number; mp4?: boolean; cor?: string },
): void {
  mkdirSync(join(pasta, 'shots'), { recursive: true })
  mkdirSync(join(pasta, 'keyframes'), { recursive: true })
  mkdirSync(join(pasta, 'metadata'), { recursive: true })
  const linhas = []
  for (let i = 1; i <= (opcoes.cenas ?? 2); i += 1) {
    const id = String(i).padStart(4, '0')
    const mp4 = join(pasta, 'shots', `${id}.mp4`)
    if (opcoes.mp4) {
      spawnSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x36:d=1', '-pix_fmt', 'yuv420p', mp4])
    } else {
      writeFileSync(mp4, 'x')
    }
    const inicio = (opcoes.inicio ?? 0) + i - 1
    linhas.push({ shot_id: id, file: `shots/${id}.mp4`, start: inicio, end: inicio + 1, duration: 1, characters: [], anime: opcoes.titulo })
  }
  writeFileSync(join(pasta, 'metadata', 'shots.json'), JSON.stringify(linhas, null, 2))
  if (opcoes.source) {
    writeFileSync(join(pasta, 'metadata', 'shot_bounds.json'), JSON.stringify({ source: opcoes.source, shots: [] }))
  }
  if (opcoes.cor) writeFileSync(join(pasta, 'shots', '.cor'), opcoes.cor)
}

function palpite(anime: string, temporada: number, episodio: number): PalpiteDoEpisodio {
  return { anime, temporada, episodio, kind: '' }
}

/** So os achados dentro de `raiz` (a busca tambem le o Corte Cenas real). */
function dentro(achados: EpisodioEncontrado[], raiz: string): EpisodioEncontrado[] {
  return achados.filter((a) => a.pasta.toLowerCase().startsWith(raiz.toLowerCase()))
}

async function main(): Promise<void> {
  const temp = mkdtempSync(join(tmpdir(), 'v-episodio-busca-'))
  const userData = join(temp, 'userData')
  const bibliotecaStudio = join(temp, 'Biblioteca')
  const lib = join(temp, 'Lib')
  mkdirSync(userData, { recursive: true })
  mkdirSync(lib, { recursive: true })
  const cofreFalso: Cofre = {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.alloc(0),
    decryptString: () => '',
  }
  configureSettings(userData, cofreFalso)
  saveSettings({ bibliotecaStudio, libraryDir: lib })
  configurarEpisodios(userData)
  configureLibrary(userData)

  try {
    // ------------------------------------------------------------------ 1
    secao('1. Anime parecido')
    const pares: [string, string, boolean][] = [
      ['Naruto', 'Naruto Shippuden', false],
      ['Bleach', 'Bleach - Sennen Kessen-hen - Soukoku-tan', false],
      ['Dragon Ball', 'Dragon Ball Super', false],
      ['Sword Art Online', 'Sword Art Online Alternative Gun Gale Online', false],
      ['Dr Stone', 'Dr. Stone', true],
      ['Dr STONE', 'Dr. Stone', true],
      ['Re Zero kara Hajimeru Isekai Seikatsu 4th Season', 'Re Zero kara Hajimeru Isekai Seikatsu', true],
      ['Rimuru Tempest', 'Tempest Rimuru', true],
    ]
    for (const [a, b, esperado] of pares) confere(animeParecido(a, b) === esperado, `animeParecido("${a}", "${b}") = ${esperado}`)
    confere(tituloParecido('Dr. STONE: SCIENCE FUTURE', 'Dr Stone'), 'titulo do motor com dois-pontos casa pelo comeco')
    confere(!tituloParecido('Naruto Shippuden', 'Naruto'), 'titulo sem dois-pontos nao casa pelo prefixo')

    // ------------------------------------------------------------------ 2
    secao('2. Grafias do mesmo personagem')
    const mapa = canonizar(
      new Map([
        ['Saionji, Ukyou', 4],
        ['Ukyo Saionji', 3],
        ['Ishigami, Senkuu', 23],
        ['Senku Ishigami', 2],
        ['Kurosaki, Ichigo', 5],
        ['Kurosaki, Isshin', 5],
        ['Rem', 3],
        ['Ram', 3],
      ]),
    )
    confere(mapa.get('Ukyo Saionji') === 'Saionji, Ukyou', 'Ukyo Saionji -> Saionji, Ukyou (a mais usada)')
    confere(mapa.get('Senku Ishigami') === 'Ishigami, Senkuu', 'Senku Ishigami -> Ishigami, Senkuu')
    confere(mapa.get('Kurosaki, Isshin') === 'Kurosaki, Isshin', 'Ichigo e Isshin continuam dois')
    confere(mapa.get('Ram') === 'Ram' && mapa.get('Rem') === 'Rem', 'Rem e Ram continuam dois')
    const doCorteCenas = lerPastaDoEpisodio(PASTA_DO_CORTE_CENAS)
    if (doCorteCenas) {
      const nomes = contarPersonagens(doCorteCenas).map((p) => p.nome)
      confere(
        nomes.filter((n) => /ukyo/i.test(n)).length === 1,
        `S04E37 do Corte Cenas: um Ukyo so na contagem (${nomes.filter((n) => /ukyo/i.test(n)).join(', ')})`,
      )
    } else {
      console.log('  (sem a pasta do Corte Cenas nesta maquina: pulado)')
    }

    // ------------------------------------------------------------------ 3
    secao('3. Busca nas bibliotecas (sinteticas)')
    pastaSintetica(join(lib, 'Bocchi', 'S01E03'), { titulo: 'Bocchi the Rock!', source: 'D:/BD/Bocchi/title_t00.mkv' })
    pastaSintetica(join(lib, 'Bleach', 'S01E06'), { titulo: 'BLEACH', source: 'X:/Bleach/[Grupo] Bleach - 06.mkv' })
    pastaSintetica(join(lib, 'DS', 'S04E24'), { titulo: 'Dr. STONE: SCIENCE FUTURE', source: 'X:/DS/a.mkv' })
    pastaSintetica(join(lib, 'Velho', 'S01E01'), { titulo: 'Velho' })

    const rip = 'C:/Rips/Frieren/title_t00.mkv'
    confere(dentro(await procurarEpisodio(rip, palpite('Frieren', 1, 3)), lib).length === 0, 'title_t00.mkv de outro anime: nao acha o Bocchi')
    const bocchi = dentro(await procurarEpisodio(rip, palpite('Bocchi', 1, 3)), lib)
    confere(bocchi[0]?.comoAchou === 'nome', `mesmo nome + mesmo anime e episodio: 'nome' (${bocchi[0]?.comoAchou})`)

    const tybw = 'C:/x/[SubsPlease] Bleach - Sennen Kessen-hen - Soukoku-tan - 06 (1080p).mkv'
    confere(
      dentro(await procurarEpisodio(tybw, palpite('Bleach - Sennen Kessen-hen - Soukoku-tan', 1, 6)), lib).length === 0,
      'Bleach TYBW nao acha a pasta do Bleach de 2004',
    )
    const ds = dentro(await procurarEpisodio('C:/x/Dr.STONE.S04E24.mkv', palpite('Dr Stone', 4, 24)), lib)
    confere(ds[0]?.comoAchou === 'anime+episodio', `pasta "DS" achada pelo titulo do motor (${ds[0]?.comoAchou})`)

    // Indice de um achado fraco: fonte.path = o arquivo aberto, mas as cenas
    // sairam de outro. Nao pode virar 'source'.
    const outroRelease = 'C:/x/Bleach.S01E06.VARYG.mkv'
    const idFraco = `ep_${'a'.repeat(40)}`
    mkdirSync(join(bibliotecaStudio, '_indices', idFraco), { recursive: true })
    writeFileSync(
      join(bibliotecaStudio, '_indices', idFraco, 'episodio.json'),
      JSON.stringify({
        id: idFraco,
        fonte: { path: outroRelease },
        biblioteca: { origem: 'dangai', pasta: join(lib, 'Bleach', 'S01E06') },
        avisos: ['As cenas foram cortadas de outro arquivo ([Grupo] Bleach - 06.mkv). Se for outro release, falas e cenas podem nao bater.'],
      }),
    )
    const fraco = dentro(await procurarEpisodio(outroRelease, palpite('Bleach', 1, 6)), lib)
    confere(fraco[0]?.comoAchou === 'anime+episodio', `indice de achado fraco nao vira 'source' (${fraco[0]?.comoAchou})`)

    // Pasta sem shot_bounds: um indice CONFERIDO ainda diz de onde ela veio.
    const velho = 'C:/x/Velho - 01.mkv'
    const idVelho = `ep_${'b'.repeat(40)}`
    mkdirSync(join(bibliotecaStudio, '_indices', idVelho), { recursive: true })
    writeFileSync(
      join(bibliotecaStudio, '_indices', idVelho, 'episodio.json'),
      JSON.stringify({ id: idVelho, fonte: { path: velho }, biblioteca: { origem: 'dangai', pasta: join(lib, 'Velho', 'S01E01') }, avisos: [] }),
    )
    const achadoVelho = dentro(await procurarEpisodio(velho, palpite('Outro nome', 9, 9)), lib)
    confere(achadoVelho[0]?.comoAchou === 'source', `pasta sem shot_bounds + indice conferido: 'source' (${achadoVelho[0]?.comoAchou})`)

    // ------------------------------------------------------------------ 4
    secao('4. Indice: herdar so do mesmo .mkv; aviso de mesmo nome')
    if (!existsSync(ACHADO)) {
      console.log('  (sem o .mkv do S4 - 37 nesta maquina: pulado)')
    } else {
      const sonda = await sondarEpisodio(ACHADO)
      const pasta = join(bibliotecaStudio, 'Dr Stone', 'S04E37')
      pastaSintetica(pasta, { titulo: 'Dr. STONE', cenas: 2, inicio: 300, mp4: true })
      const args = { path: ACHADO, pastaDoEpisodio: pasta, origem: 'studio' as const, palpite: sonda.palpite }
      await indexarEpisodio(args, () => {})

      // O episodio.json do lugar passa a ser de OUTRO release, com uma OP confirmada fora do lugar.
      const caminho = join(pasta, 'episodio.json')
      const deOutro = JSON.parse(readFileSync(caminho, 'utf8')) as EpisodeIndex
      deOutro.id = `ep_${'c'.repeat(40)}`
      deOutro.exclusoes = [{ start: 100, end: 200, motivo: 'op', origem: 'usuario', confirmada: true, porque: '' }]
      writeFileSync(caminho, JSON.stringify(deOutro, null, 2))
      const refeito = await indexarEpisodio({ ...args, refazer: true }, () => {})
      confere(
        !refeito.exclusoes.some((e) => e.start === 100 && e.end === 200),
        'refazer nao herda a OP confirmada do indice de outro .mkv',
        refeito.exclusoes,
      )
      confere(
        refeito.exclusoes.some((e) => e.motivo === 'op' && !e.confirmada),
        'a sugestao de OP deste arquivo continua la',
      )

      // Cortado de um arquivo com o MESMO nome em outro lugar, sem indice conferido antes.
      rmSync(caminho)
      writeFileSync(
        join(pasta, 'metadata', 'shot_bounds.json'),
        JSON.stringify({ source: 'D:/Outro/[SubsPlease] Dr. Stone S4 - 37 (1080p) [477E9A74].mkv', shots: [] }),
      )
      const mesmoNome = await indexarEpisodio(args, () => {})
      confere(
        mesmoNome.avisos.some((a) => a.startsWith('As cenas foram cortadas de outro arquivo com o mesmo nome')),
        'source com o mesmo nome em outro lugar: avisa',
        mesmoNome.avisos,
      )
      const busca = dentro(await procurarEpisodio(ACHADO, sonda.palpite), bibliotecaStudio)
      confere(busca[0]?.comoAchou === 'nome', `e a busca nao chama de "mesmo arquivo" (${busca[0]?.comoAchou})`)

      // O indice do S04E37 do Corte Cenas (gravado so em <temp>/Biblioteca/_indices).
      if (existsSync(PASTA_DO_CORTE_CENAS)) {
        const externo = await indexarEpisodio(
          { path: ACHADO, pastaDoEpisodio: PASTA_DO_CORTE_CENAS, origem: 'cortecenas', palpite: sonda.palpite, refazer: true },
          () => {},
        )
        const ukyos = new Set(externo.planos.flatMap((p) => p.personagens.map((x) => x.nome)).filter((n) => /ukyo/i.test(n)))
        confere(ukyos.size === 1, `planos do indice com um Ukyo so (${[...ukyos].join(', ')})`)
        const noResumo = resumirIndice(externo).personagens.filter((p) => /ukyo/i.test(p.nome))
        confere(noResumo.length === 1 && noResumo[0]!.cenas === 7, `resumo: ${noResumo.map((p) => `${p.nome} ${p.cenas}`).join(', ')}`)
      }
    }

    // ------------------------------------------------------------------ 5
    secao('5. Desarme do corte de outro arquivo')
    const bib2 = join(temp, 'Biblioteca2')
    const alvo = join(bib2, 'Dr STONE', 'S04E24')
    const naruto = join(bib2, 'Naruto', 'S04E24')
    const lembrada = join(bib2, 'Pasta Lembrada', 'S04E24')
    pastaSintetica(alvo, { titulo: 'Dr STONE', source: 'C:/x/A.mkv', cor: 'original' })
    pastaSintetica(naruto, { titulo: 'Naruto', source: 'C:/x/N.mkv', cor: 'original' })
    pastaSintetica(lembrada, { titulo: 'Tensei', source: 'C:/x/T.mkv', cor: 'original' })
    const cor = (pasta: string): string => readFileSync(join(pasta, 'shots', '.cor'), 'utf8')
    const pedido = {
      biblioteca: bib2,
      anime: 'Dr. Stone',
      temporada: 4,
      episodio: 24,
      kind: '' as const,
      id: null,
      pastaLembrada: null,
    }
    confere(desarmarCorteDeOutroArquivo({ ...pedido, path: 'C:/x/A.mkv' }).length === 0, 'mesmo arquivo: nada marcado')
    const marcadas = desarmarCorteDeOutroArquivo({ ...pedido, path: 'C:/x/B.mkv', pastaLembrada: 'Pasta Lembrada' })
    confere(marcadas.length === 2, `outro arquivo: a pasta do anime e a lembrada pelo motor (${marcadas.length})`)
    confere(cor(alvo) !== 'original' && cor(lembrada) !== 'original', 'a marca .cor deixou de bater')
    confere(cor(naruto) === 'original', 'a pasta de outro anime com o mesmo SxxEyy fica intacta')
    writeFileSync(join(alvo, 'shots', '.cor'), 'original')
    writeFileSync(join(alvo, 'episodio.json'), JSON.stringify({ id: `ep_${'d'.repeat(40)}`, avisos: [] }))
    confere(
      desarmarCorteDeOutroArquivo({ ...pedido, path: 'D:/movido/A.mkv', id: `ep_${'d'.repeat(40)}` }).length === 0,
      'o mesmo .mkv movido de lugar (indice conferido com a mesma impressao): nada marcado',
    )
    writeFileSync(
      join(alvo, 'episodio.json'),
      JSON.stringify({ id: `ep_${'d'.repeat(40)}`, avisos: ['As cenas foram cortadas de outro arquivo (A.mkv).'] }),
    )
    confere(
      desarmarCorteDeOutroArquivo({ ...pedido, path: 'D:/movido/A.mkv', id: `ep_${'d'.repeat(40)}` }).length === 1,
      'mesma impressao, mas num indice de achado fraco: marcado',
    )

    // ------------------------------------------------------------------ 6
    secao('6. Elenco degradado no cache do motor')
    const dados = join(temp, 'motor')
    const animeDb = join(dados, 'cache', 'anime_db')
    const banco = (nome: string, conteudo: object): string => {
      const pasta = join(animeDb, nome)
      mkdirSync(pasta, { recursive: true })
      writeFileSync(join(pasta, 'metadata.json'), JSON.stringify(conteudo))
      return pasta
    }
    const velhoIso = new Date(Date.now() - 7 * 3600 * 1000).toISOString()
    const degradado = banco('Dr. STONE [al105333]', { partial: true, missing_gallery: [], fetched_at: velhoIso })
    const recente = banco('Recente [al1]', { partial: true, missing_gallery: [], fetched_at: new Date().toISOString() })
    const comFaltas = banco('Faltas [al2]', { partial: true, missing_gallery: [10, 11], fetched_at: velhoIso })
    const completo = banco('Completo [al3]', { partial: false, missing_gallery: [], fetched_at: velhoIso })
    const postas = porDeLadoElencoDegradado(dados)
    confere(postas.length === 1 && postas[0] === degradado, `so o degradado e velho e posto de lado (${postas.length})`)
    confere(
      !existsSync(join(degradado, 'metadata.json')) && readdirSync(degradado).some((n) => n.startsWith('metadata.degradado-')),
      'o metadata.json vira metadata.degradado-<carimbo>.json, nada apagado',
    )
    confere(
      [recente, comFaltas, completo].every((p) => existsSync(join(p, 'metadata.json'))),
      'tregua de 6 h, faltas listadas e banco completo ficam como estao',
    )
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }

  console.log(falhas === 0 ? '\ntudo certo' : `\n${falhas} falha(s)`)
  process.exitCode = falhas === 0 ? 0 : 1
}

void main()
