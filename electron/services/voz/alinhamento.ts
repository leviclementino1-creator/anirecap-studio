import type { FraseParaNarrar } from '@shared/voz'
import { alinharAoAudio, type Alinhamento } from '../alinhador'
import { getSettings } from '../settings'
import { transcribe } from '../whisper'
import { Cancelado } from './ffmpeg'
import {
  nomesDoRoteiro,
  palavrasDoAlinhador,
  palavrasPeloRoteiro,
  type PalavrasCasadas,
} from './palavras'

/**
 * O caminho 'alinhador': o tempo das palavras DO ROTEIRO num audio que nao
 * trouxe tempo (Fish Audio, audio importado, ou o ElevenLabs sem alignment).
 *
 * E a regra do Dangai (transcribe.ts applyScript/sincronizar): o texto vem do
 * roteiro, o audio so da os tempos.
 *   - Whisper local (so no importado): diz se o audio e MESMO deste roteiro
 *     (alignScript casa >= 50% das palavras) e serve de reserva;
 *   - wav2vec2 PT (alinhador.ts, o mesmo modelo do LegendAI): o tempo fino de
 *     cada palavra. Abaixo de 0,35 de confianca o texto nao e o do audio.
 * No TTS (Fish) o texto e o roteiro por construcao: vai direto ao wav2vec2.
 */

/** O limite do LegendAI (transcribe.ts sincronizar). */
const SCORE_MINIMO = 0.35

export interface ResultadoDoAlinhador {
  casadas: PalavrasCasadas
  /** Confianca media do wav2vec2 (null = so Whisper). */
  score: number | null
  avisos: string[]
}

/**
 * O que o wav2vec2 LE de cada token: so letras e digitos ("tempo." -> "tempo",
 * "Why-Man" -> "WhyMan", "Dr." -> "Dr").
 *
 * No alinhar.ts do Dangai a pontuacao vira CURINGA, e o merge_repeats da ao
 * curinga os quadros brancos que vem depois dele: a ultima palavra da frase
 * ("tempo.", "todos?") terminava no fim da PAUSA, so quando o modelo emitia o
 * "|" da fala seguinte. Medido no t4 (importado): 'tempo.' cobrindo 1,25 s de
 * silencio, a frase seguinte acendendo 500 ms tarde, a fronteira de frase em
 * plena fala e a pausa escondida do corte. Sem a pontuacao, nenhuma palavra
 * cobre silencio e o pior erro cai de 498/1.705 ms para 122/76 ms.
 *
 * O texto da palavra continua o do roteiro (palavrasDoAlinhador): so o tempo
 * sai do modelo. O alinhar.ts fica intocado (o Dangai e o LegendAI seguem
 * iguais); a limpeza e daqui.
 */
export function paraOModelo(tokens: readonly string[]): string[] {
  return tokens.map((t) => t.normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '') || t)
}

/** A promessa ou o Cancelar, o que vier primeiro (o processo e morto por quem recebe o signal). */
export function correrContra<T>(promessa: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promessa
  if (signal.aborted) return Promise.reject(new Cancelado())
  return new Promise<T>((resolve, reject) => {
    const desistir = (): void => reject(new Cancelado())
    signal.addEventListener('abort', desistir, { once: true })
    promessa.then(
      (v) => {
        signal.removeEventListener('abort', desistir)
        resolve(v)
      },
      (e: unknown) => {
        signal.removeEventListener('abort', desistir)
        reject(e instanceof Error ? e : new Error(String(e)))
      },
    )
  })
}

export async function alinharPeloAudio(
  caminhoWav: string,
  frases: readonly Pick<FraseParaNarrar, 'fraseId' | 'palavras'>[],
  opcoes: { whisper: boolean; signal?: AbortSignal; avisar: (mensagem: string) => void },
): Promise<ResultadoDoAlinhador> {
  const avisos: string[] = []
  const tokens = frases.flatMap((f) => f.palavras)
  if (tokens.length === 0) throw new Error('O roteiro nao tem palavras para alinhar.')

  let peloWhisper: PalavrasCasadas | null = null
  let whisperOuviu = false
  if (opcoes.whisper) {
    opcoes.avisar('Ouvindo o audio (Whisper local)...')
    try {
      // Com o signal, o Cancelar mata o whisper-cli DESTE pedido (e a fila anda).
      const t = await correrContra(
        transcribe(caminhoWav, getSettings().whisperModel, opcoes.avisar, nomesDoRoteiro(frases), opcoes.signal),
        opcoes.signal,
      )
      if (t && t.words.length > 0) {
        whisperOuviu = true
        peloWhisper = palavrasPeloRoteiro(t.words, frases)
      }
    } catch (err) {
      if (err instanceof Cancelado) throw err
      avisos.push('O Whisper nao rodou: so o alinhador decidiu os tempos.')
    }
  }

  opcoes.avisar(`Alinhando ${tokens.length} palavras...`)
  let forcado: Alinhamento | null = null
  try {
    forcado = await correrContra(alinharAoAudio(caminhoWav, paraOModelo(tokens), opcoes.avisar, opcoes.signal), opcoes.signal)
  } catch (err) {
    if (err instanceof Cancelado) throw err
    avisos.push(`Sincronia fina indisponivel (${(err instanceof Error ? err.message : String(err)).slice(0, 80)}).`)
  }
  const pelaIa = forcado ? palavrasDoAlinhador(forcado.tempos, frases) : null

  if (pelaIa && forcado && forcado.score >= SCORE_MINIMO) return { casadas: pelaIa, score: forcado.score, avisos }
  // O Whisper ouviu outra coisa E o alinhador nao reconheceu: nao e este roteiro.
  if (whisperOuviu && !peloWhisper) {
    throw new Error('Esse audio nao parece ser a narracao deste roteiro. Confira o arquivo.')
  }
  if (peloWhisper) {
    /*
     * Os tempos do whisper.cpp erram por centenas de ms neste material (t4: 624
     * ms em media, 1,9 s no pior). O take sai (o montarTake ainda encosta cada
     * palavra no som), mas com score 0 quando o wav2vec2 nem rodou: a qualidade
     * fica FRACA e o "Aprovar voz" pede confirmacao.
     */
    avisos.push('A sincronia fina nao reconheceu o roteiro: tempos do Whisper, grossos. Confira antes de aprovar.')
    return { casadas: peloWhisper, score: forcado?.score ?? 0, avisos }
  }
  if (pelaIa && forcado) {
    avisos.push('O audio nao parece ser este roteiro (confianca baixa). Confira as palavras.')
    return { casadas: pelaIa, score: forcado.score, avisos }
  }
  throw new Error('Nao deu para achar as palavras do roteiro neste audio.')
}
