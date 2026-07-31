!ifndef FOOL_INSTALLER_DIR_GUARD_NSH
!define FOOL_INSTALLER_DIR_GUARD_NSH

; Refuses an install directory that belongs to somebody else.
;
; This installer removes the target directory as part of its own upgrade flow —
; `FOOL_REMOVE_INSTALL_DIR` ends in `RMDir /r "$INSTDIR"`. That is correct for a
; directory this app owns and catastrophic for anything else, and the directory
; page lets the user type any path at all. Point it at a source checkout, a
; Documents folder, or a drive root and the contents are gone.
;
; So: an empty or missing directory is fine, a directory that already holds this
; app is fine (that is what an upgrade looks like), and anything else greys out
; Next. NSIS calls this on every keystroke in the path field, which is why it
; reports by disabling the button rather than by opening a message box.

; The test is `resources\app.asar` rather than the executable's name. This file is
; included before electron-builder's common.nsh, so ${APP_EXECUTABLE_FILENAME} is
; not defined yet at parse time — and a hardcoded name is what caused the bug
; above it. Every electron-builder install has an app.asar, no ordinary folder
; does, and that is the distinction being drawn: an app directory versus
; somebody's documents.
Function .onVerifyInstDir
  ; Nothing there yet — the ordinary case.
  ${IfNot} ${FileExists} "$INSTDIR\*.*"
    Return
  ${EndIf}

  ; An app directory: an upgrade over a previous install.
  ${If} ${FileExists} "$INSTDIR\resources\app.asar"
    Return
  ${EndIf}

  ; Somebody else's files. Refuse rather than delete them.
  Abort
FunctionEnd

!endif
