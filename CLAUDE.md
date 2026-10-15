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
   **Reconhecer na mao** (15/10): sem fotos do elenco ('sem-referencias',
   'anime-nao-encontrado') ou nas cenas sem personagem, o motor agrupa os
   rostos (`run` com `discovery`), o Levi da nome aos grupos (elenco da
   AniList como sugestao, ignorar, juntar) e o commit grava os personagens
   no indice e as fotos como referencia no motor do Studio: o proximo
   episodio do anime reconhece sozinho. "Revisar personagens" refaz.
2. **Roteiro**: eventos e roteiro pelo Gemini, versões e aprovação, salvo em
   `<userData>/recaps`; modo "Partes | Texto" e "Meu roteiro" (re-divide pelos
   pontos finais, mantém id e vínculos do que não mudou e religa o resto numa
   chamada só, `religar.ts`). Aprovado, as sugestões de cena saem de graça por trás.
   O alvo (prompt, mínimo de 92%, nº de frases, "~Xs") é no **ritmo** da voz que
   vai narrar (`shared/ritmo.ts`): palavras/s do take final, aprendido dos takes
   em `<userData>/recaps/ritmos.json`; sem take, o inicial calibrado (2,84 p/s a
   1,0; ~3,76 a 1,2). Só take de roteiro inteiro ensina (≥ 20 s e ≥ 50
   palavras), e o aprendido fica entre 0,75x e 1,35x do inicial daquela
   velocidade. O 2,7 fixo ficou só como molde das frases por papel.
3. **Voz**: ElevenLabs, Fish Audio ou áudio importado; corte de pausas, takes,
   regravar frase e aprovação, no mesmo rascunho. Duas velocidades (15/10): a
   NATIVA (speed do provedor, 0,7–1,2, padrão 1,2 no perfil; muda o áudio, é
   paga) e o "acelerar" do pós (atempo, até 1,25, grátis). A nativa só entra na
   chave do cache quando ≠ 1,0: a chave da 1,0 é a de antes (`v-voz-velocidade.ts`
   confere o hash antigo). Take abaixo do alvo avisa ("52 s - abaixo de 1 min",
   em segundos arredondados), e o passo 3 ja mostra a duracao PREVISTA ("~48 s")
   antes de gerar ou aplicar. Com o atempo, os testes aceitam palavra contra tom
   ate 25 ms (meio quadro, sem deriva) quando ha acelerar (`pos.ts`).
4. **Cenas**: no tempo REAL do take aprovado (`shared/encaixe.ts`): a tela da
   seleção do Dangai (roteiro à esquerda com a barrinha rosa, grade com
   "Sugestoes para este trecho", player com a narração por cima). O casar
   (`electron/services/cenas/casar.ts`) é por regras, de graça: âncora pela
   citação/cue do momento (sem elas, pelas palavras da frase), trecho sem
   cenas no índice com aviso, plano longo dividido entre frases sem repetir
   trecho, troca local quando uma frase pega o plano do momento da seguinte.
   "Abrir no editor" monta o `.anirecap` (`electron/services/montar/`) em
   `<bibliotecaStudio>/_projetos/` e abre pelo caminho normal do Dangai.

**Edição rápida** (14/10): o botão "Edicao rapida" do editor (e a caixinha
ligada por padrão ao lado do "Abrir no editor") faz num passo só de Ctrl+Z:
whoosh nas viradas de parte e impacto no gancho e no clímax (pasta de SFX, pelo
nome, nivelado por LUFS contra a voz integrada E a frase em volta; com um
arquivo só de um tipo, ele toca só nas 2 marcas principais, e o passo 4 avisa
"SFX de fabrica"), música da pasta de músicas (padrão `G:/App Resumo/music`, só
leitura; sem repetir, histórico em `<userData>/som` com UMA entrada por
projeto, gravada ao salvar/renderizar, nunca ao aplicar) com ducking pelas
palavras igual no preview e no render, o rosto pelo motor (`motor/app/rostos.py`,
modo `rostos` em lote; sem motor, o detector antigo; no editor o recorte 9:16
do clipe é refeito na hora), a legenda no estilo salvo dele e (15/10) a **cor**:
uma camada de ajuste do Dangai no vídeo inteiro (`papel: 'cor'` e `corOriginal`;
rodar de novo troca só ela e só se ele não mexeu: valores, intensidade, fade,
corte, cópia ou pedaços ficam, e o resumo diz "mantida") com o look "Anime vivo" (vibrance +28, contraste +10, realces −5,
nitidez 10, medido nos quadros do S4-37) ou o preset de cor escolhido em
Configurações ("Cor da Edicao rapida"). O projeto montado
já nasce com o estilo salvo e com `studio.secoes`. A barra do editor se mede e
aperta (`aperto-da-barra.ts`) até caber na janela mínima. Alvos medidos: voz
−14 LUFS, whoosh ~14 LU e impacto ~13 LU abaixo (e ≥ ~12 LU abaixo da voz ali),
música −36 LUFS sob a voz e −30 nas pausas, nunca acima do arquivo, pico ≤ −1 dBTP.

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
  `package.json` (igual no dev e no instalado). O updater está **ligado**
  (`ATUALIZACAO_LIGADA` em `electron/services/updater.ts`): o app instalado lê
  as releases do repositório público `leviclementino1-creator/anirecap-studio`
  8 s depois de abrir e a cada 6 h. "Procurar atualizacoes" fica no fim das
  Configurações (`VersaoDoApp.tsx`) e na versão da barra; sem release ainda,
  as duas buscas respondem "em dia" (`semReleaseAinda`), nunca erro.
- **Instalador** (15/10): `AniRecap-Studio-Setup-<versão>.exe`, NSIS por
  usuário, sem admin, em `%LOCALAPPDATA%\Programs\anirecap-studio` (o `name`
  do `package.json`, sem espaço), ~200 MB. Leva o CÓDIGO do motor
  (`resources/motor`) e o uv (`resources/uv`); o RUNTIME do motor (Python +
  torch, ~5 GB) é instalado pelo app no 1º uso em
  `%LOCALAPPDATA%\AniRecap Studio\motor-runtime` (o GitHub limita a 2 GB por
  arquivo). Nada é gravado na pasta de instalação. Os modelos da 1ª análise
  (~1,1 GB) vão para `<runtime>\modelos` (`HF_HOME`). GTX 10xx (compute cap
  < 7.5) é sugerida como cpu; cu128 que não roda a conta na GPU sobe com
  `ANIRECAP_MOTOR_SEM_CUDA=1` (torch na CPU, NVENC fica) e a conta é refeita
  quando o driver muda. O desinstalador pergunta se apaga o runtime (padrão
  Não; na atualização nunca: `build/installer.nsh`) e apaga os restos de um
  "Remover motor"; o app espera o Remover terminar antes de sair.

## Layout

| pasta | o que é |
|---|---|
| `src/` | renderer: `App.tsx`, `components/`, `hooks/`, `store/` |
| `src/remotion/` | composições Remotion que geram o vídeo |
| `electron/` | processo main e `electron/services/` |
| `shared/` | contrato entre main e renderer: `channels.ts`, `contract.ts`, `project-file.ts`, `plan.ts`, `align.ts`, `rhythm.ts`, `sfx.ts`, `selection.ts`; do Studio: `episodio.ts` (índice do episódio e estado do corte), `roteiro.ts` (eventos, roteiro, rascunho do recap e modo Texto), `voz.ts` (takes da narração, palavras com tempo, custo, velocidade nativa), `ritmo.ts` (palavras/s por voz: o inicial calibrado e o aprendido), `cenas.ts` (escolhas de cena por frase, fita, barrinha), `encaixe.ts` (a cena na duração real da frase: emenda, fala citada, sem relance), `edicao-rapida.ts` (plano de som, ducking, pedidos de rosto, camada de cor), `loudness.ts` (BS.1770 em JS) e `descoberta.ts` (Reconhecer na mao: protocolo cru do motor, decisao, juntar/ignorar, `paraOMotor`) |
| `electron/services/descoberta/` | o main do Reconhecer na mao: uma rodada por vez segurando o motor (`index.ts`), recortes copiados por job e elenco (`recortes.ts`), o indice pelo caminho do fim de corte (`aplicar.ts`), o erro do motor em frase curta (`erro.ts`) e o aviso "Confira" quando o reconhecimento seguinte dependeu das fotos do batismo (`refs.ts`) ou quando um reconhecido so tinha UMA arte do elenco, o retrato do MAL e o da AniList em dois recortes (`arte-unica.ts`, ORB do OpenCV em WASM, depois do `done`); a tela e `ReconhecerNaMao.tsx`, `GrupoDeRostos.tsx`, `EntradaDaDescoberta.tsx` e `src/store/gerar-descoberta.ts` |
| `electron/services/som/` | a Edição rápida no main: `medir.ts` (loudness com cache), `musicas.ts` (pasta e histórico), `planejar.ts` (SFX e música) e `mix.ts` (envelope e limitador do render) |
| `electron/services/episodio/`, `electron/services/gerar/` | o main do "Gerar recap": passo 1 (índice, `falas.ts`, `corte-fundo.ts`) e passo 2 (prompts, cache de IA, rascunho, `religar.ts` + `prompt-religar.ts`) |
| `electron/services/cenas/`, `electron/services/montar/` | passo 4: `casar.ts` (a escolha de cena por regras, sem IA) e o "Abrir no editor" (pasta, foco, miniaturas e o `.anirecap`; `edicao-rapida.ts` e `rostos-motor.ts` para a Edição rápida) |
| `electron/services/voz/` | o motor do passo 3: provedores (ElevenLabs, Fish), cache pago, alinhamento (palavras sem pontuação no wav2vec2), conferência pelo som (bordas, palavras suspeitas, fronteira de frase no silêncio), corte de pausas e acelerar (atempo, arquivo em exatas N/v amostras), ritmo aprendido (`ritmo.ts`), volume (-23 LUFS), emenda de frase regravada, áudio importado, taxa de crédito da conta, takes |
| `src/components/gerar/`, `src/store/gerar*.ts` | as telas e as stores do assistente (`gerar-passos.ts` = a ordem dos passos; `gerar-cenas.ts` = o passo 4 e as sugestões em segundo plano) |
| `electron/services/motor-runtime/`, `shared/motor-runtime.ts` | o runtime do motor no app instalado: pasta, lock (`motor/studio-runtime.json`, gerado por `npm run motor:lock`), impressão, instalação pelo uv com retomada, ambiente do motor (ffmpeg do app primeiro, ffprobe do Remotion por último); a tela é `src/components/motor-runtime/` + `src/store/motor-runtime.ts` |
| `scripts/` | ícone, SFX, `release.mjs` (publica), `conferir-pacote.mjs` (confere `release/`), `baixar-uv.mjs` (`npm run uv`), `motor-lock.mjs` e testes manuais em `scripts/teste/` |

Mudou o formato de uma mensagem IPC? O tipo mora em `shared/`: mexa lá primeiro
e deixe os dois lados seguirem o tipo.

## Comandos

```bash
npm ci               # se o postinstall do Electron for bloqueado: node node_modules/electron/install.js
npm run dev          # app com recarga automática
npm run typecheck    # TS nos três processos
npm run build        # typecheck + bundles do Electron e do Remotion
npm run uv           # baixa e confere o uv.exe do instalador em build/uv (fora do git)
npm run dist         # instalador em release/ (build + uv + electron-builder, nunca publica)
node scripts/conferir-pacote.mjs   # confere release/: .exe, latest.yml, resources
npm run release -- --dry-run       # o caminho da publicação inteiro, sem subir nada
```

`GH_TOKEN` (de `gh auth token`) só é necessário para **publicar** release.
Ordem: commit, `git push`, `git push origin vX.Y.Z`, `npm run release` (ou o
workflow `release` do GitHub). O `release.mjs` recusa publicar sem a tag no
remoto apontando para o HEAD, versão já publicada (só com `--republicar`) ou
não maior que a mais recente, e o lock do motor fora do `motor/.venv`; confere
o `latest.yml` (versão, nome `AniRecap-Studio-Setup-<v>.exe`, tamanho e
sha512) e o lock contra o `motor/requirements.txt` antes de subir.

Ambiente: Node 24 e npm 11; ffmpeg 9 no PATH.
