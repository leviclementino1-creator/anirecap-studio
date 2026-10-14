# AniRecap Studio

Recap de anime com IA, do episódio ao short editável. É uma cópia do Dangai
v1.65.0 (`faahpla/dangai@7ceaedd`; commit-base local `d9aa005`) que vai
ganhando a geração do AniRecap por cima. O plano, as fases e as decisões do Levi
estão em `G:/ClaudeEditor/fusao/PLANO.md`: leia "Decisões do Levi" e a fase atual
antes de mexer. Estado: **F1** em andamento. O assistente "Gerar recap" já tem
o passo 1 (Episódio: índice, falas, OP/ED) e o passo 2 (Roteiro: eventos e
roteiro pelo Gemini, com versões e aprovação, salvo em `<userData>/recaps`).
Voz (parte 3) e Cenas (parte 4) ainda não.

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
| `shared/` | contrato entre main e renderer: `channels.ts`, `contract.ts`, `project-file.ts`, `plan.ts`, `align.ts`, `rhythm.ts`, `sfx.ts`, `selection.ts`; do Studio: `episodio.ts` (índice do episódio) e `roteiro.ts` (eventos, roteiro e rascunho do recap) |
| `electron/services/episodio/`, `electron/services/gerar/` | o main do "Gerar recap": passo 1 e passo 2 (prompts, cache de IA, rascunho) |
| `src/components/gerar/`, `src/store/gerar*.ts` | as telas e as stores do assistente |
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
