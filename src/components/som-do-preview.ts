import { useEffect, useMemo, useState } from 'react'
import type { Ducking, Word } from '@shared/contract'
import { envelopeDeDucking, ganhoDoEnvelope, REGRAS_DE_SOM_PADRAO, type MedidaDoSom, type PontoDeGanho } from '@shared/edicao-rapida'
import { monoEmDoisCanais } from '@shared/loudness'

/**
 * O SOM DO PREVIEW NO EQUILIBRIO DO RENDER (Edicao rapida, 14/10).
 *
 * 1. DUCKING: a musica com `ducking` desce sob a voz pelo MESMO envelope que o
 *    render usa (envelopeDeDucking com as palavras do transcript, interpolado
 *    por ganhoDoEnvelope) -- nao um compressor ouvindo o audio, entao o que
 *    se ouve aqui e o que sai no MP4.
 * 2. NIVEL: no render a narracao vai a -14 LUFS (loudnorm); aqui ela toca
 *    CRUA -- a voz do Studio sai do passo 3 em -23 LUFS, mono. Sem descontar,
 *    a musica soava ~6 dB mais alta em relacao a voz do que no video final, e
 *    ele acertaria o volume no ouvido errado. O desconto e a diferenca entre a
 *    voz ouvida aqui e a do render, aplicado em TODAS as faixas (as dele
 *    tambem: e o mesmo erro de equilibrio). Mono conta +3 dB aqui: o navegador
 *    copia o canal nos dois alto-falantes, e o render sobe mono para estereo a
 *    -3 dB por canal (ver monoEmDoisCanais).
 *
 * A medida vem do main (medirSom, com cache em disco). Falhou: desconto 0, o
 * preview de sempre do Dangai.
 */

const medidas = new Map<string, Promise<MedidaDoSom | null>>()

function medir(path: string): Promise<MedidaDoSom | null> {
  let p = medidas.get(path)
  if (!p) {
    p = window.dangai
      .medirSom(path)
      .then((r) => (r.ok ? r.value : null))
      .catch(() => null)
    medidas.set(path, p)
  }
  return p
}

/** Quanto a voz do render fica acima da voz tocada aqui, em dB (negativo = a voz aqui e mais baixa). */
function descontoDaVoz(m: MedidaDoSom | null): number {
  if (!m || m.lufsIntegrado === null) return 0
  const ouvida = m.lufsIntegrado + monoEmDoisCanais(m.canais ?? 2)
  return Math.min(Math.max(ouvida - REGRAS_DE_SOM_PADRAO.vozLufs, -40), 20)
}

/**
 * dB a somar em cada arquivo de faixa no preview (por caminho). Arquivo ainda
 * sem medida usa so o desconto da voz.
 */
export function useAjusteDasFaixas(vozPath: string | undefined, faixaPaths: readonly string[]): (path: string) => number {
  const [vozDb, setVozDb] = useState(0)
  const [monoDb, setMonoDb] = useState<Record<string, number>>({})
  const chave = [...new Set(faixaPaths)].sort().join('\n')

  useEffect(() => {
    let vivo = true
    if (!vozPath) {
      setVozDb(0)
      return
    }
    void medir(vozPath).then((m) => {
      if (vivo) setVozDb(descontoDaVoz(m))
    })
    return () => {
      vivo = false
    }
  }, [vozPath])

  useEffect(() => {
    let vivo = true
    const paths = chave ? chave.split('\n') : []
    void Promise.all(paths.map(async (p) => [p, await medir(p)] as const)).then((lista) => {
      if (!vivo) return
      const novo: Record<string, number> = {}
      for (const [p, m] of lista) novo[p] = m ? -monoEmDoisCanais(m.canais ?? 2) : 0
      setMonoDb(novo)
    })
    return () => {
      vivo = false
    }
  }, [chave])

  return useMemo(() => (path: string) => vozDb + (monoDb[path] ?? 0), [vozDb, monoDb])
}

/**
 * O ganho do ducking (dB, 0 ou negativo) de uma faixa no instante do VIDEO.
 * Um envelope por configuracao de ducking (as voltas da musica dividem o
 * mesmo), refeito so quando as palavras ou a duracao mudam.
 */
export function useDucking(
  faixas: readonly { ducking?: Ducking | null }[],
  words: readonly Word[] | undefined,
  duracaoSec: number | undefined,
): (ducking: Ducking | null | undefined, tVideo: number) => number {
  const configs = [...new Set(faixas.flatMap((f) => (f.ducking ? [JSON.stringify(f.ducking)] : [])))].sort().join('\n')
  const envelopes = useMemo(() => {
    const m = new Map<string, PontoDeGanho[]>()
    if (!configs || !words || !duracaoSec) return m
    for (const c of configs.split('\n')) m.set(c, envelopeDeDucking(words, duracaoSec, JSON.parse(c) as Ducking))
    return m
  }, [configs, words, duracaoSec])
  return useMemo(
    () => (ducking: Ducking | null | undefined, tVideo: number) => {
      if (!ducking) return 0
      const env = envelopes.get(JSON.stringify(ducking))
      return env ? ganhoDoEnvelope(env, tVideo) : 0
    },
    [envelopes],
  )
}
