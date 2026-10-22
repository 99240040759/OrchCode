!macro NSIS_HOOK_POSTINSTALL
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Preserve user data ($APPDATA\Orch and $LOCALAPPDATA\Orch) across updates.
  ; Unconditional deletion erases SQLite database (chat history) and user quick-projects.
!macroend





