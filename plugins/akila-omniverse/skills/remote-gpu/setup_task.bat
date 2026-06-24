@echo off
REM Launch akila viewer in the logged-on RDP session (GPU available) via a one-shot
REM scheduled task, so it survives the ssh session closing. Logs stdout to viewer_launch.log.
set REPO=C:\Users\ezycloudx-admin\Desktop\usd-viewer
schtasks /create /tn AkilaViewer /f /sc once /st 23:59 /tr "cmd /c cd /d %REPO% && runfast.bat > %REPO%\viewer_launch.log 2>&1"
schtasks /run /tn AkilaViewer
echo TASK_RUN_RC=%errorlevel%
