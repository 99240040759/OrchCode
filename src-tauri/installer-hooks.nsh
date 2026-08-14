!macro NSIS_HOOK_POSTINSTALL
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  RMDir /r "$APPDATA\Orch"
  RMDir /r "$LOCALAPPDATA\Orch"
!macroend





