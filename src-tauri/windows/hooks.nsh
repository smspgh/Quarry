; Installer hooks (bundle.windows.nsis.installerHooks).
; Adds Quarry to Explorer's "Open with" list for common text types and an "Open with Quarry" item
; to the context menu of every file and folder and of the empty space inside a folder. Nothing
; becomes a default app: Windows keeps the user's current choices. Everything is per-user (HKCU) and removed on uninstall.

!define QUARRY_APPKEY "Software\Classes\Applications\${MAINBINARYNAME}.exe"

!macro QUARRY_TYPE EXT
  WriteRegStr HKCU "${QUARRY_APPKEY}\SupportedTypes" "${EXT}" ""
  WriteRegStr HKCU "Software\Classes\${EXT}\OpenWithList\${MAINBINARYNAME}.exe" "" ""
!macroend

!macro QUARRY_UNTYPE EXT
  DeleteRegKey HKCU "Software\Classes\${EXT}\OpenWithList\${MAINBINARYNAME}.exe"
!macroend

!macro QUARRY_TYPES M
  !insertmacro ${M} ".txt"
  !insertmacro ${M} ".log"
  !insertmacro ${M} ".json"
  !insertmacro ${M} ".jsonc"
  !insertmacro ${M} ".json5"
  !insertmacro ${M} ".jsonl"
  !insertmacro ${M} ".ndjson"
  !insertmacro ${M} ".csv"
  !insertmacro ${M} ".tsv"
  !insertmacro ${M} ".md"
  !insertmacro ${M} ".xml"
  !insertmacro ${M} ".yaml"
  !insertmacro ${M} ".yml"
  !insertmacro ${M} ".toml"
  !insertmacro ${M} ".ini"
  !insertmacro ${M} ".cfg"
  !insertmacro ${M} ".conf"
  !insertmacro ${M} ".sql"
  !insertmacro ${M} ".js"
  !insertmacro ${M} ".mjs"
  !insertmacro ${M} ".ts"
  !insertmacro ${M} ".tsx"
  !insertmacro ${M} ".jsx"
  !insertmacro ${M} ".css"
  !insertmacro ${M} ".scss"
  !insertmacro ${M} ".html"
  !insertmacro ${M} ".htm"
  !insertmacro ${M} ".py"
  !insertmacro ${M} ".rs"
  !insertmacro ${M} ".go"
  !insertmacro ${M} ".c"
  !insertmacro ${M} ".h"
  !insertmacro ${M} ".cpp"
  !insertmacro ${M} ".hpp"
  !insertmacro ${M} ".cs"
  !insertmacro ${M} ".java"
  !insertmacro ${M} ".ps1"
  !insertmacro ${M} ".sh"
  !insertmacro ${M} ".bat"
  !insertmacro ${M} ".cmd"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "${QUARRY_APPKEY}" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr HKCU "${QUARRY_APPKEY}\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "${QUARRY_APPKEY}\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  !insertmacro QUARRY_TYPES QUARRY_TYPE

  WriteRegStr HKCU "Software\Classes\*\shell\Quarry" "" "Open with ${PRODUCTNAME}"
  WriteRegStr HKCU "Software\Classes\*\shell\Quarry" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\*\shell\Quarry\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\Directory\shell\Quarry" "" "Open folder in ${PRODUCTNAME}"
  WriteRegStr HKCU "Software\Classes\Directory\shell\Quarry" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\Directory\shell\Quarry\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  ; Right click on the background of an open folder (or drive); %V is that folder.
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Quarry" "" "Open folder in ${PRODUCTNAME}"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Quarry" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Quarry\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%V"'

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "${QUARRY_APPKEY}"
  !insertmacro QUARRY_TYPES QUARRY_UNTYPE
  DeleteRegKey HKCU "Software\Classes\*\shell\Quarry"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\Quarry"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\Quarry"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
