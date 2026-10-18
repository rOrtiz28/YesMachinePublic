@echo off
rem Test only: starts the latency harness in this Windows session, logging to %TEMP%\ym-latency.log.
rem Usage: run.cmd [motion|heavy]   motion = scrolling text, heavy = video-like color and shapes. Needs .\token and
rem Electron for Windows in ..\..\..\node_modules\electron\dist, as on the other systems.
rem Electron runs in the foreground, so this script returns only when the harness exits, which run-loop.cmd relies
rem on. Its DevTools port is 9224, and YM_FLAGS adds Chromium flags. stop.cmd stops it.
cd /d "%~dp0"
rem Stop a harness that is still running.
if exist pid call stop.cmd >nul
rem Start from a clean environment: an editor's ELECTRON_RUN_AS_NODE would make Electron run as plain Node. heavy is
rem motion with the video-like page instead of the scrolling text.
set ELECTRON_RUN_AS_NODE=
set YM_MOTION=
set YM_HEAVY=
if "%1"=="motion" set YM_MOTION=1
if "%1"=="heavy" set YM_MOTION=1
if "%1"=="heavy" set YM_HEAVY=1
"..\..\..\node_modules\electron\dist\electron.exe" --remote-debugging-port=9224 %YM_FLAGS% . > "%TEMP%\ym-latency.log" 2>&1
