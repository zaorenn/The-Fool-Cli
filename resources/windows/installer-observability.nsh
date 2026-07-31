!ifndef FOOL_INSTALLER_OBSERVABILITY_NSH
!define FOOL_INSTALLER_OBSERVABILITY_NSH

; Taken from electron-builder rather than written out, so it follows
; `executableName` in electron-builder.yml. It was hardcoded to "The Fool.exe",
; which survived the rebrand to The Fool and made every install fail its own
; post-extract check with E1010: the files were there, under the new name, and
; the installer was looking for the old one.
!define FOOL_APP_EXECUTABLE_FILENAME "${APP_EXECUTABLE_FILENAME}"
!define FOOL_FALLBACK_LOG "fool-installer-${VERSION}-fallback-log.jsonl"

!pragma warning disable 6001
Var /GLOBAL FoolSessionId
Var /GLOBAL FoolIsUpdated
Var /GLOBAL FoolSessionLogResult
Var /GLOBAL FoolSessionLogPath

!macro FOOL_SESSION_HEADER
  !insertmacro FOOL_SLOG "event=header arch=${FOOL_TARGET_ARCH} updated=$FoolIsUpdated instDir=$INSTDIR version=${VERSION} log=$FoolSessionLogPath detail=customHeader"
!macroend

!macro FOOL_SLOG _MESSAGE
  Push $9
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$FoolSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${FOOL_FALLBACK_LOG}' }; \
    $$session = '$FoolSessionId'; \
    if (-not $$session) { $$session = 'uninitialized' }; \
    $$message = '${_MESSAGE}'; \
    $$event = 'log'; \
    if ($$message -match '(^|\s)event=([^\s]+)') { $$event = $$Matches[2] } else { $$first = @($$message -split '\s+', 2)[0]; if ($$first -and $$first -notmatch '=') { $$event = $$first } }; \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = $$session; version = '${VERSION}'; arch = '${FOOL_TARGET_ARCH}'; updated = ('$FoolIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = $$event; message = $$message }; \
    $$json = $$payload | ConvertTo-Json -Compress -Depth 8; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value $$json \
  }"`
  Pop $9
  Pop $9
!macroend

!macro FOOL_LOG_EVENT _MESSAGE
  Push $9
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$FoolSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${FOOL_FALLBACK_LOG}' }; \
    $$session = '$FoolSessionId'; \
    if (-not $$session) { $$session = 'uninitialized' }; \
    $$message = '${_MESSAGE}'; \
    $$event = 'log'; \
    if ($$message -match '(^|\s)event=([^\s]+)') { $$event = $$Matches[2] } else { $$first = @($$message -split '\s+', 2)[0]; if ($$first -and $$first -notmatch '=') { $$event = $$first } }; \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = $$session; version = '${VERSION}'; arch = '${FOOL_TARGET_ARCH}'; updated = ('$FoolIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = $$event; message = $$message }; \
    $$json = $$payload | ConvertTo-Json -Compress -Depth 8; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value $$json \
  }"`
  Pop $9
  Pop $9
!macroend

!macro FOOL_LOG_JSON_EVENT _EVENT _JSON_FIELDS
  Push $9
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$FoolSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${FOOL_FALLBACK_LOG}' }; \
    $$session = '$FoolSessionId'; \
    if (-not $$session) { $$session = 'uninitialized' }; \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = $$session; version = '${VERSION}'; arch = '${FOOL_TARGET_ARCH}'; updated = ('$FoolIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = '${_EVENT}' }; \
    ${_JSON_FIELDS}; \
    $$json = $$payload | ConvertTo-Json -Compress -Depth 8; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value $$json \
  }"`
  Pop $9
  Pop $9
!macroend

!macro FOOL_SESSION_BEGIN
  ${GetParameters} $R9
  ClearErrors
  ${GetOptions} $R9 "--installer-log=" $R8
  ${IfNot} ${Errors}
    StrCpy $FoolSessionLogPath $R8
  ${EndIf}
  ClearErrors
  ${GetOptions} $R9 "--installer-session=" $R8
  ${IfNot} ${Errors}
    StrCpy $FoolSessionId $R8
  ${EndIf}

  ${If} $FoolSessionLogPath == ""
    nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "$$id = '$FoolSessionId'; if (-not $$id) { $$id = [guid]::NewGuid().ToString('N').Substring(0,12) }; $$stamp = Get-Date -Format 'yyyyMMdd'; $$name = 'fool-installer-${VERSION}-' + $$stamp + '-log.jsonl'; $$log = Join-Path $$env:TEMP $$name; [Console]::Out.Write($$id + '|' + $$log)"`
    Pop $FoolSessionLogResult
    Pop $FoolSessionLogResult
    StrCpy $FoolSessionId $FoolSessionLogResult 12
    StrCpy $FoolSessionLogPath $FoolSessionLogResult 1024 13
  ${ElseIf} $FoolSessionId == ""
    nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "[Console]::Out.Write([guid]::NewGuid().ToString('N').Substring(0,12))"`
    Pop $FoolSessionLogResult
    Pop $FoolSessionLogResult
    StrCpy $FoolSessionId $FoolSessionLogResult
  ${EndIf}

  ClearErrors
  ${GetOptions} $R9 "--updated" $R8
  StrCpy $FoolIsUpdated "0"
  ${IfNot} ${Errors}
    StrCpy $FoolIsUpdated "1"
  ${EndIf}

  !insertmacro FOOL_SLOG "event=session-begin detail=preInit"
!macroend

!macro FOOL_LOG_EXTRACT_RESULT _METHOD
  ${IfNot} ${FileExists} "$INSTDIR\${FOOL_APP_EXECUTABLE_FILENAME}"
    !insertmacro FOOL_FAIL_UX \
      "${FOOL_E_EXTRACT_FAILED}" \
      "event=extract result=fail method=${_METHOD} missing=${FOOL_APP_EXECUTABLE_FILENAME}" \
      "${FOOL_MSG_EXTRACT_FAILED_ZH}" \
      "${FOOL_MSG_EXTRACT_FAILED_EN}" \
      "${FOOL_MSG_EXTRACT_FAILED_ACTION_ZH}" \
      "${FOOL_MSG_EXTRACT_FAILED_ACTION_EN}" \
      "extract result=fail method=${_METHOD} missing=${FOOL_APP_EXECUTABLE_FILENAME} instDir=$INSTDIR" \
      "extract result=fail method=${_METHOD} missing=${FOOL_APP_EXECUTABLE_FILENAME} instDir=$INSTDIR"
  ${Else}
    !insertmacro FOOL_SLOG "event=extract result=ok method=${_METHOD} detail=customFiles_${FOOL_TARGET_ARCH}"
  ${EndIf}
!macroend

!macro FOOL_SESSION_SUCCESS
  !insertmacro FOOL_SLOG "event=session-end result=success detail=customInstall"
!macroend

!endif
