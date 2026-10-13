# AniRecap Studio

Recap de anime com IA, do episódio ao short editável. Você solta o episódio, a IA
escreve o roteiro, gera a narração e escolhe as cenas do próprio episódio; o
resultado abre num editor de verdade, onde tudo pode ser ajustado à mão antes do
render.

O app junta dois projetos:

- o **AniRecap**, que transforma um `.mkv` num short 9:16 com narração e
  legendas, mas entrega um vídeo fechado;
- o **Dangai** (faahpla/Kintay), a máquina de shorts de recap com editor,
  timeline, legendas karaokê e render em Remotion.

O Studio nasce de uma cópia do Dangai v1.65.0 e vai ganhando a geração do
AniRecap por cima. O fluxo manual do Dangai continua igual.

## Estado: F0, base separada e ainda sem geração

Hoje o app é o Dangai v1.65.0 com identidade própria. Todas as funções do Dangai
continuam funcionando. O que muda:

- **Nome e ícone:** AniRecap Studio (`com.leviclementino.anirecapstudio`).
- **Dados em `%APPDATA%/AniRecap Studio`**, separados dos do Dangai: chaves,
  autosave, modelo do Whisper, caches e o Chrome do render. Os dois apps podem
  ficar instalados na mesma máquina sem um mexer no outro.
- **Projeto `.anirecap`.** O Studio também abre `.dangai`, que é o mesmo formato
  (versão 1). Salvar um projeto do Dangai abre o "Salvar como" na mesma pasta,
  já em `.anirecap`, e o `.dangai` original fica intacto.
- **Atualização automática desligada** até existir a primeira release (ver
  `ATUALIZACAO_LIGADA` em `electron/services/updater.ts`).

A geração a partir do episódio entra na F1. O plano completo, com as fases e as
decisões, está em `G:/ClaudeEditor/fusao/PLANO.md`.

## Rodar

Precisa de Node 24 e npm 11.

```bash
npm ci
npm run dev
```

Se o `postinstall` do Electron for bloqueado (rede, antivírus ou política de
scripts do npm), o binário não chega a ser baixado e o `npm run dev` reclama que
o Electron não foi instalado. Baixe à mão:

```bash
node node_modules/electron/install.js
```

| comando | o que faz |
| --- | --- |
| `npm run dev` | abre o app com recarga automática |
| `npm run typecheck` | TypeScript nos três processos |
| `npm run build` | typecheck + bundles do Electron e do Remotion |
| `npm run dist` | gera o instalador em `release/` |
| `npm run icon -- caminho/logo.png` | regenera `build/icon.ico` e `build/icon.png` |
| `npm run sfx` | sintetiza os SFX de exemplo |

## Publicar uma versão

O repositório é público desde o começo
([leviclementino1-creator/anirecap-studio](https://github.com/leviclementino1-creator/anirecap-studio)):
o updater lê as releases sem token, e um repositório privado obrigaria a
embutir um token no instalador.

```bash
npm version minor        # patch, se for só correção
git push
git push origin vX.Y.Z
npm run release          # ou deixe o workflow "release" do GitHub fazer
```

O push vem **antes** do release, e o script recusa publicar sem isso.
`npm run release -- --dry-run` monta e confere sem publicar. O
`scripts/release.mjs` explica por que não se usa `electron-builder --publish
always` e o que ele confere antes de subir qualquer arquivo (tag no remoto,
`latest.yml` da versão certa, tamanho do `.exe`).

Na primeira release, troque `ATUALIZACAO_LIGADA` para `true` no mesmo commit.

O instalador não é assinado, então o SmartScreen avisa na primeira execução:
**Mais informações → Executar assim mesmo**.

## Onde as coisas ficam

```
electron/     processo main: whisper, ffmpeg, render, arquivos
shared/       o que main e renderer precisam concordar (planos, legendas, alinhamento)
src/          interface React
src/remotion/ a composição do vídeo, a mesma no preview e no render
```

`shared/` existe porque o preview e o render precisam chegar exatamente ao mesmo
plano. Se divergirem, o preview mente.

## Privacidade

Na F0 vale o mesmo do Dangai: o áudio é transcrito localmente, as imagens nunca
são enviadas e, com a IA ligada, só o texto da transcrição vai para a API.
Isso muda quando a geração entrar: as legendas do episódio, o roteiro e os
quadros das cenas candidatas vão para o provedor de IA escolhido (Gemini por
padrão), e o texto da narração vai para o serviço de voz.

## Créditos

- **Dangai**, de faahpla (Kintay): a base inteira deste app.
  [github.com/faahpla/dangai](https://github.com/faahpla/dangai), commit `7ceaedd` (v1.65.0).
- **AnCut HUB**, de faahpla: o formato de biblioteca de episódios que o Studio lê.
- **AniRecap** e **Corte Cenas**, de Levi Clementino.
- Real-ESRGAN (BSD-3), lbpcascade_animeface (MIT), fonte Komika Axis e Remotion.

Os detalhes e as licenças estão em [NOTICE](NOTICE).
