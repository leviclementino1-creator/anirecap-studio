/**
 * FUMACA DE TELA da Edicao rapida (sem app, sem navegador): desenha os
 * componentes novos com react-dom/server sobre o store de verdade e a janela
 * falsa do v-edicao-rapida-janela.ts, e confere que nada quebra e que cada
 * botao esta la com o texto curto certo:
 *
 * - RenderBar: "Edicao rapida" e "Musica" (sem musica); com a musica da
 *   Edicao rapida, o controle mostra o nome, o volume, escolher arquivo e tirar;
 * - o resumo aberto (do botao: com Desfazer; da montagem: sem);
 * - Configuracoes: as 4 partes, "Ligada ao abrir no editor" e a pasta;
 * - passo 4: a caixinha "Edicao rapida".
 *
 * Nao substitui os prints do app (o Levi audita a tela de verdade). Rodar da raiz:
 *   npx esbuild scripts/teste/v-edicao-rapida-tela.tsx --bundle --platform=node --packages=external --jsx=automatic --tsconfig=tsconfig.web.json | node
 */
import { respostas } from './v-edicao-rapida-janela'
import type React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PublicSettings } from '../../shared/channels'
import { PREFERENCIAS_DA_EDICAO_RAPIDA_PADRAO, type ResumoDaEdicaoRapida } from '../../shared/edicao-rapida'
import { planEqualSplit } from '../../shared/plan'
import { RenderBar } from '../../src/components/RenderBar'
import { BotaoDaEdicaoRapida } from '../../src/components/EdicaoRapida'
import { AjustesDaEdicaoRapida } from '../../src/components/gerar/AjustesDaEdicaoRapida'
import { CaixinhaDaEdicaoRapida } from '../../src/components/gerar/CaixinhaDaEdicaoRapida'
import { ControleDaMusica } from '../../src/components/ControleDaMusica'
import { fotografar } from '../../src/store/documento'
import { useEdicaoRapida } from '../../src/store/edicao-rapida'
import { useProject } from '../../src/store/project'

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

void respostas
/**
 * No servidor, o zustand 5 desenha o estado INICIAL (getServerSnapshot =
 * getInitialState, preso no closure do store). Aqui o "servidor" e so o
 * teste: antes de desenhar, o objeto inicial recebe o estado de agora.
 */
function desenhar(el: React.ReactElement): string {
  for (const loja of [useProject, useEdicaoRapida] as unknown as { getState: () => object; getInitialState: () => object }[]) {
    Object.assign(loja.getInitialState(), loja.getState())
  }
  return renderToStaticMarkup(el)
}
useProject.setState({
  audio: { path: 'C:/proj/n.wav', fileName: 'n.wav', url: 'x', durationSec: 12, peaks: [] },
  images: [1, 2].map((n) => ({
    id: `img-${n}`,
    path: `C:/shots/${n}.mp4`,
    fileName: `${n}.mp4`,
    url: 'x',
    urlSource: null,
    width: 1920,
    height: 1080,
    thumbnail: '',
    focusX: 0.5,
    focusY: 0.5,
    focusAuto: false,
    kind: 'video' as const,
    section: null,
    durationSec: 6,
  })),
  plan: planEqualSplit(2, 12),
  trilhas: [],
})

console.log('\n== RenderBar sem musica')
let html = desenhar(<RenderBar />)
let t = texto(html)
confere(t.includes('Edicao rapida') && t.includes('Musica'), 'os botoes "Edicao rapida" e "Musica" estao na barra')
confere(t.indexOf('Bins') < t.indexOf('Edicao rapida') && t.indexOf('Edicao rapida') < t.indexOf('Musica'), 'ao lado das Bins, na ordem Bins > Edicao rapida > Musica')

console.log('\n== RenderBar com a musica da Edicao rapida')
useProject.setState({
  trilhas: [
    {
      id: 'er-musica-0',
      path: 'C:/musicas/Naruto - Afternoon of Konoha.mp3',
      fileName: 'Naruto - Afternoon of Konoha.mp3',
      faixa: 0,
      at: 0,
      durationSec: 90,
      inicioSec: 0,
      usarSec: 12,
      gainDb: -23.5,
      fadeInSec: 1.2,
      fadeOutSec: 2,
      peaks: [],
      rms: [],
      papel: 'musica',
      ducking: { abaixoDb: 6, ataqueSec: 0.15, soltaSec: 0.6, pausaMinSec: 0.5 },
      url: 'x',
    },
  ],
})
html = desenhar(<RenderBar />)
t = texto(html)
confere(t.includes('Naruto - Afternoon of Konoha') && t.includes('-23.5 dB'), 'o controle mostra o nome (sem extensao) e o volume')
confere(html.includes('aria-label="Escolher o arquivo da musica"') && html.includes('aria-label="Tirar a musica"') && html.includes('aria-label="Volume da musica"'), 'escolher arquivo, volume e tirar')
confere(html.includes('sob a voz, -29.5 dB'), 'o volume diz quanto fica sob a voz (ducking)')
confere(/border-accent bg-accent-dim[^"]*"[^>]*>[^<]*<svg/.test(html) || html.includes('border-accent bg-accent-dim text-ink'), 'Edicao rapida aplicada: o botao fica no rosa apagado (como o Publicacao pronto)')

console.log('\n== O resumo')
const resumo: ResumoDaEdicaoRapida = {
  config: { sfx: true, musica: true, rosto: true, legenda: true },
  whoosh: 5,
  impacto: 2,
  musica: 'Naruto - Afternoon of Konoha.mp3',
  rostos: { comRosto: 11, total: 17, fonte: 'motor' },
  legenda: true,
  avisos: ['So 1 whoosh na pasta: ele repete'],
}
useEdicaoRapida.getState().mostrarResumo({ ...resumo, aplicou: true }, 'editor', fotografar(useProject.getState()))
html = desenhar(<BotaoDaEdicaoRapida />)
t = texto(html)
console.log(`  ${t.trim()}`)
confere(t.includes('Sons') && t.includes('5 whoosh, 2 impactos') && t.includes('Rosto') && t.includes('11 de 17 (motor)') && t.includes('Legenda'), 'as linhas do resumo')
confere(t.includes('Desfazer') && t.includes('Ajustar') && html.includes('aria-label="Fechar"'), 'Desfazer, Ajustar e fechar')
confere(ascii(t), 'texto da tela em ASCII')
confere(!html.includes('fixed inset-0'), 'sem camada por cima: o 1o clique em outro botao ja vale')
useEdicaoRapida.getState().mostrarResumo({ ...resumo, aplicou: false }, 'editor', null)
t = texto(desenhar(<BotaoDaEdicaoRapida />))
confere(!t.includes('Desfazer') && t.includes('Nada mudou'), 'nada aplicado: sem Desfazer, e diz que nada mudou')
useEdicaoRapida.getState().mostrarResumo({ ...resumo, legenda: false, musica: null, musicaMantida: 'Naruto.mp3' }, 'montagem')
t = texto(desenhar(<BotaoDaEdicaoRapida />))
confere(!t.includes('Desfazer') && t.includes('Ajustar'), 'resumo da montagem: sem Desfazer (abrir nao e passo de Ctrl+Z)')
confere(t.includes('Naruto (mantida)') && t.includes('padrao do app (sem estilo salvo)'), 'musica mantida e legenda sem estilo salvo, ditas com todas as letras')
useEdicaoRapida.getState().fecharResumo()
confere(!texto(desenhar(<BotaoDaEdicaoRapida soIcone />)).includes('Edicao rapida'), 'barra apertada: so o icone (o nome fica no aria-label/title)')
useEdicaoRapida.setState({ padrao: { ...PREFERENCIAS_DA_EDICAO_RAPIDA_PADRAO, config: { sfx: false, musica: false, rosto: false, legenda: false } } })
html = desenhar(<BotaoDaEdicaoRapida />)
confere(/<button[^>]*disabled=""[^>]*aria-label="Edicao rapida"/.test(html) && html.includes('Nada ligado na Edicao rapida'), 'tudo desligado nas Configuracoes: botao apagado, com o porque')
useEdicaoRapida.setState({ padrao: PREFERENCIAS_DA_EDICAO_RAPIDA_PADRAO })

console.log('\n== A musica na barra apertada')
html = desenhar(<ControleDaMusica nivel={1} />)
t = texto(html)
confere(!t.includes('Naruto') && t.includes('-23.5 dB') && html.includes('aria-label="Trocar a musica"'), 'nivel 1: sem o nome, o dB fica e o trocar e o shuffle')
html = desenhar(<ControleDaMusica nivel={3} />)
t = texto(html)
confere(!html.includes('type="range"') && t.includes('-23.5 dB') && html.includes('aria-label="Musica"'), 'nivel 3: um botao so (nota e dB); o volume vai para o popover')

console.log('\n== Configuracoes')
const settings = {
  edicaoRapidaPadrao: PREFERENCIAS_DA_EDICAO_RAPIDA_PADRAO,
  pastaDeMusicas: '',
  pastaDeMusicasEfetiva: 'G:/App Resumo/music',
} as unknown as PublicSettings
html = desenhar(<AjustesDaEdicaoRapida settings={settings} onSettings={() => {}} />)
t = texto(html)
console.log(`  ${t.trim()}`)
confere(['Sons', 'Musica', 'Rosto', 'Legenda', 'Ligada ao abrir no editor', 'Pasta de musicas', '(padrao)'].every((x) => t.includes(x)), 'as 4 partes, a caixinha do passo 4 e a pasta (padrao)')
confere((html.match(/role="checkbox"/g) ?? []).length === 5 && (html.match(/aria-checked="true"/g) ?? []).length === 5, '5 caixinhas, todas ligadas por padrao')
confere(ascii(t), 'texto da tela em ASCII')
html = desenhar(
  <AjustesDaEdicaoRapida settings={{ ...settings, pastaDeMusicas: 'D:/minhas', pastaDeMusicasEfetiva: 'D:/minhas' }} onSettings={() => {}} />,
)
confere(texto(html).includes('Usar o padrao') && !texto(html).includes('(padrao)'), 'pasta escolhida: "Usar o padrao" aparece')
html = desenhar(
  <AjustesDaEdicaoRapida settings={{ ...settings, pastaDeMusicas: 'D:/sumiu', pastaDeMusicasEfetiva: '' }} onSettings={() => {}} />,
)
t = texto(html)
confere(t.includes('D:\\sumiu') &&t.includes('nao encontrada') && !t.includes('faixas') && t.includes('Usar o padrao'), 'pasta escolhida que sumiu: o caminho, "nao encontrada" e "Usar o padrao"')
confere(texto(desenhar(<AjustesDaEdicaoRapida settings={settings} onSettings={() => {}} />)).includes('G:\\App Resumo\\music'), 'o caminho com a barra do Windows, como a Biblioteca')

console.log('\n== Passo 4')
useEdicaoRapida.setState({ padrao: PREFERENCIAS_DA_EDICAO_RAPIDA_PADRAO })
html = desenhar(<CaixinhaDaEdicaoRapida />)
confere(texto(html).includes('Edicao rapida') && html.includes('aria-checked="true"'), 'a caixinha "Edicao rapida" nasce ligada')
useEdicaoRapida.setState({ padrao: { ...PREFERENCIAS_DA_EDICAO_RAPIDA_PADRAO, aoAbrirNoEditor: false } })
confere(desenhar(<CaixinhaDaEdicaoRapida />).includes('aria-checked="false"'), 'desligada nas Configuracoes, desligada aqui')

console.log(`\n${falhas === 0 ? 'TUDO OK' : `${falhas} FALHA(S)`}`)
process.exit(falhas === 0 ? 0 : 1)
