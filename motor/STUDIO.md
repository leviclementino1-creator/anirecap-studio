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

Motivo de todas: o Corte Cenas do Levi e o AnCut HUB dividem a mesma pasta de
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
  (requisição JSON na 1ª linha do stdin; `{"cmd":"cancel"}` cancela).
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

## Atualizar a cópia

1. Copiar o ancut-hub-engine novo por cima de `motor/` (sem `.venv`).
2. Reaplicar as três mudanças acima (procurar `[Studio]` no diff).
3. Atualizar o commit no topo deste arquivo e no `NOTICE`.
4. `node out/teste/v-motor.cjs rapido` (ver `scripts/teste/v-motor.ts`).
