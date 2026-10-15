/**
 * O "Abrir no editor" com a EDICAO RAPIDA e o ESTILO SALVO da legenda (agente
 * C, 14/10), SEM interface, com o Dr. Stone S4-37:
 *
 * 1. perfil temporario com uma COPIA do rascunho (roteiro v3 aprovado + o take
 *    t1 ja pago: nada vai a provedor nem ao Gemini) e um settings.json com um
 *    captionStyle DIFERENTE do padrao (cor, altura, tamanho, entrada, marcacao,
 *    sombra, contorno);
 * 2. montar SEM Edicao rapida: o .anirecap nasce com o estilo salvo (e nao o
 *    de fabrica do project-file), `studio.secoes` com as 6 partes no tempo do
 *    take e os personagens das frases, nenhuma trilha, sem resumo;
 * 3. montar COM a Edicao rapida (sons, musica, rosto, legenda): o projeto sai
 *    de qualquer jeito (o que falhar vira aviso), o resumo conta o que entrou,
 *    as trilhas (se o som do agente A ja estiver pronto) vem com papel, cada
 *    papel na sua faixa, arquivo inteiro como sobra, musica com ducking; o
 *    rosto conta quantos blocos acharam rosto; a musica entra no historico do
 *    userData TEMPORARIO (nunca na pasta de musicas);
 * 4. settings sem captionStyle: o projeto fica no padrao de fabrica (nada muda
 *    para quem nunca mexeu no estilo).
 *
 * Grava so em SAIDA (padrao: scratchpad/edicao-rapida/montar-c). Le o indice do
 * S4-37, os mp4 do Corte Cenas e a pasta de musicas (so leitura). Rodar da raiz:
 *   npx esbuild scripts/teste/v-edicao-rapida-montar.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json --outfile=out/teste/v-edicao-rapida-montar.cjs
 *   node out/teste/v-edicao-rapida-montar.cjs
 * SEM_ROSTO=1 pula o rosto na montagem com a Edicao rapida; COM_MOTOR=1 liga o
 * motor de verdade (sem ele, o lote cai no detector antigo e avisa).
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { candidatoDosPlanos, CENAS_VERSAO, frasesDoRoteiro, palavrasNaFrase, type EscolhaDaFrase } from '../../shared/cenas'
import {
  CAPTION_ANIMATION_DEFAULT,
  CAPTION_COLOR_DEFAULT,
  CAPTION_MARK_DEFAULT,
  CAPTION_SCALE_DEFAULT,
  CAPTION_STROKE_DEFAULT,
  CAPTION_Y_DEFAULT,
  type CaptionStyle,
} from '../../shared/contract'
import { CONFIG_DA_EDICAO_RAPIDA_PADRAO } from '../../shared/edicao-rapida'
import { planoExcluido } from '../../shared/encaixe'
import { projectFileSchema, type ProjectFile } from '../../shared/project-file'
import { momentoDaFrase, roteiroAtual } from '../../shared/roteiro'
import { escolherTake, hashDoTexto, marcarVozAprovada, takeAtual } from '../../shared/voz'
import { abrirIndicePorId } from '../../electron/services/episodio/abrir-indice'
import { configurarEpisodios } from '../../electron/services/episodio/perfil'
import { configureFaces } from '../../electron/services/faces'
import { gravarRascunho, lerRascunhoDoDisco } from '../../electron/services/gerar/rascunho'
import { encaixarNaVoz, montarProjeto } from '../../electron/services/montar'
import { configureSettings, saveSettings, type Cofre } from '../../electron/services/settings'
import { configureSfx, ensureSfxDir } from '../../electron/services/sfx'
import { configurarSom } from '../../electron/services/som/medir'
import { configurarMotor } from '../../electron/services/motor'

const RAIZ = process.cwd()
const SCRATCH = 'C:/Users/levic/AppData/Local/Temp/claude/G--ClaudeEditor/ea8ba0e5-233c-49c4-9613-b7db2f0cff9f/scratchpad'
const SAIDA = process.env['SAIDA'] ?? join(SCRATCH, 'edicao-rapida', 'montar-c')
const RECAPS = process.env['RECAPS'] ?? join(SCRATCH, 'corr', 'final', 'real-recaps-2026-10-14T15-40-55-150Z')
const ID = 'rc_25d63d4babd6_mv7cxp1z'
/** A pasta de musicas do AniRecap antigo: SO LEITURA. O teste confere que nada mudou nela. */
const PASTA_DE_MUSICAS = 'G:/App Resumo/music'

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

/** Um estilo bem longe do padrao em todos os campos que o projeto guarda. */
const ESTILO: CaptionStyle = {
  color: '#FFD400',
  y: 0.42,
  scale: 1.2,
  fontNome: '',
  animation: 'elastica',
  animationFrames: 9,
  mark: 'tudo',
  shadow: { distancia: 8, desfoque: 4, opacidade: 0.7, angulo: 90 },
  stroke: 4,
}

/** O retrato da pasta de musicas (nome, tamanho, mtime): tem que sair igual. */
function retratoDaPasta(pasta: string): string {
  if (!existsSync(pasta)) return '(sem pasta)'
  return readdirSync(pasta)
    .sort()
    .map((n) => {
      const s = statSync(join(pasta, n))
      return `${n}|${s.size}|${s.mtimeMs}`
    })
    .join('\n')
}

// ------------------------------------------------------------ perfil copia
const USER = join(SAIDA, 'userData')
const BIBLIOTECA = join(SAIDA, 'biblioteca')
for (const p of [USER, BIBLIOTECA, join(SAIDA, 'projetos')]) rmSync(p, { recursive: true, force: true })
mkdirSync(join(USER, 'recaps', ID, 'voz'), { recursive: true })
copyFileSync(join(RECAPS, `${ID}.json`), join(USER, 'recaps', `${ID}.json`))
for (const n of readdirSync(join(RECAPS, ID, 'voz')).filter((n) => n.startsWith('narracao-'))) {
  copyFileSync(join(RECAPS, ID, 'voz', n), join(USER, 'recaps', ID, 'voz', n))
}
// Sem chave nenhuma: nada aqui chama provedor nem IA. O estilo e o do Levi
// "salvo" (o que o estilo-legenda.ts grava quando ele mexe no painel).
writeFileSync(join(USER, 'settings.json'), JSON.stringify({ bibliotecaStudio: BIBLIOTECA, captionStyle: ESTILO }), 'utf8')
const cofreFalso: Cofre = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' }
configureSettings(USER, cofreFalso)
configurarEpisodios(USER)
configureFaces(join(RAIZ, 'assets', 'vision', 'anime-face.xml'))
// Como o main.ts: a pasta de SFX do perfil semeada com os sons do app (impact,
// whoosh), e o som da Edicao rapida com o historico no userData TEMPORARIO.
configureSfx({ userDir: join(USER, 'sfx'), bundledDir: join(RAIZ, 'assets', 'sfx') })
ensureSfxDir()
configurarSom({ userData: USER, reservaDeSfx: join(RAIZ, 'assets', 'sfx') })
// COM_MOTOR=1: o rosto pelo motor de verdade (motor/.venv; importar o torch
// custa segundos). Sem isso, o lote cai no detector antigo e avisa.
if (process.env['COM_MOTOR'] === '1') configurarMotor({ userData: USER, appPath: RAIZ, empacotado: false })

const agora = (): string => new Date().toISOString()

function estiloDoArquivo(f: ProjectFile): Record<string, unknown> {
  return {
    color: f.captionColor,
    y: f.captionY,
    scale: f.captionScale,
    fontNome: f.captionFont,
    animation: f.captionAnimation,
    animationFrames: f.captionAnimationFrames,
    mark: f.captionMark,
    shadow: f.captionShadow,
    stroke: f.captionStroke,
  }
}

async function main(): Promise<void> {
  const musicasAntes = retratoDaPasta(PASTA_DE_MUSICAS)

  // ------------------------------------------------- 1. copia + escolhas
  secao('1. Copia do rascunho, voz t1 aprovada, escolhas simples, estilo salvo diferente do padrao')
  let r = lerRascunhoDoDisco(ID)
  const roteiro = roteiroAtual(r)!
  r = marcarVozAprovada(escolherTake(r, 't1', agora()), roteiro, agora())
  const t1 = takeAtual(r)!
  confere(r.aprovado && t1.id === 't1' && r.voz?.aprovado === true, `roteiro v${roteiro.versao} e take t1 (${t1.duracao.toFixed(2)} s) aprovados na copia`)
  const { indice } = abrirIndicePorId(r.episodioId, r.indicePath)
  const livres = indice.planos.filter((p) => !planoExcluido(p, indice.exclusoes))
  let reserva = 0
  const escolhas: EscolhaDaFrase[] = frasesDoRoteiro(roteiro).map((f) => {
    const m = momentoDaFrase(f, r.eventos, indice)
    const i = Math.max(0, livres.findIndex((p) => p.id === m?.planoId))
    const plano = livres[m?.planoId ? i : reserva++]!
    const c = candidatoDosPlanos([plano], indice.id, 'sugestao', { porque: ['no evento'] })
    const cenas = [{ candidato: c, palavraInicio: 0 }]
    if (f.id === 'f05') {
      const outro = livres[i + 3]!
      cenas.push({ candidato: candidatoDosPlanos([outro], indice.id, 'usuario'), palavraInicio: Math.floor(palavrasNaFrase(f.texto) / 2) })
    }
    return { fraseId: f.id, cenas, fita: [c], confianca: 0.5, travada: false, hashTexto: hashDoTexto(f.texto), duracao: 0, avisos: [] }
  })
  r = { ...r, cenas: { versao: CENAS_VERSAO, escolhas, sugeridasEm: agora(), roteiroVersao: roteiro.versao, takeId: null, encaixadoEm: null } }
  gravarRascunho(r)
  await encaixarNaVoz(ID)

  // ---------------------------------------------- 2. sem Edicao rapida
  secao('2. Montar SEM Edicao rapida: o estilo salvo e as partes do roteiro')
  const sem = await montarProjeto(ID, { pasta: join(SAIDA, 'projetos', 'sem') }, { rostos: false })
  const cru = JSON.parse(readFileSync(sem.projetoPath, 'utf8')) as unknown
  const z = projectFileSchema.safeParse(cru)
  confere(z.success, 'o .anirecap passa no projectFileSchema')
  const f1 = z.success ? z.data : projectFileSchema.parse(cru)
  const esperado = { ...ESTILO }
  const obtido = estiloDoArquivo(f1)
  confere(JSON.stringify(obtido) === JSON.stringify(esperado), `estilo da legenda = o salvo (${JSON.stringify(obtido)})`)
  confere(
    f1.captionColor !== CAPTION_COLOR_DEFAULT &&
      f1.captionY !== CAPTION_Y_DEFAULT &&
      f1.captionScale !== CAPTION_SCALE_DEFAULT &&
      f1.captionAnimation !== CAPTION_ANIMATION_DEFAULT &&
      f1.captionMark !== CAPTION_MARK_DEFAULT &&
      f1.captionStroke !== CAPTION_STROKE_DEFAULT,
    'nenhum campo ficou no padrao de fabrica do project-file',
  )
  const secoes = f1.studio?.secoes ?? []
  confere(secoes.length === roteiro.secoes.length, `studio.secoes: ${secoes.length} partes (${secoes.map((s) => `${s.papel} ${s.inicio.toFixed(2)}-${s.fim.toFixed(2)}`).join(' / ')})`)
  const trechos = new Map(t1.trechos.map((t) => [t.fraseId, t]))
  confere(
    // secoesDoTake arredonda no milissegundo (o .anirecap nao precisa de mais).
    secoes.every((s, k) => Math.abs(s.inicio - trechos.get(roteiro.secoes[k]!.frases[0]!.id)!.offset) <= 5e-4) &&
      Math.abs(secoes.at(-1)!.fim - t1.duracao) <= 5e-4,
    'cada parte comeca no offset da 1a frase dela e a ultima vai ate o fim da voz (ms)',
  )
  const comNome = secoes.flatMap((s) => s.frases).filter((fr) => fr.personagens.length > 0)
  confere(comNome.length > 0, `${comNome.length} frases com personagens (ex.: ${comNome[0]?.id} ${comNome[0]?.personagens.join(', ')})`)
  confere(f1.trilhas.length === 0 && sem.edicaoRapida === undefined, 'sem Edicao rapida: nenhuma trilha e nenhum resumo')

  // ---------------------------------------------- 3. com Edicao rapida
  secao('3. Montar COM a Edicao rapida')
  const config = { ...CONFIG_DA_EDICAO_RAPIDA_PADRAO, rosto: process.env['SEM_ROSTO'] !== '1' }
  const t0 = Date.now()
  const com = await montarProjeto(ID, { pasta: join(SAIDA, 'projetos', 'com'), edicaoRapida: config }, { tetoDosRostosMs: 120_000 })
  const ms = Date.now() - t0
  const f2 = projectFileSchema.parse(JSON.parse(readFileSync(com.projetoPath, 'utf8')))
  const er = com.edicaoRapida
  console.log(`  montado em ${(ms / 1000).toFixed(1)} s: ${com.projetoPath}`)
  console.log(`  resumo: ${JSON.stringify(er)}`)
  confere(er !== undefined && er !== null && JSON.stringify(er.config) === JSON.stringify(config), 'resumo da Edicao rapida com o config pedido')
  confere(JSON.stringify(estiloDoArquivo(f2)) === JSON.stringify(esperado) && er?.legenda === true, 'legenda no estilo salvo (resumo.legenda true)')
  confere((f2.studio?.secoes?.length ?? 0) === roteiro.secoes.length, 'studio.secoes gravado tambem')

  const doPapel = (p: string) => f2.trilhas.filter((t) => t.papel === p)
  const whoosh = doPapel('whoosh')
  const impacto = doPapel('impacto')
  const musica = doPapel('musica')
  if (f2.trilhas.length === 0) {
    // O som e do agente A: enquanto planejarSom nao existe, o projeto sai sem
    // som e com o aviso -- nunca com erro.
    confere(er?.avisos.some((a) => a.startsWith('Sem som')) === true, `sem som ainda: aviso "${er?.avisos.find((a) => a.startsWith('Sem som'))}"`)
    confere(er?.whoosh === 0 && er?.impacto === 0 && er?.musica === null, 'resumo sem sons e sem musica')
  } else {
    confere(f2.trilhas.every((t) => t.papel !== undefined), `${f2.trilhas.length} trechos, todos com papel`)
    const faixas = new Map<string, Set<number>>()
    for (const t of f2.trilhas) faixas.set(t.papel!, (faixas.get(t.papel!) ?? new Set()).add(t.faixa))
    confere([...faixas.values()].every((s) => s.size === 1) && new Set([...faixas.values()].map((s) => [...s][0])).size === faixas.size, `uma faixa por papel (${[...faixas].map(([p, s]) => `${p}:${[...s][0]}`).join(' ')})`)
    confere(whoosh.length === er?.whoosh && impacto.length === er?.impacto, `${whoosh.length} whoosh e ${impacto.length} impactos = o resumo`)
    confere(f2.trilhas.every((t) => t.durationSec >= (t.usarSec ?? t.durationSec - t.inicioSec) + t.inicioSec - 1e-6), 'sobra: arquivo inteiro em durationSec, o trecho dentro dele')
    const cortes = new Set(f2.plan!.scenes.map((s) => s.start))
    console.log(`  sfx: ${[...whoosh, ...impacto].sort((a, b) => a.at - b.at).map((t) => `${t.papel}@${t.at.toFixed(2)} ${t.gainDb} dB`).join(' | ')}`)
    confere(whoosh.length + impacto.length < cortes.size, `menos sons (${whoosh.length + impacto.length}) que cortes (${cortes.size}): nada de som em todo corte`)
    if (musica.length > 0) {
      confere(musica.every((t) => t.ducking) && musica[0]!.fadeInSec > 0 && musica.at(-1)!.fadeOutSec > 0, `musica ${musica[0]!.fileName}: ${musica.length} volta(s), ${musica[0]!.gainDb} dB, ducking em todas, fade in e out`)
      const fim = Math.max(...musica.map((t) => t.at + (t.usarSec ?? t.durationSec - t.inicioSec)))
      confere(Math.abs(fim - t1.duracao) < 0.06, `a musica cobre o video ate ${fim.toFixed(2)} s`)
      const hist = join(USER, 'som', 'musicas-usadas.json')
      confere(existsSync(hist) && readFileSync(hist, 'utf8').includes(musica[0]!.fileName), 'musica no historico do userData (temporario)')
    }
  }
  if (config.rosto) {
    const auto = f2.images.filter((im) => im.focusAuto).length
    confere(er?.rostos !== null && er?.rostos !== undefined, `rosto: ${er?.rostos?.comRosto} de ${er?.rostos?.total} pedacos (${er?.rostos?.fonte}); ${auto} de ${f2.images.length} blocos com focusAuto`)
  }
  console.log(`  avisos da Edicao rapida: ${er?.avisos.join(' | ') || '(nenhum)'}`)

  // ---------------------------------------- 4. sem estilo salvo: padrao
  secao('4. Sem estilo salvo: o projeto fica no padrao de fabrica')
  saveSettings({ captionStyle: null })
  const pad = await montarProjeto(ID, { pasta: join(SAIDA, 'projetos', 'padrao') }, { rostos: false })
  const f3 = projectFileSchema.parse(JSON.parse(readFileSync(pad.projetoPath, 'utf8')))
  confere(
    f3.captionColor === CAPTION_COLOR_DEFAULT && f3.captionY === CAPTION_Y_DEFAULT && f3.captionScale === CAPTION_SCALE_DEFAULT && f3.captionMark === CAPTION_MARK_DEFAULT,
    'cor, altura, tamanho e marcacao de fabrica',
  )

  secao('5. So leitura')
  confere(retratoDaPasta(PASTA_DE_MUSICAS) === musicasAntes, `a pasta de musicas (${PASTA_DE_MUSICAS}) ficou igual`)
}

main()
  .then(() => {
    console.log(`\n${falhas === 0 ? 'TUDO OK' : `${falhas} FALHA(S)`}`)
    process.exit(falhas === 0 ? 0 : 1)
  })
  .catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
