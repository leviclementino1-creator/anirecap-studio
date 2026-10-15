/**
 * O ROSTO PELO MOTOR (Edicao rapida, agente B, 14/10), com o Dr. Stone S4-37 real:
 *
 * 0. a decisao pura (escolherNoPedaco): trilha do mesmo rosto entre instantes,
 *    mediana (um foco so, sem tremer), o citado identificado ganha do maior,
 *    o indice resolve "uma pessoa so na tela", plano de dois cabe junto,
 *    nada = centro; mesmaPessoa com a vogal longa; focoNoQuadro == focoDoRosto;
 * 1. os PEDACOS do projeto montado (o .anirecap da rodada de auditoria: 20
 *    blocos, mp4 do Corte Cenas, so lidos) com os citados de cada frase;
 * 2. ANTES: o detector antigo (lbpcascade, focosDosPedacos), cronometrado;
 * 3. DEPOIS: rostosDosPedacos com o motor (YOLO + cabeca, identificando o
 *    citado pelo CLIP contra o elenco do cache do motor do Studio, SO lido), e
 *    de novo sem identificar (para saber quanto o CLIP custa);
 * 4. reserva: python que nao existe e lote.motor false caem no detector antigo;
 * 5. folha de contato antes x depois (quadro do meio do pedaco, janela 9:16 de
 *    cada foco, caixas do motor) e relatorio JSON em SAIDA.
 *
 * Grava so em SAIDA (padrao: scratchpad/edicao-rapida/rosto). O cache do motor
 * (%APPDATA%/AniRecap Studio/motor) e os mp4 do Corte Cenas sao so lidos: o
 * modo `rostos` nao grava (motor/app/rostos.py). Rodar da raiz:
 *   npx esbuild scripts/teste/v-rosto-s437.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json --outfile=out/teste/v-rosto-s437.cjs
 *   node out/teste/v-rosto-s437.cjs
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { frasesDoRoteiro } from '../../shared/cenas'
import { personagensDaFrase, chaveDoPedidoDeRosto, type PedidoDeRosto, type RostosDoLote } from '../../shared/edicao-rapida'
import { lerIndice } from '../../shared/episodio'
import type { ProjectFile } from '../../shared/project-file'
import { roteiroAtual, type RascunhoDoRecap } from '../../shared/roteiro'
import { configureClips } from '../../electron/services/clips'
import { configureFaces } from '../../electron/services/faces'
import { configureSettings, type Cofre } from '../../electron/services/settings'
import { focoNoQuadro, focosDosPedacos } from '../../electron/services/montar/foco'
import { focoDoRosto } from '../../electron/services/montar/projeto'
import {
  candidatosDoPedaco,
  escolherNoPedaco,
  janelaDoFormato,
  mesmaPessoa,
  rodarMotorDeRostos,
  rostosDosPedacos,
  type RostosDoPedaco,
} from '../../electron/services/montar/rostos-motor'

const RAIZ = process.cwd()
const SCRATCH = 'C:/Users/levic/AppData/Local/Temp/claude/G--ClaudeEditor/ea8ba0e5-233c-49c4-9613-b7db2f0cff9f/scratchpad'
const SAIDA = process.env['SAIDA'] ?? `${SCRATCH}/edicao-rapida/rosto`
/** O projeto montado na auditoria da F1 (20 blocos) e o rascunho dele. */
const PROJETO =
  process.env['PROJETO'] ?? `${SCRATCH}/f1p4/reaud/bib/_projetos/Dr. Stone S04E37 - 2026-10-14 18h00/Dr. Stone S04E37.anirecap`
const RASCUNHO = process.env['RASCUNHO'] ?? `${SCRATCH}/f1p4/reaud/ud/recaps/rc_25d63d4babd6_mv7cxp1z.json`
/** O cache do motor do Studio (elenco do Dr. Stone com embeddings): SO LIDO. */
const DADOS_DO_MOTOR = process.env['DADOS_DO_MOTOR'] ?? join(process.env['APPDATA'] ?? '', 'AniRecap Studio', 'motor')
const MOTOR = join(RAIZ, 'motor')
const PYTHON = join(MOTOR, '.venv', 'Scripts', 'python.exe')

let falhas = 0
function confere(ok: boolean, mensagem: string): void {
  if (ok) console.log(`  ok  ${mensagem}`)
  else {
    falhas += 1
    console.log(`  FALHOU  ${mensagem}`)
  }
}
function secao(t: string): void {
  console.log(`\n== ${t}`)
}
const perto = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps

// ------------------------------------------------------------ 0. decisao pura
function decisaoPura(): void {
  secao('0. Decisao pura (escolherNoPedaco)')
  const W = 1920
  const H = 1080
  const janela = janelaDoFormato(W, H, 'short')
  confere(perto(janela, 1080 / (2208 / 1080) / 1920, 1e-9), `janela 9:16 num quadro 16:9 = ${(janela * 100).toFixed(1)}% da largura`)
  const r = (x: number, y: number, w: number, h: number, extra: Partial<{ tipo: 'rosto' | 'cabeca'; personagem: string | null }> = {}) => ({
    x,
    y,
    w,
    h,
    conf: 0.8,
    tipo: extra.tipo ?? ('rosto' as const),
    personagem: extra.personagem ?? null,
    sim: null,
    quem: null,
  })
  const ped = (...quadros: ReturnType<typeof r>[][]): RostosDoPedaco => ({
    largura: W,
    altura: H,
    quadros: quadros.map((rostos, i) => ({ t: i, ok: true, rostos })),
  })

  // Nada.
  const vazio = escolherNoPedaco(ped([], [], []), [], [], janela)
  confere(vazio.centro === null && vazio.como === 'nenhum' && vazio.instantesComRosto === 0 && vazio.instantes === 3, 'sem rosto: centro, nenhum, 0 de 3')

  // Um rosto andando um pouco: mediana (nao a media, nao o maior).
  const anda = escolherNoPedaco(ped([r(300, 400, 100, 120)], [r(330, 400, 100, 120)], [r(900, 400, 100, 120)]), [], [], janela)
  confere(anda.como === 'maior' && anda.instantesComRosto === 3, 'um rosto: maior, 3 de 3')
  confere(perto(anda.centro!.centroX, 365 / W, 1e-9), `o rosto que pula para longe no 3o instante vira outra trilha; fica a trilha de 2 (mediana ${(anda.centro!.centroX * W).toFixed(0)} px)`)

  // Presenca vence tamanho de um instante so.
  const presenca = escolherNoPedaco(ped([r(200, 400, 100, 100), r(1500, 300, 150, 150)], [r(205, 400, 100, 100)], [r(210, 400, 100, 100)]), [], [], janela)
  confere(perto(presenca.centro!.centroX, 255 / W, 1e-9), 'rosto em 3 instantes ganha do maior que aparece em 1')

  // O citado identificado ganha do maior.
  const citado = escolherNoPedaco(
    ped([r(200, 400, 200, 200), r(1500, 300, 100, 100, { personagem: 'Senku' })], [r(205, 400, 200, 200), r(1500, 300, 100, 100)], []),
    ['Senku', 'Kohaku'],
    [],
    janela,
  )
  confere(citado.como === 'citado' && citado.personagem === 'Senku' && perto(citado.centro!.centroX, 1550 / W, 1e-9), 'o citado identificado (Senku) ganha do rosto maior')
  const ordem = escolherNoPedaco(
    ped([r(200, 400, 100, 100, { personagem: 'Kohaku' }), r(1500, 300, 100, 100, { personagem: 'Senku' })]),
    ['Senku', 'Kohaku'],
    [],
    janela,
  )
  confere(ordem.personagem === 'Senku', 'dois citados na tela: vale a ordem de preferencia')

  // Indice: uma pessoa na tela, o plano so tem ela, e ela e citada.
  const indice = escolherNoPedaco(ped([r(900, 300, 120, 120)]), ['Senku'], ['Ishigami, Senkuu'], janela)
  confere(indice.como === 'indice' && indice.personagem === 'Senku', 'uma pessoa so e o indice diz Senkuu: personagem Senku (vogal longa)')
  const indiceDois = escolherNoPedaco(ped([r(900, 300, 120, 120)]), ['Senku'], ['Ishigami, Senkuu', 'Kohaku'], janela)
  confere(indiceDois.como === 'maior' && indiceDois.personagem === null, 'plano com duas pessoas no indice: nao chuta quem e')

  // Plano de dois: cabe junto (centro entre os dois) ou nao (fica o escolhido).
  const junto = escolherNoPedaco(ped([r(800, 300, 120, 120), r(1000, 320, 110, 110)]), [], [], janela)
  confere(junto.juntos === 1 && perto(junto.centro!.centroX, (800 + 1110) / 2 / W, 1e-9), 'dois rostos que cabem na janela: centro entre os dois')
  const longe = escolherNoPedaco(ped([r(200, 300, 120, 120), r(1500, 320, 110, 110)]), [], [], janela)
  confere(longe.juntos === 0 && perto(longe.centro!.centroX, 260 / W, 1e-9), 'dois rostos longe: fica o maior')

  // Cabeca pesa metade.
  const cabeca = escolherNoPedaco(ped([r(200, 300, 130, 130, { tipo: 'cabeca' }), r(1500, 320, 100, 100)]), [], [], janela)
  confere(perto(cabeca.centro!.centroX, 1550 / W, 1e-9), 'cabeca 1,7x maior que o rosto ainda perde (pesa metade)')

  // Citado miudo de fundo (< 20% do maior) nao puxa o quadro.
  const miudo = escolherNoPedaco(ped([r(200, 300, 400, 400), r(1600, 300, 60, 60, { personagem: 'Chrome' })]), ['Chrome'], [], janela)
  confere(miudo.como === 'maior' && perto(miudo.centro!.centroX, 400 / W, 1e-9), 'citado miudo de fundo nao ganha do rosto grande')

  confere(
    candidatosDoPedaco(['Gen', 'Yuzuriha'], ['Ogawa, Yuzuriha', 'Ooki, Taiju']).join('|') === 'Ogawa, Yuzuriha|Ooki, Taiju',
    'candidatos: o plano inteiro quando um citado esta nele',
  )
  confere(candidatosDoPedaco(['Gen', 'Senku'], ['Kohaku', 'Momiji, Homura']).length === 0, 'candidatos: nenhum citado no plano = nao identifica')
  confere(candidatosDoPedaco(['Ukyo'], ['Saionji, Ukyou', 'Ukyo Saionji']).length === 1, 'candidatos: duas grafias da mesma pessoa vao uma vez')

  confere(mesmaPessoa('Senku', 'Ishigami, Senkuu') && mesmaPessoa('Ukyo', 'Saionji, Ukyou') && mesmaPessoa('Ryusui', 'Nanami, Ryuusui'), 'mesmaPessoa: vogal longa e nome contido')
  confere(!mesmaPessoa('Kohaku', 'Ruri') && !mesmaPessoa('Gen', 'Genbu') && !mesmaPessoa('', 'Gen'), 'mesmaPessoa: nomes diferentes nao casam')
  const a = focoNoQuadro({ centroX: 0.3, centroY: 0.4 }, W, H, 'short')
  const b = focoDoRosto({ centroX: 0.3, centroY: 0.4 }, W, H)
  confere(perto(a.focusX, b.focusX) && perto(a.focusY, b.focusY), `focoNoQuadro('short') == focoDoRosto da montagem (${a.focusX.toFixed(4)})`)
}

// ------------------------------------------------------------ 1. pedacos
interface Pedaco {
  i: number
  pedido: PedidoDeRosto
  fraseId: string
  arquivo: string
  nome: string
  de: number
  ate: number
}

function pedacosDoProjeto(): { pedacos: Pedaco[]; file: ProjectFile; rascunho: RascunhoDoRecap } {
  const file = JSON.parse(readFileSync(PROJETO, 'utf8')) as ProjectFile
  const rascunho = JSON.parse(readFileSync(RASCUNHO, 'utf8')) as RascunhoDoRecap
  const roteiro = roteiroAtual(rascunho)!
  const frases = new Map(frasesDoRoteiro(roteiro).map((f) => [f.id, f]))
  const pedacos: Pedaco[] = []
  const vistos = new Set<string>()
  file.plan!.scenes.forEach((s, i) => {
    const im = file.images[s.imageIndex]!
    const fraseId = /^(f\d+)/.exec(s.reason ?? '')?.[1] ?? ''
    const frase = frases.get(fraseId)
    const de = s.sourceStart ?? 0
    // O trecho que o bloco TOCA (o mesmo que a montagem pede: de + tempo do bloco).
    const ate = de + (s.end - s.start)
    const chave = chaveDoPedidoDeRosto(im.path, de)
    if (vistos.has(chave)) return
    vistos.add(chave)
    pedacos.push({
      i,
      fraseId,
      arquivo: im.path,
      nome: im.fileName,
      de,
      ate,
      pedido: { chave, arquivo: im.path, de, ate, personagens: frase ? personagensDaFrase(frase, rascunho.eventos) : [] },
    })
  })
  return { pedacos, file, rascunho }
}

// ------------------------------------------------------------ 5. folha
function quadroPng(arquivo: string, t: number): Buffer {
  return execFileSync('ffmpeg', ['-v', 'error', '-ss', t.toFixed(3), '-i', arquivo, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], {
    maxBuffer: 64 * 1024 * 1024,
  })
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

interface Linha {
  p: Pedaco
  antes: { focusX: number; focusAuto: boolean }
  depois: RostosDoLote['focos'][number]
  quadros: RostosDoPedaco | null
  como: string
}

/** Uma linha: quadro inteiro (caixas do motor, janela antes em vermelho e depois em verde) + os dois recortes 9:16. */
async function linhaDaFolha(l: Linha): Promise<Buffer> {
  const t = (l.p.de + l.p.ate) / 2
  const png = quadroPng(l.p.arquivo, t)
  const meta = await sharp(png).metadata()
  const W = meta.width ?? 1920
  const H = meta.height ?? 1080
  const ww = Math.round((H * 9) / 16)
  const x = (fx: number): number => Math.round(fx * (W - ww))
  const LW = 480
  const LH = Math.round((LW * H) / W)
  const k = LW / W
  const CW = Math.round((LH * 9) / 16)
  // Caixas do motor no quadro do meio (o instante mais perto de t).
  const q = l.quadros?.quadros.reduce((m, c) => (Math.abs(c.t - t) < Math.abs(m.t - t) ? c : m), l.quadros.quadros[0]!)
  const caixas = (q?.rostos ?? [])
    .map(
      (r) =>
        `<rect x="${(r.x * k).toFixed(1)}" y="${(r.y * k).toFixed(1)}" width="${(r.w * k).toFixed(1)}" height="${(r.h * k).toFixed(1)}" fill="none" stroke="${r.tipo === 'cabeca' ? '#3cf' : '#ff0'}" stroke-width="2"/>` +
        (r.quem ? `<text x="${(r.x * k).toFixed(1)}" y="${(r.y * k - 3).toFixed(1)}" font-size="11" fill="#ff0" font-family="Arial">${esc(r.quem)} ${r.sim ?? ''}</text>` : ''),
    )
    .join('')
  const svg = Buffer.from(
    `<svg width="${LW}" height="${LH}" xmlns="http://www.w3.org/2000/svg">${caixas}` +
      `<rect x="${x(l.antes.focusX) * k}" y="2" width="${ww * k}" height="${LH - 4}" fill="none" stroke="#f33" stroke-width="3" stroke-dasharray="8,5"/>` +
      `<rect x="${x(l.depois.focusX) * k}" y="4" width="${ww * k}" height="${LH - 8}" fill="none" stroke="#3f3" stroke-width="3"/></svg>`,
  )
  const inteiro = await sharp(png).resize(LW, LH).composite([{ input: svg }]).png().toBuffer()
  const recorte = (fx: number): Promise<Buffer> => sharp(png).extract({ left: x(fx), top: 0, width: ww, height: H }).resize(CW, LH).png().toBuffer()
  const [ra, rd] = await Promise.all([recorte(l.antes.focusX), recorte(l.depois.focusX)])
  const TXT = 34
  const largura = LW + 2 * CW + 24
  const cit = l.p.pedido.personagens.slice(0, 3).join(', ') || '-'
  const antesTxt = l.antes.focusAuto ? `lbp ${l.antes.focusX.toFixed(2)}` : 'centro'
  const depoisTxt = l.depois.focusAuto ? `${l.depois.fonte} ${l.depois.focusX.toFixed(2)} ${l.como}${l.depois.personagem ? ` (${l.depois.personagem})` : ''}` : 'centro'
  const texto = Buffer.from(
    `<svg width="${largura}" height="${TXT}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111"/>` +
      `<text x="6" y="14" font-size="13" fill="#fff" font-family="Arial">#${l.p.i} ${esc(l.p.nome)} ${l.p.fraseId} [${l.p.de.toFixed(2)}-${l.p.ate.toFixed(2)}s] cita: ${esc(cit)}</text>` +
      `<text x="6" y="29" font-size="13" font-family="Arial"><tspan fill="#f66">ANTES ${esc(antesTxt)}</tspan><tspan fill="#6f6" dx="14">DEPOIS ${esc(depoisTxt)}</tspan><tspan fill="#aaa" dx="14">rosto em ${l.depois.instantesComRosto}/${l.depois.instantes}</tspan></text></svg>`,
  )
  return sharp({ create: { width: largura, height: LH + TXT, channels: 3, background: '#222' } })
    .composite([
      { input: texto, left: 0, top: 0 },
      { input: inteiro, left: 0, top: TXT },
      { input: ra, left: LW + 8, top: TXT },
      { input: rd, left: LW + 16 + CW, top: TXT },
    ])
    .png()
    .toBuffer()
}

async function empilhar(linhas: Buffer[], arquivo: string): Promise<void> {
  const metas = await Promise.all(linhas.map((b) => sharp(b).metadata()))
  const largura = Math.max(...metas.map((m) => m.width ?? 0))
  const altura = metas.reduce((s, m) => s + (m.height ?? 0) + 6, 0)
  let y = 0
  const partes = linhas.map((b, i) => {
    const top = y
    y += (metas[i]!.height ?? 0) + 6
    return { input: b, left: 0, top }
  })
  await sharp({ create: { width: largura, height: altura, channels: 3, background: '#000' } }).composite(partes).png().toFile(arquivo)
}

/** Tamanho e mtime de tudo na pasta de dados do motor (2 niveis + o anime_db): o modo rostos so le. */
function fotografia(raiz: string): Map<string, string> {
  const mapa = new Map<string, string>()
  const andar = (dir: string, fundo: number): void => {
    let nomes: string[] = []
    try {
      nomes = readdirSync(dir)
    } catch {
      return
    }
    for (const n of nomes) {
      const p = join(dir, n)
      const st = statSync(p)
      mapa.set(p, st.isDirectory() ? 'dir' : `${st.size}@${st.mtimeMs}`)
      if (st.isDirectory() && fundo > 0) andar(p, fundo - 1)
    }
  }
  andar(raiz, 3)
  return mapa
}

// ------------------------------------------------------------ main
async function main(): Promise<void> {
  decisaoPura()
  const fotoAntes = fotografia(DADOS_DO_MOTOR)

  rmSync(join(SAIDA, 'ud'), { recursive: true, force: true })
  mkdirSync(join(SAIDA, 'ud'), { recursive: true })
  const cofreFalso: Cofre = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' }
  configureSettings(join(SAIDA, 'ud'), cofreFalso)
  configureFaces(join(RAIZ, 'assets', 'vision', 'anime-face.xml'))
  configureClips(join(SAIDA, 'ud', 'cache-clips'))

  secao('1. Os pedacos do projeto montado do S4-37')
  const { pedacos, rascunho } = pedacosDoProjeto()
  const indice = lerIndice(JSON.parse(readFileSync(rascunho.indicePath!, 'utf8')))
  console.log(`  ${pedacos.length} pedacos de ${PROJETO.split(/[\\/]/).pop()}; indice ${indice.anime} S${indice.temporada}E${indice.episodio}`)
  confere(pedacos.length === 20, '20 pedacos (os 20 blocos da auditoria)')
  const citam = pedacos.filter((p) => p.pedido.personagens.length > 0).length
  console.log(`  ${citam} pedacos com alguem citado na frase`)

  secao('2. ANTES: detector antigo (lbpcascade)')
  const t0 = Date.now()
  const antes = await focosDosPedacos(pedacos.map((p) => ({ arquivo: p.arquivo, de: p.de, ate: p.ate })), 120_000)
  const msAntes = Date.now() - t0
  const comAntes = pedacos.filter((p) => antes.get(p.pedido.chave)?.focusAuto).length
  console.log(`  ${comAntes}/${pedacos.length} com rosto (${((100 * comAntes) / pedacos.length).toFixed(0)}%) em ${(msAntes / 1000).toFixed(1)} s`)

  secao('3. DEPOIS: motor (YOLO + cabeca + identificar o citado)')
  const lote = { pedidos: pedacos.map((p) => p.pedido), formato: 'short' as const, episodioId: rascunho.episodioId, tetoMs: 120_000, motor: true }
  const opcoes = { python: PYTHON, cwd: MOTOR, dados: DADOS_DO_MOTOR, indice, log: join(SAIDA, 'motor-stderr.log') }
  const t1 = Date.now()
  const depois = await rostosDosPedacos(lote, opcoes)
  const msDepois = Date.now() - t1
  console.log(`  ${depois.comRosto}/${depois.total} com rosto (${((100 * depois.comRosto) / depois.total).toFixed(0)}%) em ${(msDepois / 1000).toFixed(1)} s, fonte ${depois.fonte}`)
  console.log(`  avisos: ${depois.avisos.join(' | ') || '(nenhum)'}`)
  confere(depois.fonte === 'motor' && depois.avisos.length === 0, 'tudo pelo motor, sem aviso')
  confere(depois.comRosto > comAntes, `motor acha mais (${depois.comRosto} > ${comAntes})`)
  confere(depois.focos.every((f, i) => f.chave === pedacos[i]!.pedido.chave), 'um foco por pedido, na ordem')
  confere(depois.focos.every((f) => f.focusX >= 0 && f.focusX <= 1 && f.focusY >= 0 && f.focusY <= 1 && f.instantes === 3), 'focos em [0,1], 3 instantes cada')

  // Os quadros crus (para a folha e para medir o CLIP): a mesma chamada, direto.
  const norm = (s: string): string => s.replace(/\\/g, '/').toLowerCase()
  const noPlano = (arquivo: string): string[] =>
    indice.planos.find((pl) => norm(pl.arquivo) === norm(arquivo))?.personagens.map((x) => x.nome) ?? []
  const itens = pedacos.map((p) => ({
    chave: p.pedido.chave,
    arquivo: p.arquivo,
    instantes: [0.25, 0.5, 0.75].map((f) => p.de + f * (p.ate - p.de)),
    personagens: p.pedido.personagens,
    candidatos: candidatosDoPedaco(p.pedido.personagens, noPlano(p.arquivo)),
  }))
  console.log(`  ${itens.filter((i) => i.candidatos.length > 0).length} pedacos com citado reconhecido no plano (candidatos a identificar)`)
  const cru = await rodarMotorDeRostos(itens, { anime: indice.anime, temporada: indice.temporada, identificar: true }, 90_000, { ...opcoes, log: null })
  const semId = await rodarMotorDeRostos(itens, { anime: indice.anime, temporada: indice.temporada, identificar: false }, 90_000, { ...opcoes, log: null })
  console.log(
    `  motor: pronto em ${((cru.prontoMs ?? 0) / 1000).toFixed(1)} s (gpu ${cru.gpu}), total ${(cru.ms / 1000).toFixed(1)} s, CLIP ${(cru.clipMs / 1000).toFixed(1)} s, ${cru.identificados} rostos identificados; sem identificar: ${(semId.ms / 1000).toFixed(1)} s`,
  )
  confere(cru.falha === null && cru.resultados.size === pedacos.length, 'motor respondeu todos os pedacos')
  confere(cru.elenco !== null, `elenco achado (${cru.elenco?.split(/[\\/]/).pop() ?? cru.semElenco})`)
  const instComRosto = [...cru.resultados.values()].reduce((s, r) => s + r.quadros.filter((q) => q.rostos.length > 0).length, 0)
  console.log(`  instantes com rosto: motor ${instComRosto}/${pedacos.length * 3}`)

  secao('4. Reserva: sem motor cai no detector antigo')
  const semPython = await rostosDosPedacos({ ...lote, pedidos: lote.pedidos.slice(0, 4) }, { ...opcoes, python: join(MOTOR, 'nao-existe.exe') })
  confere(semPython.fonte !== 'motor' && semPython.avisos.some((a) => a.startsWith('Motor indisponivel')), `python ausente: fonte ${semPython.fonte}, aviso "${semPython.avisos[0] ?? ''}"`)
  confere(semPython.focos.every((f) => f.fonte !== 'motor'), 'nenhum foco marcado como motor')
  const desligado = await rostosDosPedacos({ ...lote, pedidos: lote.pedidos.slice(0, 4), motor: false }, opcoes)
  confere(desligado.avisos.length === 0 && desligado.focos.every((f) => f.fonte !== 'motor'), 'lote.motor false: so o antigo, sem aviso')
  const iguais = desligado.focos.every((f) => {
    const a = antes.get(f.chave)
    return a ? perto(a.focusX, f.focusX) && f.fonte === 'lbp' : f.fonte === null
  })
  confere(iguais, 'reserva da o MESMO foco que o detector antigo sozinho')

  const fotoDepois = fotografia(DADOS_DO_MOTOR)
  const mudou = [...new Set([...fotoAntes.keys(), ...fotoDepois.keys()])].filter((k) => fotoAntes.get(k) !== fotoDepois.get(k))
  confere(fotoAntes.size > 10 && mudou.length === 0, `a pasta de dados do motor ficou intocada (${fotoAntes.size} itens conferidos${mudou.length ? `; mudou: ${mudou.slice(0, 3).join(', ')}` : ''})`)

  secao('5. Folha de contato antes x depois')
  const linhas: Linha[] = pedacos.map((p, k) => {
    const d = depois.focos[k]!
    const q = cru.resultados.get(p.pedido.chave) ?? null
    const e = q ? escolherNoPedaco(q, p.pedido.personagens, noPlano(p.arquivo), janelaDoFormato(q.largura, q.altura)) : null
    return { p, antes: antes.get(p.pedido.chave) ?? { focusX: 0.5, focusAuto: false }, depois: d, quadros: q, como: e?.como ?? '-' }
  })
  const imgs: Buffer[] = []
  for (const l of linhas) imgs.push(await linhaDaFolha(l))
  for (let k = 0; k < imgs.length; k += 5) await empilhar(imgs.slice(k, k + 5), join(SAIDA, `folha-${k / 5 + 1}.png`))
  await empilhar(imgs, join(SAIDA, 'folha-contato.png'))
  console.log(`  ${join(SAIDA, 'folha-contato.png')} (+ folha-1..${Math.ceil(imgs.length / 5)}.png)`)

  const relatorio = {
    projeto: PROJETO,
    pedacos: pedacos.length,
    antes: { comRosto: comAntes, ms: msAntes },
    depois: { comRosto: depois.comRosto, ms: msDepois, fonte: depois.fonte, avisos: depois.avisos },
    motor: { prontoMs: cru.prontoMs, gpu: cru.gpu, ms: cru.ms, clipMs: cru.clipMs, identificados: cru.identificados, semIdentificarMs: semId.ms, instantesComRosto: instComRosto },
    linhas: linhas.map((l) => ({
      i: l.p.i,
      arquivo: l.p.nome,
      frase: l.p.fraseId,
      de: +l.p.de.toFixed(3),
      ate: +l.p.ate.toFixed(3),
      cita: l.p.pedido.personagens,
      antes: l.antes,
      depois: { focusX: +l.depois.focusX.toFixed(4), focusAuto: l.depois.focusAuto, fonte: l.depois.fonte, personagem: l.depois.personagem, instantesComRosto: l.depois.instantesComRosto, como: l.como },
      quadros: l.quadros?.quadros.map((q) => q.rostos.map((r) => ({ tipo: r.tipo, conf: r.conf, w: Math.round(r.w), quem: r.quem, sim: r.sim, personagem: r.personagem }))),
    })),
  }
  writeFileSync(join(SAIDA, 'relatorio.json'), JSON.stringify(relatorio, null, 1), 'utf8')

  console.log(`\n${falhas === 0 ? 'TUDO OK' : `${falhas} FALHA(S)`}`)
  process.exit(falhas === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
