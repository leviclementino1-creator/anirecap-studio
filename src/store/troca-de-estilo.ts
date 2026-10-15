// So o TIPO: project.ts e estilo-legenda.ts importam este arquivo, e um valor
// de la fecharia o ciclo.
import type { ProjectState } from './project'

/**
 * Trocas de estilo da legenda que NAO viram padrao (Edicao rapida, 14/10).
 *
 * O estilo-legenda.ts grava como padrao qualquer mudanca de estilo fora do
 * carregamento -- inclusive a que o Ctrl+Z faz. A Edicao rapida poe o estilo
 * salvo num projeto antigo; o Ctrl+Z dela devolve o estilo daquele video, e o
 * refazer traz o salvo de volta. Nenhum dos dois e ajuste dele: sem isto,
 * desfazer a Edicao rapida trocaria o padrao pelo estilo do video antigo (e,
 * se a fonte do padrao faltar na pasta, o proprio set() da Edicao rapida
 * apagaria a fonte do padrao).
 *
 * Guarda as duas pontas de cada troca; o mesmo par, em qualquer sentido, e
 * ignorado. Ajuste dele (slider, preset) nunca cai num par destes.
 */

type CamposDoEstilo = Pick<
  ProjectState,
  | 'captionColor'
  | 'captionY'
  | 'captionScale'
  | 'captionFont'
  | 'captionAnimation'
  | 'captionAnimationFrames'
  | 'captionMark'
  | 'captionShadow'
  | 'captionStroke'
  | 'captionRules'
  | 'captionAnimationCurve'
>

/** Os mesmos campos que o estilo-legenda.ts compara (mudou) e grava (estiloAtual). */
function chave(s: CamposDoEstilo): string {
  return JSON.stringify([
    s.captionColor,
    s.captionY,
    s.captionScale,
    s.captionFont?.nome ?? '',
    s.captionAnimation,
    s.captionAnimationFrames,
    s.captionMark,
    s.captionShadow,
    s.captionStroke,
    s.captionRules,
    s.captionAnimationCurve,
  ])
}

/** Poucos pares bastam: cada Edicao rapida com legenda deixa um. */
const LIMITE = 20
const trocas: Array<[string, string]> = []

/** Chame ANTES do set() que troca o estilo. */
export function trocaQueNaoViraPadrao(antes: CamposDoEstilo, depois: CamposDoEstilo): void {
  const a = chave(antes)
  const b = chave(depois)
  if (a === b) return
  trocas.push([a, b])
  if (trocas.length > LIMITE) trocas.shift()
}

export function ehTrocaQueNaoViraPadrao(antes: CamposDoEstilo, depois: CamposDoEstilo): boolean {
  if (trocas.length === 0) return false
  const a = chave(antes)
  const b = chave(depois)
  return trocas.some(([x, y]) => (x === a && y === b) || (x === b && y === a))
}
