; x64 architecture entry for the NSIS installer.

!include "x64.nsh"

!define FOOL_TARGET_ARCH "x64"
!define FOOL_RUNTIME_KEY "win32-x64"
!define FOOL_EXTRACT_METHOD "7z"

!addincludedir "${PROJECT_DIR}\resources\windows"
!include "installer-common.nsh"
!include "installer-dir-guard.nsh"

!macro customHeader
  !insertmacro FOOL_INSTALLER_CUSTOM_HEADER
!macroend

!macro preInit
  !insertmacro FOOL_INSTALLER_PREINIT
!macroend

!macro customFiles_x64
  !insertmacro FOOL_LOG_EXTRACT_RESULT "7z"
!macroend

; Architecture guard. Inserted from FOOL_INSTALLER_PREINIT (preInit) so it runs before any
; registry mutation, replacing the old .onVerifyInstDir placement which fired after customInit
; had already healed/cleared/repaired an existing install's registry. (Sentry ELECTRON-3BX)
; Rejection policy is unchanged: an x64 build refuses both x86 and ARM64 machines.
!macro FOOL_ASSERT_TARGET_ARCH
  Var /GLOBAL FoolActualArch
  ${If} ${IsNativeARM64}
    !insertmacro FOOL_DETECT_NATIVE_ARCH $FoolActualArch
    !insertmacro FOOL_FAIL_UX \
      "${FOOL_E_ARCH_MISMATCH}" \
      "target=x64 actual=$FoolActualArch" \
      "${FOOL_MSG_ARCH_MISMATCH_ZH}" \
      "${FOOL_MSG_ARCH_MISMATCH_EN}" \
      "${FOOL_MSG_ARCH_MISMATCH_ACTION_ZH}" \
      "${FOOL_MSG_ARCH_MISMATCH_ACTION_EN}" \
      "target=x64 actual=$FoolActualArch" \
      "target=x64 actual=$FoolActualArch"
  ${ElseIfNot} ${RunningX64}
    !insertmacro FOOL_DETECT_NATIVE_ARCH $FoolActualArch
    !insertmacro FOOL_FAIL_UX \
      "${FOOL_E_ARCH_MISMATCH}" \
      "target=x64 actual=$FoolActualArch" \
      "${FOOL_MSG_ARCH_MISMATCH_ZH}" \
      "${FOOL_MSG_ARCH_MISMATCH_EN}" \
      "${FOOL_MSG_ARCH_MISMATCH_ACTION_ZH}" \
      "${FOOL_MSG_ARCH_MISMATCH_ACTION_EN}" \
      "target=x64 actual=$FoolActualArch" \
      "target=x64 actual=$FoolActualArch"
  ${EndIf}
!macroend
