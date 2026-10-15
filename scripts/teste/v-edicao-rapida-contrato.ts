/**
 * O CONTRATO da Edicao rapida (14/10), sem app, sem motor, sem ffmpeg, sem IA:
 *
 * 1. os modulos de shared carregam sem ciclo (cenas importa edicao-rapida);
 * 2. projeto antigo abre igual: trilha sem `papel`/`ducking` e `studio` sem
 *    `secoes` voltam do zod byte a byte; um .anirecap de verdade (copia do
 *    S4-37 numa rodada anterior, so lido) volta identico;
 * 3. as partes do S4-37 no tempo do take (secoesDoTake) e os fallbacks do
 *    secoesParaSom (imagens, paragrafos, nada);
 * 4. planejarSfx: whoosh so nas viradas, impacto no gancho e no climax,
 *    pico do whoosh no corte, rodizio sem repetir, reserva so sem arquivo dele,
 *    intervalo minimo, sobra (arquivo inteiro), UM arquivo so = so as 2
 *    viradas principais, e a voz NAQUELE instante abaixando o SFX;
 * 5. envelopeDeDucking nas palavras do take: embaixo na fala, em cima na
 *    pausa longa, "um pouco" na pausa curta, pontos em ordem;
 * 6. plano -> trilhas (faixas por papel e o reaproveitamento delas ao rodar de
 *    novo, voltas da musica, ducking em todas, musica sem ganho positivo) e
 *    trilhaParaMixar (envelope recortado);
 * 7. musica sem repetir, estilo da legenda no arquivo, config e preferencias
 *    com lixo, pedido da montagem.
 *
 * Nao escreve nada. Rodar da raiz do projeto:
 *   npx esbuild scripts/teste/v-edicao-rapida-contrato.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json | node
 * RECAPS=<pasta recaps> troca a copia do perfil de onde vem o S4-37.
 */
// cenas PRIMEIRO de proposito: se edicao-rapida fechasse um ciclo com
// roteiro, o schema chegaria undefined aqui e o parse abaixo quebraria.
import { pedidoDeMontagemSchema } from '../../shared/cenas'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  aplicarEstiloNoProjeto,
  configDaEdicaoRapidaSchema,
  envelopeDeDucking,
  faixasDaEdicaoRapida,
  ganhoDaMusica,
  ganhoDoEnvelope,
  ganhoDoSfx,
  musicaAbaixoDoAlvoDb,
  musicaSemRepetir,
  nadaLigado,
  naFaixaDaEdicaoRapida,
  partesLigadas,
  pedidoDePlanoDeSomSchema,
  vozNoSfx,
  planejarSfx,
  planoDeSomSchema,
  preferenciasDaEdicaoRapidaSchema,
  PREFERENCIAS_DA_EDICAO_RAPIDA_PADRAO,
  REGRAS_DE_SOM_PADRAO,
  secoesDoTake,
  secoesParaSom,
  semTrilhasDaEdicaoRapida,
  tipoDoSfxPeloNome,
  trilhaParaMixar,
  trilhasDoPlanoDeSom,
  loteDeRostosSchema,
  type ArquivoDeSfx,
  type PlanoDeSom,
} from '../../shared/edicao-rapida'
import { DUCKING_PADRAO, trechoDeAudioSchema } from '../../shared/contract'
import { projectFileSchema } from '../../shared/project-file'
import { lerRascunho, roteiroAtual } from '../../shared/roteiro'
import { takeAtual } from '../../shared/voz'

let falhas = 0
let total = 0
function confere(ok: boolean, nome: string): void {
  total++
  console.log(`  ${ok ? 'ok ' : 'FALHOU'} ${nome}`)
  if (!ok) falhas++
}
function secao(nome: string): void {
  console.log(`\n== ${nome}`)
}
const perto = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps

const SCRATCH = 'C:/Users/levic/AppData/Local/Temp/claude/G--ClaudeEditor/ea8ba0e5-233c-49c4-9613-b7db2f0cff9f/scratchpad'
const RECAPS = process.env['RECAPS'] ?? join(SCRATCH, 'f1p4', 'reaud', 'ud', 'recaps')

// ---------------------------------------------------------------- 1. carga
secao('1. Modulos carregam sem ciclo')
confere(pedidoDeMontagemSchema.safeParse({}).success, 'pedidoDeMontagemSchema (cenas) vivo depois de importar edicao-rapida')
confere(projectFileSchema !== undefined && trechoDeAudioSchema !== undefined, 'project-file e contract vivos')

// ------------------------------------------------------- 2. projeto antigo
secao('2. Projeto antigo abre igual')
const trechoAntigo = {
  id: 'a1',
  path: 'C:/x/musica.mp3',
  fileName: 'musica.mp3',
  faixa: 0,
  at: 0,
  durationSec: 120,
  inicioSec: 0,
  usarSec: null,
  gainDb: -20,
  fadeInSec: 0.5,
  fadeOutSec: 1,
  peaks: [],
  rms: [],
}
const relido = trechoDeAudioSchema.parse(trechoAntigo)
confere(JSON.stringify(relido) === JSON.stringify(trechoAntigo), 'trilha sem papel/ducking volta byte a byte')
confere(!('papel' in relido) && !('ducking' in relido), 'nenhum campo novo aparece sozinho')
const comDucking = trechoDeAudioSchema.parse({ ...trechoAntigo, papel: 'musica', ducking: {} })
confere(comDucking.papel === 'musica' && JSON.stringify(comDucking.ducking) === JSON.stringify(DUCKING_PADRAO), 'ducking {} vira o padrao')
confere(!trechoDeAudioSchema.safeParse({ ...trechoAntigo, papel: 'pop' }).success, 'papel desconhecido e recusado')

const projetos = [
  join(SCRATCH, 'f1p4', 'reaud', 'bib', '_projetos', 'Dr. Stone S04E37 - 2026-10-14 18h00', 'Dr. Stone S04E37.anirecap'),
  join(SCRATCH, 'f1p4', 'montar', 'projeto', 'Dr. Stone S04E37.anirecap'),
].filter((p) => existsSync(p))
confere(projetos.length > 0, `${projetos.length} .anirecap de rodada anterior achado(s)`)
for (const p of projetos) {
  const antes = statSync(p)
  const cru = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>
  const lido = projectFileSchema.parse(cru)
  // O arquivo foi gravado PELO schema: reler e regravar tem que dar o mesmo JSON.
  confere(JSON.stringify(projectFileSchema.parse(JSON.parse(JSON.stringify(lido)))) === JSON.stringify(lido), `${p.split(/[\\/]/).slice(-2).join('/')}: idempotente`)
  confere(lido.studio !== undefined && lido.studio.secoes === undefined, '  studio sem secoes continua sem secoes')
  const depois = statSync(p)
  confere(antes.mtimeMs === depois.mtimeMs, '  arquivo intocado')
}

// --------------------------------------------------------------- 3. partes
secao('3. Partes do S4-37 no tempo do take')
const nomeS437 = existsSync(RECAPS)
  ? readdirSync(RECAPS).find((n) => /^rc_25d63d4babd6_.*\.json$/.test(n) && statSync(join(RECAPS, n)).size > 200_000)
  : undefined
confere(nomeS437 !== undefined, `rascunho do S4-37 em ${RECAPS}`)
const rascunho = lerRascunho(JSON.parse(readFileSync(join(RECAPS, nomeS437!), 'utf8')))
const roteiro = roteiroAtual(rascunho)!
const take = takeAtual(rascunho)!
confere(roteiro !== null && take !== null, `roteiro v${roteiro.versao} e take ${take.id} (${take.duracao.toFixed(1)} s)`)
const secoesS437 = secoesDoTake(roteiro, take, rascunho.eventos)
for (const s of secoesS437) {
  console.log(`     ${s.id} ${s.papel.padEnd(16)} ${s.inicio.toFixed(2).padStart(6)} - ${s.fim.toFixed(2).padStart(6)}  ${s.frases.length} frases  [${[...new Set(s.frases.flatMap((f) => f.personagens))].join(', ')}]`)
}
confere(secoesS437.length === roteiro.secoes.length, `${secoesS437.length} partes (uma por secao com voz)`)
confere(secoesS437[0]!.inicio === 0, 'a 1a parte comeca em 0')
confere(secoesS437.every((s, i) => i === 0 || perto(s.inicio, secoesS437[i - 1]!.fim, 1e-3)), 'partes contiguas (fim de uma = inicio da outra)')
confere(perto(secoesS437.at(-1)!.fim, take.duracao, 1e-3), 'a ultima vai ate o fim da voz')
confere(secoesS437.some((s) => s.frases.some((f) => f.personagens.length > 0)), 'frases com personagens dos eventos')

const projetoStudio = projectFileSchema.parse({
  ...(JSON.parse(readFileSync(projetos[0]!, 'utf8')) as object),
})
const comSecoes = projectFileSchema.parse({ ...projetoStudio, studio: { ...projetoStudio.studio!, secoes: secoesS437 } })
confere(comSecoes.studio?.secoes?.length === secoesS437.length, 'studio.secoes passa pelo zod do .anirecap')

const paraSom = secoesParaSom({ studio: comSecoes.studio, duracaoSec: take.duracao })
confere(paraSom.length === secoesS437.length && paraSom[0]!.papel === 'gancho', 'secoesParaSom 1: studio.secoes')
const pelasImagens = secoesParaSom({
  images: projetoStudio.images,
  plan: projetoStudio.plan,
  words: projetoStudio.transcript?.words,
  duracaoSec: take.duracao,
})
confere(
  pelasImagens.length === secoesS437.length && pelasImagens.every((s, i) => s.papel === secoesS437[i]!.papel && perto(s.inicio, secoesS437[i]!.inicio, 1e-3)),
  `secoesParaSom 2: pelas imagens do projeto antigo (${pelasImagens.map((s) => s.papel).join(' > ')})`,
)
const pelosParagrafos = secoesParaSom({ words: projetoStudio.transcript?.words, duracaoSec: take.duracao })
confere(pelosParagrafos.length === secoesS437.length && pelosParagrafos.every((s) => s.papel === null), `secoesParaSom 3: pelos paragrafos (${pelosParagrafos.length} partes, sem papel)`)
confere(secoesParaSom({ duracaoSec: 30 }).length === 1, 'secoesParaSom 4: sem nada, uma parte so')

// ----------------------------------------------------------------- 4. sfx
secao('4. planejarSfx')
const medida = (path: string, tipo: ArquivoDeSfx['tipo'], d: Partial<ArquivoDeSfx>): ArquivoDeSfx => ({
  path,
  fileName: path.split('/').pop()!,
  tipo,
  reserva: false,
  durationSec: 1.5,
  lufsIntegrado: -20,
  lufsMomentaneoMax: -12,
  picoSec: 0.4,
  inicioSomSec: 0.02,
  fimSomSec: 1.2,
  ...d,
})
const arquivos: ArquivoDeSfx[] = [
  medida('C:/sfx/whoosh.mp3', 'whoosh', { picoSec: 0.45, lufsMomentaneoMax: -11 }),
  medida('C:/sfx/whoosh-2.wav', 'whoosh', { picoSec: 0.3, lufsMomentaneoMax: -15, durationSec: 0.9, fimSomSec: 0.8 }),
  medida('C:/app/whoosh-reserva.mp3', 'whoosh', { reserva: true }),
  medida('C:/sfx/impact.mp3', 'impacto', { picoSec: 0.12, inicioSomSec: 0.01, lufsMomentaneoMax: -7, durationSec: 2.4, fimSomSec: 1.9 }),
]
confere(tipoDoSfxPeloNome('C:/x/Whoosh_02.wav') === 'whoosh' && tipoDoSfxPeloNome('impact.mp3') === 'impacto' && tipoDoSfxPeloNome('ui-pop.mp3') === null, 'tipo pelo nome (pop de interface fica de fora)')
const cortes = projetoStudio.plan!.scenes
const sfx = planejarSfx(cortes, paraSom, arquivos, REGRAS_DE_SOM_PADRAO, take.duracao)
for (const s of sfx) console.log(`     ${s.tipo.padEnd(8)} marca ${s.marcaSec.toFixed(2).padStart(6)}  at ${s.at.toFixed(3)}  in ${s.inSec.toFixed(2)} out ${s.outSec.toFixed(2)}/${s.durationSec}  ${s.ganhoDb} dB  ${s.arquivo.split('/').pop()}  (${s.motivo})`)
const viradas = paraSom.slice(1).map((s) => s.inicio)
const whooshes = sfx.filter((s) => s.tipo === 'whoosh')
const impactos = sfx.filter((s) => s.tipo === 'impacto')
confere(whooshes.length === viradas.length, `${whooshes.length} whoosh = ${viradas.length} viradas de parte`)
confere(sfx.length < cortes.length / 2, `${sfx.length} sons para ${cortes.length} cortes: nada de som em todo corte`)
const climax = paraSom.find((s) => s.papel === 'climax')!
confere(impactos.length === 2 && impactos[0]!.marcaSec === 0 && perto(impactos[1]!.marcaSec, climax.inicio, 0.36), 'impacto no comeco do gancho e do climax, e so')
const iniciosDeBloco = new Set(cortes.map((c) => c.start.toFixed(3)))
confere(whooshes.every((w) => iniciosDeBloco.has(w.marcaSec.toFixed(3))), 'toda virada grudou num corte de bloco')
confere(
  whooshes.every((w) => {
    const a = arquivos.find((x) => x.path === w.arquivo)!
    return perto(w.at + (a.picoSec - w.inSec), w.marcaSec - REGRAS_DE_SOM_PADRAO.whooshAntesDoCorteSec, 2e-3)
  }),
  'o PICO do whoosh cai 40 ms antes do corte',
)
confere(whooshes.every((w, i) => i === 0 || w.arquivo !== whooshes[i - 1]!.arquivo), 'rodizio: o mesmo whoosh nunca duas vezes seguidas')
confere(!sfx.some((s) => s.arquivo.includes('reserva')), 'a reserva fica de fora quando a pasta dele tem o tipo')
const soReserva = planejarSfx(cortes, paraSom, arquivos.filter((a) => a.reserva || a.tipo === 'impacto'), REGRAS_DE_SOM_PADRAO, take.duracao)
confere(soReserva.filter((s) => s.tipo === 'whoosh').every((s) => s.arquivo.includes('reserva')) && soReserva.some((s) => s.tipo === 'whoosh'), 'sem whoosh dele: entra o da reserva')
confere(planejarSfx(cortes, paraSom, [], REGRAS_DE_SOM_PADRAO, take.duracao).length === 0, 'sem arquivo nenhum: nenhum som')
confere(sfx.every((s) => s.at >= 0 && s.inSec >= 0 && s.outSec <= s.durationSec && s.outSec > s.inSec), 'trechos dentro do arquivo')
confere(impactos[0]!.at === 0 && perto(impactos[0]!.inSec, 0.01), 'impacto no zero: pula so o silencio do comeco')
confere(sfx.every((s) => s.durationSec === arquivos.find((a) => a.path === s.arquivo)!.durationSec), 'durationSec = o arquivo inteiro (sobra)')
const w1 = whooshes.find((w) => w.arquivo.endsWith('whoosh.mp3'))!
confere(w1.ganhoDb === ganhoDoSfx(-11, 'whoosh') && w1.ganhoDb === -14 - 14 + 11, `ganho por LUFS momentaneo: whoosh -11 LUFS -> ${w1.ganhoDb} dB (max momentaneo em -28 = 14 LU abaixo da voz)`)
const juntas = planejarSfx(
  [{ start: 0 }, { start: 5 }, { start: 6 }, { start: 12 }],
  [
    { papel: 'gancho', inicio: 0, fim: 5 },
    { papel: 'contexto', inicio: 5, fim: 6 },
    { papel: 'desenvolvimento', inicio: 6, fim: 12 },
    { papel: 'climax', inicio: 12, fim: 20 },
  ],
  arquivos,
  REGRAS_DE_SOM_PADRAO,
  20,
)
confere(juntas.filter((s) => s.tipo === 'whoosh').map((s) => s.marcaSec).join(',') === '5,12', 'parte curta: o whoosh a menos de 2,5 s do anterior cai')
const dangai = planejarSfx([{ start: 0 }, { start: 4 }], [{ papel: null, inicio: 0, fim: 4 }, { papel: null, inicio: 4, fim: 9 }], arquivos, REGRAS_DE_SOM_PADRAO, 9)
confere(dangai.filter((s) => s.tipo === 'impacto').length === 1 && dangai.filter((s) => s.tipo === 'whoosh').length === 1, 'projeto sem papel: impacto so no comeco, whoosh na virada')

// UM whoosh so (a pasta de fabrica): nada de 5 vezes o mesmo arquivo.
const umWhoosh = planejarSfx(cortes, paraSom, arquivos.filter((a) => a.path === 'C:/sfx/whoosh.mp3' || a.tipo === 'impacto'), REGRAS_DE_SOM_PADRAO, take.duracao)
const soUm = umWhoosh.filter((s) => s.tipo === 'whoosh')
const desenvolvimento = paraSom.find((s) => s.papel === 'desenvolvimento')!
console.log(`     com 1 whoosh: ${soUm.map((w) => `${w.marcaSec.toFixed(2)} (${w.motivo})`).join(', ')}`)
confere(
  soUm.length === REGRAS_DE_SOM_PADRAO.maximoComUmArquivo &&
    soUm.some((w) => perto(w.marcaSec, climax.inicio, 0.36)) &&
    soUm.some((w) => perto(w.marcaSec, desenvolvimento.inicio, 0.36)),
  `1 whoosh na pasta: so ${REGRAS_DE_SOM_PADRAO.maximoComUmArquivo} vezes, nas viradas para o desenvolvimento e o climax`,
)
confere(umWhoosh.filter((s) => s.tipo === 'impacto').length === 2, '1 impacto na pasta: gancho e climax continuam')

// A VOZ NAQUELE INSTANTE: a virada que cai num trecho baixo da voz abaixa o SFX.
const vozCrua = -23
const blocosDaVoz = Array.from({ length: Math.ceil(take.duracao * 10) }, () => vozCrua)
const alvoBaixo = soUm.find((w) => perto(w.marcaSec, climax.inicio, 0.36))!
// A voz 10 LU mais baixa (-24 no render, ainda FALA) em volta da virada do climax.
for (let j = Math.floor((alvoBaixo.marcaSec - 1) * 10); j < Math.ceil((alvoBaixo.marcaSec + 1) * 10); j++) blocosDaVoz[j] = vozCrua - 10
const voz = { blocos: blocosDaVoz, ajusteDb: REGRAS_DE_SOM_PADRAO.vozLufs - vozCrua }
const semVoz = planejarSfx(cortes, paraSom, arquivos, REGRAS_DE_SOM_PADRAO, take.duracao)
const comVoz = planejarSfx(cortes, paraSom, arquivos, REGRAS_DE_SOM_PADRAO, take.duracao, voz)
const naVirada = (lista: typeof sfx) => lista.filter((s) => perto(s.marcaSec, alvoBaixo.marcaSec, 0.01))
const doClimax = (lista: typeof sfx) => naVirada(lista).find((s) => s.tipo === 'whoosh')
const antesW = doClimax(semVoz)
const depoisW = doClimax(comVoz)
console.log(`     whoosh no climax: ${antesW?.ganhoDb} dB pelo integrado, ${depoisW?.ganhoDb} dB com a voz falando a -24 ali`)
confere(antesW !== undefined && depoisW !== undefined && depoisW.ganhoDb <= antesW.ganhoDb - 7, 'voz 10 LU mais baixa na virada: o whoosh abaixa junto')
const mMaxDe = (s: { arquivo: string }) => arquivos.find((a) => a.path === s.arquivo)!.lufsMomentaneoMax!
const juntosNaVirada = naVirada(comVoz).length
confere(
  naVirada(comVoz).every((s) => mMaxDe(s) + s.ganhoDb <= -24 - REGRAS_DE_SOM_PADRAO.abaixoDaVozLu[s.tipo] - (juntosNaVirada > 1 ? 10 * Math.log10(juntosNaVirada) : 0) + 0.3),
  'os SFX da virada ficam abaixoDaVozLu[tipo] abaixo da voz ALI (nao da integrada)',
)
const longeDoClimax = (lista: typeof sfx) => lista.filter((s) => Math.abs(s.marcaSec - alvoBaixo.marcaSec) > 1.5).map((s) => `${s.arquivo}@${s.marcaSec}:${s.ganhoDb}`).join('|')
confere(longeDoClimax(semVoz) === longeDoClimax(comVoz), 'voz no nivel de sempre: os outros SFX nao mudam (so abaixa)')
confere(vozNoSfx({ picoSec: 0.2 }, 0, 0, null) === null && ganhoDoSfx(-11, 'whoosh', REGRAS_DE_SOM_PADRAO, null) === ganhoDoSfx(-11, 'whoosh'), 'sem a voz: o integrado vale sozinho')
const pausa = { blocos: Array.from({ length: 50 }, (_, j) => (j < 10 ? -23 : -200)), ajusteDb: 9 }
confere(vozNoSfx({ picoSec: 0.2 }, 3, 0, pausa) === null, 'SFX num silencio da voz: nao abaixa (vale o integrado; senao sumia embaixo da musica)')
const vozAlta = vozNoSfx({ picoSec: 0.2 }, 0.2, 0, { blocos: Array.from({ length: 50 }, () => -10), ajusteDb: 9 })!
confere(perto(vozAlta, -1, 1e-6) && ganhoDoSfx(-11, 'whoosh', REGRAS_DE_SOM_PADRAO, vozAlta) === ganhoDoSfx(-11, 'whoosh'), 'voz alta ali nao SOBE o SFX (conta no maximo -14)')
// (O vao entre frases x a frase em volta: medido no S4-37 de verdade, v-som-mix 5c.)

// ------------------------------------------------------------- 5. ducking
secao('5. envelopeDeDucking')
const palavras = take.palavras
const env = envelopeDeDucking(palavras, take.duracao, DUCKING_PADRAO)
const A = DUCKING_PADRAO.abaixoDb
confere(env.length > 2, `${env.length} pontos para ${palavras.length} palavras`)
confere(env.every((p, i) => i === 0 || p.t > env[i - 1]!.t), 'tempos estritamente crescentes')
confere(env.every((p) => p.db <= 0 && p.db >= -A), `db entre -${A} e 0`)
confere(palavras.every((p) => perto(ganhoDoEnvelope(env, (p.start + p.end) / 2), -A, 1e-6)), 'no meio de toda palavra: embaixo')
const vaos = palavras.slice(1).map((p, i) => ({ a: palavras[i]!.end, b: p.start, g: p.start - palavras[i]!.end }))
const longos = vaos.filter((v) => v.g >= DUCKING_PADRAO.ataqueSec + DUCKING_PADRAO.soltaSec)
const medios = vaos.filter((v) => v.g >= DUCKING_PADRAO.pausaMinSec && v.g < DUCKING_PADRAO.ataqueSec + DUCKING_PADRAO.soltaSec)
const curtos = vaos.filter((v) => v.g < DUCKING_PADRAO.pausaMinSec)
console.log(`     vaos: ${longos.length} longos (sobe ate 0), ${medios.length} medios (sobe um pouco), ${curtos.length} curtos (fica embaixo)`)
confere(longos.every((v) => perto(ganhoDoEnvelope(env, v.a + DUCKING_PADRAO.soltaSec + 1e-3), 0, 1e-6) || v.b - DUCKING_PADRAO.ataqueSec < v.a + DUCKING_PADRAO.soltaSec), 'pausa longa: volta a 0')
confere(medios.every((v) => { const meio = (v.a * DUCKING_PADRAO.ataqueSec + v.b * DUCKING_PADRAO.soltaSec) / (DUCKING_PADRAO.ataqueSec + DUCKING_PADRAO.soltaSec); const g = ganhoDoEnvelope(env, meio); return g > -A && g < 0 }), 'pausa media: sobe so um pouco')
confere(curtos.every((v) => perto(ganhoDoEnvelope(env, (v.a + v.b) / 2), -A, 1e-6)), 'pausa curta: fica embaixo')
confere(envelopeDeDucking([], 10).length === 0 && ganhoDoEnvelope([], 3) === 0, 'sem palavras: sem envelope (ganho 0)')
const sintetico = envelopeDeDucking([{ start: 2, end: 3 }, { start: 6, end: 7 }], 10, DUCKING_PADRAO)
confere(
  perto(ganhoDoEnvelope(sintetico, 0.5), 0) && perto(ganhoDoEnvelope(sintetico, 2.5), -A) && perto(ganhoDoEnvelope(sintetico, 4.5), 0) && perto(ganhoDoEnvelope(sintetico, 9.5), 0) && perto(ganhoDoEnvelope(sintetico, 1.925), -A / 2, 1e-3),
  'sintetico: 0 antes, -A na fala, 0 na pausa, 0 no fim, meia rampa no meio do ataque',
)

// ---------------------------------------------------- 6. plano -> trilhas
secao('6. Plano de som -> trilhas')
const plano: PlanoDeSom = planoDeSomSchema.parse({
  musica: {
    arquivo: 'G:/App Resumo/music/Naruto - Afternoon of Konoha.mp3',
    ganhoDb: ganhoDaMusica(-12),
    fadeInSec: 1.2,
    fadeOutSec: 2,
    ducking: DUCKING_PADRAO,
    inSec: 0.5,
    durationSec: 40,
    lufsIntegrado: -12,
  },
  sfx,
})
const existentes = [{ ...trechoAntigo, faixa: 1 }, { ...trechoAntigo, id: 'velha', faixa: 4, papel: 'musica' as const }]
const faixas = faixasDaEdicaoRapida([{ ...trechoAntigo, faixa: 1 }])
confere(faixas.musica === 2 && faixas.whoosh === 3 && faixas.impacto === 4, 'faixas depois da mais alta DELE')
const novas = trilhasDoPlanoDeSom(plano, { duracaoSec: take.duracao, faixas, prefixoId: 'er1' })
// Rodar de novo: cada papel FICA na faixa dele, mesmo com um som dele numa
// faixa acima (antes, cada rodada empurrava musica/whoosh/impacto para cima).
const comDele = [{ ...trechoAntigo, faixa: 1 }, ...novas, { ...trechoAntigo, id: 'acima', faixa: 5 }]
const deNovo = faixasDaEdicaoRapida(comDele, novas)
confere(deNovo.musica === 2 && deNovo.whoosh === 3 && deNovo.impacto === 4, 'rodar de novo com um som dele na faixa de cima: nada sai do lugar')
const w0 = novas.find((t) => t.papel === 'whoosh')!
const naFaixaDoWhoosh = (at: number) => [...comDele, { ...trechoAntigo, id: 'meu-whoosh', faixa: 3, at, durationSec: 1, inicioSec: 0, usarSec: null }]
confere(faixasDaEdicaoRapida(naFaixaDoWhoosh(w0.at + 0.1), novas).whoosh !== 3, 'som dele na faixa do whoosh NO MESMO TEMPO: o whoosh muda de faixa')
const vazio = [0, 1, 2, 3, 4, 5].map((k) => k * 0.5).find((t) => novas.every((n) => n.papel !== 'whoosh' || t + 1 <= n.at || t >= n.at + (n.usarSec ?? n.durationSec - n.inicioSec)))
confere(vazio !== undefined && faixasDaEdicaoRapida(naFaixaDoWhoosh(vazio), novas).whoosh === 3, 'som dele na faixa do whoosh em OUTRO tempo: o whoosh fica')
confere(faixasDaEdicaoRapida(existentes).musica === 4, 'a musica velha da Edicao rapida: fica na faixa dela')
const semWhoosh = naFaixaDaEdicaoRapida([], novas.filter((t) => t.papel !== 'whoosh'))
confere(semWhoosh.find((t) => t.papel === 'musica')!.faixa === 0 && semWhoosh.find((t) => t.papel === 'impacto')!.faixa === 1, 'sem whoosh: o impacto logo abaixo da musica (sem faixa vazia)')
const musicas = novas.filter((t) => t.papel === 'musica')
confere(musicas.length === 2 && musicas[0]!.inicioSec === 0.5 && musicas[1]!.inicioSec === 0, `musica de 40 s num video de ${take.duracao.toFixed(1)} s: 2 voltas`)
confere(perto(musicas.reduce((s, t) => s + (t.usarSec ?? t.durationSec - t.inicioSec), 0), take.duracao, 1e-3), 'as voltas cobrem o video inteiro')
confere(musicas[0]!.fadeInSec === 1.2 && musicas[0]!.fadeOutSec === 0 && musicas[1]!.fadeOutSec === 2 && musicas[1]!.fadeInSec === 0, 'fade de entrada na 1a volta e de saida na ultima')
confere(musicas.every((t) => t.ducking !== undefined && t.ducking !== null && t.faixa === 2), 'ducking em todas as voltas, na faixa da musica')
confere(ganhoDaMusica(-12) === -14 - 16 + 12, `ganho da musica por LUFS integrado: -12 -> ${ganhoDaMusica(-12)} dB (-30 nas pausas, -36 sob a voz)`)
confere(ganhoDaMusica(-40) === 0 && musicaAbaixoDoAlvoDb(-40) === 10 && musicaAbaixoDoAlvoDb(-12) === 0, 'musica baixa no arquivo: nao sobe acima dele (preview = render), fica 10 dB abaixo do alvo')
confere(novas.filter((t) => t.papel === 'whoosh').every((t) => t.faixa === 3) && novas.filter((t) => t.papel === 'impacto').every((t) => t.faixa === 4), 'cada tipo de SFX na sua faixa')
confere(new Set(novas.map((t) => t.id)).size === novas.length, 'ids unicos')
confere(novas.every((t) => trechoDeAudioSchema.safeParse(t).success), 'toda trilha nova passa no trechoDeAudioSchema')
confere(semTrilhasDaEdicaoRapida([...existentes, ...novas]).length === 1, 'rodar de novo: so a trilha DELE fica')
const mix = trilhaParaMixar(musicas[1]!, palavras, take.duracao)
confere(mix.envelope !== undefined && mix.envelope[0]!.t === musicas[1]!.at && perto(mix.envelope.at(-1)!.t, take.duracao, 1e-3), 'trilhaParaMixar: envelope recortado no trecho')
confere(
  [0.3, 0.5, 0.9].every((f) => {
    const t = musicas[1]!.at + f * (take.duracao - musicas[1]!.at)
    return perto(ganhoDoEnvelope(mix.envelope!, t), ganhoDoEnvelope(env, t), 1e-6)
  }),
  'o recorte da o MESMO ganho do envelope inteiro (preview = render)',
)
confere(trilhaParaMixar(novas.find((t) => t.papel === 'whoosh')!, palavras, take.duracao).envelope === undefined, 'SFX sem ducking: sem envelope')

// ----------------------------------------------------------------- 7. resto
secao('7. Musica sem repetir, legenda, config, pedidos')
const pasta = [
  { path: 'G:/m/b.mp3', fileName: 'b.mp3' },
  { path: 'G:/m/a.m4a', fileName: 'a.m4a' },
]
confere(musicaSemRepetir(pasta, { versao: 1, usadas: [] })?.fileName === 'a.m4a', 'nada usado: a 1a pelo nome')
confere(musicaSemRepetir(pasta, { versao: 1, usadas: [{ path: 'G:\\M\\A.m4a', fileName: 'a.m4a', em: '2026-10-14T10:00:00Z', projeto: null }] })?.fileName === 'b.mp3', 'a usada fica para depois (caminho com barra/caixa diferente)')
confere(
  musicaSemRepetir(pasta, {
    versao: 1,
    usadas: [
      { path: 'G:/m/a.m4a', fileName: 'a.m4a', em: '2026-10-14T12:00:00Z', projeto: null },
      { path: 'G:/m/b.mp3', fileName: 'b.mp3', em: '2026-10-14T11:00:00Z', projeto: null },
    ],
  })?.fileName === 'b.mp3',
  'todas usadas: a usada ha mais tempo',
)
confere(musicaSemRepetir(pasta, { versao: 1, usadas: [] }, ['G:/m/a.m4a'])?.fileName === 'b.mp3', 'evitar: pula a do projeto')
confere(musicaSemRepetir([], { versao: 1, usadas: [] }) === null, 'pasta vazia: null')

const estilo = aplicarEstiloNoProjeto(projetoStudio, { color: '#12AB34', y: 0.3, fontNome: 'Komika.ttf', stroke: 9 })
confere(estilo.captionColor === '#12AB34' && estilo.captionY === 0.3 && estilo.captionFont === 'Komika.ttf' && estilo.captionStroke === 9 && estilo.captionScale === projetoStudio.captionScale, 'estilo salvo nos campos do arquivo; o que falta fica')
confere(projectFileSchema.safeParse(estilo).success, 'o arquivo com estilo passa no zod')

confere(JSON.stringify(configDaEdicaoRapidaSchema.parse({})) === JSON.stringify({ sfx: true, musica: true, rosto: true, legenda: true }), 'config vazia = tudo ligado')
const prefs = preferenciasDaEdicaoRapidaSchema.catch(PREFERENCIAS_DA_EDICAO_RAPIDA_PADRAO).parse({ aoAbrirNoEditor: 'sim', config: { sfx: false, musica: 3 } })
confere(prefs.aoAbrirNoEditor === true && prefs.config.sfx === false && prefs.config.musica === true, 'preferencia com lixo: campo ruim volta ao padrao, o bom fica')
confere(preferenciasDaEdicaoRapidaSchema.catch(PREFERENCIAS_DA_EDICAO_RAPIDA_PADRAO).parse('lixo').aoAbrirNoEditor === true, 'preferencia que nem e objeto: padrao')
confere(pedidoDeMontagemSchema.parse({ edicaoRapida: { rosto: false } }).edicaoRapida?.rosto === false, 'montagem com Edicao rapida parcial')
confere(pedidoDeMontagemSchema.parse({}).edicaoRapida === undefined, 'montagem sem Edicao rapida (a de sempre)')
confere(pedidoDePlanoDeSomSchema.safeParse({ sfx: true, musica: true, duracaoSec: 60, cortes: [0, 3], secoes: paraSom }).success, 'pedido de plano de som confere')
confere(!pedidoDePlanoDeSomSchema.safeParse({ sfx: true, musica: true, duracaoSec: 60, cortes: [], secoes: [{ papel: 'pop', inicio: 0, fim: 1 }] }).success, 'papel desconhecido no pedido e recusado')
confere(loteDeRostosSchema.parse({ pedidos: [{ chave: 'a@0.000', arquivo: 'a.mp4', de: 0, ate: 2 }] }).motor === true, 'lote de rostos: motor por padrao')
confere(pedidoDePlanoDeSomSchema.parse({ sfx: true, musica: true, duracaoSec: 60, cortes: [], secoes: [] }).vozPath === null, 'pedido de som sem narracao: vozPath null')
confere(nadaLigado({ sfx: false, musica: false, rosto: false, legenda: false }) && !nadaLigado({ sfx: false, musica: false, rosto: true, legenda: false }), 'nada ligado')
confere(partesLigadas({ sfx: true, musica: true, rosto: false, legenda: true }) === 'sons, musica e legenda' && partesLigadas({ sfx: false, musica: false, rosto: true, legenda: false }) === 'rosto', 'a dica diz so as partes ligadas')

console.log(`\n${total - falhas}/${total} ok${falhas ? `, ${falhas} FALHA(S)` : ''}`)
process.exit(falhas ? 1 : 0)
