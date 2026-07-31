!ifndef FOOL_INSTALLER_UPDATE_VERIFY_NSH
!define FOOL_INSTALLER_UPDATE_VERIFY_NSH

Var /GLOBAL FoolUninstallHadErrors
Var /GLOBAL FoolUninstallLogResult
Var /GLOBAL FoolVerifyResourceResult
Var /GLOBAL FoolUpdatedAppExitWaitResult
Var /GLOBAL FoolActiveMarkerExecResult
Var /GLOBAL FoolActiveMarkerResult

!define FOOL_ACTIVE_INSTALLER_MARKER "fool-installer-active.marker"

!macro FOOL_BRING_UPDATED_INSTALLER_TO_FRONT
  ${If} ${isUpdated}
    BringToFront
    !insertmacro FOOL_SLOG "event=updated-installer-foreground action=bring-to-front"
  ${EndIf}
!macroend

!macro FOOL_WAIT_FOR_UPDATED_APP_EXIT
  ${If} ${isUpdated}
    !insertmacro FOOL_SLOG "event=updated-app-exit-wait phase=start"
    StrCpy $FoolUpdatedAppExitWaitResult "0"

    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
      $$ErrorActionPreference = 'SilentlyContinue'; \
      $$deadline = (Get-Date).AddSeconds(10); \
      $$target = [System.IO.Path]::GetFullPath((Join-Path '$INSTDIR' '${FOOL_APP_EXECUTABLE_FILENAME}')); \
      do { \
        $$hits = @(Get-CimInstance -ClassName Win32_Process | Where-Object { \
          $$path = $$_.ExecutablePath; \
          if (-not $$path) { $$path = $$_.Path } \
          $$_.Name -ieq '${FOOL_APP_EXECUTABLE_FILENAME}' -and $$path -and \
          [string]::Equals([System.IO.Path]::GetFullPath($$path), $$target, [System.StringComparison]::CurrentCultureIgnoreCase) \
        }); \
        if ($$hits.Count -eq 0) { exit 0 }; \
        Start-Sleep -Milliseconds 500; \
      } while ((Get-Date) -lt $$deadline); \
      exit 1 \
    }"`
    Pop $FoolUpdatedAppExitWaitResult

    ${If} $FoolUpdatedAppExitWaitResult != 0
      !insertmacro FOOL_SLOG "event=updated-app-exit-wait phase=timeout action=stop"
      !insertmacro FOOL_STOP_APP_PROCESSES
    ${EndIf}

    !insertmacro FOOL_SLOG "event=updated-app-exit-wait phase=done result=$FoolUpdatedAppExitWaitResult"
  ${EndIf}
!macroend

!macro FOOL_RECORD_ACTIVE_INSTALLER_MARKER
  nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$marker = Join-Path $$env:TEMP '${FOOL_ACTIVE_INSTALLER_MARKER}'; \
    if (-not (Test-Path -LiteralPath $$marker)) { Write-Output 'missing'; exit 0 }; \
    $$item = Get-Item -LiteralPath $$marker; \
    if ($$item.LastWriteTime -lt (Get-Date).AddHours(-2)) { Write-Output 'stale'; exit 0 }; \
    Write-Output 'active' \
  }"`
  Pop $FoolActiveMarkerExecResult
  Pop $FoolActiveMarkerResult
  ${If} $FoolActiveMarkerResult == "active"
    !insertmacro FOOL_SLOG "event=installer-active-marker state=active"
  ${ElseIf} $FoolActiveMarkerResult == "stale"
    !insertmacro FOOL_SLOG "event=installer-active-marker state=stale"
  ${Else}
    !insertmacro FOOL_SLOG "event=installer-active-marker state=missing"
  ${EndIf}
!macroend

!macro FOOL_WRITE_ACTIVE_INSTALLER_MARKER
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
    $$ErrorActionPreference = 'SilentlyContinue'; \
    $$marker = Join-Path $$env:TEMP '${FOOL_ACTIVE_INSTALLER_MARKER}'; \
    Set-Content -LiteralPath $$marker -Encoding UTF8 -Value ('pid=' + $$PID + ';session=$FoolSessionId;started=' + (Get-Date -Format o)) \
  }"`
  Pop $FoolActiveMarkerResult
!macroend

!macro FOOL_CLEAR_ACTIVE_INSTALLER_MARKER
  !ifndef BUILD_UNINSTALLER
    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "& { \
      $$ErrorActionPreference = 'SilentlyContinue'; \
      Remove-Item -LiteralPath (Join-Path $$env:TEMP '${FOOL_ACTIVE_INSTALLER_MARKER}') -Force \
    }"`
    Pop $FoolActiveMarkerResult
  !endif
!macroend

!macro FOOL_OVERRIDE_SINGLE_INSTANCE
!macroend

!macro FOOL_OVERRIDE_APP_CANNOT_BE_CLOSED_MESSAGE
  !pragma warning disable 6030
  LangString appCannotBeClosed 1033 "${FOOL_MSG_APP_CANNOT_BE_CLOSED_ZH}$\r$\n$\r$\n${FOOL_MSG_BLOCK_SEPARATOR}$\r$\n$\r$\n${FOOL_MSG_APP_CANNOT_BE_CLOSED_EN}"
  LangString appCannotBeClosed 2052 "${FOOL_MSG_APP_CANNOT_BE_CLOSED_ZH}$\r$\n$\r$\n${FOOL_MSG_BLOCK_SEPARATOR}$\r$\n$\r$\n${FOOL_MSG_APP_CANNOT_BE_CLOSED_EN}"
  !pragma warning default 6030
!macroend

!macro FOOL_INSTALLER_CUSTOM_HEADER
  !insertmacro FOOL_OVERRIDE_SINGLE_INSTANCE
  !insertmacro FOOL_OVERRIDE_APP_CANNOT_BE_CLOSED_MESSAGE
!macroend

!macro FOOL_RELEASE_INSTALL_DIR_OUTDIR
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  StrCpy $FoolCurrentOutDir "$PLUGINSDIR"
!macroend

; Resolve the machine's real native architecture (arm64 / x64 / x86) for diagnostics.
; Backed by IsWow64Process2 (via x64.nsh), so it reports the true hardware arch even when
; the installer runs under x86/x64 emulation. Replaces the old hardcoded "non-arm64" detail.
!macro FOOL_DETECT_NATIVE_ARCH _OUT
  ${If} ${IsNativeARM64}
    StrCpy ${_OUT} "arm64"
  ${ElseIf} ${RunningX64}
    StrCpy ${_OUT} "x64"
  ${Else}
    StrCpy ${_OUT} "x86"
  ${EndIf}
!macroend

!macro FOOL_INSTALLER_PREINIT
  !ifdef BUILD_UNINSTALLER
    StrCpy $FoolSessionId ""
    StrCpy $FoolIsUpdated "0"
    StrCpy $FoolSessionLogResult ""
    StrCpy $FoolSessionLogPath "$TEMP\${FOOL_FALLBACK_LOG}"
    StrCpy $FoolUninstallHadErrors "0"
    StrCpy $FoolUninstallLogResult ""
    StrCpy $FoolVerifyResourceResult ""
    StrCpy $FoolUpdatedAppExitWaitResult ""
    StrCpy $FoolActiveMarkerExecResult ""
    StrCpy $FoolActiveMarkerResult ""
    StrCpy $FoolStopResult ""
    StrCpy $FoolLockerListZh ""
    StrCpy $FoolLockerListEn ""
  !else
    !insertmacro FOOL_RELEASE_INSTALL_DIR_OUTDIR
    !insertmacro FOOL_SESSION_BEGIN
    !insertmacro FOOL_SLOG "event=installer-outdir-release outDir=$FoolCurrentOutDir instDir=$INSTDIR"
    ; Guard target/machine architecture as early as possible: this runs before customInit's
    ; registry heal/clear/repair, so a wrong-arch installer aborts without mutating an existing
    ; correct-arch install's registry or uninstaller state. (Sentry ELECTRON-3BX / code E1040)
    !insertmacro FOOL_ASSERT_TARGET_ARCH
    !insertmacro FOOL_BRING_UPDATED_INSTALLER_TO_FRONT
    !insertmacro FOOL_RECORD_ACTIVE_INSTALLER_MARKER
    !insertmacro FOOL_WRITE_ACTIVE_INSTALLER_MARKER
  !endif
!macroend

!macro FOOL_VERIFY_REQUIRED_FILE _PATH _LABEL
  ${IfNot} ${FileExists} "${_PATH}"
    !insertmacro FOOL_LOG_EVENT "verify-required-file missing label=${_LABEL} path=${_PATH}"
    !insertmacro FOOL_FAIL_UX \
      "${FOOL_E_CORE_APP_FILES_INCOMPLETE}" \
      "verify-required-file missing label=${_LABEL} path=${_PATH}" \
      "${FOOL_MSG_VERIFY_REQUIRED_FILE_ZH} ${_LABEL}" \
      "${FOOL_MSG_VERIFY_REQUIRED_FILE_EN} ${_LABEL}" \
      "${FOOL_MSG_VERIFY_REQUIRED_FILE_ACTION_ZH}" \
      "${FOOL_MSG_VERIFY_REQUIRED_FILE_ACTION_EN}" \
      "verify-required-file missing label=${_LABEL} path=${_PATH}" \
      "verify-required-file missing label=${_LABEL} path=${_PATH}"
  ${Else}
    !insertmacro FOOL_LOG_EVENT "verify-required-file ok label=${_LABEL} path=${_PATH}"
  ${EndIf}
!macroend

!macro FOOL_VERIFY_CORE_APP_FILES
  !insertmacro FOOL_LOG_EVENT "verify-install start instDir=$INSTDIR"
  !insertmacro FOOL_VERIFY_REQUIRED_FILE "$INSTDIR\${FOOL_APP_EXECUTABLE_FILENAME}" "${FOOL_APP_EXECUTABLE_FILENAME}"
  !insertmacro FOOL_VERIFY_REQUIRED_FILE "$INSTDIR\ffmpeg.dll" "ffmpeg.dll"
  !insertmacro FOOL_VERIFY_REQUIRED_FILE "$INSTDIR\libEGL.dll" "libEGL.dll"
  !insertmacro FOOL_VERIFY_REQUIRED_FILE "$INSTDIR\libGLESv2.dll" "libGLESv2.dll"
  !insertmacro FOOL_VERIFY_REQUIRED_FILE "$INSTDIR\d3dcompiler_47.dll" "d3dcompiler_47.dll"
  !insertmacro FOOL_VERIFY_REQUIRED_FILE "$INSTDIR\dxcompiler.dll" "dxcompiler.dll"
  !insertmacro FOOL_VERIFY_REQUIRED_FILE "$INSTDIR\dxil.dll" "dxil.dll"
  !insertmacro FOOL_VERIFY_REQUIRED_FILE "$INSTDIR\vk_swiftshader.dll" "vk_swiftshader.dll"
  !insertmacro FOOL_VERIFY_REQUIRED_FILE "$INSTDIR\vulkan-1.dll" "vulkan-1.dll"
  !insertmacro FOOL_VERIFY_REQUIRED_FILE "$INSTDIR\resources\app.asar" "resources\app.asar"
!macroend

!macro FOOL_VERIFY_BUNDLED_FOOLCORE_RESOURCES _RUNTIME_KEY
  InitPluginsDir
  File "/oname=$PLUGINSDIR\verify-bundled-foolcore-install.ps1" "${PROJECT_DIR}\resources\windows\support\verify-bundled-foolcore-install.ps1"
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\verify-bundled-foolcore-install.ps1" -InstallDir "$INSTDIR" -RuntimeKey "${_RUNTIME_KEY}" -LogPath "$FoolSessionLogPath"`
  Pop $FoolVerifyResourceResult

  ${If} $FoolVerifyResourceResult != 0
    !insertmacro FOOL_FAIL_UX \
      "${FOOL_E_BUNDLED_FOOLCORE_INCOMPLETE}" \
      "event=session-end result=fail code=${FOOL_E_BUNDLED_FOOLCORE_INCOMPLETE} detail=bundled-foolcore-incomplete runtime=${_RUNTIME_KEY} result=$FoolVerifyResourceResult" \
      "${FOOL_MSG_BUNDLED_FOOLCORE_INCOMPLETE_ZH}" \
      "${FOOL_MSG_BUNDLED_FOOLCORE_INCOMPLETE_EN}" \
      "${FOOL_MSG_BUNDLED_FOOLCORE_INCOMPLETE_ACTION_ZH}" \
      "${FOOL_MSG_BUNDLED_FOOLCORE_INCOMPLETE_ACTION_EN}" \
      "bundled-foolcore-incomplete runtime=${_RUNTIME_KEY} result=$FoolVerifyResourceResult instDir=$INSTDIR" \
      "bundled-foolcore-incomplete runtime=${_RUNTIME_KEY} result=$FoolVerifyResourceResult instDir=$INSTDIR"
  ${EndIf}
!macroend

!macro customInstall
  !insertmacro FOOL_VERIFY_CORE_APP_FILES
  !insertmacro FOOL_VERIFY_BUNDLED_FOOLCORE_RESOURCES "${FOOL_RUNTIME_KEY}"
  !insertmacro FOOL_LOG_EVENT "verify-install ok instDir=$INSTDIR"
  !insertmacro FOOL_CLEAR_ACTIVE_INSTALLER_MARKER
  !insertmacro FOOL_SESSION_SUCCESS
!macroend

!endif
