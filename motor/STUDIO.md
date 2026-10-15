# motor/ no AniRecap Studio

Este é o **motor de personagens** do AniRecap Studio: corta o episódio em cenas
(`shots/NNNN.mp4`, `keyframes/`, `metadata/shots.json`) e reconhece os
personagens pelo rosto (YOLO anime-face + CLIP ViT-L/14 + CCIP). O Studio
continua em TypeScript e sobe este motor como processo separado, falando
JSON-lines (`app/headless.py`), igual ao AnCut HUB.

## Origem

- Cópia de `faahpla/ancut-hub-engine`, commit **`a1d732b`**
  ("fix: vídeo HDR sai com a cor certa — clipes e keyframes"), versão
  `app.__version__ = 0.16.1`.
- O ancut-hub-engine é um fork do **Corte Cenas**, de Levi Clementino.
- Referência local, só leitura: `G:\ClaudeEditor\fusao\ancut-hub-engine`.

**Regra: não "melhorar" o motor aqui.** Detecção, matching, corte e pipeline
ficam idênticos aos do AnCut, para os pontos de corte e o reconhecimento
saírem iguais. Correções de motor vão para o ancut-hub-engine e voltam por
cópia. As únicas mudanças desta cópia estão listadas abaixo e marcadas com
`[Studio]` no código.

## Mudanças em relação ao a1d732b

Motivo das três primeiras: o Corte Cenas do Levi e o AnCut HUB dividem a mesma pasta de
dados, `%LOCALAPPDATA%\CorteCenas\CorteCenas` (config.json com as chaves,
`cache/index.db`, refs do elenco em `cache/anime_db`, `models/`, `Logs/`). Com
o `APP_NAME = "CorteCenas"` original, o motor do Studio leria e gravaria ali, e
um `index.db` misturado não tem volta.

1. **`app/config.py`**
   - `APP_NAME = "AniRecapStudioMotor"` (era `"CorteCenas"`).
   - Nova env **`ANIRECAP_MOTOR_DADOS`**: a pasta de dados que o Studio passa
     (`<userData>/motor`, ou seja `%APPDATA%\AniRecap Studio\motor`). Com ela,
     rodando do fonte ou empacotado:
     - `CONFIG_FILE = <dados>/config.json`
     - cache (index.db, anime_db, skip_ranges.json…) = `<dados>/cache`
     - modelos = `<dados>/models`
     - logs = `<dados>/logs`
     - saída padrão = `<Documentos>/AniRecap Studio/Biblioteca` (o `run`
       sempre usa a `outputDir` da requisição).
   - Sem a env (motor rodado à mão): config e logs em
     `%LOCALAPPDATA%\AniRecapStudioMotor\AniRecapStudioMotor`; do fonte, cache,
     modelos e saída continuam relativos ao projeto (`motor/cache`,
     `motor/models`, `motor/Output`, no `.gitignore`); empacotado, cache e
     modelos em `%LOCALAPPDATA%\AniRecapStudioMotor\...`.
   - A saída padrão do app empacotado era `Documents/CorteCenas/Output`, a
     biblioteca do AnCut. Passou a ser `Documents/AniRecap Studio/Biblioteca`.
   - Nova constante `LOG_DIR`, usada pelos dois itens abaixo.
2. **`app/applog.py`** — `log_dir()` usa `config.LOG_DIR` (era
   `user_log_dir("CorteCenas")`). Só roda no app Qt e no exe (`run.py`); o
   `python -m app.headless` do Studio não chama.
3. **`run.py`** — `_crash_log_path()` usa `config.LOG_DIR` (era
   `user_log_dir("CorteCenas")`).

Conferido (sem mudança): todo `index.db`, refs, `skip_ranges.json`,
`busca_resolvida.json`, `benchmark.db` e modelo do lbpcascade saem de
`Config.cache_path`/`models_path`, que vêm de `config.py`. Os `[CorteCenas]`
dos prints são só prefixo de log; o `User-Agent` dos downloads, o `updater.py`
(auto-update do app Qt) e as telas em `app/ui/` não entram no headless. Os
modelos grandes (CLIP, YOLO, CCIP) ficam no cache global do HuggingFace
(`~/.cache/huggingface`), que não é do Corte Cenas.

### Fontes de elenco (out/2026)

Motivo: na rede do Levi o `api.jikan.moe` não aceita conexão (ConnectTimeout,
também no curl). O elenco vinha só da AniList, com 1 retrato por personagem,
abaixo de `min_references_per_character = 2`, e a análise terminava em
"sem-referencias" depois de ~6 min de timeouts. Três mudanças pequenas, as
três para levar ao ancut-hub-engine:

4. **`app/providers/jikan.py`** — Jikan fora do ar desiste no 1º pedido.
   - `httpx.Timeout(30, connect=CONEXAO_S)`, com `CONEXAO_S = 8`: só abrir a
     conexão ficou curto; a leitura segue em 30 s.
   - `respondeu` / `fora_do_ar`: erro de rede (`httpx.HTTPError`) sem nenhuma
     resposta antes na rodada liga `fora_do_ar` (e `gave_up`) sem retry, e
     dali em diante todo pedido, até o `essencial`, volta `None` na hora,
     contando em `failures` (os avisos de fonte do provider continuam certos).
   - Medido: antes, 69,2 s por pedido e o disjuntor só no 5º (5 × 69 s ≈
     5,8 min por análise); depois, 8,0 s no 1º e 0,0 s nos outros. O
     `resolve()` de Dr. Stone S4 inteiro (AniList + Kitsu, banco parcial)
     caiu para 12 s.
5. **`app/providers/anime_provider.py`** — a Kitsu também pela RAIZ da
   franquia. O retrato extra da Kitsu era buscado só pelo MAL id da temporada
   pedida, mas o elenco da AniList vem da raiz (`get_characters(root_id)`). A
   Kitsu parou de cadastrar elenco por volta de 2020: temporada nova de
   franquia velha volta vazia. Agora, se a temporada vier vazia, tenta o MAL id
   da raiz (`root_mal_id`, achado nas `relations`).
   - Medido: Re:Zero 3ª (mal 54857) e Slime 3ª (mal 53580) = 0 na Kitsu; as
     1ªs temporadas = 50 e 11. Re:Zero S3 com o Jikan fora: 0 → 33
     personagens com 2 fotos.
   - Não resolve Dr. Stone: a Kitsu não tem elenco de nenhuma das 9 entradas
     da franquia (2019 em diante), nem de Mushoku, Frieren, Lv999 ou
     Apothecary. Para esses, a saída é a reserva do Corte Cenas (abaixo).
6. **`app/pipeline.py`** (`run`, passo 3/5) — o personagem do elenco acha a
   linha do banco pelo id que o `upsert_character` devolveu, não só pelo
   nome. Bug do upstream: o upsert reusa por tokens a linha de "Senkuu
   Ishigami" (nome da AniList, gravado numa rodada com o MyAnimeList fora)
   para "Ishigami, Senkuu" (MyAnimeList) SEM trocar o nome, e o
   `db_chars.get(ch.name)` do passo 5 não achava a linha: o personagem ficava
   sem embedding e fora do reconhecimento, em silêncio. Agora `ids_do_banco`
   guarda o id por nome e o lookup cai nele quando o nome não bate; os nomes
   que saem no `shots.json` continuam os do banco (os da 1ª rodada).
   - Medido no S04E24 com a reserva DEPOIS de uma rodada sem fotos: antes,
     162 de 385 cenas e 9 nomes (sumiram Senkuu, Gen, Taiju e Ukyou, todos
     de nome composto); depois, 178 de 385 e 12 nomes, igual ao banco limpo.
     O `index.db` do Studio do Levi já tinha os 50 nomes da AniList.

### Rostos em lote para o enquadramento (14/10)

Motivo: a "Edição rápida" enquadra cada bloco 9:16 no rosto. O detector do
Dangai (lbpcascade, frontal) achou rosto em 6 de 20 blocos do S4-37; o YOLO de
anime do motor + a cabeça de reserva acham em 17 de 20. Importar o torch e
subir a GPU custa ~8 s, então é UM processo para o lote inteiro. Esta mudança
é só do Studio (não vai ao ancut-hub-engine): nada do corte nem do
reconhecimento muda.

7. **`app/rostos.py`** (arquivo novo) + **`app/headless.py`**: modo
   `rostos` (`_rostos()` e uma linha no `main()`, marcados `[Studio]`).
   - Pedido JSON na 1ª linha do stdin: `itens` (`chave`, `arquivo`,
     `instantes` em s, `personagens` = quem a frase cita, `candidatos` = quem
     o índice reconhece no plano), `anime`, `temporada`, `identificar`.
   - Eventos: `pronto` (modelos no ar), um `rostos` por item (por quadro:
     caixas `x,y,w,h` em px, `conf`, `tipo` `rosto`|`cabeca`, `personagem`,
     `sim`, `quem`) e `fim`; erro pelo `failed` de sempre. O stdin fica
     aberto e o cancelamento é o mesmo do `run` (`_watch_stdin`).
   - Detecta com os MESMOS pesos do `AnimeFaceDetector`
     (`_YOLO_REPO/_YOLO_FILE`, cabeça só nos quadros sem rosto, conf 0.4,
     mínimo de 32 px a 1080p), pegando-os do cache do HuggingFace sem rede
     primeiro (`local_files_only`). Não mexe em `face_detector.py`.
   - Identifica só com 2+ rostos no quadro e `candidatos` (conjunto FECHADO:
     as 2-3 pessoas que o índice vê no plano, nunca o elenco inteiro --
     contra o elenco inteiro o CLIP trocou o Gen pelo Gozan e marcou um
     figurante de fundo como Chrome). CLIP ViT-L/14 + protótipos como o
     pipeline (`build_prototypes`), com os embeddings das fotos lidos do
     `ref_features.npz` com a MESMA meta do `_feature_meta`; foto sem
     embedding no cache é calculada e NÃO gravada. O CLIP sobe numa thread
     logo no começo, em paralelo com o YOLO.
   - SÓ LEITURA: `Config.load()` sem `ensure_dirs()`/`save()`, o elenco
     achado por `AnimeFolderStore.franchise_for_name` + `resolve_anime_dir`
     (o mesmo caminho do modo só-cortar), `FeatureCache` sem `save()`.
     Conferido no teste: a pasta de dados fica intocada.
   - Quem chama: `electron/services/montar/rostos-motor.ts` (a decisão do
     foco, a suavização e a reserva no detector antigo moram lá).
   - Medido no S4-37 (20 blocos, RTX 5080, `scripts/teste/v-rosto-s437.ts`):
     rosto em 17/20 (85%) contra 6/20 (30%) do lbpcascade; 15,4 s o lote
     inteiro identificando (pronto em ~9 s) e 12,4 s só detectando, contra
     9,5 s do lbpcascade. O custo é quase todo fixo (torch + CUDA): o
     lbpcascade cresce ~0,5 s por bloco, o motor ~0,1 s.

## Como o Studio chama

`electron/services/motor.ts`:

- Dev: `motor/.venv/Scripts/python.exe -m app.headless <modo>`, cwd `motor/`.
  O venv é **próprio** (uv, Python 3.12, torch cu128 para a RTX 5080), nunca o
  do Corte Cenas.
- Empacotado: fica para a F5 (pacote do motor para download, ~2 a 5 GB).
- Env: `ANIRECAP_MOTOR_DADOS`, `PYTHONIOENCODING=utf-8`,
  `YOLO_AUTOINSTALL=false` (o `run.py` liga isto no exe; o `-m app.headless`
  não passa por ele) e o PATH com o ffmpeg do sistema primeiro e o
  ffmpeg-static do app no fim, de reserva.
- Modos usados: `probe` (versão, GPU, ffmpeg), `parse <arquivo>` e `run`
  (requisição JSON na 1ª linha do stdin; `{"cmd":"cancel"}` cancela), e
  `rostos` (o item 7 acima, chamado por `montar/rostos-motor.ts` com o
  próprio spawn; log em `<dados>/logs/ultimos-rostos.log`).
- `run` com `discovery: true` ("Reconhecer na mao", 15/10): o Studio usa o
  Modo Descoberta como o AnCut, sem mudar nada no Python
  (`electron/services/descoberta/` + `analisarEpisodio(..., { descoberta: true })`
  e `comandarDescoberta` em `motor.ts`). Com as cenas no disco vai a
  `outputFolder` da pasta do anime e o corte é reaproveitado
  (`shot_bounds.json` + `shots/`); os rostos ficam em `metadata/face_cache.npz`.
  Depois do `discovery-ready` o processo fica vivo esperando UMA linha
  `{"cmd":"commit-discovery","names":{...},"removed":{...}}` (ou `cancel`); o
  Studio confere antes que pelo menos um grupo tem nome (sem nenhum, o
  `commit_discovery` lança e o processo morre). As fotos batizadas vão para
  `<dados>/cache/anime_db/<anime>/characters/<nome>/auto_disc_NN.jpg` e o
  centroide para `<dados>/cache/index.db`, os do Studio; o `run` normal do
  próximo episódio soma essas fotos às do catálogo e reconhece sozinho.
- Log da última análise: `<dados>/logs/ultima-analise.log`.

"Analisar com o AnCut" não usa esta pasta: chama o `CorteCenas.exe --headless`
do AnCut HUB instalado, que grava na pasta e na biblioteca dele.

## Bugs do motor contornados no Studio (levar ao ancut-hub-engine)

O código daqui continua igual ao upstream. Estes dois bugs são contornados em
TypeScript, nas pastas que são do Studio, e o contorno sai quando a correção
voltar por cópia:

1. **Corte de outro arquivo reaproveitado.** `keyframe_extractor.cut_all_shots`
   reaproveita `shots/NNNN.mp4` e `keyframes/NNNN_k.jpg` pelo número,
   conferindo só `.export_mode` e `.cor`. Quando `_prepare_shots` recalcula os
   limites porque o `shot_bounds.json.source` mudou (outro release do mesmo
   episódio na mesma pasta), a pasta fica com os tempos de um vídeo e as
   imagens do outro. Correção no motor: invalidar o reaproveitamento de clipes
   e keyframes sempre que os limites forem recalculados. Contorno:
   `electron/services/episodio/corte-de-outro-arquivo.ts` grava um `.cor` que
   não bate antes do `run`.
2. **Elenco degradado congelado.** Quando o Jikan falha já na lista de
   personagens, `anime_provider` salva o banco com `partial: true`,
   `missing_gallery: []` e os `mal_id` nulos; `_completar_galerias` sai na hora
   (lista vazia) e o atalho `busca_resolvida.json` reaproveita esse banco para
   sempre (reconhecimento preso em "sem-referencias"). Correção no motor:
   tratar `partial` sem `missing_gallery` (ou personagens sem `mal_id`) como
   refazer a busca inteira depois da trégua de 6 h. Contorno:
   `electron/services/elenco-degradado.ts` põe o `metadata.json` de lado
   (renomeia) depois da trégua.

## Reserva de fotos do elenco (no Studio, sem mexer no motor)

`electron/services/elenco-reserva.ts`. Antes de subir o motor com
reconhecimento — e de novo quando ele volta `needs-input` `refs-missing` —, o
Studio procura o elenco do MESMO anime já baixado pelo Corte Cenas e copia para
`<dados>/cache/anime_db`, onde o motor acha o banco pelo id da franquia e segue
normal.

- Origens, SÓ LEITURA: `G:\App Corte Cenas\cache\anime_db` (Corte Cenas do
  fonte) e `%LOCALAPPDATA%\CorteCenas\CorteCenas\cache\anime_db` (Corte Cenas
  e AnCut HUB instalados, que dividem a pasta). `ANIRECAP_ELENCO_RESERVA`
  (raízes separadas por `;`) troca a lista, para testes.
- O id (`al<id>`, o sufixo `[al<id>]` da pasta) vem do que o motor do Studio já
  resolveu (`busca_resolvida.json`, `pastas_de_anime.json`), do índice de
  buscas do Corte Cenas (`busca_resolvida.json` ou o `index.json` antigo, mesmo
  formato), do `refsDir` do needs-input ou, na falta, do título (só com um
  anime casando).
- Copia `metadata.json` + `characters/` inteiros (as fotos têm o nome que o
  downloader do motor daria, sha1 da URL, e só contam com o metadata junto).
  `ref_features.npz` fica (chaveado pelo caminho absoluto, não bateria). O
  `fetched_at` em segundos do Corte Cenas vira ISO na cópia.
- Só quando o banco do Studio para o id não reconhece ninguém; o banco ruim vai
  inteiro para `<dados>/cache/elenco-posto-de-lado/`. A cópia passa por uma
  pasta temporária e só então ganha o nome final.
- Ensina `nome|sN -> id` ao `busca_resolvida.json` do motor quando o id não
  veio de palpite de título: o motor acha o banco sem a AniList.
- De onde vieram as fotos: `reserva-do-studio.json` na pasta copiada,
  `fotosDoElenco()` e a linha `[studio] fotos do elenco: ...` do log.

## Atualizar a cópia

1. Copiar o ancut-hub-engine novo por cima de `motor/` (sem `.venv`).
2. Reaplicar as sete mudanças acima (procurar `[Studio]` no diff; o
   `app/rostos.py` é só do Studio e fica como está).
3. Atualizar o commit no topo deste arquivo e no `NOTICE`.
4. `node out/teste/v-motor.cjs rapido` (ver `scripts/teste/v-motor.ts`).
