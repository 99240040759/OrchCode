!macro NSIS_HOOK_POSTUNINSTALL
  RMDir /r "$APPDATA\${BUNDLEID}"
  RMDir /r "$LOCALAPPDATA\${BUNDLEID}"
  RMDir /r "$APPDATA\com.orch.live"
  RMDir /r "$LOCALAPPDATA\com.orch.live"
  RMDir /r "$APPDATA\orchcode"
  RMDir /r "$LOCALAPPDATA\orchcode"
!macroend
