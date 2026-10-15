import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * O APERTO DA BARRA do editor (auditoria de 14/10). A barra do Dangai nao
 * quebra linha, e com a Edicao rapida e a musica ela passava da janela abaixo
 * de ~1240 px: o "Renderizar" saia da tela e o play era amassado pela metade.
 * Breakpoint fixo nao resolve -- a barra muda com o estado ("Abrir pasta"
 * depois do render, "Selecao", legendas) --, entao a barra MEDE: enquanto o
 * conteudo passar da largura, aperta mais um nivel.
 *
 *   0  tudo por extenso
 *   1  a musica sem o nome (o dB fica: e por ele que ele repete o equilibrio)
 *   2  "Edicao rapida" so com o icone
 *   3  a musica num botao so (nome, trocar, pasta e volume num popover)
 *   4  a barra inteira com o espaco entre os botoes menor (8 px)
 *   5  "Abrir pasta" so com o icone e o espaco menor ainda (6 px)
 *   6  "Editar" e "Upscale" so com o icone (abaixo da janela minima, 1080)
 *
 * Tudo no layout (antes de pintar): nao pisca. A largura da barra ou o
 * conteudo (`chave`) mudou: recomeca do nivel 0 e aperta de novo.
 */
export const NIVEL_MAXIMO_DA_BARRA = 6

export function useApertoDaBarra(chave: string): {
  ref: RefObject<HTMLDivElement>
  refDoEspaco: RefObject<HTMLDivElement>
  nivel: number
} {
  const ref = useRef<HTMLDivElement>(null)
  // O `flex-1` entre os botoes e o Renderizar: largura 0 = nao sobrou espaco,
  // e o flexbox ja esta AMASSANDO botoes (o play com 16 px, o "Abrir pasta" em
  // duas linhas) -- o scrollWidth sozinho nao ve isso.
  const refDoEspaco = useRef<HTMLDivElement>(null)
  const [nivel, setNivel] = useState(0)
  const [largura, setLargura] = useState(0)
  const [, setTique] = useState(0)
  const ultima = useRef({ largura: -1, chave: '' })
  const observador = useRef<ResizeObserver | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // A barra muda de largura (janela) ou um botao muda de tamanho sozinho
    // (o nome da musica, o Preflight): mede de novo.
    const ro = new ResizeObserver((entradas) => {
      for (const e of entradas) {
        if (e.target === el) setLargura(Math.round(el.clientWidth))
      }
      setTique((t) => t + 1)
    })
    ro.observe(el)
    observador.current = ro
    return () => {
      ro.disconnect()
      observador.current = null
    }
  }, [])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    for (const filho of Array.from(el.children)) observador.current?.observe(filho)
    if (ultima.current.largura !== largura || ultima.current.chave !== chave) {
      ultima.current = { largura, chave }
      if (nivel !== 0) {
        setNivel(0)
        return
      }
    }
    const espaco = refDoEspaco.current
    const naoCabe = el.scrollWidth > el.clientWidth + 1 || (espaco !== null && espaco.isConnected && espaco.getBoundingClientRect().width < 1)
    if (naoCabe && nivel < NIVEL_MAXIMO_DA_BARRA) setNivel(nivel + 1)
  })

  return { ref, refDoEspaco, nivel }
}

/**
 * Popover da barra: abre para CIMA (o padrao do Dangai, por cima do preview),
 * mas para BAIXO quando acima nao cabe -- com a linha do tempo puxada para o
 * alto, a barra fica perto do topo e o resumo saia cortado da tela.
 */
export function useAbreParaBaixo(ref: RefObject<HTMLElement>, aberto: boolean, altura: number): boolean {
  const [paraBaixo, setParaBaixo] = useState(false)
  useLayoutEffect(() => {
    if (!aberto || !ref.current) return
    setParaBaixo(ref.current.getBoundingClientRect().top < altura + 12)
  }, [aberto, ref, altura])
  return paraBaixo
}
