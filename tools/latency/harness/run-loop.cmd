@echo off
rem Test only: keeps the latency harness running for experiments from the viewer computer. Each time the harness
rem exits, it starts again with the mode in mode.txt (still, motion or heavy) and the Chromium flags in flags.txt.
rem Close this window to end it.
cd /d "%~dp0"
:again
rem Without mode.txt the mode is motion, and without flags.txt there are no extra flags.
set MODE=motion
set FLAGS=
if exist mode.txt set /p MODE=<mode.txt
if exist flags.txt set /p FLAGS=<flags.txt
set YM_FLAGS=%FLAGS%
echo Starting the latency harness: %MODE% %FLAGS%
call run.cmd %MODE%
rem Wait about two seconds before starting again: batch files have no sleep, so ping this computer three times.
ping -n 3 127.0.0.1 >nul
goto again
