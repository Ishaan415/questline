; Questline installer hooks (wired up in tauri.conf.json → bundle.windows.nsis.installerHooks).
;
; Why this exists
; ---------------
; Before replacing questline.exe, Tauri's installer asks the Windows Restart Manager
; "is anything using this file?". Restart Manager also counts programs that only have
; the file open for a moment: antivirus scanners (McAfee, Defender), the search
; indexer, Explorer reading the icon. The installer runs without admin rights, so it
; can't close those, and it gives up at once with "Failed to kill Questline", even
; though Questline itself isn't running.
;
; These hooks run just before that check. If Questline really is running, they do
; nothing and Tauri's normal "close it?" prompt takes over. Otherwise they wait up
; to 30 seconds for the other program to let go of the file, so the check passes.

!macro QL_WAIT_FOR_UNLOCK
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5

  ; Is a process actually called questline.exe running? (find exits 0 if so)
  nsExec::ExecToStack 'cmd /c tasklist /NH /FI "IMAGENAME eq ${MAINBINARYNAME}.exe" | find /I "${MAINBINARYNAME}.exe"'
  Pop $0
  Pop $1

  ${If} $0 != 0
    StrCpy $5 0
    ${Do}
      StrCpy $4 0 ; 1 = something still holds the file
      System::Call 'RSTRTMGR::RmStartSession(*i .r1, i 0, w .r2) i .r0'
      ${If} $0 = 0
        System::Call '*(&w${NSIS_MAX_STRLEN} "$INSTDIR\${MAINBINARYNAME}.exe") p .r3'
        System::Call 'RSTRTMGR::RmRegisterResources(i r1, i 1, *p r3, i 0, p 0, i 0, p 0) i .r0'
        ${If} $0 = 0
          System::Call 'RSTRTMGR::RmGetList(i r1, *i 0 .r2, *i 0, p 0, *i 0) i .r0'
          ${If} $0 = 234 ; ERROR_MORE_DATA: at least one process has the file open
            StrCpy $4 1
          ${EndIf}
        ${EndIf}
        System::Free $3
        System::Call 'RSTRTMGR::RmEndSession(i r1)'
      ${EndIf}

      ${If} $4 = 0
        ${ExitDo}
      ${EndIf}
      IntOp $5 $5 + 1
      ${If} $5 >= 30
        DetailPrint "questline.exe is still in use by another program; continuing anyway."
        ${ExitDo}
      ${EndIf}
      ${If} $5 = 1
        DetailPrint "Waiting for another program (often antivirus) to release questline.exe..."
      ${EndIf}
      Sleep 1000
    ${Loop}
  ${EndIf}

  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro QL_WAIT_FOR_UNLOCK
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro QL_WAIT_FOR_UNLOCK
!macroend
