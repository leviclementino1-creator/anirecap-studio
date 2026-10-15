/**
 * A TELA DE BOAS-VINDAS sem app e sem navegador (decisao 2 da v0.1.0):
 *
 * - settings.ts: o "Nao perguntar mais" (naoPerguntarChave) nasce false, grava,
 *   volta do disco, sobrevive a outro save e lixo no arquivo vale false;
 * - @/store/boas-vindas: abre so sem chave de IA (nem Gemini nem Anthropic),
 *   sem o "Nao perguntar mais" e na tela inicial; decide uma vez por sessao;
 *   projeto aberto enquanto as settings chegavam nao deixa abrir; "Depois"
 *   nao grava nada; "Nao perguntar mais" grava; o "Instalar agora" abre a tela
 *   do motor e so comeca quando ela nao tem nada a dizer antes;
 * - a tela: o cartao com cada botao e o texto curto certo, em ASCII, nos
 *   estados da chave, da voz e do motor; o AjustesDeVoz ainda comeca pela
 *   linha que a boas-vindas esconde; as Configuracoes continuam com o campo
 *   do Gemini (agora o ChaveDoGemini compartilhado).
 *
 * Nao substitui o print do app. Rodar da raiz:
 *   npx esbuild scripts/teste/v-boas-vindas.tsx --bundle --platform=node --packages=external --jsx=automatic --loader:.png=dataurl --tsconfig=tsconfig.web.json --define:import.meta.env.DEV=false | node
 */
import { chamadas, quantas, respostas, semChave, ultima } from './v-boas-vindas-janela'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PublicSettings } from '../../shared/channels'
import type { EstadoDoMotorRuntime, FaseDoMotorRuntime } from '../../shared/motor-runtime'
import { configureSettings, getSettings, getSettingsForRenderer, saveSettings, type Cofre } from '../../electron/services/settings'
import { instalarMotorAgora, motorPronto, pedeBoasVindas, useBoasVindas } from '../../src/store/boas-vindas'
import { useMotorRuntime } from '../../src/store/motor-runtime'
import { useProject } from '../../src/store/project'
import { CartaoDeBoasVindas } from '../../src/components/BoasVindas'
import { AjustesDeVoz } from '../../src/components/gerar/AjustesDeVoz'
import { Settings } from '../../src/components/Settings'

let falhas = 0
function confere(ok: boolean, mensagem: string): void {
  if (ok) console.log(`  ok  ${mensagem}`)
  else {
    falhas += 1
    console.log(`  FALHOU  ${mensagem}`)
  }
}
const texto = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const ascii = (s: string): boolean => [...s].every((c) => c.charCodeAt(0) < 128)

/** O zustand desenha o estado INICIAL no servidor: antes, ele recebe o de agora (ver v-edicao-rapida-tela). */
function desenhar(el: React.ReactElement): string {
  for (const loja of [useProject, useBoasVindas, useMotorRuntime] as unknown as { getState: () => object; getInitialState: () => object }[]) {
    Object.assign(loja.getInitialState(), loja.getState())
  }
  return renderToStaticMarkup(el)
}

function motor(fase: FaseDoMotorRuntime, extra: Partial<EstadoDoMotorRuntime> = {}): EstadoDoMotorRuntime {
  return {
    fase,
    pasta: 'C:\\x\\motor-runtime',
    pastaPadrao: true,
    variante: null,
    varianteSugerida: 'cu128',
    gpu: { nome: 'NVIDIA GeForce RTX 5080', driver: '616.92', driverAntigo: false, fonte: 'nvidia-smi' },
    bytesParaBaixar: fase === 'pronto' || fase === 'dev' ? 0 : 2.96e9,
    bytesNoDisco: 5.2e9,
    livreNoDisco: 1.6e12,
    precisaDeLivre: fase === 'pronto' || fase === 'dev' ? 0 : 9.4e9,
    andamento: null,
    erro: null,
    mudancas: null,
    aviso: null,
    log: null,
    ...extra,
  }
}

const reiniciar = (): void => useBoasVindas.setState({ momento: 'esperando', settings: null })
const com = (patch: Partial<PublicSettings>): PublicSettings => ({ ...semChave(), ...patch })

async function main(): Promise<void> {
  console.log('\n== settings.ts: naoPerguntarChave')
  {
    const pasta = mkdtempSync(join(tmpdir(), 'boas-vindas-'))
    const cofre: Cofre = {
      isEncryptionAvailable: () => true,
      encryptString: (t) => Buffer.from(`C:${t}`, 'utf8'),
      decryptString: (b) => b.toString('utf8').slice(2),
    }
    const arquivo = join(pasta, 'settings.json')
    try {
      configureSettings(pasta, cofre)
      confere(getSettings().naoPerguntarChave === false, 'sem arquivo: false (o usuario novo ve a tela)')
      confere(getSettingsForRenderer().naoPerguntarChave === false, 'a interface recebe o campo')
      saveSettings({ naoPerguntarChave: true })
      confere(JSON.parse(readFileSync(arquivo, 'utf8')).naoPerguntarChave === true, 'grava no settings.json')
      configureSettings(pasta, cofre)
      confere(getSettings().naoPerguntarChave === true && getSettingsForRenderer().naoPerguntarChave === true, 'volta do disco')
      saveSettings({ whisperModel: 'base' })
      confere(getSettings().naoPerguntarChave === true, 'outro save nao apaga')
      writeFileSync(arquivo, JSON.stringify({ naoPerguntarChave: 'sim', whisperModel: 'base' }), 'utf8')
      configureSettings(pasta, cofre)
      confere(getSettings().naoPerguntarChave === false, 'lixo no arquivo vale false')
      writeFileSync(arquivo, JSON.stringify({ whisperModel: 'medium', iaProvedor: 'gemini' }), 'utf8')
      configureSettings(pasta, cofre)
      confere(getSettings().naoPerguntarChave === false && getSettings().whisperModel === 'medium', 'settings antigo, sem o campo: false e o resto fica')
    } finally {
      rmSync(pasta, { recursive: true, force: true })
    }
  }

  console.log('\n== Quem ve a tela')
  confere(pedeBoasVindas(semChave()), 'sem chave nenhuma: ve')
  confere(!pedeBoasVindas(com({ hasGeminiKey: true })), 'com a do Gemini: nao ve')
  confere(!pedeBoasVindas(com({ hasApiKey: true })), 'so com a da Anthropic (o app usa ela): nao ve')
  confere(!pedeBoasVindas(com({ naoPerguntarChave: true })), '"Nao perguntar mais": nao ve')
  confere(pedeBoasVindas(com({ hasElevenKey: true, hasFishKey: true })), 'so chave de voz nao conta: ve')

  console.log('\n== A decisao, uma vez por sessao')
  reiniciar()
  respostas.settings = semChave()
  await useBoasVindas.getState().decidir(() => true)
  confere(useBoasVindas.getState().momento === 'aberta', 'sem chave, na tela inicial: abre')
  confere(useBoasVindas.getState().settings?.hasGeminiKey === false, 'e guarda as settings para a tela')

  reiniciar()
  respostas.settings = com({ hasGeminiKey: true })
  await useBoasVindas.getState().decidir(() => true)
  confere(useBoasVindas.getState().momento === 'encerrada', 'com chave: nao abre')
  respostas.settings = semChave()
  await useBoasVindas.getState().decidir(() => true)
  confere(useBoasVindas.getState().momento === 'encerrada', 'decidida, nao decide de novo na sessao')

  reiniciar()
  await useBoasVindas.getState().decidir(() => false)
  confere(useBoasVindas.getState().momento === 'encerrada', 'fora da tela inicial (projeto ou assistente aberto): nao abre')

  reiniciar()
  let soltar: () => void = () => {}
  respostas.segurarSettings = new Promise<void>((r) => (soltar = r))
  const decisao = useBoasVindas.getState().decidir(() => true)
  useBoasVindas.getState().saiuDaTelaInicial()
  soltar()
  await decisao
  respostas.segurarSettings = null
  confere(useBoasVindas.getState().momento === 'encerrada', 'projeto abriu enquanto as settings chegavam: nao abre')

  reiniciar()
  await useBoasVindas.getState().decidir(() => true)
  useBoasVindas.getState().saiuDaTelaInicial()
  confere(useBoasVindas.getState().momento === 'encerrada', 'aberta e saiu da tela inicial: fecha')

  reiniciar()
  await useBoasVindas.getState().decidir(() => true)
  const antes = quantas('saveSettings')
  useBoasVindas.getState().depois()
  confere(useBoasVindas.getState().momento === 'encerrada' && quantas('saveSettings') === antes, '"Depois": fecha e nao grava nada (volta na proxima abertura)')

  reiniciar()
  await useBoasVindas.getState().decidir(() => true)
  await useBoasVindas.getState().naoPerguntarMais()
  confere(useBoasVindas.getState().momento === 'encerrada', '"Nao perguntar mais": fecha')
  confere(JSON.stringify(ultima('saveSettings')) === JSON.stringify([{ naoPerguntarChave: true }]), 'e grava so naoPerguntarChave: true')
  confere(!pedeBoasVindas(respostas.settings), 'na proxima abertura, nao ve')
  respostas.settings = semChave()

  console.log('\n== Instalar agora (motor)')
  const casos: { nome: string; estado: EstadoDoMotorRuntime; instala: boolean }[] = [
    { nome: 'ausente, placa lida, disco ok', estado: motor('ausente'), instala: true },
    { nome: 'incompleto (Continuar)', estado: motor('incompleto', { andamento: { etapa: 'baixar-torch', fracao: 0.4, mensagem: 'x' } }), instala: true },
    { nome: 'desatualizado (Atualizar)', estado: motor('desatualizado'), instala: true },
    { nome: 'placa ainda sendo lida', estado: motor('ausente', { gpu: null }), instala: false },
    { nome: 'falta disco', estado: motor('ausente', { livreNoDisco: 2e9 }), instala: false },
    { nome: 'parou na conferencia (Continuar ou Recomecar)', estado: motor('incompleto', { erro: { tipo: 'conferencia', mensagem: 'x' } }), instala: false },
    { nome: 'instalando', estado: motor('instalando'), instala: false },
  ]
  for (const caso of casos) {
    useMotorRuntime.setState({ estado: caso.estado, aberta: false })
    respostas.motor = caso.estado
    const n = quantas('instalarMotorRuntime')
    instalarMotorAgora()
    await new Promise((r) => setTimeout(r, 5))
    const instalou = quantas('instalarMotorRuntime') - n
    confere(
      useMotorRuntime.getState().aberta && instalou === (caso.instala ? 1 : 0),
      `${caso.nome}: abre a tela do motor${caso.instala ? ' e ja instala' : ', sem comecar'}`,
    )
  }
  confere(motorPronto(motor('pronto')) && motorPronto(motor('dev')) && !motorPronto(motor('ausente')) && !motorPronto(null), 'pronto e dev contam como prontos')

  console.log('\n== A tela')
  useMotorRuntime.setState({ estado: motor('ausente'), aberta: false })
  useBoasVindas.setState({ momento: 'aberta', settings: semChave() })
  let html = desenhar(<CartaoDeBoasVindas />)
  let t = texto(html)
  console.log(`  ${t.trim()}`)
  confere(
    ['Bem-vindo ao AniRecap Studio', 'Chave do Gemini', 'Pegar chave gratis', 'Salvar', 'Testar', 'Narracao', 'Configurar', 'Motor de personagens', 'Instalar agora', '~3 GB', 'Nao perguntar mais', 'Depois'].every((x) => t.includes(x)),
    'sem chave: Gemini (pegar, salvar, testar), voz, motor, "Nao perguntar mais" e "Depois"',
  )
  confere(!t.includes('Comecar'), 'sem chave, sem "Comecar"')
  confere(html.includes('href="https://aistudio.google.com/apikey"') && html.includes('target="_blank"'), '"Pegar chave gratis" abre o AI Studio no navegador')
  confere(/<input[^>]*autofocus=""/i.test(html) || /<input[^>]*autoFocus/.test(html), 'o foco nasce no campo da chave')
  confere(html.includes('src="data:image/png'), 'o icone do app no topo')
  confere(html.includes('border-accent/40'), 'a chave do Gemini e a destacada (recomendada)')
  confere(ascii(t), 'texto da tela em ASCII')
  const palavras = t.trim().split(' ').length
  confere(palavras < 60, `pouco texto (${palavras} palavras)`)

  useBoasVindas.setState({ settings: com({ hasGeminiKey: true, geminiKeyHint: '\u2022\u2022\u2022\u2022abcd' }) })
  t = texto(desenhar(<CartaoDeBoasVindas />))
  confere(t.includes('Salva') && t.includes('Comecar') && !t.includes('Nao perguntar mais') && !t.includes('Pegar chave gratis'), 'com a chave salva: "Salva", "Comecar" e sem "Nao perguntar mais"')

  useBoasVindas.setState({ settings: com({ hasElevenKey: true, vozPadrao: { ...semChave().vozPadrao, provedor: 'elevenlabs', voiceId: 'v1' } }) })
  t = texto(desenhar(<CartaoDeBoasVindas />))
  confere(t.includes('ElevenLabs') && !t.includes('Chave salva') && !t.includes('importe o audio'), 'voz padrao com a chave dela: o nome do provedor, sem a frase')
  useBoasVindas.setState({ settings: com({ hasFishKey: true }) })
  t = texto(desenhar(<CartaoDeBoasVindas />))
  confere(t.includes('Chave salva'), 'so a chave da voz, sem voz escolhida: "Chave salva"')
  useBoasVindas.setState({ settings: semChave() })

  for (const [fase, esperado, nao] of [
    ['pronto', 'Pronto', 'Instalar agora'],
    ['dev', 'Pronto', 'Instalar agora'],
    ['incompleto', 'Continuar', 'Instalar agora'],
    ['desatualizado', 'Atualizar', 'Instalar agora'],
  ] as const) {
    useMotorRuntime.setState({ estado: motor(fase) })
    t = texto(desenhar(<CartaoDeBoasVindas />))
    confere(t.includes(esperado) && !t.includes(nao), `motor ${fase}: "${esperado}"`)
  }
  useMotorRuntime.setState({ estado: motor('pronto') })
  t = texto(desenhar(<CartaoDeBoasVindas />))
  confere(!t.includes('~3 GB') && !t.includes('Corta as cenas'), 'motor pronto: sem tamanho e sem a frase')
  useMotorRuntime.setState({ estado: motor('instalando', { andamento: { etapa: 'baixar-torch', fracao: 0.43, mensagem: 'Baixando torch' } }) })
  t = texto(desenhar(<CartaoDeBoasVindas />))
  confere(t.includes('Instalando 43%'), 'motor instalando: "Instalando 43%"')
  useMotorRuntime.setState({ estado: null })
  t = texto(desenhar(<CartaoDeBoasVindas />))
  confere(!t.includes('Instalar agora') && t.includes('~3 GB'), 'motor ainda sem resposta do main: nada de botao, o tamanho da instalacao cheia')

  console.log('\n== O que a boas-vindas reaproveita')
  html = desenhar(<AjustesDeVoz settings={semChave()} onSettings={() => {}} />)
  confere(/^<div class="my-5 h-px bg-line"><\/div>/.test(html), 'as Configuracoes: o AjustesDeVoz comeca pela linha e pela voz, como antes')
  confere(['Chave do ElevenLabs', 'Chave do Fish Audio'].every((x) => texto(html).includes(x)), 'e traz as duas chaves de voz com Testar')
  // O modo da boas-vindas (revisao C de 15/10): chaves primeiro, voz so com chave, sem as frases.
  html = desenhar(<AjustesDeVoz settings={semChave()} onSettings={() => {}} compacto />)
  t = texto(html)
  confere(!html.includes('h-px bg-line') && t.indexOf('Chave do ElevenLabs') >= 0 && !t.includes('Nenhuma ainda') && !t.includes('Velocidade'), 'compacto sem chave de voz: so as chaves (sem linha, sem Voz/Velocidade)')
  confere(!t.includes('Testar nao gasta') && !t.includes('Teste uma chave'), 'compacto: sem as frases de rodape')
  html = desenhar(<AjustesDeVoz settings={com({ hasElevenKey: true })} onSettings={() => {}} compacto />)
  t = texto(html)
  confere(t.indexOf('Chave do ElevenLabs') < t.indexOf('Nenhuma ainda') && t.includes('Velocidade'), 'compacto com chave de voz: chaves primeiro, depois Voz e Velocidade')
  useBoasVindas.setState({ settings: semChave() })
  t = texto(desenhar(<CartaoDeBoasVindas />))
  confere(!t.includes('Fechar') || (t.match(/Fechar/g) ?? []).length === 0, 'o recolher da voz nao se chama "Fechar" (o X ja e o Fechar)')

  useProject.setState({ settingsOpen: true })
  html = desenhar(<Settings />)
  t = texto(html)
  confere(
    t.includes('Chave do Gemini') && t.includes('Pegar uma chave gratis') && html.includes('aria-label="Chave do Gemini"') && html.includes('placeholder="AIza..."'),
    'Configuracoes: o campo do Gemini (o mesmo ChaveDoGemini) com o link',
  )
  confere((t.match(/Testar/g) ?? []).length >= 3 && t.includes('Modelo do Gemini') && t.includes('Chave da API da Anthropic'), 'Configuracoes: Testar do Gemini e das vozes, modelo e Anthropic no lugar')
  useProject.setState({ settingsOpen: false })

  void chamadas
  console.log(`\n${falhas === 0 ? 'TUDO OK' : `${falhas} FALHA(S)`}`)
  process.exit(falhas === 0 ? 0 : 1)
}

void main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
