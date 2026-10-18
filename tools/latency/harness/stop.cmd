@echo off
rem Test only: stops the latency harness started by run.cmd.
cd /d "%~dp0"
if not exist pid (echo stopped & exit /b 0)
set /p HARNESS=<pid
rem The process id the harness wrote. /t also ends the processes it started, such as Electron's renderers, and /f
rem forces them all to end.
taskkill /pid %HARNESS% /t /f >nul 2>&1
del pid
echo stopped
