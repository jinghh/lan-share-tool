Option Explicit

' Launch ShareBox without showing a console window.
' Kept ASCII-only on purpose: cscript/wscript reads VBScript using the system
' ANSI code page, so non-ASCII characters would be mangled.

Dim fso, shell, here, exe, cmd

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

here = fso.GetParentFolderName(WScript.ScriptFullName)
exe = fso.BuildPath(here, "ShareBox.exe")

If fso.FileExists(exe) Then
    shell.CurrentDirectory = here
    cmd = """" & exe & """ --tray --no-open"
    shell.Run cmd, 0, False
Else
    MsgBox "ShareBox.exe not found:" & vbCrLf & exe, 16, "LAN ShareBox"
End If
