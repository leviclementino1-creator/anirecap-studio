import { transcriptFromScript } from '@shared/align'
import type { CaptionBlock, RegrasDaLegenda, ScenePlan, Transcript } from '@shared/contract'
import { abrirEspaco, removerCena } from '@shared/indices'
import { buildCaptions } from '@shared/plan'
import type { OrigemDoStudio } from '@shared/project-file'

/**
 * A GUARDA DE REANALISE do projeto que nasceu do "Abrir no editor" do Gerar
 * recap (electron/services/montar/*).
 *
 * O analyze() do store roda transcricao + plano no main e TROCA o transcript
 * pelo do Whisper. Num projeto do Dangai isso e o certo. Num projeto do Studio
 * com `studio.vozAlinhada`, o transcript e o do TAKE: as palavras do roteiro
 * com o tempo do provedor/alinhador, e o plano tem os cortes nas fronteiras de
 * frase dele. Trocar por um Whisper seria piorar o texto e mexer nos tempos de
 * tudo -- e o plano provisorio que vem antes do analyze (setInterimPlan) jogaria
 * fora as cenas escolhidas uma a uma.
 *
 * Com a guarda ligada:
 *   - analyze() nao roda (a trava de baixo de tudo: insertImages sem plano, o
 *     fim do ingest e qualquer caminho novo passam por ela);
 *   - removeImage tira os blocos daquela imagem sobre o plano que existe (o
 *     tempo vai para o vizinho, como o removeScene), sem plano provisorio;
 *   - setScript (e o roteiro solto no ingest) vira "reescrever frases": o texto
 *     novo por cima dos tempos da voz (transcriptFromScript, a mesma conta do
 *     roteiro do Dangai), e as legendas nao editadas seguem o texto;
 *   - imagem solta no ingest entra na agulha, como o "inserir" da linha do
 *     tempo (insertImages), e nao redistribui o video.
 * Narracao nova (audio solto no ingest, "legendar video pronto") desliga a
 * guarda: os tempos do take deixam de valer.
 */

interface EstadoDaGuarda {
  studio: OrigemDoStudio | null
  transcript: Transcript | null
}

/** A guarda esta ligada: projeto do Studio com a voz alinhada e o transcript dela no estado. */
export function vozDoStudio(s: EstadoDaGuarda): boolean {
  return s.studio?.vozAlinhada === true && s.transcript !== null && s.transcript.alinhado === true
}

/** A origem com a guarda desligada (narracao trocada). null continua null. */
export function semGuarda(studio: OrigemDoStudio | null): OrigemDoStudio | null {
  return studio ? { ...studio, vozAlinhada: false } : null
}

/**
 * removeImage sem reanalise: os blocos que usam a imagem saem (o tempo vai para
 * o vizinho -- removerCena), e os indices de cima descem. Metade de baixo de
 * uma tela dividida so desfaz a divisao. Era o unico bloco: plano null.
 */
export function tirarImagemSemReanalise<T extends { id: string }>(
  plan: ScenePlan | null,
  images: readonly T[],
  id: string,
): { plan: ScenePlan | null; images: T[] } {
  let plano = plan
  let lista = [...images]
  for (;;) {
    const i = lista.findIndex((img) => img.id === id)
    if (i < 0) break
    // Bloco de tela cheia com esta imagem: sai inteiro, o tempo vai para o vizinho.
    const k = plano ? plano.scenes.findIndex((c) => c.imageIndex === i && c.imageIndexB === null) : -1
    if (plano && k >= 0) {
      const feito = removerCena(plano, lista, k)
      if (!feito) return { plan: null, images: lista.filter((img) => img.id !== id) }
      plano = feito.plan
      lista = feito.images
      continue
    }
    // Fora do plano, ou metade de uma tela dividida: so a imagem sai. A outra
    // metade fica sozinha em tela cheia, e os indices acima descem uma casa.
    lista = lista.filter((_, j) => j !== i)
    if (plano) {
      plano = {
        ...plano,
        scenes: plano.scenes.map((c) => {
          let x = c
          if (x.imageIndexB === i) x = { ...x, imageIndexB: null }
          else if (x.imageIndex === i && x.imageIndexB !== null) {
            x = {
              ...x,
              imageIndex: x.imageIndexB,
              imageIndexB: null,
              effect: x.effectB ?? x.effect,
              sourceStart: x.sourceStartB ?? 0,
              camera: x.cameraB ?? null,
            }
          }
          return abrirEspaco(x, i + 1, -1)
        }),
      }
    }
  }
  return { plan: plano, images: lista }
}

/**
 * setScript sem reanalise: o roteiro novo por cima dos tempos da voz. Roteiro
 * vazio ou que nao bate (outro texto) deixa o transcript como esta e diz por
 * que; as legendas nao editadas sao refeitas do transcript que ficou.
 */
export function frasesReescritas(
  s: { transcript: Transcript; captionRules: RegrasDaLegenda },
  script: string | null,
): { transcript: Transcript; captions: CaptionBlock[]; scriptNote: string | null } {
  const feito = script?.trim() ? transcriptFromScript(script, s.transcript) : null
  const transcript = feito ? { ...feito.transcript, alinhado: s.transcript.alinhado } : s.transcript
  return {
    transcript,
    captions: buildCaptions(transcript, s.captionRules),
    scriptNote:
      script?.trim() && !feito
        ? 'Esse roteiro nao bate com a narracao. Para mudar o que se fala, regrave a voz no Gerar recap.'
        : null,
  }
}
