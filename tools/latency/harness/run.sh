#!/bin/bash
# Test only: starts the latency harness on this Linux computer's desktop, logging to /tmp/ym-latency.log.
# Usage: run.sh [motion|heavy]   motion = scrolling text, heavy = video-like color and shapes. Needs ./token.
# Electron runs detached from this shell (setsid nohup), so the harness keeps running after an SSH session ends.
# Its DevTools port, 9224, is the one measure.cjs reaches over YM_SSH; YM_FLAGS adds Chromium flags. stop.sh stops it.
cd "$(dirname "$0")"
# Stop a harness that is still running, and give it time to exit.
[ -f pid ] && kill "$(cat pid)" 2>/dev/null && sleep 2
# In a Wayland session (YM_SESSION=wayland), input goes through the RemoteDesktop portal and the color window fills
# the screen; the desktop asks to share the screen and, the first time, to allow control. Over SSH, the desktop's
# display is taken to be :0 unless DISPLAY says otherwise.
export DISPLAY=${DISPLAY:-:0}
if [ "$YM_SESSION" = wayland ]; then export XDG_SESSION_TYPE=wayland WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-wayland-0}
else export XDG_SESSION_TYPE=x11; unset WAYLAND_DISPLAY; fi
# An editor's ELECTRON_RUN_AS_NODE would make Electron run as plain Node (see scripts/start.cjs). heavy is motion
# with the video-like page instead of the scrolling text.
unset ELECTRON_RUN_AS_NODE YM_MOTION YM_HEAVY
[ "$1" = motion ] || [ "$1" = heavy ] && export YM_MOTION=1
[ "$1" = heavy ] && export YM_HEAVY=1
setsid nohup ../../../node_modules/electron/dist/electron --remote-debugging-port=9224 $YM_FLAGS . > /tmp/ym-latency.log 2>&1 &
