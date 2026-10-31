Set WshShell = CreateObject("WScript.Shell")
projectPath = CreateObject("Scripting.FileSystemObject").GetAbsolutePathName(".")
WshShell.CurrentDirectory = projectPath
WshShell.Run "cmd /c python main.py", 0, False
WScript.Sleep 2000
WshShell.Run "http://localhost:8000", 1, False
