/**
 * INTEGRACAO REAL do motor de voz, com a conta do Levi -- GASTA CREDITO.
 *
 * Orcamento da F1 parte 3 inteira: 4.000 caracteres. Isto gasta ~1.100:
 *   1. um take do roteiro aprovado do S4-37 (1.034 caracteres) com a voz
 *      padrao dele (Andrea Wolff, eleven_multilingual_v2);
 *   2. uma regravacao de frase (f03, 60 caracteres) com previous/next_text;
 *   3. um take IMPORTADO (a voz do Windows em PT-BR como "audio do Levi"), de graca.
 *
 * Antes e depois de cada chamada paga: GET /v1/user e /v1/history (gratis), e
 * a linha vai para o creditos.log (sem a chave, nunca).
 *
 * NUNCA PAGAR DUAS VEZES: o cache pago das rodadas anteriores (REAL_RECAPS,
 * padrao SAIDA/../real-recaps) e SEMEADO na copia antes de tudo -- rodar de
 * novo sai do cache, de graca. (O ouvidos.json NAO e semeado: com ele, o
 * "Gerar voz" explicito pediria uma leitura nova, paga.) E cada passo pago
 * confere o TETO TOTAL do trabalho (4.000 caracteres de texto): o ja gasto vem
 * de TEXTO_JA_GASTO ou da ultima linha "Total da parte 3: N car. de TEXTO" do
 * creditos.log; sem nenhum dos dois, nada e pago. SO_CACHE=1 recusa qualquer
 * passo que cobraria.
 *
 * Trabalha numa COPIA do perfil (settings.json + Local State, para o
 * safeStorage abrir a chave, + o rascunho), numa pasta temporaria: o rascunho
 * do Levi nao e tocado. Os WAVs e as palavras com tempo vao para SAIDA, e o
 * recaps/ da copia vai para uma pasta NOVA ao lado (real-recaps-<data>): a de
 * antes nunca e apagada.
 *
 * Rodar da raiz (com SAIDA e CREDITOS):
 *   npx esbuild scripts/teste/v-voz-real.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json --outfile=out/teste/v-voz-real.cjs
 *   $env:SO_CACHE='1'; npx electron out/teste/v-voz-real.cjs
 */
import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { roteiroAtual } from '../../shared/roteiro'
import { conferirTake, configPadrao, textoParaNarrar, type TakeDaVoz } from '../../shared/voz'
import { alinharAoAudio, configureAlinhador } from '../../electron/services/alinhador'
import { configurarEpisodios } from '../../electron/services/episodio/perfil'
import { lerRascunhoDoDisco } from '../../electron/services/gerar/rascunho'
import { configureSettings, getSettings } from '../../electron/services/settings'
import { configureWhisper } from '../../electron/services/whisper'
import { paraOModelo } from '../../electron/services/voz/alinhamento'
import { lerDoCache, lerOuvidos } from '../../electron/services/voz/cache'
import { estimarVoz } from '../../electron/services/voz/estimar'
import { gerarVoz, importarAudio, regravarFrases } from '../../electron/services/voz/gerar'
import { arquivoDaVoz } from '../../electron/services/voz/pastas'
import { cortesDasPausas, medirEnergia } from '../../electron/services/voz/pos'
import { lerWavDoDisco } from '../../electron/services/voz/wav'

const PERFIL_REAL = join(process.env['APPDATA'] ?? '', 'AniRecap Studio')
const ID = 'rc_25d63d4babd6_mv7cxp1z'
const SAIDA = process.env['SAIDA'] ?? join(tmpdir(), 'anirecap-v-voz-real-saida')
const CREDITOS = process.env['CREDITOS'] ?? join(SAIDA, 'creditos.log')
/** Teto TOTAL do trabalho (F1 parte 3), em caracteres de TEXTO mandados. */
const TETO_TOTAL = 4000
const REAL_RECAPS = process.env['REAL_RECAPS'] ?? join(SAIDA, '..', 'real-recaps')
const BASE = join(tmpdir(), 'anirecap-v-voz-real')
const USER = join(BASE, 'userData')

rmSync(BASE, { recursive: true, force: true })
mkdirSync(join(USER, 'recaps'), { recursive: true })
mkdirSync(SAIDA, { recursive: true })
copyFileSync(join(PERFIL_REAL, 'settings.json'), join(USER, 'settings.json'))
copyFileSync(join(PERFIL_REAL, 'Local State'), join(USER, 'Local State'))
copyFileSync(join(PERFIL_REAL, 'recaps', `${ID}.json`), join(USER, 'recaps', `${ID}.json`))
// O cache pago das rodadas anteriores (so o cache: ver o cabecalho).
if (existsSync(join(REAL_RECAPS, 'cache', 'voz'))) {
  cpSync(join(REAL_RECAPS, 'cache', 'voz'), join(USER, 'recaps', 'cache', 'voz'), { recursive: true })
}
app.setPath('userData', USER)

/** O texto ja pago no trabalho: o maior entre TEXTO_JA_GASTO e o ultimo "Total da parte 3" do log. null = nao se sabe. */
function textoJaGasto(): number | null {
  const valores: number[] = []
  const doEnv = Number(process.env['TEXTO_JA_GASTO'])
  if (process.env['TEXTO_JA_GASTO'] && Number.isFinite(doEnv)) valores.push(doEnv)
  try {
    const linhas = [...readFileSync(CREDITOS, 'utf8').matchAll(/Total da parte 3: ([\d.]+) car\. de TEXTO/g)]
    const ultimo = linhas.at(-1)?.[1]
    if (ultimo) valores.push(Number(ultimo.replace(/\./g, '')))
  } catch {
    /* sem log: so o env */
  }
  return valores.length > 0 ? Math.max(...valores) : null
}

let pagoNestaRodada = 0
/** Antes de cada passo: so paga se couber no teto total (e nunca com SO_CACHE=1). */
function conferirTeto(pagos: number, oque: string): void {
  if (pagos === 0) return
  if (process.env['SO_CACHE'] === '1') throw new Error(`${oque}: cobraria ${pagos} caracteres e SO_CACHE=1. Nada pago.`)
  const ja = textoJaGasto()
  if (ja === null) throw new Error('Sem o total ja gasto (TEXTO_JA_GASTO ou "Total da parte 3" no creditos.log): nada pago.')
  if (ja + pagoNestaRodada + pagos > TETO_TOTAL) {
    throw new Error(`${oque}: ${ja} + ${pagoNestaRodada} + ${pagos} passa do teto total (${TETO_TOTAL}). Nada pago.`)
  }
  pagoNestaRodada += pagos
}

const progresso = (p: { etapa: string; mensagem: string }): void => console.log(`    [${p.etapa}] ${p.mensagem}`)
let n = 0
const pid = (): string => `real${++n}`

/**
 * GET /v1/user (gratis): o character_count do plano. No payg ele so atualiza
 * DEPOIS (leu 0 logo apos as chamadas na integracao), entao o ultimo item do
 * GET /v1/history (gratis) vai junto.
 */
async function caracteresUsados(): Promise<{ usados: number; limite: number; plano: string; historico: string } | null> {
  const chave = getSettings().elevenlabsApiKey
  const r = await fetch('https://api.elevenlabs.io/v1/user', { headers: { 'xi-api-key': chave }, signal: AbortSignal.timeout(15_000) })
  if (!r.ok) return null
  const a = ((await r.json()) as { subscription?: Record<string, unknown> }).subscription ?? {}
  let historico = '?'
  try {
    const h = await fetch('https://api.elevenlabs.io/v1/history?page_size=1', { headers: { 'xi-api-key': chave }, signal: AbortSignal.timeout(15_000) })
    const item = ((await h.json()) as { history?: { date_unix?: number }[] }).history?.[0]
    historico = item?.date_unix ? new Date(item.date_unix * 1000).toISOString() : 'vazio'
  } catch {
    /* so o character_count */
  }
  return { usados: Number(a['character_count']), limite: Number(a['character_limit']), plano: String(a['tier']), historico }
}

function registrar(etapa: string, oque: string, antes: number | null, depois: number | null): void {
  const quando = new Date().toISOString()
  const gasto = antes !== null && depois !== null ? depois - antes : '?'
  appendFileSync(CREDITOS, `${quando} | ${etapa} | ${oque} | ${antes ?? '-'} | ${depois ?? '-'} | ${gasto}\n`)
  console.log(`  creditos: ${oque}: ${antes} -> ${depois} (gasto ${gasto})`)
}

function guardar(nome: string, take: TakeDaVoz): void {
  copyFileSync(arquivoDaVoz(ID, take.arquivo), join(SAIDA, `${nome}.wav`))
  copyFileSync(arquivoDaVoz(ID, take.bruto.arquivo), join(SAIDA, `${nome}.bruto.wav`))
  writeFileSync(
    join(SAIDA, `${nome}.palavras.json`),
    JSON.stringify(
      {
        take: take.id,
        config: take.config,
        origemDoAlinhamento: take.origemDoAlinhamento,
        qualidade: take.qualidade,
        duracao: take.duracao,
        bruto: { arquivo: take.bruto.arquivo, duracao: take.bruto.duracao },
        caracteres: take.caracteres,
        cobrados: take.cobrados,
        chamadas: take.chamadas.map((c) => ({ ...c, requestId: c.requestId ? 'veio' : null })),
        avisos: take.avisos,
        regravadas: take.regravadas,
        derivadoDe: take.derivadoDe,
        trechos: take.trechos,
        palavras: take.palavras,
        brutoPalavras: take.bruto.palavras,
      },
      null,
      1,
    ),
  )
}

/** O tempo do provedor contra o wav2vec2 no MESMO audio (referencia de concordancia). */
async function concordancia(caminho: string, take: Pick<TakeDaVoz, 'palavras'>): Promise<string> {
  const medido = await alinharAoAudio(caminho, paraOModelo(take.palavras.map((p) => p.texto)), () => {})
  if (!medido) return 'alinhador nao rodou'
  const d = take.palavras.map((p, i) => Math.abs(p.start - medido.tempos[i]!.start)).sort((a, b) => a - b)
  const f = (x: number): string => `${(x * 1000).toFixed(0)} ms`
  return `mediana ${f(d[Math.floor(d.length / 2)]!)} p90 ${f(d[Math.floor(d.length * 0.9)]!)} max ${f(d.at(-1)!)} (score ${medido.score.toFixed(2)})`
}

function picoNosCortes(take: TakeDaVoz): string {
  const pcm = lerWavDoDisco(arquivoDaVoz(ID, take.bruto.arquivo))
  const e = medirEnergia(pcm)
  const cortes = cortesDasPausas(take.bruto.palavras, e, pcm.amostras.length)
  let pico = 0
  for (const c of cortes) for (let i = c.de; i < c.ate; i++) pico = Math.max(pico, Math.abs(pcm.amostras[i]!))
  const cortado = cortes.reduce((s, c) => s + c.ate - c.de, 0) / pcm.taxa
  return `${cortes.length} cortes, ${cortado.toFixed(2)} s tirados, pico dentro dos cortes ${(20 * Math.log10(Math.max(1, pico) / 32768)).toFixed(0)} dBFS (limiar ${e.limiar.toFixed(0)} dBFS)`
}

async function rodar(): Promise<void> {
  configureSettings(USER)
  configurarEpisodios(USER)
  configureAlinhador(PERFIL_REAL)
  configureWhisper(join(PERFIL_REAL, 'whisper'))
  const s = getSettings()
  if (!s.elevenlabsApiKey) throw new Error('A chave do ElevenLabs nao abriu na copia do perfil.')
  console.log(`chave ElevenLabs: abre (${s.elevenlabsApiKey.length > 0}); Fish: ${s.fishApiKey.length > 0 ? 'tem' : 'nao tem'}`)
  // A 1,0: e a leitura que ja esta no cache pago semeado (a nativa 1,2, o padrao novo do perfil, seria outra chave e pagaria de novo).
  const config = configPadrao({ ...s.vozPadrao, velocidadeNativa: 1 })
  if (!config || config.fonte !== 'elevenlabs') throw new Error('A voz padrao nao e do ElevenLabs.')
  console.log(`voz: ${config.voiceId} / ${config.modelId}`)
  const r = lerRascunhoDoDisco(ID)
  const narrar = textoParaNarrar(roteiroAtual(r)!)
  console.log(`roteiro v${r.atual} aprovado=${r.aprovado}: ${narrar.frases.length} frases, ${narrar.texto.length} caracteres`)

  // ------------------------------------------------ 1. take inteiro
  console.log('\n1. gerarVoz (roteiro inteiro, UM pedido)')
  const e1 = await estimarVoz(ID, { tipo: 'tudo', config })
  console.log(`  estimativa: ${e1.caracteres} caracteres, a cobrar ${e1.aCobrar}, restam ${e1.restam}, plano ${e1.plano}, aviso ${e1.aviso}`)
  conferirTeto(e1.pagos, 'take inteiro')
  const a1 = await caracteresUsados()
  const g1 = await gerarVoz(ID, { config, pedidoId: pid(), confirmado: e1.aCobrar }, progresso)
  const d1 = await caracteresUsados()
  registrar('v-voz-real', `take inteiro S4-37 (${e1.pagos} car. pagos de ${e1.caracteres}; cobrados ${g1.cobrados}; history ${a1?.historico} -> ${d1?.historico})`, a1?.usados ?? null, d1?.usados ?? null)
  const t1 = g1.take
  const meta1 = [...lerOuvidos(ID)].map((k) => lerDoCache(k)?.meta).find((m) => m && m.caracteres === e1.caracteres)
  console.log(`  take ${t1.id}: origem ${t1.origemDoAlinhamento}, formato ${t1.chamadas[0]?.formato}, request-id ${t1.chamadas[0]?.requestId ? 'veio' : 'nao veio'}, character-cost ${meta1?.custo}`)
  console.log(`  alignment veio: ${meta1?.alignment ? 'sim' : 'nao'} (${meta1?.alignment ? (meta1.alignment.characters.join('') === narrar.texto ? 'igual ao texto' : 'DIFERENTE do texto') : '-'}); normalized_alignment veio: ${meta1?.normalized_alignment ? 'sim' : 'nao'} (${meta1?.normalized_alignment ? (meta1.normalized_alignment.characters.join('') === narrar.texto ? 'igual ao texto' : 'diferente do texto') : '-'})`)
  if (meta1?.normalized_alignment && meta1.normalized_alignment.characters.join('') !== narrar.texto) {
    const n = meta1.normalized_alignment.characters.join('')
    let i = 0
    while (i < n.length && n[i] === narrar.texto[i]) i++
    console.log(`  normalizado difere a partir de: "${narrar.texto.slice(Math.max(0, i - 15), i + 25).replace(/\n/g, '\\n')}" vs "${n.slice(Math.max(0, i - 15), i + 25).replace(/\n/g, '\\n')}"`)
  }
  console.log(`  bruto ${t1.bruto.duracao.toFixed(2)} s -> narracao ${t1.duracao.toFixed(2)} s; ${t1.palavras.length} palavras; conferirTake ${conferirTake(t1).length === 0 ? 'ok' : conferirTake(t1)[0]}; avisos ${JSON.stringify(t1.avisos)}`)
  console.log(`  pos: ${picoNosCortes(t1)}`)
  console.log(`  provedor x wav2vec2 no bruto:    ${await concordancia(arquivoDaVoz(ID, t1.bruto.arquivo), t1.bruto)}`)
  console.log(`  remapeado x wav2vec2 na narracao: ${await concordancia(arquivoDaVoz(ID, t1.arquivo), t1)}`)
  guardar('eleven-t1-take-inteiro', t1)

  // ------------------------------------------------ 2. regravar f03
  console.log('\n2. regravarFrases(f03) com previous_text/next_text')
  const e2 = await estimarVoz(ID, { tipo: 'frases', fraseIds: ['f03'] })
  console.log(`  estimativa: ${e2.caracteres} caracteres, a cobrar ${e2.aCobrar}, frases ${e2.fraseIds.join(',')}`)
  if (e2.aCobrar > 200) throw new Error('Custo da frase fora do esperado.')
  conferirTeto(e2.pagos, 'regravar f03')
  const a2 = await caracteresUsados()
  const g2 = await regravarFrases(ID, { fraseIds: ['f03'], pedidoId: pid(), confirmado: e2.aCobrar }, progresso)
  const d2 = await caracteresUsados()
  registrar('v-voz-real', `regravar f03 (${e2.pagos} car. pagos de ${e2.caracteres} + previous/next_text; cobrados ${g2.cobrados}; history ${a2?.historico} -> ${d2?.historico})`, a2?.usados ?? null, d2?.usados ?? null)
  const t2 = g2.take
  const tr1 = t1.bruto.trechos.find((t) => t.fraseId === 'f03')!
  const tr2 = t2.bruto.trechos.find((t) => t.fraseId === 'f03')!
  console.log(`  take ${t2.id} (de ${t2.derivadoDe}): f03 ${tr1.duracao.toFixed(3)} s -> ${tr2.duracao.toFixed(3)} s; origem ${t2.origemDoAlinhamento}; conferirTake ${conferirTake(t2).length === 0 ? 'ok' : conferirTake(t2)[0]}; avisos ${JSON.stringify(t2.avisos)}`)
  const delta = tr2.duracao - tr1.duracao
  const iF04 = t1.bruto.palavras.findIndex((p) => p.fraseId === 'f04')
  console.log(`  primeira palavra de f04: ${t1.bruto.palavras[iF04]!.start.toFixed(4)} -> ${t2.bruto.palavras[iF04]!.start.toFixed(4)} (delta ${delta.toFixed(4)}, erro ${Math.abs(t2.bruto.palavras[iF04]!.start - t1.bruto.palavras[iF04]!.start - delta).toExponential(1)})`)
  console.log(`  remapeado x wav2vec2 na narracao: ${await concordancia(arquivoDaVoz(ID, t2.arquivo), t2)}`)
  guardar('eleven-t2-regravou-f03', t2)

  // ------------------------------------------------ 3. importado
  console.log('\n3. importarAudio (voz do Windows como "audio do Levi", sem credito)')
  const ps = join(BASE, 'falar.ps1')
  writeFileSync(
    ps,
    [
      'param([string]$entrada, [string]$saida)',
      'Add-Type -AssemblyName System.Speech',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      "$s.SelectVoice('Microsoft Maria Desktop')",
      '$s.SetOutputToWaveFile($saida)',
      '$texto = [System.IO.File]::ReadAllText($entrada, [System.Text.Encoding]::UTF8)',
      '$s.Speak($texto)',
      '$s.Dispose()',
    ].join('\r\n'),
  )
  const txt = join(BASE, 'roteiro.txt')
  writeFileSync(txt, narrar.frases.map((f) => f.texto).join('\n\n'), 'utf8')
  const wavLevi = join(BASE, 'narracao-gravada.wav')
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps, '-entrada', txt, '-saida', wavLevi], { windowsHide: true })
  const g3 = await importarAudio(ID, { caminho: wavLevi, velocidade: 1, cortarPausas: true, pedidoId: pid() }, progresso)
  const t3 = g3.take
  console.log(`  take ${t3.id}: origem ${t3.origemDoAlinhamento}, score ${t3.qualidade?.score?.toFixed(2)}, ancoradas ${t3.qualidade?.ancoradas}/${t3.qualidade?.total}; ${t3.bruto.duracao.toFixed(2)} s -> ${t3.duracao.toFixed(2)} s; conferirTake ${conferirTake(t3).length === 0 ? 'ok' : conferirTake(t3)[0]}; avisos ${JSON.stringify(t3.avisos)}`)
  console.log(`  pos: ${picoNosCortes(t3)}`)
  console.log(`  remapeado x wav2vec2 na narracao: ${await concordancia(arquivoDaVoz(ID, t3.arquivo), t3)}`)
  guardar('importado-t3-voz-do-windows', t3)

  const fim = await caracteresUsados()
  console.log(`\ncreditos no fim: ${fim?.usados} de ${fim?.limite} (${fim?.plano})`)
  // O recaps da copia (rascunho com os takes + cache pago) numa pasta NOVA: a de antes (com o cache pago) nunca e apagada.
  const recaps = join(SAIDA, '..', `real-recaps-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  cpSync(join(USER, 'recaps'), recaps, { recursive: true })
  console.log(`recaps da copia em ${recaps}`)
}

app
  .whenReady()
  .then(rodar)
  .then(
    () => 0,
    (err: unknown) => {
      console.log('ERRO', err instanceof Error ? err.message : String(err))
      return 1
    },
  )
  .then((codigo) => {
    // A copia do settings (chave cifrada) nao fica para tras.
    for (const f of ['settings.json', 'Local State']) if (existsSync(join(USER, f))) rmSync(join(USER, f), { force: true })
    app.exit(codigo)
  })
