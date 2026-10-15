/**
 * FUMACA DE TELA do "Montar sozinho" (src/components/Automount.tsx), sem app e
 * sem navegador: desenha o componente com react-dom/server sobre o store de
 * verdade e a janela falsa do v-montar-guarda-janela.ts, e confere:
 *
 * - um botao "Montar sozinho" com a escolha Recap/Teoria dentro (e nenhum
 *   "Montar recap"/"Montar teoria" sobrando), "Escolher na biblioteca" e o
 *   seletor de anime continuam;
 * - a cronologia vai no title de cada opcao; texto da tela em ASCII;
 * - a escolha lembrada no localStorage (dangai.automount.modo): sem nada ou
 *   com lixo vale Recap; 'theory' acende Teoria; localStorage que explode nao
 *   quebra a tela;
 * - ocupado: o fieldset e a biblioteca ficam desligados;
 * - so aparece com narracao e sem imagem;
 * - o store manda o modo escolhido para o main.
 *
 * Nao substitui o print do app. Nao escreve nada. Rodar da raiz:
 *   npx esbuild scripts/teste/v-automount-tela.tsx --bundle --platform=node --packages=external --jsx=automatic --tsconfig=tsconfig.web.json | node
 */
import { chamadas } from './v-montar-guarda-janela'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AutomountMode, LibraryIndex } from '../../shared/channels'
import { Automount } from '../../src/components/Automount'
import { CHAVE_DO_MODO, gravarModoDoAutomount, lerModoDoAutomount, MODO_PADRAO } from '../../src/components/automount-modo'
import { useProject } from '../../src/store/project'

let falhas = 0
function confere(ok: boolean, mensagem: string): void {
  if (ok) console.log(`  ok  ${mensagem}`)
  else {
    falhas += 1
    console.log(`  FALHOU  ${mensagem}`)
  }
}
const texto = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
const ascii = (s: string): boolean => [...s].every((c) => c.charCodeAt(0) < 128)

// localStorage falso: o node nao tem um, e o teste precisa trocar o que ha nele.
const guardado = new Map<string, string>()
let explodir = false
const armazenamento = {
  getItem: (k: string): string | null => {
    if (explodir) throw new Error('bloqueado')
    return guardado.get(k) ?? null
  },
  setItem: (k: string, v: string): void => {
    if (explodir) throw new Error('bloqueado')
    guardado.set(k, v)
  },
}
Object.defineProperty(globalThis, 'localStorage', { value: armazenamento, configurable: true, writable: true })

/** No servidor o zustand 5 desenha o estado INICIAL: copia o de agora para ele. */
function desenhar(): string {
  const loja = useProject as unknown as { getState: () => object; getInitialState: () => object }
  Object.assign(loja.getInitialState(), loja.getState())
  return renderToStaticMarkup(<Automount />)
}

/** As tags <button ...> de abertura, com os atributos. */
function botoes(html: string): string[] {
  return html.match(/<button[^>]*>/g) ?? []
}
function apertado(html: string, rotulo: string): boolean | null {
  const b = botoes(html).find((t) => t.includes(`aria-label="${rotulo}:`))
  if (!b) return null
  return b.includes('aria-pressed="true"')
}

const biblioteca: LibraryIndex = {
  root: 'C:/cenas',
  clips: [],
  animes: ['Dr. Stone', 'Tensura'],
  characters: [],
  episodes: 2,
  scanned: 0,
}
useProject.setState({
  audio: { path: 'C:/proj/n.wav', fileName: 'n.wav', url: 'x', durationSec: 12, peaks: [] },
  images: [],
  library: biblioteca,
  libraryBusy: null,
  busy: null,
})

console.log('\n== tela com narracao e sem cena (nada lembrado)')
let html = desenhar()
let t = texto(html)
confere(t.includes('Montar sozinho'), 'o botao "Montar sozinho" esta la')
confere(!t.includes('Montar recap') && !t.includes('Montar teoria'), 'os dois botoes antigos sumiram')
confere(t.includes('Recap') && t.includes('Teoria'), 'a escolha Recap/Teoria esta dentro')
confere(t.includes('Escolher na biblioteca'), '"Escolher na biblioteca" continua')
confere(/<select[^>]*id="automount-serie"/.test(html) && t.includes('Dr. Stone') && t.includes('Descobrir pelo roteiro'), 'o seletor de anime continua, com as series')
confere(apertado(html, 'Recap') === true && apertado(html, 'Teoria') === false, 'sem nada lembrado, Recap vem marcado')
confere(/aria-label="Recap:[^"]*ordem do episodio/.test(html), 'a dica da cronologia do recap vai no title/aria')
confere(/aria-label="Teoria:[^"]*ordem do argumento/.test(html), 'a dica da cronologia da teoria vai no title/aria')
confere(/<fieldset[^>]*aria-label="Montar sozinho"/.test(html), 'botao e escolha na mesma moldura')
// `disabled=""` e o atributo; so "disabled" pegaria a classe disabled:opacity-40.
confere(!/<fieldset[^>]*\sdisabled=""/.test(html), 'parado: a moldura esta ligada')
confere(ascii(t) && ascii(html), 'texto em ASCII')
const montar = botoes(html).find((b) => b.includes('title="Recap: le a narracao'))
confere(Boolean(montar), 'o title do "Montar sozinho" diz o modo e o que ele faz')
confere(!t.includes('le a narracao'), 'a explicacao saiu da tela (fica no title)')

console.log('\n== escolha lembrada')
guardado.set(CHAVE_DO_MODO, 'theory')
html = desenhar()
confere(apertado(html, 'Teoria') === true && apertado(html, 'Recap') === false, "'theory' guardado acende Teoria")
confere(botoes(html).some((b) => b.includes('title="Teoria: le a narracao')), 'o title do botao segue o modo')
guardado.set(CHAVE_DO_MODO, 'lixo')
confere(lerModoDoAutomount() === MODO_PADRAO, 'valor estranho volta ao padrao')
html = desenhar()
confere(apertado(html, 'Recap') === true, 'com lixo guardado, Recap vem marcado')
guardado.clear()
gravarModoDoAutomount('theory')
confere(guardado.get('dangai.automount.modo') === 'theory', 'gravar usa a chave dangai.automount.modo')
confere(lerModoDoAutomount() === 'theory', 'ler devolve o que foi gravado')
explodir = true
let quebrou = false
try {
  gravarModoDoAutomount('recap')
  confere(lerModoDoAutomount() === MODO_PADRAO, 'localStorage bloqueado: ler devolve o padrao')
  html = desenhar()
  confere(texto(html).includes('Montar sozinho'), 'localStorage bloqueado: a tela desenha')
} catch {
  quebrou = true
}
confere(!quebrou, 'localStorage bloqueado nao derruba nada')
explodir = false
guardado.clear()

console.log('\n== ocupado')
useProject.setState({ busy: 'Montando...' })
html = desenhar()
confere(/<fieldset[^>]*\sdisabled=""/.test(html), 'a moldura (botao + escolha) fica desligada')
confere(botoes(html).some((b) => b.includes('Ctrl+B') && /\sdisabled=""/.test(b)), 'a biblioteca fica desligada')
useProject.setState({ busy: null })

console.log('\n== quando aparece')
useProject.setState({ images: [{ id: 'i', path: 'C:/a.png', fileName: 'a.png', url: 'x', urlSource: null, width: 1, height: 1, thumbnail: '', focusX: 0.5, focusY: 0.5, focusAuto: false, kind: 'image', section: null }] })
confere(desenhar() === '', 'com cena na tela, nao aparece')
useProject.setState({ images: [], audio: null })
confere(desenhar() === '', 'sem narracao, nao aparece')

// O bundle sai em cjs (sem await no topo): o fim roda numa funcao.
async function oModoChegaAoMain(): Promise<void> {
  console.log('\n== o modo chega ao main')
  useProject.setState({ audio: { path: 'C:/proj/n.wav', fileName: 'n.wav', url: 'x', durationSec: 12, peaks: [] } })
  for (const modo of ['theory', 'recap'] as AutomountMode[]) {
    chamadas.length = 0
    useProject.setState({ images: [] })
    await useProject.getState().automount(modo, 'Dr. Stone')
    const pedido = chamadas.find((c) => c.metodo === 'automount')?.args[0] as { mode?: string; series?: string | null } | undefined
    confere(pedido?.mode === modo && pedido.series === 'Dr. Stone', `automount('${modo}') manda mode=${modo} e a serie`)
  }
}

void oModoChegaAoMain().then(() => {
  console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
  process.exit(falhas === 0 ? 0 : 1)
})
