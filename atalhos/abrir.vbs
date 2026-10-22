' Abre o Laboratorio de Trebuchets: sobe o servidor local escondido (se ainda nao estiver no ar)
' e abre a pagina no navegador padrao. Duplo clique; nenhuma janela de terminal aparece.
Option Explicit
Const PORTA = 5190
Dim sh, fso, pasta, url, i
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
pasta = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)) ' a pasta do projeto
url = "http://localhost:" & PORTA & "/"

If Not NoAr(url) Then
  sh.CurrentDirectory = pasta
  ' primeira vez nesta maquina: instala as dependencias (escondido, espera terminar)
  If Not fso.FolderExists(pasta & "\node_modules") Then sh.Run "cmd /c npm install > atalhos\servidor.log 2>&1", 0, True
  ' --host: tambem aceita o celular na mesma rede Wi-Fi
  sh.Run "cmd /c npm run dev -- --port " & PORTA & " --strictPort --host > atalhos\servidor.log 2>&1", 0, False
  For i = 1 To 80
    WScript.Sleep 250
    If NoAr(url) Then Exit For
  Next
End If

If NoAr(url) Then
  sh.Run url
Else
  MsgBox "Não consegui iniciar o servidor da ferramenta." & vbCrLf & "Veja o arquivo atalhos\servidor.log na pasta do projeto.", 48, "Laboratório de Trebuchets"
End If

Function NoAr(u)
  Dim h
  On Error Resume Next
  Set h = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  h.setTimeouts 500, 500, 500, 500
  h.Open "GET", u, False
  h.Send
  NoAr = (Err.Number = 0)
  If NoAr Then NoAr = (h.Status = 200)
End Function
