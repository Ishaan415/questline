; Questline installer hooks (wired up in tauri.conf.json → bundle.windows.nsis.installerHooks).
;
; Why this exists
; ---------------
; Before replacing questline.exe, Tauri's installer asks the Windows Restart Manager
; "is anything using this file?". Restart Manager also counts programs that only keep
; the file open to read it, such as antivirus scanners. The installer runs without
; admin rights, so it can't close those, and it stops with "Failed to kill Questline"
; even though Questline isn't running.
;
; Those readers still allow the file to be renamed and deleted. So, when Questline
; itself is not running, these hooks rename questline.exe out of the way just before
; that check and then delete it: nothing is left for the check to complain about,
; and the installer goes on to write the new copy. If Questline really is running,
; the hooks do nothing and Tauri's normal "close it?" prompt takes over.

!macro QL_MOVE_EXE_ASIDE
  Push $0
  Push $1

  ; Is a process actually called questline.exe running? (find exits 0 if so)
  nsExec::ExecToStack 'cmd /c tasklist /NH /FI "IMAGENAME eq ${MAINBINARYNAME}.exe" | find /I "${MAINBINARYNAME}.exe"'
  Pop $0
  Pop $1

  ${If} $0 != 0
  ${AndIf} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
    Delete "$INSTDIR\${MAINBINARYNAME}.exe.old"
    ClearErrors
    Rename "$INSTDIR\${MAINBINARYNAME}.exe" "$INSTDIR\${MAINBINARYNAME}.exe.old"
    ${IfNot} ${Errors}
      ; Usually deletes right away; otherwise Windows removes it at the next restart.
      Delete /REBOOTOK "$INSTDIR\${MAINBINARYNAME}.exe.old"
    ${EndIf}
    ClearErrors
  ${EndIf}

  Pop $1
  Pop $0
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro QL_MOVE_EXE_ASIDE
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro QL_MOVE_EXE_ASIDE
!macroend
