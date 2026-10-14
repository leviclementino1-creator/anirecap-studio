# AniRecap Studio

Recap de anime com IA, do episódio ao short editável. É uma cópia do Dangai
v1.65.0 (`faahpla/dangai@7ceaedd`; commit-base local `d9aa005`) que vai
ganhando a geração do AniRecap por cima. O plano, as fases e as decisões do Levi
estão em `G:/ClaudeEditor/fusao/PLANO.md`: leia "Decisões do Levi" e a fase atual
antes de mexer. Estado: **F1** em andamento. O assistente "Gerar recap" faz
o caminho inteiro, na ordem decidida pelo Levi em 14/10 (`src/store/gerar-passos.ts`):

1. **Episódio**: falas e sugestão de OP/ED em segundos; o "Próximo: Roteiro"
   libera logo e o corte das cenas (+ personagens) roda em segundo plano
   (`falas.ts`, `corte-fundo.ts`). O índice nasce sem planos em
   `<bibliotecaStudio>/_indices/<id>` e ganha os planos no fim do corte.
2. **Roteiro**: eventos e roteiro pelo Gemini, versões e aprovação, salvo em
   `<userData>/recaps`; modo "Partes | Texto" e "Meu roteiro" (re-divide pelos
   pontos finais, mantém id e vínculos do que não mudou e religa o resto numa
   chamada só, `religar.ts`). Aprovado, as sugestões de cena saem de graça por trás.
3. **Voz**: ElevenLabs, Fish Audio ou áudio importado; corte de pausas, takes,
   regravar frase e aprovação, no mesmo rascunho.
4. **Cenas**: no tempo REAL do take aprovado (`shared/encaixe.ts`): a tela da
   seleção do Dangai (roteiro à esquerda com a barrinha rosa, grade com
   "Sugestoes para este trecho", player com a narração por cima). O casar
   (`electron/services/cenas/casar.ts`) é por regras, de graça: âncora pela
   citação/cue do momento (sem elas, pelas palavras da frase), trecho sem
   cenas no índice com aviso, plano longo dividido entre frases sem repetir
   trecho, troca local quando uma frase pega o plano do momento da seguinte.
   "Abrir no editor" monta o `.anirecap` (`electron/services/montar/`) em
   `<bibliotecaStudio>/_projetos/` e abre pelo caminho normal do Dangai.

O projeto montado leva `studio.vozAlinhada`: a guarda de reanálise
(`src/store/guarda-do-studio.ts`) impede que remover/inserir imagem, soltar
arquivo ou trocar o roteiro troque o transcript da voz pelo do Whisper.
Soltar UM vídeo longo (> 5 min) na tela inicial pergunta "Gerar recap" ou
"Usar como clipe" (`PerguntaDoEpisodio.tsx`).

Voz custa dinheiro do Levi: toda chamada paga passa pela pergunta de custo
(`confirmado`), e o cache por hash (`<userData>/recaps/cache/voz/`) nunca deixa
pagar duas vezes a mesma leitura. Para testar, use o provedor falso
(`scripts/teste/v-voz-motor.ts`) e o áudio sintético de `v-voz-sinal.ts`;
`v-voz-real.ts` gasta crédito de verdade (semeia o cache pago, confere o teto
total e, com `SO_CACHE=1`, recusa qualquer passo que cobraria).

## Regra central (do Dangai, mantida)

**O roteiro é a fonte da verdade.** O Whisper roda local e serve apenas para
obter os tempos; o texto das legendas vem sempre do roteiro, nunca da
transcrição. As cenas são cortadas pela pontuação do roteiro: um ponto final
encerra uma cena.

## Regras deste fork

- **Identificadores internos `dangai` ficam; só o que o usuário vê muda.**
  `window.dangai`, `DangaiBridge`, `dangaiStore`, chaves `dangai.*` do
  localStorage, classes CSS (`dangai-range`, `ease-dangai`), o id de composição
  `dangai` e as extensões de preset `.dangai-*` continuam como estão. Renomear
  só cria diff e atrapalha trazer correções do Dangai depois.
- Todas as funções do Dangai continuam. Código novo vai em arquivos novos, e a
  edição nos arquivos centrais (`src/store/project.ts` tem ~5 mil linhas) é
  mínima e cirúrgica.
- **Nunca escrever em bibliotecas do AnCut nem do Corte Cenas**
  (`G:\App Corte Cenas`, `%LOCALAPPDATA%\CorteCenas` e a saída do AnCut HUB).
  São só leitura. Para testar, use dados sintéticos numa pasta temporária.
- Os clones em `G:/ClaudeEditor/fusao/*` são referência, só leitura.
- Estilo do Dangai: comentários em português **sem acento** explicando o
  porquê, e textos de interface em ASCII ("Trocar a cena (N opcoes)").
- Projeto: grava `.anirecap` e abre `.anirecap` e `.dangai`, os dois no formato
  versão 1 (`shared/project-file.ts`). Nunca grava por cima de um `.dangai`.
- Dados em `%APPDATA%/AniRecap Studio`, que sai do `productName` do
  `package.json`. O updater fica desligado (`ATUALIZACAO_LIGADA` em
  `electron/services/updater.ts`) até a primeira release do repositório
  público `leviclementino1-creator/anirecap-studio`.

## Layout

| pasta | o que é |
|---|---|
| `src/` | renderer: `App.tsx`, `components/`, `hooks/`, `store/` |
| `src/remotion/` | composições Remotion que geram o vídeo |
| `electron/` | processo main e `electron/services/` |
| `shared/` | contrato entre main e renderer: `channels.ts`, `contract.ts`, `project-file.ts`, `plan.ts`, `align.ts`, `rhythm.ts`, `sfx.ts`, `selection.ts`; do Studio: `episodio.ts` (índice do episódio e estado do corte), `roteiro.ts` (eventos, roteiro, rascunho do recap e modo Texto), `voz.ts` (takes da narração, palavras com tempo, custo), `cenas.ts` (escolhas de cena por frase, fita, barrinha) e `encaixe.ts` (a cena na duração real da frase: emenda, fala citada, sem relance) |
| `electron/services/episodio/`, `electron/services/gerar/` | o main do "Gerar recap": passo 1 (índice, `falas.ts`, `corte-fundo.ts`) e passo 2 (prompts, cache de IA, rascunho, `religar.ts` + `prompt-religar.ts`) |
| `electron/services/cenas/`, `electron/services/montar/` | passo 4: `casar.ts` (a escolha de cena por regras, sem IA) e o "Abrir no editor" (pasta, foco, miniaturas e o `.anirecap`) |
| `electron/services/voz/` | o motor do passo 3: provedores (ElevenLabs, Fish), cache pago, alinhamento (palavras sem pontuação no wav2vec2), conferência pelo som (bordas, palavras suspeitas, fronteira de frase no silêncio), corte de pausas e velocidade, volume (-23 LUFS), emenda de frase regravada, áudio importado, taxa de crédito da conta, takes |
| `src/components/gerar/`, `src/store/gerar*.ts` | as telas e as stores do assistente (`gerar-passos.ts` = a ordem dos passos; `gerar-cenas.ts` = o passo 4 e as sugestões em segundo plano) |
| `scripts/` | ícone, SFX, `release.mjs` e testes manuais em `scripts/teste/` |

Mudou o formato de uma mensagem IPC? O tipo mora em `shared/`: mexa lá primeiro
e deixe os dois lados seguirem o tipo.

## Comandos

```bash
npm ci               # se o postinstall do Electron for bloqueado: node node_modules/electron/install.js
npm run dev          # app com recarga automática
npm run typecheck    # TS nos três processos
npm run build        # typecheck + bundles do Electron e do Remotion
npm run dist         # instalador em release/
```

`GH_TOKEN` (de `gh auth token`) só é necessário para **publicar** release.

Ambiente: Node 24 e npm 11; ffmpeg 9 no PATH.
