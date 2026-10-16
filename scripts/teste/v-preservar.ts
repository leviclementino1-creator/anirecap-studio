/**
 * GUARDA O QUE NAO CONHECE (v0.1.1), sem janela e sem tocar em nada do Levi:
 *
 *   1. campo de raiz desconhecido (o `modulos` do Dangai) passa pelo schema e
 *      sai em extrasDoProjeto, para o store devolver no save;
 *   2. campos novos da sobreposicao do Dangai 1.67 (chaves, curvaDasChaves,
 *      pivo) e um campo desconhecido no trecho de audio saem intactos;
 *   3. papel desconhecido vira "sem papel" e `studio` invalido vira "sem
 *      origem" -- o projeto abre, em vez de "corrompido";
 *   4. o projeto real do Levi (so leitura) continua passando igual.
 *
 * Rodar da raiz:
 *   npx esbuild scripts/teste/v-preservar.ts --bundle --platform=node --packages=external --tsconfig=tsconfig.node.json --outfile=out/teste/v-preservar.cjs
 *   node out/teste/v-preservar.cjs
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extrasDoProjeto, projectFileSchema } from '@shared/project-file'

let falhas = 0
function conferir(nome: string, ok: boolean, detalhe = ''): void {
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${nome}${detalhe ? ` -- ${detalhe}` : ''}`)
  if (!ok) falhas++
}

/** Um projeto minimo valido, com uma trilha e uma sobreposicao. */
function minimo(): Record<string, unknown> {
  const ref = { path: 'C:/x/narracao.wav', rel: null, fileName: 'narracao.wav' }
  return {
    version: 1,
    savedAt: '2026-10-16T00:00:00.000Z',
    audio: ref,
    images: [],
    script: null,
    subtitle: null,
    plan: null,
    planOrigin: null,
    planEdited: false,
    transcript: null,
    captions: [],
    captionsEdited: false,
    captionsEnabled: true,
    sfxEnabled: true,
    trilhas: [],
    sobreposicoes: [],
  }
}

// 1 e 2: o que um Dangai mais novo gravaria
{
  const base = minimo()
  const bruto = JSON.parse(JSON.stringify(base)) as Record<string, unknown>
  bruto['modulos'] = { recap: { versao: 1, qualquer: [1, 2, 3] } }
  const r = projectFileSchema.safeParse(bruto)
  conferir('raiz desconhecida passa no schema', r.success && 'modulos' in (r.data as object))
  if (r.success) {
    const extras = extrasDoProjeto(r.data as Record<string, unknown>)
    conferir('extrasDoProjeto devolve so o desconhecido', JSON.stringify(Object.keys(extras)) === '["modulos"]', Object.keys(extras).join(','))
    conferir('o valor volta igual', JSON.stringify(extras['modulos']) === JSON.stringify(bruto['modulos']))
  }
}

// 2: itens com campos novos (pega uma sobreposicao e um trecho reais do schema, se existirem no projeto do Levi)
const PROJETOS = 'G:/AniRecap Studio/Biblioteca/_projetos'
let real: Record<string, unknown> | null = null
if (existsSync(PROJETOS)) {
  for (const pasta of readdirSync(PROJETOS)) {
    const arq = readdirSync(join(PROJETOS, pasta)).find((f) => f.endsWith('.anirecap'))
    if (!arq) continue
    real = JSON.parse(readFileSync(join(PROJETOS, pasta, arq), 'utf8')) as Record<string, unknown>
    const r = projectFileSchema.safeParse(real)
    conferir(`projeto real abre (${arq})`, r.success, r.success ? '' : r.error.issues[0]?.message ?? '')
    if (r.success) conferir('nenhum extra num projeto do proprio Studio', Object.keys(extrasDoProjeto(r.data as Record<string, unknown>)).length === 0)
    break
  }
}
if (real) {
  const p = JSON.parse(JSON.stringify(real)) as { sobreposicoes: Record<string, unknown>[]; trilhas: Record<string, unknown>[]; studio?: Record<string, unknown> }
  if (p.sobreposicoes.length > 0) {
    p.sobreposicoes[0]!['chaves'] = [{ t: 0, x: 1 }]
    p.sobreposicoes[0]!['curvaDasChaves'] = 'suave'
    p.sobreposicoes[0]!['pivo'] = { x: 0.5, y: 0.5 }
  }
  if (p.trilhas.length > 0) p.trilhas[0]!['modulos'] = { recap: { papel: 'musica' } }
  const r = projectFileSchema.safeParse(p)
  conferir('itens com campos novos abrem', r.success)
  if (r.success && p.sobreposicoes.length > 0) {
    const o = r.data.sobreposicoes[0] as Record<string, unknown>
    conferir('sobreposicao guarda chaves/curvaDasChaves/pivo', JSON.stringify([o['chaves'], o['curvaDasChaves'], o['pivo']]) === JSON.stringify([[{ t: 0, x: 1 }], 'suave', { x: 0.5, y: 0.5 }]))
  }
  if (r.success && p.trilhas.length > 0) {
    conferir('trecho de audio guarda o desconhecido', JSON.stringify((r.data.trilhas[0] as Record<string, unknown>)['modulos']) === '{"recap":{"papel":"musica"}}')
  }

  // 3: papel e studio de uma versao mais nova
  const q = JSON.parse(JSON.stringify(real)) as typeof p
  if (q.trilhas.length > 0) q.trilhas[0]!['papel'] = 'papel-que-nao-existe'
  if (q.sobreposicoes.length > 0) q.sobreposicoes[0]!['papel'] = 'outro'
  if (q.studio) q.studio['rascunhoId'] = 'formato novo'
  const r3 = projectFileSchema.safeParse(q)
  conferir('papel e studio desconhecidos nao derrubam o projeto', r3.success, r3.success ? '' : r3.error.issues[0]?.message ?? '')
  if (r3.success) {
    if (q.trilhas.length > 0) conferir('papel desconhecido vira sem papel', r3.data.trilhas[0]!.papel === undefined)
    if (q.studio) conferir('studio invalido vira sem origem', r3.data.studio === undefined)
  }
} else {
  console.log('(sem projeto do Levi nesta maquina: parte 2 e 3 puladas)')
}

console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} FALHA(S)`)
process.exit(falhas === 0 ? 0 : 1)
