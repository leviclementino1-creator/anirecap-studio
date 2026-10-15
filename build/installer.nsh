; Ganchos do AniRecap Studio no NSIS do electron-builder (nsis.include).
;
; O runtime do motor de personagens (Python + torch, ~5 GB) mora fora da pasta
; de instalacao, em %LOCALAPPDATA%\AniRecap Studio\motor-runtime: a
; atualizacao troca a pasta do app inteira, e o runtime tem que sobreviver a
; ela (baixar 3 GB de novo a cada versao seria absurdo). Por isso o
; desinstalador padrao nao o apaga.
;
; Na desinstalacao DE VERDADE ele pergunta, com NAO como padrao (e no modo
; silencioso, /SD IDNO). Na atualizacao nunca: o instalador novo roda o
; desinstalador velho sempre com --updated (installUtil.nsh do
; electron-builder), e ai ${isUpdated} e verdadeiro.
;
; So a pasta padrao: se o Levi escolheu outro disco (<userData>\motor-runtime.json),
; a pasta escolhida fica, e ele apaga pelo app (Configuracoes > Remover motor)
; antes de desinstalar.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ${if} ${FileExists} "$LOCALAPPDATA\AniRecap Studio\motor-runtime\*.*"
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Apagar tambem o motor de personagens (~5 GB)?$\r$\n$\r$\nSe nao apagar, ele fica em $LOCALAPPDATA\AniRecap Studio\motor-runtime e o app reinstalado usa de novo, sem baixar." /SD IDNO IDNO anirecapMotorFica
        RMDir /r "$LOCALAPPDATA\AniRecap Studio\motor-runtime"
        ; A pasta de cima so sai se ficou vazia (RMDir sem /r).
        RMDir "$LOCALAPPDATA\AniRecap Studio"
      anirecapMotorFica:
    ${endIf}
  ${endIf}
!macroend
