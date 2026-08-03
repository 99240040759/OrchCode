!macro NSIS_HOOK_POSTINSTALL
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  RMDir /r "$APPDATA\orch"
  RMDir /r "$LOCALAPPDATA\orch"
!macroend





