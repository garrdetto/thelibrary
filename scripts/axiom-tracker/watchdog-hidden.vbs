' Runs the Axiom Radar guard with no window. Windows Task Scheduler starts this every two minutes.
Set files = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
here = files.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = files.GetAbsolutePathName(files.BuildPath(here, "..\.."))
shell.Run "node ""scripts\axiom-tracker\watchdog.mjs""", 0, False
