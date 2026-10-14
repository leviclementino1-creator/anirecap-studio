import { rostoNosInstantes } from '../assets'
import { probeClip } from '../clips'
import { chaveDoPedaco, focoDoRosto, type FocoDoPedaco, type PedacoDaMontagem } from './projeto'

/**
 * O ENQUADRAMENTO 9:16 de cada bloco do projeto montado, pelo mesmo detector
 * de rosto que o Dangai usa ao soltar um clipe (lbpcascade_animeface, faces.ts).
 *
 * Por que aqui e nao no openProject: projeto aberto passa o foco pronto para o
 * importImages, que entao NAO procura rosto (e a regra do Dangai: o foco salvo
 * e decisao do usuario). Sem isto, todo bloco do Studio abriria no centro --
 * pior que o mesmo clipe solto a mao no Dangai.
 *
 * Melhor que o do import: olha tres instantes DENTRO do trecho que o bloco usa
 * (25/50/75% de [de, ate]), e nao do arquivo inteiro. Fica o maior rosto, como
 * o rostoNoClipe. Nenhum rosto, erro ou tempo esgotado: centro, sem marca de
 * automatico. Rosto e melhoria, nunca requisito -- o projeto sai de qualquer
 * jeito.
 */

/** Quantos blocos olhados ao mesmo tempo (o mesmo IMPORTE_PARALELO do assets.ts). */
const EM_PARALELO = 3

/** Teto da etapa inteira: passou disso, o resto fica no centro (o Levi esta esperando). */
export const TETO_DOS_ROSTOS_MS = 60_000

export async function focosDosPedacos(
  pedacos: readonly Pick<PedacoDaMontagem, 'arquivo' | 'de' | 'ate'>[],
  tetoMs = TETO_DOS_ROSTOS_MS,
): Promise<Map<string, FocoDoPedaco>> {
  const focos = new Map<string, FocoDoPedaco>()
  const unicos = new Map<string, Pick<PedacoDaMontagem, 'arquivo' | 'de' | 'ate'>>()
  for (const p of pedacos) unicos.set(chaveDoPedaco(p), p)
  const fila = [...unicos.entries()]
  const limite = Date.now() + tetoMs
  const medidas = new Map<string, Promise<{ width: number; height: number } | null>>()

  const medir = (arquivo: string): Promise<{ width: number; height: number } | null> => {
    let m = medidas.get(arquivo)
    if (!m) {
      m = probeClip(arquivo).then(
        (info) => (info.width > 0 && info.height > 0 ? { width: info.width, height: info.height } : null),
        () => null,
      )
      medidas.set(arquivo, m)
    }
    return m
  }

  const trabalhar = async (): Promise<void> => {
    for (;;) {
      const proximo = fila.shift()
      if (!proximo || Date.now() > limite) return
      const [chave, p] = proximo
      try {
        const dura = Math.max(p.ate - p.de, 0)
        const instantes = [0.25, 0.5, 0.75].map((f) => p.de + f * dura)
        const [achados, medida] = await Promise.all([rostoNosInstantes(p.arquivo, instantes), medir(p.arquivo)])
        let maior: { centroX: number; centroY: number; area: number } | null = null
        for (const r of achados) if (r && (maior === null || r.area > maior.area)) maior = r
        if (maior && medida) focos.set(chave, { ...focoDoRosto(maior, medida.width, medida.height), focusAuto: true })
      } catch {
        // Fica no centro.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(EM_PARALELO, fila.length) }, trabalhar))
  return focos
}
