/**
 * A COR da Edicao rapida no "Abrir no editor" (15/10), SEM interface, com o
 * Dr. Stone S4-37: o projeto montado com a Edicao rapida ja nasce com a
 * camada de cor.
 *
 * 1. perfil temporario com uma COPIA do rascunho da rodada anterior (roteiro
 *    e voz aprovados, escolhas prontas: nada vai a provedor nem a IA);
 * 2. so a cor: o .anirecap tem UMA camada de ajuste (papel 'cor', Anime
 *    vivo, V1, do 0 ao fim da narracao -- conferido contra a duracao do WAV
 *    pelo ffprobe, o mesmo numero que o editor le) e o resumo diz o look;
 * 3. o preset de cor escolhido nas Configuracoes entra no lugar; o que sumiu
 *    vira Anime vivo, dito na linha da Cor do resumo (corPresetSumiu);
 * 4. cor desligada, ou sem Edicao rapida: nenhuma camada;
 * 5. a Edicao rapida inteira (sem rosto): cor, sons e musica juntos;
 * 6. o render do projeto montado: o filtro vai do quadro 0 ao ultimo.
 *
 * Grava so em SAIDA (padrao: scratchpad/cor/montar). Le o indice da rodada
 * anterior, os mp4 do Corte Cenas e a pasta de musicas (so leitura). Rodar da raiz:
 *   npx esbuild scripts/teste/v-edicao-rapida-cor-montar.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json --outfile=out/teste/v-edicao-rapida-cor-montar.cjs
 *   node out/teste/v-edicao-rapida-cor-montar.cjs
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AJUSTE_DE_COR_PADRAO, VIDEO_FPS, type ImageAsset } from '../../shared/contract'
import { ANIME_VIVO, CONFIG_DA_EDICAO_RAPIDA_PADRAO, type ConfigDaEdicaoRapida } from '../../shared/edicao-rapida'
import { toRenderProps } from '../../shared/plan'
import { projectFileSchema, type ProjectFile } from '../../shared/project-file'
import { takeAtual } from '../../shared/voz'
import { configurarEpisodios } from '../../electron/services/episodio/perfil'
import { configureFaces } from '../../electron/services/faces'
import { lerRascunhoDoDisco } from '../../electron/services/gerar/rascunho'
import { montarProjeto } from '../../electron/services/montar'
import { configureSettings, saveSettings, type Cofre } from '../../electron/services/settings'
import { configureSfx, ensureSfxDir } from '../../electron/services/sfx'
import { configurarSom } from '../../electron/services/som/medir'

const RAIZ = process.cwd()
const SCRATCH = 'C:/Users/levic/AppData/Local/Temp/claude/G--ClaudeEditor/ea8ba0e5-233c-49c4-9613-b7db2f0cff9f/scratchpad'
const SAIDA = process.env['SAIDA'] ?? join(SCRATCH, 'cor', 'montar')
/** O perfil da rodada anterior (reaudf): so lido -- o rascunho e a voz sao copiados. */
const ORIGEM = process.env['ORIGEM'] ?? join(SCRATCH, 'edicao-rapida', 'reaudf', 'app', 'ud')
const ID = 'rc_25d63d4babd6_mv7cxp1z'
const MEU_LOOK = { ...AJUSTE_DE_COR_PADRAO, saturacao: 0.2, contraste: 0.3, temperatura: 0.1 }

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
for (const p of [USER, BIBLIOTECA, join(SAIDA, 'projetos')]) rmSync(p, { recursive: true, force: true })
mkdirSync(join(USER, 'recaps', ID, 'voz'), { recursive: true })
copyFileSync(join(ORIGEM, 'recaps', `${ID}.json`), join(USER, 'recaps', `${ID}.json`))
for (const n of readdirSync(join(ORIGEM, 'recaps', ID, 'voz')).filter((n) => n.startsWith('narracao-'))) {
  copyFileSync(join(ORIGEM, 'recaps', ID, 'voz', n), join(USER, 'recaps', ID, 'voz', n))
}
// Sem chave nenhuma: nada chama provedor nem IA.
writeFileSync(join(USER, 'settings.json'), JSON.stringify({ bibliotecaStudio: BIBLIOTECA }), 'utf8')
const cofreFalso: Cofre = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' }
configureSettings(USER, cofreFalso)
configurarEpisodios(USER)
configureFaces(join(RAIZ, 'assets', 'vision', 'anime-face.xml'))
configureSfx({ userDir: join(USER, 'sfx'), bundledDir: join(RAIZ, 'assets', 'sfx') })
ensureSfxDir()
configurarSom({ userData: USER, reservaDeSfx: join(RAIZ, 'assets', 'sfx') })

const SO_A_COR: ConfigDaEdicaoRapida = { sfx: false, musica: false, rosto: false, legenda: false, cor: true }

async function montar(nome: string, config: ConfigDaEdicaoRapida | null) {
  const m = await montarProjeto(ID, { pasta: join(SAIDA, 'projetos', nome), edicaoRapida: config }, { rostos: false })
  const file = projectFileSchema.parse(JSON.parse(readFileSync(m.projetoPath, 'utf8')))
  return { m, file }
}

/** A duracao do WAV como o editor le (ffprobe), e nao a do take. */
function duracaoDoWav(caminho: string): number {
  const s = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', caminho], { encoding: 'utf8' })
  return Number(s.trim())
}

function camadas(f: ProjectFile) {
  return f.sobreposicoes.filter((o) => o.papel === 'cor')
}

async function main(): Promise<void> {
  const r = lerRascunhoDoDisco(ID)
  const take = takeAtual(r)!
  console.log(`  rascunho ${ID}: take ${take.id}, ${take.duracao.toFixed(3)} s`)

  // --------------------------------------------------------- 2. so a cor
  secao('2. Montar com a Edicao rapida (so a cor)')
  const { m: m2, file: f2 } = await montar('so-cor', SO_A_COR)
  const [c] = camadas(f2)
  const wav = duracaoDoWav(join(SAIDA, 'projetos', 'so-cor', f2.audio!.rel ?? f2.audio!.fileName))
  console.log(`  ${m2.projetoPath}`)
  console.log(`  camada: ${JSON.stringify({ id: c?.id, faixa: c?.faixa, at: c?.at, usarSec: c?.usarSec, nome: c?.fileName })}; wav ${wav.toFixed(3)} s`)
  confere(f2.sobreposicoes.length === 1 && c?.tipo === 'ajuste' && c.papel === 'cor', 'o projeto nasce com UMA camada de ajuste, papel cor')
  confere(JSON.stringify(c?.cor) === JSON.stringify(ANIME_VIVO) && c?.fileName === 'Cor: Anime vivo', 'look Anime vivo (e o nome no clipe)')
  confere(JSON.stringify(c?.corOriginal) === JSON.stringify(ANIME_VIVO), 'guarda o look que pos (corOriginal): rodar de novo sabe se ele mexeu')
  confere(c?.faixa === 0 && c.at === 0 && c.fadeInSec === 0 && c.fadeOutSec === 0, 'na V1, do comeco, sem fade')
  confere(c !== undefined && Math.abs((c.usarSec ?? 0) - take.duracao) < 1e-3 && (c.usarSec ?? 0) >= wav - 1 / VIDEO_FPS, `ate o fim da narracao (${c?.usarSec} s; o WAV tem ${wav.toFixed(3)} s)`)
  confere(m2.edicaoRapida?.cor === 'Anime vivo' && m2.edicaoRapida.avisos.length === 0, 'resumo: cor Anime vivo, sem aviso')
  confere(f2.trilhas.length === 0, 'so a cor: nenhuma trilha')

  // --------------------------------------------------- 3. preset escolhido
  secao('3. O preset de cor escolhido nas Configuracoes')
  saveSettings({
    presetsDeCor: [{ nome: 'Meu look', cor: MEU_LOOK }] as unknown as Record<string, unknown>[],
    edicaoRapidaPadrao: { aoAbrirNoEditor: true, config: CONFIG_DA_EDICAO_RAPIDA_PADRAO, corPreset: 'Meu look' },
  })
  const { m: m3, file: f3 } = await montar('preset', SO_A_COR)
  confere(JSON.stringify(camadas(f3)[0]?.cor) === JSON.stringify(MEU_LOOK) && camadas(f3)[0]?.fileName === 'Cor: Meu look' && m3.edicaoRapida?.cor === 'Meu look', 'a camada com o preset dele')
  saveSettings({ edicaoRapidaPadrao: { aoAbrirNoEditor: true, config: CONFIG_DA_EDICAO_RAPIDA_PADRAO, corPreset: 'Apagado' } })
  const { m: m3b, file: f3b } = await montar('apagado', SO_A_COR)
  confere(
    JSON.stringify(camadas(f3b)[0]?.cor) === JSON.stringify(ANIME_VIVO) && m3b.edicaoRapida?.cor === 'Anime vivo' && m3b.edicaoRapida.corPresetSumiu === 'Apagado',
    'preset que sumiu: Anime vivo, e o resumo diz qual sumiu (na linha da Cor)',
  )
  confere(m3b.edicaoRapida?.avisos.length === 0, 'sem aviso solto (ia para tras do "+1")')
  saveSettings({ edicaoRapidaPadrao: { aoAbrirNoEditor: true, config: CONFIG_DA_EDICAO_RAPIDA_PADRAO, corPreset: null } })

  // ------------------------------------------ 4. cor desligada / sem ER
  secao('4. Cor desligada, ou sem Edicao rapida')
  const { m: m4, file: f4 } = await montar('sem-cor', { ...SO_A_COR, cor: false, legenda: true })
  confere(f4.sobreposicoes.length === 0 && (m4.edicaoRapida?.cor ?? null) === null, 'cor desligada: nenhuma camada, resumo sem cor')
  const { m: m4b, file: f4b } = await montar('sem-edicao', null)
  confere(f4b.sobreposicoes.length === 0 && m4b.edicaoRapida === undefined, 'sem a Edicao rapida: nenhuma camada')

  // ------------------------------------------------ 5. tudo (sem rosto)
  secao('5. A Edicao rapida inteira (sem rosto)')
  const { m: m5, file: f5 } = await montar('tudo', { ...CONFIG_DA_EDICAO_RAPIDA_PADRAO, rosto: false })
  console.log(`  resumo: ${JSON.stringify(m5.edicaoRapida)}`)
  confere(camadas(f5).length === 1 && m5.edicaoRapida?.cor === 'Anime vivo', 'a camada de cor entra')
  confere(f5.trilhas.length > 0 && f5.trilhas.every((t) => t.papel !== undefined), `junto com ${f5.trilhas.length} trechos de som (musica ${m5.edicaoRapida?.musica ?? 'nenhuma'})`)

  // --------------------------------------------------------- 6. render
  secao('6. O render do projeto montado')
  const images: ImageAsset[] = f5.images.map((im, i) => ({
    id: `img-${i}`,
    path: im.path,
    fileName: im.fileName,
    url: 'x',
    urlSource: null,
    width: 1920,
    height: 1080,
    thumbnail: '',
    focusX: im.focusX,
    focusY: im.focusY,
    focusAuto: im.focusAuto,
    kind: 'video',
    section: null,
  }))
  const props = toRenderProps(f5.plan!, images, [], null, undefined, undefined, wav, {}, 'short', f5.sobreposicoes.map((o) => ({ ...o, url: '' })))
  const total = Math.ceil(wav * VIDEO_FPS)
  const filtro = props.sobreposicoes.find((o) => o.tipo === 'ajuste')
  confere(filtro !== undefined && filtro.from === 0 && filtro.from + filtro.durationInFrames >= total, `o filtro cobre do quadro 0 ao ${filtro ? filtro.from + filtro.durationInFrames : '?'} (o video tem ${total})`)
  confere(JSON.stringify(filtro?.cor) === JSON.stringify(ANIME_VIVO), 'com o look Anime vivo')

  console.log(`\n${falhas === 0 ? 'TUDO OK' : `${falhas} FALHA(S)`}`)
  process.exit(falhas === 0 ? 0 : 1)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
