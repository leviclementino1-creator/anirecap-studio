import { resolve } from 'node:path'
import type { LibraryClip, LibraryIndex } from '@shared/channels'
import { episodiosEm, ordemNatural, scanLibrary, unificarNomes } from '../library'
import { getSettings, pastaDaBibliotecaStudio } from '../settings'

/**
 * A BIBLIOTECA DO EDITOR (Ctrl+B): o que o handler de scanLibrary devolve.
 *
 * Duas raizes: a do usuario (settings.libraryDir, a do AnCut/Corte Cenas, como
 * no Dangai) e a do Studio (onde o motor do Studio corta). As cenas do Studio
 * aparecem junto na grade e servem para trocar cena como as outras.
 *
 * - Sem libraryDir e sem nenhum episodio na do Studio: o mesmo erro de antes.
 *   So uma das duas: vale so ela, e com a do Studio vazia o resultado e
 *   exatamente o do Dangai.
 * - O id de cena tem que ser unico entre as raizes: favorito, etiqueta,
 *   descricao e miniatura sao guardados por id, e "Dr. Stone/S04E37/0025" pode
 *   existir nas duas. As cenas da raiz do Studio ganham 'studio:' na frente; as
 *   da libraryDir ficam como estao, para nada do que ele ja favoritou ficar
 *   orfao.
 * - Uma raiz dentro da outra (ele apontou a libraryDir para a pasta do Studio,
 *   ou o contrario): a libraryDir le como sempre, e a do Studio so acrescenta
 *   o que a outra nao trouxe, sem cena repetida.
 */

/** O prefixo do id das cenas da biblioteca do Studio. */
export const PREFIXO_DO_STUDIO = 'studio:'

function normal(caminho: string): string {
  return resolve(caminho).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

/** A pasta do Studio tem pelo menos um episodio cortado? (para no primeiro achado) */
function temEpisodio(raiz: string): boolean {
  try {
    return !episodiosEm(raiz, 0).next().done
  } catch {
    return false
  }
}

export async function escanearBibliotecaDoEditor(
  publish: (absolutePath: string) => string,
  onProgress: (mensagem: string) => void,
): Promise<LibraryIndex> {
  const { libraryDir } = getSettings()
  const studio = pastaDaBibliotecaStudio()
  const comStudio = temEpisodio(studio)

  if (!libraryDir && !comStudio) {
    throw new Error(
      'Nenhuma biblioteca escolhida. Abra as configuracoes (Ctrl+,) e aponte a pasta onde o AnCut grava as cenas.',
    )
  }
  // A do Studio vazia, ou ja dentro da libraryDir (ou igual a ela): a varredura
  // de sempre, com os ids de sempre.
  if (!comStudio || (libraryDir && dentroDe(studio, libraryDir))) return scanLibrary(libraryDir, publish, onProgress)

  const doStudio = await scanLibrary(studio, publish, onProgress, { prefixoDoId: PREFIXO_DO_STUDIO })
  if (!libraryDir) return doStudio

  const doUsuario = await scanLibrary(libraryDir, publish, onProgress)
  const jaTem = new Set(doUsuario.clips.map((c) => normal(c.path)))
  const extras = doStudio.clips.filter((c) => !jaTem.has(normal(c.path)))
  return juntar(doUsuario, extras, doStudio.scanned)
}

function dentroDe(caminho: string, raiz: string): boolean {
  const a = normal(caminho)
  const r = normal(raiz)
  return a === r || a.startsWith(`${r}\\`)
}

function unicos(valores: readonly string[]): string[] {
  return [...new Set(valores)].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

/** A grade unica: os clipes das duas, nomes de personagem unificados por serie, na ordem de leitura. */
function juntar(base: LibraryIndex, extras: LibraryClip[], scannedExtras: number): LibraryIndex {
  if (extras.length === 0) return base
  const clips = [...base.clips, ...extras]
  // Mesma serie nas duas raizes: as grafias do personagem viram uma so, como
  // dentro de uma raiz.
  unificarNomes(clips)
  clips.sort(ordemNatural)
  // O id e "<serie>/<SxxEyy>/<cena>": sem a cena, e o episodio.
  const episodiosExtras = new Set(extras.map((c) => c.id.slice(0, c.id.lastIndexOf('/'))))
  return {
    root: base.root,
    clips,
    animes: unicos(clips.map((c) => c.anime)),
    characters: unicos(clips.flatMap((c) => c.characters)),
    episodes: base.episodes + episodiosExtras.size,
    scanned: base.scanned + scannedExtras,
  }
}
