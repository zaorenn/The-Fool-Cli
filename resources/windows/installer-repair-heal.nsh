!ifndef FOOL_INSTALLER_REPAIR_HEAL_NSH
!define FOOL_INSTALLER_REPAIR_HEAL_NSH

Var /GLOBAL FoolRegistryInstallIsValid
Var /GLOBAL FoolInnerFailureSummary
Var /GLOBAL FoolInnerRootCode
Var /GLOBAL FoolInnerFailureReadResult

!macro FOOL_READ_LAST_INNER_FAILURE
  InitPluginsDir
  StrCpy $FoolInnerRootCode ""
  StrCpy $FoolInnerFailureSummary "No specific locking process was identified. Close The Fool, terminals, editors, and file managers opened in the install folder."
  nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$logPath = '$FoolSessionLogPath'; \
    $$summary = 'No specific locking process was identified. Close The Fool, terminals, editors, and file managers opened in the install folder.'; \
    $$code = ''; \
    if ($$logPath -and (Test-Path -LiteralPath $$logPath)) { \
      $$events = @(Get-Content -LiteralPath $$logPath -ErrorAction SilentlyContinue | ForEach-Object { try { $$_ | ConvertFrom-Json } catch { $$null } } | Where-Object { $$_ }); \
      $$failure = @($$events | Where-Object { $$_.event -eq 'failure' -and $$_.updated -eq $$true } | Select-Object -Last 1)[0]; \
      if (-not $$failure) { $$failure = @($$events | Where-Object { $$_.event -eq 'failure' } | Select-Object -Last 1)[0] }; \
      if ($$failure) { \
        $$code = ([string]$$failure.code).Trim(); \
        $$phase = ([string]$$failure.phase).Trim(); \
        $$path = ([string]$$failure.failedPath).Trim(); \
        $$blocking = ''; \
        $$processes = @($$failure.blockingProcesses); \
        if ($$processes.Count -gt 0) { $$blocking = (@($$processes | ForEach-Object { if ($$_.pid) { [string]$$_.name + '(' + [string]$$_.pid + ')' } else { [string]$$_.name } }) -join ', ') }; \
        if (-not $$blocking) { $$blocking = ([string]$$failure.message).Trim() }; \
        if (-not $$blocking) { $$blocking = 'Windows did not identify a specific locking process. Close terminals, editors, and file managers opened in the install folder.' }; \
        $$parts = @('- Outer installer: previous uninstaller exited with code $R0', ('- Inner failure: ' + $$code + ' phase ' + $$phase)); \
        if ($$path) { $$parts += ('- File or folder: ' + $$path) }; \
        $$parts += ('- Blocking process: ' + $$blocking); \
        $$summary = $$parts -join [Environment]::NewLine; \
      } \
    }; \
    if (-not $$code) { $$code = '-----' }; \
    [Console]::Out.Write($$code + '|' + $$summary) \
  }"`
  Pop $FoolInnerFailureReadResult
  Pop $FoolInnerFailureReadResult
  StrCpy $FoolInnerRootCode $FoolInnerFailureReadResult 5
  ${If} $FoolInnerRootCode == "-----"
    StrCpy $FoolInnerRootCode ""
  ${EndIf}
  StrCpy $FoolInnerFailureSummary $FoolInnerFailureReadResult 4096 6
!macroend

!macro FOOL_LOG_UNINSTALLER_REPAIR _PHASE
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$FoolSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${FOOL_FALLBACK_LOG}' }; \
    $$path = '$INSTDIR\${UNINSTALL_FILENAME}'; \
    $$item = Get-Item -LiteralPath $$path -ErrorAction SilentlyContinue; \
    $$version = if ($$item) { $$item.VersionInfo.ProductVersion } else { '' }; \
    $$length = if ($$item) { $$item.Length } else { '' }; \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$FoolSessionId'; version = '${VERSION}'; arch = '${FOOL_TARGET_ARCH}'; updated = ('$FoolIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'uninstaller-repair'; phase = '${_PHASE}'; path = $$path; exists = [bool]$$item; productVersion = $$version; length = $$length }; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8) \
  }"`
  Pop $FoolRepairLogResult
!macroend

!macro FOOL_REPAIR_INSTALLED_UNINSTALLER
  Var /GLOBAL FoolInstalledUninstaller
  Var /GLOBAL FoolBundledUninstaller
  Var /GLOBAL FoolRepairLogResult

  !insertmacro FOOL_LOG_UNINSTALLER_REPAIR "before"
  StrCpy $FoolInstalledUninstaller "$INSTDIR\${UNINSTALL_FILENAME}"

  InitPluginsDir
  StrCpy $FoolBundledUninstaller "$PLUGINSDIR\The Fool-fixed-uninstaller.exe"
  SetOverwrite on
  File "/oname=$PLUGINSDIR\The Fool-fixed-uninstaller.exe" "${UNINSTALLER_OUT_FILE}"

  ${If} ${FileExists} "$FoolInstalledUninstaller"
    ClearErrors
    CopyFiles /SILENT "$FoolBundledUninstaller" "$FoolInstalledUninstaller"
    ${If} ${Errors}
      !insertmacro FOOL_LOG_UNINSTALLER_REPAIR "copy-failed-retry"
      !insertmacro FOOL_STOP_APP_PROCESSES
      Sleep 1000

      ClearErrors
      CopyFiles /SILENT "$FoolBundledUninstaller" "$FoolInstalledUninstaller"
      ${If} ${Errors}
        ${If} ${FileExists} "$FoolBundledUninstaller"
          !insertmacro FOOL_LOG_UNINSTALLER_REPAIR "copy-failed-using-bundled"
          !insertmacro FOOL_LOG_EVENT "event=uninstaller-repair phase=copy-failed-using-bundled"
        ${Else}
          !insertmacro FOOL_FAIL_REPORTABLE_BILINGUAL ${FOOL_E_UNINSTALLER_COPY_OR_REBUILD_FAILED} "uninstaller-repair copy-failed-retry-bundled-missing" "${FOOL_MSG_UNINSTALLER_COPY_LOCKED_EN}" "${FOOL_MSG_UNINSTALLER_COPY_LOCKED_ZH}" "${FOOL_MSG_UNINSTALLER_REPAIR_ACTION_EN}" "${FOOL_MSG_UNINSTALLER_REPAIR_ACTION_ZH}"
        ${EndIf}
      ${Else}
        !insertmacro FOOL_LOG_UNINSTALLER_REPAIR "after-copy-retry"
      ${EndIf}
    ${Else}
      !insertmacro FOOL_LOG_UNINSTALLER_REPAIR "after-copy"
    ${EndIf}
  ${Else}
    ClearErrors
    CopyFiles /SILENT "$FoolBundledUninstaller" "$FoolInstalledUninstaller"
    ${If} ${Errors}
      !insertmacro FOOL_FAIL_REPORTABLE_BILINGUAL ${FOOL_E_UNINSTALLER_COPY_OR_REBUILD_FAILED} "uninstaller-repair rebuild-failed" "${FOOL_MSG_UNINSTALLER_REBUILD_FAILED_EN}" "${FOOL_MSG_UNINSTALLER_REBUILD_FAILED_ZH}" "${FOOL_MSG_UNINSTALLER_REPAIR_ACTION_EN}" "${FOOL_MSG_UNINSTALLER_REPAIR_ACTION_ZH}"
    ${EndIf}

    ${IfNot} ${FileExists} "$FoolInstalledUninstaller"
      !insertmacro FOOL_FAIL_REPORTABLE_BILINGUAL ${FOOL_E_UNINSTALLER_COPY_OR_REBUILD_FAILED} "uninstaller-repair rebuild-missing-after-copy" "${FOOL_MSG_UNINSTALLER_REBUILD_MISSING_EN}" "${FOOL_MSG_UNINSTALLER_REBUILD_MISSING_ZH}" "${FOOL_MSG_UNINSTALLER_REPAIR_ACTION_EN}" "${FOOL_MSG_UNINSTALLER_REPAIR_ACTION_ZH}"
    ${EndIf}

    !insertmacro FOOL_LOG_UNINSTALLER_REPAIR "rebuilt"
    !insertmacro FOOL_LOG_EVENT "event=uninstaller-repair phase=rebuilt"
  ${EndIf}
!macroend

!macro FOOL_HEAL_INSTALL_REGISTRY
  Var /GLOBAL FoolRegInstallLocation
  Var /GLOBAL FoolRegUninstallString
  Var /GLOBAL FoolRegInstallExe

  StrCpy $FoolRegistryInstallIsValid "0"

  ReadRegStr $FoolRegInstallLocation SHCTX "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  ReadRegStr $FoolRegUninstallString SHCTX "${UNINSTALL_REGISTRY_KEY}" "UninstallString"

  ${If} $FoolRegInstallLocation == ""
    !insertmacro FOOL_LOG_EVENT "event=registry-heal phase=missing-install-location uninstallString=$FoolRegUninstallString"
    !insertmacro FOOL_CLEAR_INSTALL_REGISTRY "missing-install-location"
  ${Else}
    StrCpy $FoolRegInstallExe "$FoolRegInstallLocation\${FOOL_APP_EXECUTABLE_FILENAME}"
    ${If} ${FileExists} "$FoolRegInstallExe"
      StrCpy $INSTDIR "$FoolRegInstallLocation"
      StrCpy $FoolRegistryInstallIsValid "1"
      !insertmacro FOOL_LOG_EVENT "event=registry-heal phase=valid-install-location instDir=$INSTDIR uninstallString=$FoolRegUninstallString"
    ${Else}
      !insertmacro FOOL_LOG_EVENT "event=registry-heal phase=stale-install-location installLocation=$FoolRegInstallLocation uninstallString=$FoolRegUninstallString"
      !insertmacro FOOL_CLEAR_INSTALL_REGISTRY "stale-install-location"
    ${EndIf}
  ${EndIf}
!macroend

!macro FOOL_LOG_UNINSTALL_RESULT _ROOT_KEY _HAD_ERRORS
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$log = '$FoolSessionLogPath'; \
    if (-not $$log) { $$log = Join-Path $$env:TEMP '${FOOL_FALLBACK_LOG}' }; \
    $$payload = [ordered]@{ schemaVersion = 1; ts = (Get-Date -Format o); session = '$FoolSessionId'; version = '${VERSION}'; arch = '${FOOL_TARGET_ARCH}'; updated = ('$FoolIsUpdated' -eq '1'); instDir = '$INSTDIR'; event = 'uninstall-result'; root = '${_ROOT_KEY}'; launchErrors = '${_HAD_ERRORS}'; exitCode = '$R0' }; \
    Add-Content -LiteralPath $$log -Encoding UTF8 -Value ($$payload | ConvertTo-Json -Compress -Depth 8) \
  }"`
  Pop $FoolUninstallLogResult
!macroend

!macro FOOL_HANDLE_UNINSTALL_RESULT _ROOT_KEY _LABEL_PREFIX
  ${If} ${Errors}
    StrCpy $FoolUninstallHadErrors "1"
  ${Else}
    StrCpy $FoolUninstallHadErrors "0"
  ${EndIf}

  !insertmacro FOOL_LOG_UNINSTALL_RESULT "${_ROOT_KEY}" "$FoolUninstallHadErrors"

  ${If} $FoolUninstallHadErrors == "1"
    DetailPrint `Uninstall was not successful. Not able to launch uninstaller!`
    Return
  ${EndIf}

  ${If} $R0 != 0
      DetailPrint `Uninstall was not successful. Uninstaller error code: $R0.`
      !insertmacro FOOL_READ_LAST_INNER_FAILURE
      ${If} $FoolLockerList != ""
        StrCpy $FoolInnerFailureSummary "- Failure: previous uninstaller failed with exit code $R0$\r$\n- File or folder: $INSTDIR$\r$\n- Blocking process: $FoolLockerList"
      ${EndIf}
      !insertmacro FOOL_LOG_EVENT "event=old-uninstaller-failed action=report exitCode=$R0 lockers=$FoolLockerList uninstallerDetail=$FoolInnerFailureSummary"
      ${If} $FoolInnerRootCode != ""
        !insertmacro FOOL_FAIL_REPORTABLE_ROOTED_BILINGUAL_DIAGNOSTICS "$FoolInnerRootCode" ${FOOL_E_OLD_UNINSTALL_FAILED} "old-uninstaller exitCode=$R0 lockers=$FoolLockerList uninstallerDetail=$FoolInnerFailureSummary" "${FOOL_MSG_OLD_UNINSTALL_FAILED_EN}" "${FOOL_MSG_OLD_UNINSTALL_FAILED_ZH}" "${FOOL_MSG_OLD_UNINSTALL_ACTION_EN}" "${FOOL_MSG_OLD_UNINSTALL_ACTION_ZH}" "$FoolInnerFailureSummary" "$FoolInnerFailureSummary"
      ${Else}
        !insertmacro FOOL_FAIL_REPORTABLE_BILINGUAL_DIAGNOSTICS ${FOOL_E_OLD_UNINSTALL_FAILED} "old-uninstaller exitCode=$R0 lockers=$FoolLockerList uninstallerDetail=$FoolInnerFailureSummary" "${FOOL_MSG_OLD_UNINSTALL_FAILED_EN}" "${FOOL_MSG_OLD_UNINSTALL_FAILED_ZH}" "${FOOL_MSG_OLD_UNINSTALL_ACTION_EN}" "${FOOL_MSG_OLD_UNINSTALL_ACTION_ZH}" "$FoolInnerFailureSummary" "$FoolInnerFailureSummary"
      ${EndIf}
  ${EndIf}
!macroend

!macro customInit
  !insertmacro FOOL_HEAL_INSTALL_REGISTRY
  ${If} $FoolRegistryInstallIsValid == "1"
    !insertmacro FOOL_REPAIR_INSTALLED_UNINSTALLER
  ${EndIf}
!macroend

!macro customUnInstallCheck
  !insertmacro FOOL_HANDLE_UNINSTALL_RESULT "SHELL_CONTEXT" "shctx"
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro FOOL_HANDLE_UNINSTALL_RESULT "HKEY_CURRENT_USER" "hkcu"
!macroend

!endif
