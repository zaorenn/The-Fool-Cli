!ifndef FOOL_INSTALLER_REMOVE_REGISTRY_NSH
!define FOOL_INSTALLER_REMOVE_REGISTRY_NSH

!macro FOOL_CLEAR_INSTALL_REGISTRY _REASON
  DeleteRegKey SHCTX "${UNINSTALL_REGISTRY_KEY}"
  DeleteRegKey SHCTX "${INSTALL_REGISTRY_KEY}"
  !insertmacro FOOL_LOG_EVENT "event=registry-clear reason=${_REASON} uninstallKey=${UNINSTALL_REGISTRY_KEY} installKey=${INSTALL_REGISTRY_KEY}"
!macroend

!macro FOOL_LOG_ATOMIC_REMOVE_FAILURE
  Push $9
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$FoolSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${FOOL_FALLBACK_LOG}' }; \
    $$failed = '$FoolAtomicFailedPath'; \
    $$instDir = '$INSTDIR'; \
    $$oldInstallDir = '$FoolAtomicStagingDir'; \
    $$relative = $$failed; \
    if ($$failed.StartsWith($$instDir, [System.StringComparison]::CurrentCultureIgnoreCase)) { $$relative = $$failed.Substring($$instDir.Length).TrimStart('\') }; \
    $$tempCandidate = if ($$relative -and $$relative -ne $$failed) { Join-Path $$oldInstallDir $$relative } else { '' }; \
    $$kind = if ($$tempCandidate.Length -ge 260) { 'likely-long-path' } else { 'unknown' }; \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$FoolSessionId'; version = '${VERSION}'; arch = '${FOOL_TARGET_ARCH}'; updated = ('$FoolIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'remove-atomic-failed'; kind = $$kind; pathLength = $$failed.Length; tempCandidateLength = $$tempCandidate.Length; atomicFailedPath = $$failed; tempCandidate = $$tempCandidate }; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8) \
  }"`
  Pop $9
  Pop $9
!macroend

!macro FOOL_LOG_REMOVE_FAILURE_JSON _PHASE _FATAL _FAILED_PATH _EXTRA_FIELDS
  !insertmacro FOOL_LOG_JSON_EVENT "failure" "$$lockerText = '$FoolLockerList'; $$processes = @(); if ($$lockerText -and $$lockerText -notlike 'Windows did not identify*' -and $$lockerText -ne 'unknown process') { $$processes = @($$lockerText -split ',\s*' | Where-Object { $$_ } | ForEach-Object { if ($$_ -match '^(.*)\(([0-9]+)\)$$') { [ordered]@{ name = $$Matches[1]; pid = [int]$$Matches[2] } } else { [ordered]@{ name = $$_; pid = $$null } } }) }; $$payload.code = '${FOOL_E_INSTALL_DIR_REMOVE_OR_LOCKED}'; $$payload.phase = '${_PHASE}'; $$payload.failedPath = '${_FAILED_PATH}'; $$payload.blockingProcesses = @($$processes); if ($$lockerText -like 'The Fool installer(*)') { $$payload.fallbackReason = 'installer-self-lock'; $$payload.message = 'The installer process is using the install directory as its current output directory.' } elseif ($$processes.Count -eq 0) { $$payload.fallbackReason = 'restart-manager-no-process'; $$payload.message = 'Windows did not identify a specific locking process. Close terminals, editors, and file managers opened in the install folder.' } else { $$payload.fallbackReason = ''; $$payload.message = '' }; $$payload.fatal = ('${_FATAL}' -eq '1'); ${_EXTRA_FIELDS}"
!macroend

!macro FOOL_REMOVE_INSTALL_DIR
  StrCpy $FoolRemoveResidueCount "0"
  ${If} $FoolRemoveResidueRoot == ""
    StrCpy $FoolRemoveResidueRoot "$INSTDIR"
  ${EndIf}
  StrCpy $FoolRemoveFirstFailedPath ""
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'Continue'; \
    $$log = '$FoolSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${FOOL_FALLBACK_LOG}' }; \
    $$path = [System.IO.Path]::GetFullPath('$FoolRemoveResidueRoot'); \
    $$firstFailedFile = '$PLUGINSDIR\fool-remove-first-failed.txt'; \
    Set-Content -LiteralPath $$firstFailedFile -Encoding UTF8 -NoNewline -Value ''; \
    function Write-InstallerLog($$message) { $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$FoolSessionId'; version = '${VERSION}'; arch = '${FOOL_TARGET_ARCH}'; updated = ('$FoolIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'remove-log'; message = $$message }; if ($$message -match '(^|\s)event=([^\s]+)') { $$payload.event = $$Matches[2] }; Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8) } \
    function Convert-LongPath($$itemPath) { if ($$itemPath.StartsWith('\\')) { return '\\?\UNC\' + $$itemPath.TrimStart('\') } return '\\?\' + $$itemPath } \
    function Remove-WithRetries($$item, $$isDir) { \
      $$delays = @(200,500,1000); \
      for ($$i = 0; $$i -lt $$delays.Count; $$i++) { \
        try { \
          if ($$isDir) { [System.IO.Directory]::Delete((Convert-LongPath $$item), $$false) } else { [System.IO.File]::Delete((Convert-LongPath $$item)) } \
          return $$true \
        } catch { \
          if ($$i -lt $$delays.Count - 1) { Start-Sleep -Milliseconds $$delays[$$i] } else { Write-InstallerLog ('event=remove-resilient-leftover path=' + $$item + ' attempts=3 error=' + $$_.Exception.GetType().FullName + ': ' + $$_.Exception.Message); return $$false } \
        } \
      } \
      return $$false \
    } \
    try { \
      if (-not (Test-Path -LiteralPath $$path)) { Write-InstallerLog ('remove-longpath result=0 instDir=' + $$path); exit 0 } \
      $$failed = New-Object System.Collections.Generic.List[string]; \
      foreach ($$file in @(Get-ChildItem -LiteralPath $$path -Force -Recurse -File -ErrorAction SilentlyContinue | Sort-Object FullName -Descending)) { if (-not (Remove-WithRetries $$file.FullName $$false)) { $$failed.Add($$file.FullName) } } \
      foreach ($$dir in @(Get-ChildItem -LiteralPath $$path -Force -Recurse -Directory -ErrorAction SilentlyContinue | Sort-Object FullName -Descending)) { if (-not (Remove-WithRetries $$dir.FullName $$true)) { $$failed.Add($$dir.FullName) } } \
      if (-not (Remove-WithRetries $$path $$true)) { $$failed.Add($$path) } \
      Write-InstallerLog ('event=remove-resilient-summary failedCount=' + $$failed.Count + ' root=' + $$path); \
      if ($$failed.Count -gt 0) { Set-Content -LiteralPath $$firstFailedFile -Encoding UTF8 -NoNewline -Value $$failed[0]; exit $$failed.Count } \
      Write-InstallerLog ('remove-longpath result=0 instDir=' + $$path); \
      exit 0 \
    } catch { \
      Write-InstallerLog ('remove-longpath result=1 instDir=' + $$path + ' error=' + $$_.Exception.GetType().FullName + ': ' + $$_.Exception.Message); \
      exit 1 \
    } \
  }"`
  Pop $FoolRemoveDirResult

  ClearErrors
  SetDetailsPrint none
  FileOpen $FoolRemoveFirstFailedFile "$PLUGINSDIR\fool-remove-first-failed.txt" r
  ${IfNot} ${Errors}
    FileRead $FoolRemoveFirstFailedFile $FoolRemoveFirstFailedPath
    FileClose $FoolRemoveFirstFailedFile
  ${EndIf}
  SetDetailsPrint lastused

  ${If} $FoolRemoveDirResult == "error"
    !insertmacro FOOL_LOG_EVENT "event=remove-longpath fallback=RMDir reason=no-powershell root=$INSTDIR"
    RMDir /r "$FoolRemoveResidueRoot"
    ${If} ${FileExists} "$FoolRemoveResidueRoot\*.*"
      StrCpy $FoolRemoveDirResult "1"
    ${Else}
      StrCpy $FoolRemoveDirResult "0"
    ${EndIf}
  ${EndIf}

  ${If} $FoolRemoveDirResult != 0
    StrCpy $FoolRemoveResidueCount $FoolRemoveDirResult
  ${EndIf}
!macroend

!macro customRemoveFiles
  !insertmacro FOOL_LOG_EVENT "remove-start instDir=$INSTDIR"
  Var /GLOBAL FoolRemoveDirResult
  Var /GLOBAL FoolAtomicFailedPath
  Var /GLOBAL FoolAtomicRemoveSucceeded
  Var /GLOBAL FoolAtomicStagingDir
  Var /GLOBAL FoolRemoveResidueCount
  Var /GLOBAL FoolRemoveResidueRoot
  Var /GLOBAL FoolRemoveFirstFailedPath
  Var /GLOBAL FoolRemoveFirstFailedFile
  StrCpy $FoolAtomicFailedPath ""
  StrCpy $FoolAtomicRemoveSucceeded "0"
  StrCpy $FoolAtomicStagingDir ""
  StrCpy $FoolRemoveResidueCount "0"
  StrCpy $FoolRemoveResidueRoot "$INSTDIR"
  StrCpy $FoolRemoveFirstFailedPath ""

  SetOutPath $TEMP
  StrCpy $FoolCurrentOutDir "$TEMP"

  ${if} ${isUpdated}
    StrCpy $FoolAtomicStagingDir "$INSTDIR.__old"
    ${If} ${FileExists} "$FoolAtomicStagingDir\*.*"
      StrCpy $FoolRemoveResidueRoot "$FoolAtomicStagingDir"
      !insertmacro FOOL_LOG_EVENT "remove-stale-staging start root=$FoolRemoveResidueRoot"
      !insertmacro FOOL_REMOVE_INSTALL_DIR
      StrCpy $FoolRemoveResidueRoot "$INSTDIR"
    ${EndIf}

    fool_retry_atomic_rename:
      ClearErrors
      Rename "$INSTDIR" "$FoolAtomicStagingDir"
    ${if} ${Errors}
      DetailPrint "Atomic update cleanup failed before replacing previous installation: $INSTDIR"
      StrCpy $FoolAtomicFailedPath "$INSTDIR"
      !insertmacro FOOL_LOG_ATOMIC_REMOVE_FAILURE
      !insertmacro FOOL_CAPTURE_FAILED_PATH_LOCKERS "$FoolAtomicFailedPath"
      ${IfNot} ${Silent}
        !insertmacro FOOL_PROMPT_FAILED_PATH_LOCKERS "$FoolAtomicFailedPath" "atomic-failed" fool_retry_atomic_rename fool_cancel_atomic_rename fool_continue_atomic_failed
        fool_cancel_atomic_rename:
      ${EndIf}
      fool_continue_atomic_failed:
      !insertmacro FOOL_LOG_REMOVE_FAILURE_JSON "atomic-failed" "1" "$FoolAtomicFailedPath" "$$payload.atomicFailedPath = '$FoolAtomicFailedPath'"
      !insertmacro FOOL_LOG_EVENT "code=${FOOL_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=atomic-failed fatal=1 degraded=none firstFailed=$FoolAtomicFailedPath atomicFailedPath=$FoolAtomicFailedPath"
      !insertmacro FOOL_CLEAR_INSTALL_REGISTRY "remove-failed-before-quit"
      !insertmacro FOOL_FAIL_REPORTABLE_BILINGUAL ${FOOL_E_INSTALL_DIR_REMOVE_OR_LOCKED} "event=session-end result=fail code=${FOOL_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=atomic-failed fatal=1 firstFailed=$FoolAtomicFailedPath lockers=$FoolLockerList" "${FOOL_MSG_REPLACE_LOCKED_EN}" "${FOOL_MSG_REPLACE_LOCKED_ZH}" "${FOOL_MSG_CLOSE_SHOWN_FILE_ACTION_EN}" "${FOOL_MSG_CLOSE_SHOWN_FILE_ACTION_ZH}"
    ${else}
      !insertmacro FOOL_LOG_EVENT "remove-atomic result=0 staging=$FoolAtomicStagingDir"
      StrCpy $FoolAtomicRemoveSucceeded "1"
      StrCpy $FoolRemoveResidueRoot "$FoolAtomicStagingDir"
    ${endif}
  ${endif}

  fool_retry_remove_install_dir:
    !insertmacro FOOL_REMOVE_INSTALL_DIR
  ${if} $FoolRemoveDirResult != 0
    !insertmacro FOOL_CAPTURE_FAILED_PATH_LOCKERS "$FoolRemoveFirstFailedPath"
    ${if} $FoolAtomicRemoveSucceeded == "1"
      ${IfNot} ${Silent}
        !insertmacro FOOL_PROMPT_FAILED_PATH_LOCKERS "$FoolRemoveFirstFailedPath" "residual-delete-failed" fool_retry_remove_install_dir fool_cancel_remove_after_rm fool_continue_after_rm
        fool_cancel_remove_after_rm:
          !insertmacro FOOL_LOG_REMOVE_FAILURE_JSON "residual-delete-failed" "1" "$FoolRemoveFirstFailedPath" "$$payload.residueRoot = '$FoolRemoveResidueRoot'; $$payload.failedCount = '$FoolRemoveResidueCount'; $$payload.removeDirResult = '$FoolRemoveDirResult'; $$payload.atomicSucceeded = ('$FoolAtomicRemoveSucceeded' -eq '1')"
          !insertmacro FOOL_LOG_EVENT "code=${FOOL_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=residual-delete-failed userAction=cancel fatal=1 residueRoot=$FoolRemoveResidueRoot failedCount=$FoolRemoveResidueCount firstFailed=$FoolRemoveFirstFailedPath removeDirResult=$FoolRemoveDirResult removeResidueCount=$FoolRemoveResidueCount atomicFailedPath=$FoolAtomicFailedPath atomicSucceeded=$FoolAtomicRemoveSucceeded"
          !insertmacro FOOL_FAIL_REPORTABLE_BILINGUAL ${FOOL_E_INSTALL_DIR_REMOVE_OR_LOCKED} "event=session-end result=fail code=${FOOL_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=residual-delete-failed userAction=cancel fatal=1 firstFailed=$FoolRemoveFirstFailedPath lockers=$FoolLockerList" "${FOOL_MSG_PREVIOUS_FILE_OPEN_EN}" "${FOOL_MSG_PREVIOUS_FILE_OPEN_ZH}" "${FOOL_MSG_CLOSE_SHOWN_FILE_ACTION_EN}" "${FOOL_MSG_CLOSE_SHOWN_FILE_ACTION_ZH}"
      ${EndIf}
      fool_continue_after_rm:
      DetailPrint `The Fool previous installation had locked residual files; continuing after atomic cleanup succeeded: $INSTDIR`
      !insertmacro FOOL_LOG_EVENT "code=${FOOL_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=residual-delete-failed degraded=continue fatal=0 residueRoot=$FoolRemoveResidueRoot failedCount=$FoolRemoveResidueCount firstFailed=$FoolRemoveFirstFailedPath removeDirResult=$FoolRemoveDirResult removeResidueCount=$FoolRemoveResidueCount atomicFailedPath=$FoolAtomicFailedPath atomicSucceeded=$FoolAtomicRemoveSucceeded"
    ${else}
      DetailPrint `Can't safely remove previous installation without atomic cleanup proof: $INSTDIR`
      ${IfNot} ${Silent}
        !insertmacro FOOL_PROMPT_FAILED_PATH_LOCKERS "$FoolRemoveFirstFailedPath" "residual-delete-failed-no-atomic-proof" fool_retry_remove_install_dir fool_cancel_remove_no_atomic fool_continue_remove_no_atomic
        fool_cancel_remove_no_atomic:
      ${EndIf}
      fool_continue_remove_no_atomic:
      !insertmacro FOOL_LOG_REMOVE_FAILURE_JSON "residual-delete-failed-no-atomic-proof" "1" "$FoolRemoveFirstFailedPath" "$$payload.residueRoot = '$FoolRemoveResidueRoot'; $$payload.failedCount = '$FoolRemoveResidueCount'; $$payload.removeDirResult = '$FoolRemoveDirResult'; $$payload.atomicSucceeded = ('$FoolAtomicRemoveSucceeded' -eq '1')"
      !insertmacro FOOL_LOG_EVENT "code=${FOOL_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=residual-delete-failed-no-atomic-proof degraded=none fatal=1 residueRoot=$FoolRemoveResidueRoot failedCount=$FoolRemoveResidueCount firstFailed=$FoolRemoveFirstFailedPath removeDirResult=$FoolRemoveDirResult removeResidueCount=$FoolRemoveResidueCount atomicFailedPath=$FoolAtomicFailedPath atomicSucceeded=$FoolAtomicRemoveSucceeded"
      !insertmacro FOOL_CLEAR_INSTALL_REGISTRY "remove-failed-before-quit"
      !insertmacro FOOL_FAIL_REPORTABLE_BILINGUAL ${FOOL_E_INSTALL_DIR_REMOVE_OR_LOCKED} "event=session-end result=fail code=${FOOL_E_INSTALL_DIR_REMOVE_OR_LOCKED} phase=residual-delete-failed-no-atomic-proof fatal=1 firstFailed=$FoolRemoveFirstFailedPath removeDirResult=$FoolRemoveDirResult lockers=$FoolLockerList" "${FOOL_MSG_REMOVE_PREVIOUS_DIR_EN}" "${FOOL_MSG_REMOVE_PREVIOUS_DIR_ZH}" "${FOOL_MSG_CLOSE_INSTALL_DIR_ACTION_EN}" "${FOOL_MSG_CLOSE_INSTALL_DIR_ACTION_ZH}"
    ${endif}
  ${else}
    !insertmacro FOOL_LOG_EVENT "remove-final errors=0 instDir=$INSTDIR removeDirResult=$FoolRemoveDirResult removeResidueCount=$FoolRemoveResidueCount removeResidueRoot=$FoolRemoveResidueRoot atomicFailedPath=$FoolAtomicFailedPath atomicSucceeded=$FoolAtomicRemoveSucceeded"
  ${endif}
!macroend

!macro customUnInit
  !insertmacro FOOL_LOG_EVENT "uninit instDir=$INSTDIR"
!macroend

!macro customUnInstall
  !insertmacro FOOL_LOG_EVENT "uninstall-section start instDir=$INSTDIR"
!macroend

!endif
