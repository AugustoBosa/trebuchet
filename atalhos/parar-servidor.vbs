' Desliga o servidor escondido do Laboratorio de Trebuchets (o processo que escuta a porta 5190).
Option Explicit
Dim sh
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell -NoProfile -WindowStyle Hidden -Command ""Get-NetTCPConnection -LocalPort 5190 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }""", 0, True
MsgBox "Servidor da ferramenta desligado.", 64, "Laboratório de Trebuchets"
