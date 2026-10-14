/**
 * TESTE REAL do passo 2 com o Gemini do Levi: eventos e roteiro de 60 s para
 * episodios de verdade, pelo mesmo caminho do app (rascunho, cache, prompts).
 *
 * Roda DENTRO do Electron com o userData do app ('%APPDATA%/AniRecap Studio'):
 * o safeStorage so decifra a chave assim. O settings e so LIDO (nada grava
 * nele); rascunhos, cache e miniaturas vao para um perfil de teste fora do app
 * (PERFIL, abaixo), para o teste nao aparecer como rascunho do Levi. A chave
 * nunca e impressa: o teste so ve o que o llm.ts devolve.
 *
 * Cota: cada rodada comeca um rascunho novo, mas o cache (por sha256 do prompt
 * inteiro) fica -- prompt que nao mudou nao chama a IA de novo.
 *
 * Rodar da raiz do projeto (PowerShell):
 *   npx esbuild scripts/teste/v-roteiro-ia.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json --outfile=out/teste/v-roteiro-ia.cjs
 *   $env:RODADA='1'; $env:EPS='37,24'; $env:EXTRAS='0'; npx electron out/teste/v-roteiro-ia.cjs
 * EXTRAS=1 tambem pede "Outra versao" e "Refazer esta parte" (s2, "mais forte").
 * MODELO=gemini-x troca o modelo SO NA MEMORIA deste processo (o settings.json
 * do Levi nao muda): a cota gratis do Gemini e por modelo, e a do automatico
 * pode acabar no meio do teste. MODELO_ROTEIRO=gemini-y troca so para o roteiro
 * (os eventos ficam do MODELO, no cache), quando um modelo esta lotado (503).
 */
import { app } from 'electron'
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { z } from 'zod'
import type { EpisodeIndex } from '../../shared/episodio'
import {
  cuesDoEvento,
  duracaoEstimada,
  faixaDePalavras,
  formatarTempo,
  momentoDaFrase,
  palavrasDoRoteiro,
  textoDoRoteiro,
  validarRoteiro,
  type RascunhoDoRecap,
  type Roteiro,
} from '../../shared/roteiro'
import { gerarJson, type PedidoJson, type RespostaJson } from '../../electron/services/llm'
import { configureSettings, getSettings } from '../../electron/services/settings'
import { configurarEpisodios } from '../../electron/services/episodio/indice'
import { trocarIaParaTeste } from '../../electron/services/gerar/ia'
import { abrirRascunho, pastaDosRascunhos } from '../../electron/services/gerar/rascunho'
import { gerarEventos } from '../../electron/services/gerar/eventos'
import { gerarRoteiro } from '../../electron/services/gerar/roteiro'

const SCRATCH = 'C:/Users/levic/AppData/Local/Temp/claude/G--ClaudeEditor/442547a5-4e27-4823-b36e-be8193446205/scratchpad/f1p2'
const PERFIL = join(SCRATCH, 'perfil')
const SAIDA = join(SCRATCH, 'roteiros')

const EPISODIOS: Record<string, { id: string; nome: string }> = {
  '37': { id: 'ep_25d63d4babd6dd9145aae70912d5b5b2b1fcb067', nome: 'ACHADO S4-37 (.ass com falantes)' },
  '24': { id: 'ep_7f20fe8a8728a5329c365e2b81648155cd2336e7', nome: 'NOVO S04E24 (.srt sem falantes)' },
}

const RODADA = process.env['RODADA'] ?? '1'
const EPS = (process.env['EPS'] ?? '37,24').split(',').map((s) => s.trim()).filter((s) => s in EPISODIOS)
const EXTRAS = process.env['EXTRAS'] === '1'
const MODELO = process.env['MODELO']?.trim() ?? ''
const MODELO_ROTEIRO = process.env['MODELO_ROTEIRO']?.trim() ?? ''

interface Medida {
  etapa: string
  ok: boolean
  modelo: string
  segundos: number
  nota?: string
}
const medidas: Medida[] = []

/** O gerarJson de verdade, medido. So passa aqui o que nao veio do cache. */
async function medido<S extends z.ZodType>(pedido: PedidoJson<S>): Promise<RespostaJson<z.infer<S>>> {
  const inicio = Date.now()
  const r = await gerarJson(pedido)
  const segundos = (Date.now() - inicio) / 1000
  medidas.push(r.ok ? { etapa: pedido.etapa, ok: true, modelo: r.modelo, segundos } : { etapa: pedido.etapa, ok: false, modelo: '-', segundos, nota: r.nota })
  console.log(`  [ia] ${pedido.etapa}: ${r.ok ? r.modelo : `FALHOU (${r.nota})`} em ${segundos.toFixed(1)} s`)
  return r
}

function textoLegivel(r: RascunhoDoRecap, indice: EpisodeIndex, roteiros: readonly Roteiro[]): string {
  const cues = new Map(indice.cues.map((c) => [c.id, c]))
  const linhas: string[] = [`# ${r.titulo} (rodada ${RODADA})`, `eventos: ${r.eventos.length} (${r.eventosMeta?.modelo ?? '?'})`, '']
  for (const ev of r.eventos) {
    linhas.push(`${ev.id} [${formatarTempo(ev.t0)}-${formatarTempo(ev.t1)}] peso ${ev.peso} | ${ev.personagens.join(', ')}: ${ev.resumo}`)
    // O trecho inteiro (o evento guarda todas as falas da primeira a ultima citada).
    for (const c of cuesDoEvento(ev, indice)) linhas.push(`     ${c.id} ${c.falante ? `(${c.falante}) ` : ''}${c.texto}`)
  }
  for (const rot of roteiros) {
    const palavras = palavrasDoRoteiro(rot)
    const f = faixaDePalavras(rot.alvoSec)
    linhas.push(
      '',
      `## Versao ${rot.versao} (${rot.origem}, ${rot.modelo}, pedido ${rot.pedido?.tipo ?? '-'}${rot.pedido?.secaoId ? ` ${rot.pedido.secaoId}` : ''}${rot.pedido?.instrucao ? ` "${rot.pedido.instrucao}"` : ''})`,
      `${palavras} palavras (${f.min}-${f.max}), ~${duracaoEstimada(palavras).toFixed(0)} s`,
    )
    // Os avisos do validarRoteiro por frase: o que a tela vai mostrar no triangulo ambar.
    const problemas = validarRoteiro(rot, r.eventos, indice)
    for (const p of problemas) if (!p.fraseId && p.nivel === 'aviso') linhas.push(`AVISO: ${p.mensagem}`)
    for (const s of rot.secoes) {
      linhas.push(`[${s.id} ${s.papel}]`)
      for (const fr of s.frases) {
        const m = momentoDaFrase(fr, r.eventos, indice)
        const daFrase = problemas.filter((p) => p.fraseId === fr.id).map((p) => p.mensagem)
        const cit = fr.citacaoCueId ? ` CITA ${fr.citacaoCueId}: "${cues.get(fr.citacaoCueId)?.texto ?? '?'}"` : ''
        linhas.push(
          `  ${fr.id} ${fr.texto}`,
          `       ev ${fr.eventoIds.join(',') || '-'} @${m ? formatarTempo(m.t) : '-'} (${fr.cueDoMomento ?? 'sem cue do momento'}) cena ${m?.planoId ?? '-'} | vis: ${fr.intencaoVisual}${fr.textoDeTela ? ` | TELA: ${fr.textoDeTela}` : ''}${cit}`,
          ...(daFrase.length > 0 ? [`       !! ${daFrase.join(' / ')}`] : []),
        )
      }
    }
    linhas.push('', 'TEXTO CORRIDO:', textoDoRoteiro(rot))
  }
  return linhas.join('\n')
}

async function rodarEpisodio(chave: string): Promise<void> {
  const ep = EPISODIOS[chave]!
  if (MODELO) getSettings().geminiModelo = MODELO
  console.log(`\n== ${ep.nome}`)
  // Rascunho novo a cada rodada (os eventos sao fixos por rascunho); o cache fica.
  for (const nome of readdirSync(pastaDosRascunhos(), { withFileTypes: true })) {
    if (nome.isFile() && nome.name.startsWith(`rc_${ep.id.slice(3, 15)}_`)) rmSync(join(pastaDosRascunhos(), nome.name))
  }
  const aberto = await abrirRascunho(ep.id)
  const id = aberto.rascunho.id
  const avisar = (p: { etapa: string; mensagem: string }): void => console.log(`  ... ${p.etapa}: ${p.mensagem}`)
  const avisos: Record<string, string[]> = {}

  const ev = await gerarEventos(id, avisar)
  avisos['eventos'] = ev.avisos
  console.log(`  eventos: ${ev.rascunho.eventos.length}${ev.doCache ? ' (cache)' : ''} ${ev.avisos.join(' | ')}`)
  if (MODELO_ROTEIRO) getSettings().geminiModelo = MODELO_ROTEIRO

  const r1 = await gerarRoteiro(id, { alvoSec: 60 }, avisar)
  avisos['roteiro'] = r1.avisos
  console.log(`  roteiro v${r1.roteiro.versao}: ${palavrasDoRoteiro(r1.roteiro)} palavras${r1.doCache ? ' (cache)' : ''} ${r1.avisos.join(' | ')}`)
  let final = r1.rascunho
  if (EXTRAS) {
    const r2 = await gerarRoteiro(id, { alvoSec: 60 }, avisar)
    avisos['outra'] = r2.avisos
    console.log(`  outra versao v${r2.roteiro.versao}: ${palavrasDoRoteiro(r2.roteiro)} palavras`)
    const r3 = await gerarRoteiro(id, { alvoSec: 60, secaoId: 's2', instrucao: 'mais forte' }, avisar)
    avisos['secao'] = r3.avisos
    console.log(`  refazer s2 v${r3.roteiro.versao}: ${palavrasDoRoteiro(r3.roteiro)} palavras`)
    final = r3.rascunho
  }

  const base = `${chave === '37' ? 'achado-s4-37' : 'novo-s04e24'}-r${RODADA}`
  writeFileSync(join(SAIDA, `${base}.json`), JSON.stringify({ rascunho: final, avisos, medidas: medidas.slice() }, null, 2), 'utf8')
  writeFileSync(join(SAIDA, `${base}.txt`), textoLegivel(final, aberto.indice, final.roteiros), 'utf8')
  console.log(`  salvo: ${base}.json / .txt`)
}

// Antes do ready: e daqui que o safeStorage tira a chave do cofre (Local State).
app.setPath('userData', join(app.getPath('appData'), 'AniRecap Studio'))

void app.whenReady().then(async () => {
  let codigo = 0
  try {
    configureSettings(app.getPath('userData'))
    const s = getSettings()
    if (MODELO) s.geminiModelo = MODELO
    console.log(`provedor ${s.iaProvedor}, modelo pedido '${s.geminiModelo || 'automatico'}', chave do Gemini ${s.geminiApiKey ? 'presente' : 'AUSENTE'}`)
    mkdirSync(PERFIL, { recursive: true })
    mkdirSync(SAIDA, { recursive: true })
    configurarEpisodios(PERFIL)
    mkdirSync(pastaDosRascunhos(), { recursive: true })
    trocarIaParaTeste(medido)
    for (const ep of EPS) await rodarEpisodio(ep)
  } catch (err) {
    codigo = 1
    console.log(`ERRO: ${err instanceof Error ? err.message : String(err)}`)
  }
  console.log('\nchamadas reais:')
  for (const m of medidas) console.log(`  ${m.etapa.padEnd(8)} ${m.ok ? 'ok   ' : 'FALHA'} ${m.modelo.padEnd(24)} ${m.segundos.toFixed(1)} s${m.nota ? `  ${m.nota}` : ''}`)
  app.exit(codigo)
})
