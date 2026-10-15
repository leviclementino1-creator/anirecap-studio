/**
 * Chaves de voz: o "Importar do AniRecap" com a cifra DE VERDADE (safeStorage)
 * e o "Testar" do ElevenLabs/Fish com o fetch trocado por um falso.
 *
 * O config do AniRecap aqui e FALSO, numa pasta temporaria: o teste nunca le
 * os config.json de verdade (a lista de caminhos e passada a mao). A chave
 * nunca e impressa: as conferencias que envolvem chave comparam booleano.
 *
 * Precisa do Electron pelo mesmo motivo do v-cofre.ts. Rodar da raiz:
 *   npx esbuild scripts/teste/v-voz.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json --outfile=out/teste/v-voz.cjs
 *   npx electron out/teste/v-voz.cjs
 *
 * Com `--real` no fim, confere de verdade (GET, sem gastar caractere) a chave
 * do ElevenLabs do AniRecap instalado: imprime so plano, contagem e se a voz
 * importada esta na conta.
 */
import { app } from 'electron'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  configureSettings,
  decifrar,
  getSettings,
  getSettingsForRenderer,
  saveSettings,
} from '../../electron/services/settings'
import {
  caminhosDoAniRecap,
  importarDoAniRecap,
  procurarNoAniRecap,
  testarEleven,
  testarFish,
} from '../../electron/services/voz-chaves'

let falhas = 0
function conferir(nome: string, obtido: unknown, esperado: unknown): void {
  const a = JSON.stringify(obtido)
  const b = JSON.stringify(esperado)
  if (a === b) {
    console.log(`  ok   ${nome}`)
  } else {
    falhas += 1
    console.log(`  FALHA ${nome}\n        obtido:   ${a}\n        esperado: ${b}`)
  }
}

async function lancou(fn: () => unknown): Promise<string> {
  try {
    await fn()
    return '(nao lancou)'
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

// Falsas de proposito, com cara de chave. So aparecem aqui dentro.
const CHAVE = 'sk_falsa_voz_importar_000000000000000000000000abcd'
const CHAVE_FISH = 'falsa-fish-000000000000000000ef01'
const VOZ = 'VozFalsa0000000000AA'
const MODELO = 'eleven_multilingual_v2'

const pasta = join(tmpdir(), 'anirecap-v-voz')
rmSync(pasta, { recursive: true, force: true })
mkdirSync(pasta, { recursive: true })
app.setPath('userData', join(pasta, 'userData'))

const real = process.argv.includes('--real')

// ------------------------------------------------------------- fetch falso
type Rota = (url: URL, cabecalhos: Record<string, string>) => { status: number; corpo: unknown } | 'rede'
let rota: Rota = () => ({ status: 500, corpo: null })
const pedidos: { url: string; cabecalhos: Record<string, string> }[] = []
const fetchDeVerdade = globalThis.fetch

function trocarFetch(): void {
  globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(entrada))
    const cabecalhos = { ...((init?.headers as Record<string, string> | undefined) ?? {}) }
    pedidos.push({ url: url.toString(), cabecalhos })
    const r = rota(url, cabecalhos)
    if (r === 'rede') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
    return new Response(r.corpo === null ? '' : JSON.stringify(r.corpo), { status: r.status })
  }) as typeof fetch
}

const VOZES_ELEVEN = {
  voices: [
    { voice_id: 'Pronta00000000000001', name: 'Zeca', category: 'premade', labels: { gender: 'male', accent: 'american' }, preview_url: 'https://x/p1.mp3' },
    { voice_id: VOZ, name: 'Narrador', category: 'cloned', labels: {}, verified_languages: [{ language: 'pt' }], preview_url: 'https://x/p2.mp3' },
    { voice_id: 'barra/na/url', name: 'Invalida', category: 'premade' },
  ],
}

async function testesDoFetch(): Promise<void> {
  trocarFetch()

  console.log('ElevenLabs: chave boa')
  rota = (url) =>
    url.pathname === '/v1/user'
      ? { status: 200, corpo: { subscription: { tier: 'creator', character_count: 1234, character_limit: 100000 } } }
      : { status: 200, corpo: VOZES_ELEVEN }
  pedidos.length = 0
  const bom = await testarEleven(CHAVE)
  conferir('plano e caracteres', [bom.plano, bom.usados, bom.limite, bom.aviso], ['creator', 1234, 100000, null])
  conferir('vozes: a da conta primeiro, id invalido fora', bom.vozes.map((v) => [v.id, v.nome, v.detalhe]), [
    [VOZ, 'Narrador', 'pt'],
    ['Pronta00000000000001', 'Zeca', 'male, american'],
  ])
  conferir('so GET em /v1/user e /v1/voices', pedidos.map((p) => new URL(p.url).pathname), ['/v1/user', '/v1/voices'])
  conferir('chave no cabecalho xi-api-key, nunca na URL', [
    pedidos.every((p) => p.cabecalhos['xi-api-key'] === CHAVE),
    pedidos.some((p) => p.url.includes(CHAVE)),
  ], [true, false])

  console.log('ElevenLabs: erros')
  rota = (url) =>
    url.pathname === '/v1/user'
      ? { status: 200, corpo: { subscription: { tier: 'free', character_count: 10000, character_limit: 10000, next_character_count_reset_unix: 1762128000 } } }
      : { status: 200, corpo: { voices: [] } }
  const semCaracteres = await testarEleven(CHAVE)
  conferir('caracteres acabaram vira aviso "Sem creditos"', semCaracteres.aviso?.startsWith('Sem creditos no ElevenLabs'), true)

  rota = () => ({ status: 401, corpo: { detail: { status: 'invalid_api_key', message: 'Invalid API key' } } })
  const invalida = await lancou(() => testarEleven(CHAVE))
  conferir('401 invalid_api_key', invalida.startsWith('Chave invalida'), true)

  rota = () => ({ status: 401, corpo: { detail: { status: 'quota_exceeded', message: 'quota' } } })
  conferir('401 quota_exceeded', (await lancou(() => testarEleven(CHAVE))).startsWith('Sem creditos no ElevenLabs'), true)

  rota = (url) =>
    url.pathname === '/v1/user'
      ? { status: 401, corpo: { detail: { status: 'missing_permissions', message: 'needs user_read' } } }
      : { status: 200, corpo: VOZES_ELEVEN }
  const restrita = await testarEleven(CHAVE)
  conferir('chave sem permissao de ler o plano: vale, com aviso', [restrita.plano, restrita.vozes.length, restrita.aviso !== null], [
    null,
    2,
    true,
  ])

  rota = () => 'rede'
  conferir('sem internet', (await lancou(() => testarEleven(CHAVE))).startsWith('Sem internet'), true)

  rota = () => ({ status: 400, corpo: { detail: { status: 'bad', message: `eco da chave ${CHAVE} aqui` } } })
  const eco = await lancou(() => testarEleven(CHAVE))
  conferir('chave ecoada pelo provedor nao chega na nota', [eco.includes(CHAVE), eco.includes('erro 400')], [false, true])

  console.log('Fish Audio')
  rota = (url) =>
    url.pathname === '/wallet/self/api-credit'
      ? { status: 200, corpo: { _id: 'x', user_id: 'u', credit: '4.2000', cumulative_top_up: '10' } }
      : {
          status: 200,
          corpo: {
            total: 3,
            items: [
              { _id: 'aaaaaaaabbbbbbbbccccccccdddddddd', type: 'tts', state: 'trained', title: 'Minha voz', languages: ['pt', 'en'], samples: [{ audio: 'https://x/a.mp3' }] },
              { _id: 'eeeeeeeeffffffff0000000011111111', type: 'tts', state: 'training', title: 'Treinando' },
              { _id: '22222222333333334444444455555555', type: 'svc', state: 'trained', title: 'Conversao' },
            ],
          },
        }
  pedidos.length = 0
  const fish = await testarFish(CHAVE_FISH)
  conferir('saldo e so a voz tts treinada', [fish.saldo, fish.vozes.map((v) => [v.nome, v.detalhe, v.previewUrl]), fish.aviso], [
    '4.2000',
    [['Minha voz', 'pt, en', 'https://x/a.mp3']],
    null,
  ])
  const urlDosModelos = new URL(pedidos[1]?.url ?? 'http://x')
  conferir('lista so as proprias (self=true)', [urlDosModelos.pathname, urlDosModelos.searchParams.get('self')], ['/model', 'true'])
  conferir('Bearer no cabecalho', pedidos.every((p) => p.cabecalhos['Authorization'] === `Bearer ${CHAVE_FISH}`), true)

  rota = (url) =>
    url.pathname === '/wallet/self/api-credit'
      ? { status: 200, corpo: { credit: '0' } }
      : { status: 200, corpo: { total: 0, items: [] } }
  const zerado = await testarFish(CHAVE_FISH)
  conferir('saldo zerado e sem voz: os dois avisos', [zerado.aviso?.startsWith('Sem creditos no Fish Audio'), zerado.aviso?.includes('voz propria')], [true, true])

  rota = () => ({ status: 401, corpo: { status: 401, message: 'Unauthorized' } })
  conferir('401 do Fish', (await lancou(() => testarFish(CHAVE_FISH))).startsWith('Chave invalida: o Fish Audio'), true)
  rota = () => ({ status: 402, corpo: { status: 402, message: 'No payment' } })
  conferir('402 do Fish', (await lancou(() => testarFish(CHAVE_FISH))).startsWith('Sem creditos no Fish Audio'), true)
  rota = () => ({ status: 503, corpo: null })
  conferir('503 do Fish', (await lancou(() => testarFish(CHAVE_FISH))).includes('fora do ar'), true)

  globalThis.fetch = fetchDeVerdade
}

// --------------------------------------------------------- importar do AniRecap
function testesDoImportar(): void {
  const dados = join(pasta, 'userData')
  const arquivoSettings = join(dados, 'settings.json')
  configureSettings(dados)

  // Tres "instalacoes": a primeira sem nada, a segunda com BOM (PowerShell), a terceira nao deve ser lida.
  const vazio = join(pasta, 'a', 'config.json')
  const certo = join(pasta, 'b', 'config.json')
  const depois = join(pasta, 'c', 'config.json')
  for (const p of [vazio, certo, depois]) mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(vazio, JSON.stringify({ elevenlabs_api_key: '', elevenlabs_voice_id: '' }), 'utf8')
  writeFileSync(
    certo,
    '\uFEFF' + JSON.stringify({ navy_api_key: 'outra', elevenlabs_api_key: ` ${CHAVE} `, elevenlabs_voice_id: VOZ, elevenlabs_model_id: MODELO }),
    'utf8',
  )
  writeFileSync(depois, JSON.stringify({ elevenlabs_api_key: 'sk_errada_000000000000', elevenlabs_voice_id: 'Outra' }), 'utf8')
  const antes = { texto: readFileSync(certo, 'utf8'), mtime: statSync(certo).mtimeMs }
  const caminhos = [join(pasta, 'nao-existe', 'config.json'), vazio, certo, depois]

  console.log('procurar')
  const achado = procurarNoAniRecap(caminhos)
  conferir('acha o primeiro com chave, na ordem', achado?.arquivo === certo, true)
  conferir('so a dica, o id e o modelo', [achado?.chaveHint, achado?.voiceId, achado?.modelId, achado?.jaImportado], [
    '\u2022\u2022\u2022\u2022abcd',
    VOZ,
    MODELO,
    false,
  ])
  conferir('a chave nao vai no que a tela recebe', JSON.stringify(achado).includes(CHAVE.slice(0, 20)), false)
  conferir('nada achado = null', procurarNoAniRecap([vazio]), null)

  console.log('importar')
  conferir('caminho fora da lista e recusado', (() => {
    try {
      importarDoAniRecap(depois, [certo])
      return 'gravou'
    } catch (err) {
      return (err as Error).message.startsWith('Esse arquivo nao e um config')
    }
  })(), true)
  conferir('e nao gravou nada', getSettings().elevenlabsApiKey === '', true)

  const r = importarDoAniRecap(certo.replace(/\\/g, '/').toUpperCase(), caminhos)
  conferir('importa (caminho com outra caixa e barra)', r, { chave: true, voz: true })
  const texto = readFileSync(arquivoSettings, 'utf8')
  const disco = JSON.parse(texto) as Record<string, unknown>
  conferir('nada em texto puro no settings.json', [texto.includes(CHAVE), 'elevenlabsApiKey' in disco], [false, false])
  conferir('cifrada no campo *Enc', typeof disco['elevenlabsApiKeyEnc'], 'string')
  conferir('o *Enc abre na chave certa', decifrar(String(disco['elevenlabsApiKeyEnc'])) === CHAVE, true)
  // A velocidade nativa sai no padrao do perfil (1,2, 15/10): importar so a voz nao a escolhe.
  conferir('voz padrao veio junto', disco['vozPadrao'], { provedor: 'elevenlabs', voiceId: VOZ, modelId: MODELO, velocidadeNativa: 1.2 })

  configureSettings(dados) // sem cache: le do disco
  conferir('ida e volta', getSettings().elevenlabsApiKey === CHAVE, true)
  const publico = getSettingsForRenderer()
  conferir('o renderer nao ve a chave', JSON.stringify(publico).includes(CHAVE.slice(0, 20)), false)
  conferir('so a dica', [publico.hasElevenKey, publico.elevenKeyHint, publico.hasFishKey, publico.fishKeyHint], [
    true,
    '\u2022\u2022\u2022\u2022abcd',
    false,
    '',
  ])
  conferir('procurar de novo: ja importado', procurarNoAniRecap(caminhos)?.jaImportado, true)
  conferir('o config do AniRecap ficou intacto', [readFileSync(certo, 'utf8') === antes.texto, statSync(certo).mtimeMs === antes.mtime], [
    true,
    true,
  ])

  console.log('settings: chave do Fish e voz padrao')
  saveSettings({ fishApiKey: CHAVE_FISH })
  const comFish = readFileSync(arquivoSettings, 'utf8')
  conferir('fish cifrada tambem', [comFish.includes(CHAVE_FISH), typeof JSON.parse(comFish)['fishApiKeyEnc']], [false, 'string'])
  saveSettings({ vozPadrao: { provedor: 'fish', voiceId: 'barra/x', modelId: 'a b' } as never })
  conferir('voz com id ou modelo invalido e limpa', getSettings().vozPadrao, { provedor: 'fish', voiceId: '', modelId: '', velocidadeNativa: 1.2 })
  saveSettings({ vozPadrao: { provedor: 'outro', voiceId: VOZ, modelId: MODELO } as never })
  conferir('provedor desconhecido vira nenhum', getSettings().vozPadrao, { provedor: '', voiceId: '', modelId: '', velocidadeNativa: 1.2 })
  saveSettings({ vozPadrao: { provedor: 'elevenlabs', voiceId: VOZ, modelId: MODELO, velocidadeNativa: 1 } })
  saveSettings({ vozPadrao: { provedor: 'elevenlabs', voiceId: VOZ, modelId: '' } })
  conferir('trocar so a voz mantem a velocidade nativa escolhida', getSettings().vozPadrao.velocidadeNativa, 1)
  saveSettings({ vozPadrao: { provedor: 'elevenlabs', voiceId: VOZ, modelId: '', velocidadeNativa: 1.5 } })
  conferir('velocidade nativa fora da faixa volta para dentro (1,2)', getSettings().vozPadrao.velocidadeNativa, 1.2)

  console.log('migracao: chave de voz aberta no settings antigo')
  writeFileSync(arquivoSettings, JSON.stringify({ elevenlabsApiKey: CHAVE, whisperModel: 'base' }), 'utf8')
  configureSettings(dados)
  conferir('abre', getSettings().elevenlabsApiKey === CHAVE, true)
  const migrado = readFileSync(arquivoSettings, 'utf8')
  conferir('e ja regrava cifrada', [migrado.includes(CHAVE), typeof JSON.parse(migrado)['elevenlabsApiKeyEnc']], [false, 'string'])

  console.log('caminhos conhecidos')
  const local = join(pasta, 'local')
  mkdirSync(join(local, 'Programs', 'AniRecap'), { recursive: true })
  conferir('sem AniRecap.exe em Programs, fica de fora', caminhosDoAniRecap({ LOCALAPPDATA: local }).length, 3)
  writeFileSync(join(local, 'Programs', 'AniRecap', 'AniRecap.exe'), '', 'utf8')
  const lista = caminhosDoAniRecap({ LOCALAPPDATA: local })
  conferir('com o exe, entra por ultimo', [lista.length, lista[0], lista[3] === join(local, 'Programs', 'AniRecap', 'config.json')], [
    4,
    'G:/App Resumo/config.json',
    true,
  ])

  rmSync(arquivoSettings, { force: true })
}

/** Opcional: a chave do AniRecap de verdade, num settings temporario. So GET. */
async function testeReal(): Promise<void> {
  console.log('\nde verdade (--real): AniRecap instalado -> ElevenLabs')
  const dados = join(pasta, 'real')
  const arquivoSettings = join(dados, 'settings.json')
  configureSettings(dados)
  try {
    const achado = procurarNoAniRecap()
    if (!achado) {
      console.log('  nenhum config do AniRecap com chave')
      return
    }
    console.log(`  achado em ${achado.arquivo}: ${achado.chaveHint} · voz ${achado.voiceId || '(nenhuma)'}`)
    importarDoAniRecap(achado.arquivo)
    const teste = await testarEleven(getSettings().elevenlabsApiKey)
    console.log(`  plano ${teste.plano ?? '?'} · ${teste.usados ?? '?'} de ${teste.limite ?? '?'} caracteres · ${teste.vozes.length} vozes`)
    console.log(`  a voz importada esta na conta: ${teste.vozes.some((v) => v.id === achado.voiceId)}`)
    if (teste.aviso) console.log(`  aviso: ${teste.aviso}`)
  } catch (err) {
    console.log(`  erro: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    rmSync(arquivoSettings, { force: true })
  }
}

void app.whenReady().then(async () => {
  try {
    await testesDoFetch()
    testesDoImportar()
    if (real) await testeReal()
  } catch (err) {
    falhas += 1
    console.log(`  QUEBROU: ${err instanceof Error ? err.message : String(err)}`)
  }
  console.log(falhas === 0 ? '\ntudo certo' : `\n${falhas} falha(s)`)
  app.exit(falhas === 0 ? 0 : 1)
})
