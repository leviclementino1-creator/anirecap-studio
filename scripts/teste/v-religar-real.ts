/**
 * TESTE REAL do religar (modo Texto do passo 2) com o Gemini do Levi: UMA
 * chamada, no maximo, pelo mesmo caminho do app (religarRoteiro, cache,
 * prompt-religar.ts).
 *
 * Roda DENTRO do Electron, com um userData TEMPORARIO que tem so COPIAS do
 * settings.json e do Local State do app (o safeStorage decifra a chave pelo
 * Local State): nada do perfil do Levi e escrito. O rascunho real do S4-37 e
 * copiado para esse perfil, editado como no v-religar.ts (2 frases mexidas, 1
 * acrescida) e religado. A chave nunca e impressa.
 *
 * Rodar da raiz do projeto (PowerShell):
 *   npx esbuild scripts/teste/v-religar-real.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json --outfile=out/teste/v-religar-real.cjs
 *   npx electron out/teste/v-religar-real.cjs
 */
import { app } from 'electron'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { z } from 'zod'
import { ehParadaNoReserva, roteiroAtual, textoDoRoteiro, type Frase, type Roteiro } from '../../shared/roteiro'
import { gerarJson, type PedidoJson, type RespostaJson } from '../../electron/services/llm'
import { configureSettings, getSettings } from '../../electron/services/settings'
import { configurarEpisodios } from '../../electron/services/episodio/indice'
import { trocarIaParaTeste } from '../../electron/services/gerar/ia'
import { lerRascunhoDoDisco, pastaDosRascunhos } from '../../electron/services/gerar/rascunho'
import { religarRoteiro } from '../../electron/services/gerar/religar'

const APP = join(app.getPath('appData'), 'AniRecap Studio')
const RC = 'rc_25d63d4babd6_mv78ssvg'
const TEMP = mkdtempSync(join(tmpdir(), 'anirecap-religar-real-'))
const USER_DATA = join(TEMP, 'userData')
const PERFIL = join(TEMP, 'perfil')

mkdirSync(USER_DATA, { recursive: true })
copyFileSync(join(APP, 'settings.json'), join(USER_DATA, 'settings.json'))
copyFileSync(join(APP, 'Local State'), join(USER_DATA, 'Local State'))
// Antes do ready: e daqui que o safeStorage tira a chave do cofre (Local State).
app.setPath('userData', USER_DATA)

let reais = 0
async function umaSo<S extends z.ZodType>(pedido: PedidoJson<S>): Promise<RespostaJson<z.infer<S>>> {
  reais += 1
  if (reais > 1) throw new Error('mais de uma chamada real: recusada')
  const inicio = Date.now()
  const r = await gerarJson(pedido)
  console.log(`  chamada real ${pedido.etapa}: ${r.ok ? `ok ${r.modelo}` : `FALHA ${r.nota}`} em ${((Date.now() - inicio) / 1000).toFixed(1)} s`)
  return r
}

function porId(rt: Pick<Roteiro, 'secoes'>): Map<string, Frase> {
  return new Map(rt.secoes.flatMap((s) => s.frases.map((f) => [f.id, f] as const)))
}

void app.whenReady().then(async () => {
  let codigo = 0
  try {
    configureSettings(USER_DATA)
    const s = getSettings()
    console.log(`provedor ${s.iaProvedor}, modelo pedido '${s.geminiModelo || 'automatico'}', chave do Gemini ${s.geminiApiKey ? 'presente' : 'AUSENTE'}`)
    configurarEpisodios(PERFIL)
    mkdirSync(pastaDosRascunhos(), { recursive: true })
    copyFileSync(join(APP, 'recaps', `${RC}.json`), join(pastaDosRascunhos(), `${RC}.json`))
    trocarIaParaTeste(umaSo)

    const r0 = lerRascunhoDoDisco(RC)
    const v3 = roteiroAtual(r0)!
    const f = porId(v3)
    const texto = textoDoRoteiro(v3)
      .replace(f.get('f07')!.texto, 'O Taiju e a Yuzuriha finalmente se casaram numa baita comemoração.')
      .replace(f.get('f12')!.texto, 'A ideia agora é apagar a petrificação antes dela acontecer.')
      .replace(f.get('f13')!.texto, `${f.get('f13')!.texto} Ninguém achou que isso fosse possível.`)
    const res = await religarRoteiro(RC, { texto, modo: 'editar', versao: v3.versao, criadoEm: v3.criadoEm, pedidoId: 'real' }, (p) =>
      console.log(`  [${p.etapa}] ${p.mensagem}`),
    )
    if (ehParadaNoReserva(res)) throw new Error(`parou no reserva (${res.reserva})`)
    const depois = porId(res.roteiro)
    const mantidas = [...f.keys()].filter((id) => id !== 'f07' && id !== 'f12')
    const iguais = mantidas.filter((id) => JSON.stringify(depois.get(id)) === JSON.stringify(f.get(id))).length
    console.log(`\nversao v${res.rascunho.atual} (${res.roteiro.origem}, de v${res.roteiro.derivadoDe}), aprovado ${res.rascunho.aprovado}`)
    console.log(`mantidas iguais (id, texto e vinculos): ${iguais}/${mantidas.length}`)
    console.log(`f07 (parecida): ${depois.get('f07')?.eventoIds.join(',')} | ${depois.get('f07')?.texto}`)
    console.log(`religadas: ${res.religadas.join(', ') || '-'} | sem evento: ${res.semEvento.join(', ') || '-'} | doCache ${res.doCache}`)
    for (const id of res.frases.filter((x) => x.destino === 'nova').map((x) => x.id)) {
      const fr = depois.get(id)!
      const ev = res.rascunho.eventos.filter((e) => fr.eventoIds.includes(e.id))
      console.log(`  ${id}: "${fr.texto}"`)
      console.log(`     eventos ${fr.eventoIds.join(',') || '-'} | momento ${fr.cueDoMomento ?? '-'} | tela ${fr.textoDeTela ?? '-'}`)
      console.log(`     na tela: ${fr.intencaoVisual}`)
      for (const e of ev) console.log(`     ${e.id}: ${e.resumo}`)
    }
    if (res.avisos.length > 0) console.log(`avisos: ${res.avisos.join(' | ')}`)
    if (iguais !== mantidas.length || res.religadas.length === 0) codigo = 1
    console.log(`\nchamadas reais: ${reais}`)
  } catch (err) {
    codigo = 1
    console.log(`ERRO: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    // O Chromium ainda segura arquivos do userData: o perfil vai embora, o resto quando der.
    try {
      rmSync(PERFIL, { recursive: true, force: true })
    } catch {
      /* temporario */
    }
  }
  app.exit(codigo)
})
