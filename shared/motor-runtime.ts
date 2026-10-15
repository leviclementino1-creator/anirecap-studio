import { z } from 'zod'

/**
 * O RUNTIME DO MOTOR no app instalado: contrato entre o main
 * (electron/services/motor-runtime/) e a tela (src/components/motor-runtime/,
 * src/store/motor-runtime.ts). Desenho aprovado pelo Levi em 15/10.
 *
 * DONO: agente A (runtime + tela). O agente B (empacotamento + updater) so le
 * `fase` (para segurar o "Atualizar" enquanto o motor instala).
 *
 * O .exe leva o CODIGO do motor (resources/motor) e o uv (resources/uv). O
 * RUNTIME -- Python 3.12 + torch + pacotes, ~5 GB no disco -- nao cabe no
 * instalador (o GitHub limita a 2 GB por arquivo) e e instalado no primeiro
 * uso, das fontes oficiais, em %LOCALAPPDATA%\AniRecap Studio\motor-runtime:
 *
 *   motor-runtime/
 *     python/         uv python install (python-build-standalone), --no-bin --no-registry
 *     venv/           uv venv: Scripts/python.exe + Lib/site-packages (torch...)
 *     baixando/       as rodas do torch, retomaveis (.part + .part.json); apagadas no fim
 *     uv-cache/       UV_CACHE_DIR: retomada dos pacotes; apagada no fim
 *     req/pacotes.txt o lock em formato pip (com --hash), gerado a cada instalacao
 *     logs/instalar.log  saida do uv e das etapas da ultima instalacao
 *     estado.json     EstadoGravado: a instalacao em andamento (retomada)
 *     impressao.json  ImpressaoGravada: escrito SO no fim de uma instalacao boa
 *     instalando.trava  pid de quem instala (duas janelas nao instalam juntas)
 *
 * Em dev nada disso existe (fase 'dev'): o motor continua no motor/.venv.
 * ANIRECAP_MOTOR_RUNTIME=1 liga o runtime no dev, para testar a instalacao.
 */

// ------------------------------------------------------------------ o lock

/** Uma roda do torch, baixada pelo proprio app (retomavel) e conferida pelo sha256. */
export interface RodaDoTorch {
  nome: 'torch' | 'torchvision'
  /** Com o sufixo local: "2.11.0+cu128". */
  versao: string
  arquivo: string
  url: string
  sha256: string
  bytes: number
}

/** Um pacote do PyPI, instalado pelo uv com --no-deps e --require-hashes. */
export interface PacoteDoLock {
  /** Normalizado (PEP 503): minusculas, com hifen. */
  nome: string
  versao: string
  /** Do arquivo que o uv vai preferir no Windows x64 (para a barra e o "~3 GB"). */
  bytes: number
  /** Todos os sha256 que o uv pode encontrar para esta versao. */
  hashes: string[]
}

/**
 * motor/studio-runtime.json, gerado por scripts/motor-lock.mjs a partir do
 * `uv pip freeze` do motor/.venv do dev (sem o Qt). Vai no instalador dentro
 * de resources/motor.
 */
export interface LockDoRuntime {
  formato: 1
  comentario?: string
  /** "3.12.13": o uv instala esta, exata. */
  python: string
  /** https://pypi.org/simple */
  indice: string
  torch: Record<VarianteDoMotor, RodaDoTorch[]>
  pacotes: PacoteDoLock[]
}

// ------------------------------------------------------------- o que grava

/** cu128: NVIDIA (o torch leva o CUDA, 2,7 GB). cpu: sem NVIDIA (120 MB). */
export const varianteDoMotorSchema = z.enum(['cu128', 'cpu'])
export type VarianteDoMotor = z.infer<typeof varianteDoMotorSchema>

/**
 * impressao.json. A `impressao` e o sha256 de
 * {formato, python, variante, rodas [nome, versao], pacotes [nome==versao] em ordem}
 * (impressaoDoLock em electron/services/motor-runtime/lock.ts). Os mapas
 * guardados servem para dizer O QUE mudou numa atualizacao do app.
 */
export interface ImpressaoGravada {
  formato: 1
  impressao: string
  variante: VarianteDoMotor
  python: string
  /** nome -> versao das rodas instaladas ("torch" -> "2.11.0+cu128"). */
  rodas: Record<string, string>
  /** nome -> versao dos pacotes instalados. */
  pacotes: Record<string, string>
  /** O torch rodou uma conta na GPU na conferencia. false = o motor sobe com CUDA_VISIBLE_DEVICES=-1. */
  cudaOk: boolean
  gpu: string | null
  uv: string
  /** Versao do app que instalou. */
  app: string
  /** ISO. */
  instaladoEm: string
  /** Medido no fim (python/ + venv/). Ausente nas gravadas antes de medir. */
  bytesNoDisco?: number
}

/** estado.json: a instalacao que comecou e ainda nao terminou. */
export interface EstadoGravado {
  formato: 1
  /** A impressao que esta instalacao vai gravar no fim. Outra = recomeca o plano. */
  alvo: string
  variante: VarianteDoMotor
  etapasFeitas: EtapaDaInstalacao[]
  /** Fracao total quando parou (o "Continuar (43%)"). */
  fracao: number
  cancelado: boolean
  erro: ErroDaInstalacao | null
  iniciadoEm: string
  atualizadoEm: string
  /** A etapa em que parou (o 'Parou em Baixar torch'). */
  etapa?: EtapaDaInstalacao
  /** Comecou como atualizacao automatica (so pacotes). */
  automatica?: boolean
}

// --------------------------------------------------------------- a instalacao

/**
 * - dev: em desenvolvimento o motor e o motor/.venv; nada a instalar.
 * - ausente: nunca instalado nesta pasta.
 * - incompleto: comecou e parou (cancelou, erro, app fechou). Da para continuar.
 * - instalando: rodando agora (instalar, continuar ou atualizar).
 * - desatualizado: instalado, mas o studio-runtime.json do app mudou.
 * - pronto: impressao.json bate com o lock do app.
 */
export type FaseDoMotorRuntime = 'dev' | 'ausente' | 'incompleto' | 'instalando' | 'desatualizado' | 'pronto'

/** As etapas, na ordem. Cada uma confere o disco antes e pula o que ja esta feito. */
export const ETAPAS_DA_INSTALACAO = ['preparar', 'python', 'venv', 'baixar-torch', 'torch', 'pacotes', 'conferir'] as const
export type EtapaDaInstalacao = (typeof ETAPAS_DA_INSTALACAO)[number]

/** Quanto cada etapa pesa na barra numa instalacao completa cu128 (o main ajusta pelo plano). */
export const PESO_DAS_ETAPAS: Record<EtapaDaInstalacao, number> = {
  preparar: 0.01,
  python: 0.02,
  venv: 0.01,
  'baixar-torch': 0.7,
  torch: 0.12,
  pacotes: 0.1,
  conferir: 0.04,
}

/** Rotulo curto de cada etapa (ASCII, uma ou duas palavras). */
export const ROTULO_DA_ETAPA: Record<EtapaDaInstalacao, string> = {
  preparar: 'Preparar',
  python: 'Python',
  venv: 'Ambiente',
  'baixar-torch': 'Baixar torch',
  torch: 'Instalar torch',
  pacotes: 'Pacotes',
  conferir: 'Conferir',
}

export type TipoDeErroDaInstalacao =
  /** DNS, conexao recusada, tempo esgotado, HTTP 5xx. */
  | 'sem-internet'
  /** Antes de comecar (statfs) ou ENOSPC no meio. */
  | 'sem-espaco'
  /** sha256 de uma roda nao bateu: o arquivo e apagado. */
  | 'arquivo-corrompido'
  /** O uv saiu com erro (python, venv, pacotes, pip check). */
  | 'uv'
  /** Instalou, mas o torch ou o `app.headless probe` nao responderam. */
  | 'conferencia'
  /** Outro processo do app esta instalando (instalando.trava com pid vivo). */
  | 'ocupado'
  /** Nao consegue gravar na pasta, ou o caminho e longo demais. */
  | 'pasta'
  /** resources/uv/uv.exe faltando ou de outra versao: instalador do app quebrado. */
  | 'uv-ausente'
  /** Sistema sem suporte (fora do Windows x64). */
  | 'sistema'

export interface ErroDaInstalacao {
  tipo: TipoDeErroDaInstalacao
  /** Uma frase curta, ASCII, que diz o que fazer ("Sem internet. Confira a conexao e clique em Continuar."). */
  mensagem: string
  /** Para o tooltip: a cauda do log do uv, o caminho, o codigo. */
  detalhe?: string
}

export interface AndamentoDaInstalacao {
  etapa: EtapaDaInstalacao
  /** 0..1 da instalacao inteira. null = sem como medir agora (spinner). */
  fracao: number | null
  /** Curta: "Baixando torch", "Instalando pacotes (12/60)". */
  mensagem: string
  /** So no baixar-torch: bytes ja no disco e o total das rodas. */
  baixados?: number
  total?: number
  /** Media dos ultimos segundos, para "18 MB/s". */
  bytesPorSegundo?: number
}

/** O que mudou entre o runtime instalado e o lock do app (fase 'desatualizado'). */
export interface MudancasDoRuntime {
  /** Python de outra versao: o venv inteiro e refeito. */
  python: boolean
  /** torch/torchvision de outra versao (ou outra variante): baixa de novo. */
  torch: boolean
  /** "numpy 2.5.2 -> 2.6.0", "+ novo 1.0", "- velho 2.0". */
  pacotes: string[]
  /** Sem python nem torch: o app atualiza sozinho ao abrir e so avisa. */
  automatica: boolean
  /** Quanto falta baixar (estimativa). */
  bytes: number
}

export interface GpuDetectada {
  /** "NVIDIA GeForce RTX 5080". null = sem NVIDIA. */
  nome: string | null
  /** "581.57". null = nao deu para ler (veio pelo WMI). */
  driver: string | null
  /** Driver abaixo do minimo do CUDA 12.8 (DRIVER_MINIMO_CU128): instala, mas avisa. */
  driverAntigo: boolean
  /** Por onde soube: nvidia-smi, WMI ou nenhum. */
  fonte: 'nvidia-smi' | 'wmi' | 'nenhuma'
}

/** CUDA 12.8 no Windows pede driver R570 ou mais novo. */
export const DRIVER_MINIMO_CU128 = 570.65

/** Tudo que a tela precisa, sempre inteiro (o evento manda o estado todo). */
export interface EstadoDoMotorRuntime {
  fase: FaseDoMotorRuntime
  /** A pasta efetiva do runtime. */
  pasta: string
  /** false = o Levi escolheu outra pasta (<userData>/motor-runtime.json). */
  pastaPadrao: boolean
  /** A instalada, ou a da instalacao em andamento. null = nada instalado. */
  variante: VarianteDoMotor | null
  /** Pela GPU detectada. */
  varianteSugerida: VarianteDoMotor
  /** null = ainda detectando (a 1a leitura leva ~1 s). */
  gpu: GpuDetectada | null
  /** O que falta baixar para chegar ao 'pronto' (o "~3 GB" do botao). */
  bytesParaBaixar: number
  /** Quanto o runtime ocupa (ou vai ocupar) no disco. */
  bytesNoDisco: number
  /** Espaco livre no disco da pasta. null = nao deu para medir. */
  livreNoDisco: number | null
  /** Quanto precisa estar livre para chegar ao 'pronto' (o que falta + a folga). 0 = nada. */
  precisaDeLivre: number
  /** So em 'instalando' (e o ultimo, em 'incompleto'). */
  andamento: AndamentoDaInstalacao | null
  /** O que parou a ultima tentativa. null em 'instalando' e 'pronto'. */
  erro: ErroDaInstalacao | null
  /** So em 'desatualizado' e na atualizacao em andamento. */
  mudancas: MudancasDoRuntime | null
  /** Aviso de uma linha depois de uma atualizacao automatica ("Motor atualizado: 3 pacotes"). */
  aviso: string | null
  /** <pasta>/logs/instalar.log, quando existe. */
  log: string | null
}

export const pedidoDeInstalacaoSchema = z.object({
  /** Ausente = a sugerida (ou a ja instalada, numa atualizacao). */
  variante: varianteDoMotorSchema.optional(),
  /** Apaga venv, baixando/ e uv-cache e faz do zero (o "Recomecar" depois de erro de conferencia). */
  recomecar: z.boolean().optional(),
})
export type PedidoDeInstalacao = z.infer<typeof pedidoDeInstalacaoSchema>

// ------------------------------------------------------------ contas puras

/** Folga alem do que o runtime ocupa: o uv descompacta antes de ligar os arquivos. */
export const FOLGA_DE_DISCO = 1.5e9

/** O Python do uv instalado (python/cpython-3.12.13-...). */
export const DISCO_DO_PYTHON = 0.1e9

/** torch + torchvision instalados, com os .pyc (medido em 15/10: cu128 4,1 GB; cpu ~0,5 GB). */
export const DISCO_DO_TORCH: Record<VarianteDoMotor, number> = {
  cu128: 4.3e9,
  cpu: 0.55e9,
}

/** Os pacotes do PyPI ocupam ~4x o que baixam (medido: 170 MB -> 0,65 GB). */
export const FATOR_DOS_PACOTES = 4

/**
 * Quanto ocupa instalado: python + venv com os .pyc (medido em 15/10 pelo
 * proprio instalador: cu128 5,2 GB, cpu 1,2 GB). O pico durante a instalacao
 * cu128 foi ~7,3 GB (a roda de 2,7 GB ainda no disco enquanto o uv liga os
 * arquivos): coberto pela FOLGA_DE_DISCO.
 */
export const DISCO_POR_VARIANTE: Record<VarianteDoMotor, number> = {
  cu128: 5.2e9,
  cpu: 1.2e9,
}

/** O que baixar do zero numa variante: rodas + pacotes + o Python (~30 MB). */
export function bytesDaInstalacaoCompleta(lock: LockDoRuntime, variante: VarianteDoMotor): number {
  const rodas = lock.torch[variante].reduce((s, r) => s + r.bytes, 0)
  const pacotes = lock.pacotes.reduce((s, p) => s + p.bytes, 0)
  return rodas + pacotes + 30e6
}

/** "~3 GB", "~320 MB": o tamanho no botao, arredondado para cima de leve. */
export function textoDoTamanho(bytes: number): string {
  if (bytes >= 1e9) {
    const gb = bytes / 1e9
    return `~${gb >= 2 ? Math.round(gb) : gb.toFixed(1).replace('.', ',')} GB`
  }
  return `~${Math.max(1, Math.round(bytes / 1e7) * 10)} MB`
}

/**
 * O que mudou entre o que esta instalado e o lock do app. null = nada.
 * Variante trocada conta como torch mudado (os pacotes ficam).
 */
export function mudancasDoRuntime(
  gravada: Pick<ImpressaoGravada, 'python' | 'variante' | 'rodas' | 'pacotes'>,
  lock: LockDoRuntime,
  variante: VarianteDoMotor = gravada.variante,
): MudancasDoRuntime | null {
  const python = gravada.python !== lock.python
  const rodas = lock.torch[variante]
  const torch = variante !== gravada.variante || rodas.some((r) => gravada.rodas[r.nome] !== r.versao)
  const pacotes: string[] = []
  let bytes = 0
  const noLock = new Map(lock.pacotes.map((p) => [p.nome, p]))
  for (const p of lock.pacotes) {
    const antes = gravada.pacotes[p.nome]
    if (antes === p.versao && !python) continue
    if (antes !== p.versao) pacotes.push(antes ? `${p.nome} ${antes} -> ${p.versao}` : `+ ${p.nome} ${p.versao}`)
    bytes += p.bytes
  }
  for (const [nome, versao] of Object.entries(gravada.pacotes)) {
    if (!noLock.has(nome)) pacotes.push(`- ${nome} ${versao}`)
  }
  if (torch || python) bytes += rodas.reduce((s, r) => s + r.bytes, 0)
  if (python) bytes += 30e6
  if (!python && !torch && pacotes.length === 0) return null
  return { python, torch, pacotes, automatica: !python && !torch, bytes }
}
