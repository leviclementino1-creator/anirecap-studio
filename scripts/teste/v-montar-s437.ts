/**
 * O "Abrir no editor" de ponta a ponta, SEM interface, com o Dr. Stone S4-37:
 *
 * 1. uma COPIA do rascunho (roteiro v3 aprovado + o take ElevenLabs t1, ja
 *    pago: nada vai ao provedor) num perfil temporario, com escolhas simples
 *    (a cena do momento de cada frase; a f05 com duas cenas, a 2a na palavra
 *    do meio);
 * 2. encaixarNaVoz: cada escolha na duracao real da frase no take;
 * 3. montarProjeto: o .anirecap passa no zod, reabre pelo openProjectFile do
 *    Dangai (todos os arquivos achados), os blocos comecam EXATAMENTE nas
 *    fronteiras de frase do take e nas palavras da barrinha (diferenca 0),
 *    sao contiguos de 0 ao fim da voz, a narracao foi copiada e e a do take,
 *    e o toRenderProps nao perde bloco;
 * 4. pasta: a padrao cai em <biblioteca do Studio>/_projetos; pasta dentro do
 *    Corte Cenas e recusada ANTES de criar qualquer coisa;
 * 5. trocar o take (t2, f03 regravada): o encaixe refaz so o que mudou, e
 *    montar sem a voz aprovada e recusado;
 * 6. RENDER de verdade pelo render do Dangai (electron/services/render.ts),
 *    com as props montadas como o startRender do store faz (openProjectFile ->
 *    importImages com o foco salvo -> legendas do editor -> toRenderProps), e
 *    o mp4 conferido: 1080x1920, 23,976 fps, duracao = a da voz, -14 LUFS, e um
 *    quadro com legenda salvo em PNG para olhar. SEM_RENDER=1 pula.
 *
 * Grava so em SAIDA (padrao: o scratchpad desta sessao, f1p4/montar). Le o
 * indice do S4-37 e os mp4 do Corte Cenas (so leitura). Rodar da raiz:
 *   npx esbuild scripts/teste/v-montar-s437.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json --outfile=out/teste/v-montar-s437.cjs
 *   node out/teste/v-montar-s437.cjs
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  candidatoDosPlanos,
  CENAS_VERSAO,
  escolhasDesatualizadas,
  frasesDoRoteiro,
  palavrasNaFrase,
  type EscolhaDaFrase,
} from '../../shared/cenas'
import { REGRAS_DA_LEGENDA_PADRAO, VIDEO_FPS, type ImageAsset } from '../../shared/contract'
import { planoExcluido } from '../../shared/encaixe'
import { buildCaptions, toRenderProps, totalFrames } from '../../shared/plan'
import { projectFileSchema } from '../../shared/project-file'
import { momentoDaFrase, roteiroAtual } from '../../shared/roteiro'
import { escolherTake, hashDoTexto, marcarVozAprovada, takeAtual } from '../../shared/voz'
import { importImages } from '../../electron/services/assets'
import { abrirIndicePorId } from '../../electron/services/episodio/abrir-indice'
import { configurarEpisodios } from '../../electron/services/episodio/perfil'
import { configureFaces } from '../../electron/services/faces'
import { gravarRascunho, lerRascunhoDoDisco } from '../../electron/services/gerar/rascunho'
import { startMediaServer } from '../../electron/services/media-server'
import { encaixarNaVoz, montarProjeto } from '../../electron/services/montar'
import { openProjectFile } from '../../electron/services/project'
import { configureRender, renderVideo } from '../../electron/services/render'
import { configureSettings, type Cofre } from '../../electron/services/settings'

const RAIZ = process.cwd()
const SAIDA =
  process.env['SAIDA'] ??
  'C:/Users/levic/AppData/Local/Temp/claude/G--ClaudeEditor/ea8ba0e5-233c-49c4-9613-b7db2f0cff9f/scratchpad/f1p4/montar'
/** A copia mais nova do rascunho com os takes pagos (rodada de correcao da parte 3). */
const RECAPS =
  process.env['RECAPS'] ??
  'C:/Users/levic/AppData/Local/Temp/claude/G--ClaudeEditor/ea8ba0e5-233c-49c4-9613-b7db2f0cff9f/scratchpad/corr/final/real-recaps-2026-10-14T15-40-55-150Z'
const ID = 'rc_25d63d4babd6_mv7cxp1z'

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

// ------------------------------------------------------------ perfil copia
const USER = join(SAIDA, 'userData')
const BIBLIOTECA = join(SAIDA, 'biblioteca')
for (const p of [USER, BIBLIOTECA, join(SAIDA, 'projeto')]) rmSync(p, { recursive: true, force: true })
mkdirSync(join(USER, 'recaps', ID, 'voz'), { recursive: true })
copyFileSync(join(RECAPS, `${ID}.json`), join(USER, 'recaps', `${ID}.json`))
for (const n of readdirSync(join(RECAPS, ID, 'voz')).filter((n) => n.startsWith('narracao-'))) {
  copyFileSync(join(RECAPS, ID, 'voz', n), join(USER, 'recaps', ID, 'voz', n))
}
// Sem chave nenhuma: este teste nao chama provedor nem IA. A biblioteca do
// Studio aponta para uma pasta TEMPORARIA (a pasta padrao do projeto cai nela).
writeFileSync(join(USER, 'settings.json'), JSON.stringify({ bibliotecaStudio: BIBLIOTECA }), 'utf8')
const cofreFalso: Cofre = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' }
configureSettings(USER, cofreFalso)
configurarEpisodios(USER)
configureFaces(join(RAIZ, 'assets', 'vision', 'anime-face.xml'))

const agora = (): string => new Date().toISOString()

async function main(): Promise<void> {
  // ------------------------------------------------- 1. copia + escolhas
  secao('1. Copia do rascunho, voz t1 aprovada, escolhas simples')
  let r = lerRascunhoDoDisco(ID)
  const roteiro = roteiroAtual(r)!
  confere(r.aprovado && roteiro.versao === 3, `roteiro v${roteiro.versao} aprovado`)
  r = marcarVozAprovada(escolherTake(r, 't1', agora()), roteiro, agora())
  const t1 = takeAtual(r)!
  confere(t1.id === 't1' && t1.config.fonte === 'elevenlabs' && r.voz?.aprovado === true, `take ${t1.id} (${t1.config.fonte}, ${t1.duracao.toFixed(2)} s) aprovado na copia`)
  const { indice } = abrirIndicePorId(r.episodioId, r.indicePath)
  const livres = indice.planos.filter((p) => !planoExcluido(p, indice.exclusoes))
  const frases = frasesDoRoteiro(roteiro)
  let reserva = 0
  const escolhas: EscolhaDaFrase[] = frases.map((f) => {
    const m = momentoDaFrase(f, r.eventos, indice)
    const i = Math.max(0, livres.findIndex((p) => p.id === m?.planoId))
    const plano = livres[m?.planoId ? i : reserva++]!
    const c = candidatoDosPlanos([plano], indice.id, 'sugestao', { porque: ['no evento'] })
    const cenas = [{ candidato: c, palavraInicio: 0 }]
    if (f.id === 'f05') {
      const outro = livres[i + 3]!
      cenas.push({ candidato: candidatoDosPlanos([outro], indice.id, 'usuario'), palavraInicio: Math.floor(palavrasNaFrase(f.texto) / 2) })
    }
    return { fraseId: f.id, cenas, fita: [c], confianca: 0.5, travada: f.id === 'f05', hashTexto: hashDoTexto(f.texto), duracao: 0, avisos: [] }
  })
  r = { ...r, cenas: { versao: CENAS_VERSAO, escolhas, sugeridasEm: agora(), roteiroVersao: roteiro.versao, takeId: null, encaixadoEm: null } }
  gravarRascunho(r)
  console.log(`  ${escolhas.length} frases, planos: ${escolhas.map((e) => e.cenas.map((c) => c.candidato.planoIds.join('+')).join('/')).join(' ')}`)

  // ------------------------------------------------------- 2. encaixe
  secao('2. encaixarNaVoz')
  const enc = await encaixarNaVoz(ID)
  const cenas = enc.rascunho.cenas!
  confere(cenas.takeId === 't1' && cenas.encaixadoEm !== null, 'takeId t1 gravado')
  const trechos = new Map(t1.trechos.map((t) => [t.fraseId, t]))
  confere(cenas.escolhas.every((e) => Math.abs(e.duracao - trechos.get(e.fraseId)!.duracao) < 1e-9), 'cada escolha com a duracao REAL da frase no take')
  const d = escolhasDesatualizadas(roteiro, t1, cenas)
  confere(!d.encaixeVelho && d.duracaoMudou.length === 0, 'escolhasDesatualizadas: encaixe em dia')
  console.log(`  avisos: ${enc.avisos.join(' | ') || '(nenhum)'}`)

  // ------------------------------------------------------- 3. montar
  secao('3. montarProjeto')
  const t0 = Date.now()
  const m = await montarProjeto(ID, { pasta: join(SAIDA, 'projeto') })
  console.log(`  ${m.projetoPath} em ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  const cru = JSON.parse(readFileSync(m.projetoPath, 'utf8')) as unknown
  const z = projectFileSchema.safeParse(cru)
  confere(z.success, 'o .anirecap passa no projectFileSchema (zod)')
  const aberto = openProjectFile(m.projetoPath)
  const file = aberto.file
  confere(file.images.every((im) => existsSync(im.path)) && existsSync(file.audio.path), 'reabre pelo openProjectFile do Dangai: todos os arquivos achados')
  confere(file.studio?.vozAlinhada === true && file.studio.takeId === 't1' && file.studio.rascunhoId === ID && file.studio.roteiroVersao === 3, 'studio: vozAlinhada, take t1, roteiro v3')
  const wavOrigem = join(USER, 'recaps', ID, 'voz', t1.arquivo)
  confere(
    file.audio.rel === 'Dr. Stone S04E37.wav' && readFileSync(file.audio.path).equals(readFileSync(wavOrigem)),
    `narracao copiada para a pasta do projeto (${file.audio.rel}), igual ao WAV do take`,
  )
  const plano = file.plan!
  const scenes = plano.scenes
  confere(file.planOrigin === 'auto' && file.planEdited && scenes.length === file.images.length, `${scenes.length} blocos, um por imagem, planOrigin auto`)
  confere(scenes[0]!.start === 0 && scenes.every((c, i) => i === 0 || c.start === scenes[i - 1]!.end), 'contiguos, comecando em 0')
  confere(Math.abs(scenes.at(-1)!.end - t1.duracao) < 1e-9, `o ultimo vai ate o fim da voz (${t1.duracao.toFixed(3)} s)`)

  // As fronteiras: cada frase comeca num bloco, EXATAMENTE no trecho.offset; a
  // 2a cena da f05 comeca EXATAMENTE no start da palavra escolhida.
  const inicios = new Set(scenes.map((c) => c.start))
  const fronteiras = t1.trechos.map((t) => t.offset)
  const faltando = fronteiras.filter((o) => !inicios.has(o))
  confere(faltando.length === 0, `todas as ${fronteiras.length} fronteiras de frase sao inicio de bloco (diferenca 0)${faltando.length ? `; faltam ${faltando.join(', ')}` : ''}`)
  const f05 = cenas.escolhas.find((e) => e.fraseId === 'f05')!
  const palavrasF05 = t1.palavras.filter((p) => p.fraseId === 'f05')
  const corteF05 = palavrasF05[f05.cenas[1]!.palavraInicio]!.start
  confere(inicios.has(corteF05), `a barrinha da f05 (palavra ${f05.cenas[1]!.palavraInicio}, "${palavrasF05[f05.cenas[1]!.palavraInicio]!.texto}") e inicio de bloco em ${corteF05} (diferenca 0)`)
  const viradas = scenes.filter((c) => c.transitionIn !== 'cut')
  const offsetsDeSecao = roteiro.secoes.slice(1).map((s) => trechos.get(s.frases[0]!.id)!.offset)
  confere(
    scenes[0]!.transitionIn === 'cut' && viradas.length === roteiro.secoes.length - 1 && viradas.every((c) => offsetsDeSecao.includes(c.start)),
    `corte seco dentro da secao; ${viradas.length} transicoes (${viradas[0]?.transitionIn}) nas viradas de secao`,
  )
  confere(scenes.every((c, i) => i === 0 || c.effect !== scenes[i - 1]!.effect) && scenes.every((c) => c.effect !== 'nenhum'), 'Ken Burns em rodizio, sem repetir em seguida')
  confere(file.transcript?.alinhado === true && file.transcript.source === 'script' && file.transcript.words.length === t1.palavras.length, `transcript alinhado do take (${file.transcript?.words.length} palavras)`)
  confere(
    file.transcript!.words.every((w, i) => w.start === t1.palavras[i]!.start && w.text === t1.palavras[i]!.texto),
    'palavras = as do take (texto do roteiro, tempo do take)',
  )
  const paragrafos = file.transcript!.words.filter((w) => w.paragraph).length
  confere(paragrafos === roteiro.secoes.length, `${paragrafos} paragrafos = ${roteiro.secoes.length} secoes`)
  confere(file.script === roteiro.secoes.map((s) => s.frases.map((f) => f.texto.trim()).join(' ')).join('\n\n'), 'script = o roteiro aprovado (textoDoRoteiro)')
  confere(file.hookText === roteiro.secoes[0]!.frases[0]!.textoDeTela && file.hookSec > 0, `gancho "${file.hookText}" por ${file.hookSec} s`)
  confere(file.captionsEnabled && !file.captionsEdited && file.captions.length > 0, `legendas do editor (${file.captions.length} blocos, captionsEdited false)`)
  confere(file.images.every((im) => im.section !== null && im.sectionName), 'cada imagem com a parte do roteiro (section)')
  const comRosto = file.images.filter((im) => im.focusAuto).length
  console.log(`  rosto achado em ${comRosto} de ${file.images.length} blocos`)
  // sourceStart: o ponto DENTRO do mp4 = inSec - plano.start da cena.
  const porArquivo = new Map(indice.planos.map((p) => [p.arquivo, p]))
  confere(scenes.every((c) => c.sourceStart >= 0 && c.sourceStart <= (porArquivo.get(file.images[c.imageIndex]!.path)!.end - porArquivo.get(file.images[c.imageIndex]!.path)!.start)), 'sourceStart dentro de cada mp4')
  confere(file.images.every((im) => !im.path.startsWith(SAIDA.replace(/\//g, '\\')) && porArquivo.has(im.path)), 'as cenas apontam os mp4 do Corte Cenas onde estao (so leitura, nada copiado)')
  const imagensFalsas = file.images.map((im, i) => ({
    id: `i${i}`, path: im.path, fileName: im.fileName, url: 'x', urlSource: null, width: 1080, height: 1920, thumbnail: '',
    focusX: im.focusX, focusY: im.focusY, focusAuto: im.focusAuto, kind: 'video' as const, section: im.section, durationSec: 5,
  })) satisfies ImageAsset[]
  const props = toRenderProps(plano, imagensFalsas, file.captions, { hook: file.hookText, hookSec: file.hookSec, end: '', endSec: 3 }, file.captionColor, file.captionY, file.audio ? t1.duracao : undefined)
  confere(props.scenes.length === scenes.length && props.cards.length === 1, `toRenderProps: ${props.scenes.length} cenas (nenhuma perdida), card de gancho`)
  console.log(`  avisos: ${m.avisos.join(' | ') || '(nenhum)'}`)

  // ------------------------------------------------------- 4. pasta
  secao('4. Pasta do projeto')
  const proibida = 'G:\\App Corte Cenas\\Output\\Dr. Stone\\S04E37\\recap-teste'
  let recusou = ''
  try {
    await montarProjeto(ID, { pasta: proibida }, { rostos: false })
  } catch (err) {
    recusou = err instanceof Error ? err.message : String(err)
  }
  confere(recusou.includes('so leitura') && !existsSync(proibida), `pasta no Corte Cenas recusada, nada criado ("${recusou}")`)
  const padrao = await montarProjeto(ID, {}, { rostos: false })
  confere(padrao.projetoPath.startsWith(join(BIBLIOTECA, '_projetos', 'Dr. Stone S04E37 - ')) && existsSync(padrao.projetoPath), `padrao: ${padrao.projetoPath.slice(BIBLIOTECA.length)}`)
  const denovo = await montarProjeto(ID, {}, { rostos: false })
  confere(denovo.projetoPath !== padrao.projetoPath && existsSync(padrao.projetoPath), 'montar de novo nunca cobre o projeto anterior')

  // ------------------------------------------------------- 5. take trocado
  secao('5. Trocar o take (t2: f03 regravada)')
  let r2 = lerRascunhoDoDisco(ID)
  r2 = escolherTake(r2, 't2', agora())
  gravarRascunho(r2)
  const t2 = takeAtual(r2)!
  const antes = escolhasDesatualizadas(roteiro, t2, r2.cenas)
  confere(antes.encaixeVelho, `take trocado: encaixeVelho, duracaoMudou ${antes.duracaoMudou.join(',')}`)
  const enc2 = await encaixarNaVoz(ID)
  const depois = escolhasDesatualizadas(roteiro, t2, enc2.rascunho.cenas)
  confere(enc2.rascunho.cenas?.takeId === 't2' && !depois.encaixeVelho && depois.duracaoMudou.length === 0, 'encaixe refeito no t2')
  const mudadas = enc2.rascunho.cenas!.escolhas.filter((e, i) => JSON.stringify(e) !== JSON.stringify(cenas.escolhas[i])).map((e) => e.fraseId)
  console.log(`  escolhas que mudaram: ${mudadas.join(', ') || '(nenhuma)'}`)
  let semVoz = ''
  try {
    await montarProjeto(ID, { pasta: join(SAIDA, 'projeto-t2') }, { rostos: false })
  } catch (err) {
    semVoz = err instanceof Error ? err.message : String(err)
  }
  confere(semVoz === 'Aprove a voz antes de abrir no editor.' && !existsSync(join(SAIDA, 'projeto-t2')), `voz desaprovada: recusado ("${semVoz}")`)
  // Volta ao t1 aprovado (para o render abaixo e para a copia ficar como estava).
  r2 = marcarVozAprovada(escolherTake(lerRascunhoDoDisco(ID), 't1', agora()), roteiro, agora())
  gravarRascunho(r2)
  await encaixarNaVoz(ID)

  // ------------------------------------------------------- 6. render
  if (process.env['SEM_RENDER'] === '1') return
  secao('6. Render pelo render do Dangai')
  await startMediaServer()
  configureRender({ appPath: RAIZ, prebuiltBundle: join(RAIZ, 'out', 'remotion'), defaultSfxDir: join(USER, 'sfx'), binariesDirectory: null })
  // O que o openProject + refazerLegendasNaoEditadas + startRender do store fazem:
  const assets = await importImages(
    file.images.map((im) => im.path),
    file.images.map((im) => ({ focusX: im.focusX, focusY: im.focusY, focusAuto: im.focusAuto })),
    file.images.map((im) => (im.section === null ? null : { index: im.section, name: im.sectionName ?? '' })),
  )
  const legendas = file.captionsEdited ? file.captions : buildCaptions(file.transcript, REGRAS_DA_LEGENDA_PADRAO)
  const duracao = t1.duracao
  const propsReais = toRenderProps(
    plano,
    assets,
    file.captionsEnabled ? legendas : [],
    { hook: file.hookText, hookSec: file.hookSec, end: file.endText, endSec: file.endSec },
    file.captionColor,
    file.captionY,
    duracao,
    {
      font: null,
      animation: file.captionAnimation,
      animationFrames: file.captionAnimationFrames,
      animationCurve: file.captionAnimationCurve,
      mark: file.captionMark,
      shadow: file.captionShadow,
      stroke: file.captionStroke,
      scale: file.captionScale,
    },
    file.formato,
    [],
  )
  confere(propsReais.scenes.length === scenes.length, `props do render: ${propsReais.scenes.length} cenas, ${propsReais.captions.length} legendas`)
  const t0r = Date.now()
  let ultimo = -1
  const saida = await renderVideo(
    {
      props: propsReais,
      audioPath: file.audio.path,
      durationInFrames: totalFrames(duracao),
      sfxCues: [],
      sfxDir: '',
      music: null,
      trilhas: [],
    },
    (p) => {
      const pct = Math.floor(p.progress * 10)
      if (pct !== ultimo) {
        ultimo = pct
        console.log(`  ${p.stage} ${Math.round(p.progress * 100)}%`)
      }
    },
  )
  console.log(`  ${saida} em ${((Date.now() - t0r) / 1000).toFixed(0)} s`)

  const sonda = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate,nb_frames:format=duration', '-of', 'json', saida]).toString(),
  ) as { streams: { codec_type: string; width?: number; height?: number; r_frame_rate?: string; nb_frames?: string }[]; format: { duration: string } }
  const video = sonda.streams.find((s) => s.codec_type === 'video')!
  const audio = sonda.streams.find((s) => s.codec_type === 'audio')
  confere(video.width === 1080 && video.height === 1920, `${video.width}x${video.height}`)
  confere(video.r_frame_rate === '24000/1001', `fps ${video.r_frame_rate} (23,976)`)
  const quadros = Number(video.nb_frames)
  confere(quadros === totalFrames(duracao) && Math.abs(Number(sonda.format.duration) - duracao) < 2 / VIDEO_FPS, `duracao ${Number(sonda.format.duration).toFixed(3)} s, ${quadros} quadros = a voz (${duracao.toFixed(3)} s, ${totalFrames(duracao)} quadros)`)
  // O ebur128 escreve o resumo no stderr.
  const stderr = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', saida, '-map', '0:a', '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' }).stderr
  const integrado = /Integrated loudness:\s+I:\s+(-?[\d.]+) LUFS/.exec(stderr)
  const lufs = integrado ? Number(integrado[1]) : NaN
  confere(audio !== undefined && Math.abs(lufs + 14) <= 1, `audio a ${lufs} LUFS (alvo -14)`)

  // Um quadro com legenda (o meio da 3a legenda) e o do gancho, para olhar.
  const leg = propsReais.captions[2]!
  const tLeg = (leg.from + leg.durationInFrames / 2) / VIDEO_FPS
  const pngLegenda = join(SAIDA, 'quadro-legenda.png')
  const pngGancho = join(SAIDA, 'quadro-gancho.png')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', tLeg.toFixed(3), '-i', saida, '-frames:v', '1', '-vf', 'scale=540:-1', pngLegenda])
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '1.0', '-i', saida, '-frames:v', '1', '-vf', 'scale=540:-1', pngGancho])
  confere(statSync(pngLegenda).size > 1000 && statSync(pngGancho).size > 1000, `quadros salvos: ${pngLegenda} ("${leg.words.map((w) => w.text).join(' ')}" em ${tLeg.toFixed(2)} s), ${pngGancho}`)
  cpSync(saida, join(SAIDA, 'render-s437.mp4'))
}

main()
  .catch((err) => {
    falhas += 1
    console.log(`  FALHOU  ${err instanceof Error ? err.stack : String(err)}`)
  })
  .finally(() => {
    console.log(falhas === 0 ? '\nTUDO CERTO' : `\n${falhas} FALHA(S)`)
    process.exitCode = falhas === 0 ? 0 : 1
  })
