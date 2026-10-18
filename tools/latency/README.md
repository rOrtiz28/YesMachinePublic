# Latency measurements

Test-only tools that time how long a pointer move takes to come back as a changed picture, and record what WebRTC reports on both ends. They are not part of the packaged app. The results are in [docs/VALIDATION.md](../../docs/VALIDATION.md#responsiveness-october-11-2026).

## What happens

- `harness/` runs this repository's Yes Machine on a Linux X11 computer, the host. It uses a one-time test password from `harness/token`, port 4778, its own data folder, and no network announcements. It also opens a small window that turns white when the mouse is in its right half and black in its left half. With `motion` or `heavy`, it adds a large window that keeps changing: scrolling text, or video-like color and shapes.
- `measure.cjs` runs on another computer with Google Chrome. It signs in to the harness from headless Chrome and moves the pointer over the small window. Frame by frame, it watches the video for the color to change. It also reports frame rate and pacing, bitrate, resolution and quality on the viewer, and, with `YM_SSH`, the host's encoder and capture rate.
- With `relay=`, every packet between the two goes through `relay.cjs` on the viewer's computer. The relay adds a link speed with a 300 ms queue, a base delay, variation without reordering, and random loss, in both directions, to stand in for poor Wi-Fi.

## Run it

On the host, in its desktop session, with the repository and its `node_modules` in place:

```sh
cd tools/latency/harness
(umask 077; openssl rand -hex 16 > token)
./run.sh motion        # or: ./run.sh, ./run.sh heavy
```

Over SSH, also set `XAUTHORITY`, `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS` for that session. In a Wayland session, run it with `YM_SESSION=wayland`: the color window then fills the screen, because Wayland doesn't let an app place its windows, and someone at the host has to choose the screen and allow control in the desktop's dialogs. `./stop.sh` stops the harness.

On Windows, put Electron for Windows in `node_modules\electron\dist` (the zip electron-builder caches, for the host's architecture), create `token` the same way, and start `tools\latency\harness\run.cmd` (with `motion` or `heavy` if wanted) in the desktop session; over SSH, start it through a scheduled task that runs in that session. `stop.cmd` stops it, and the log is `%TEMP%\ym-latency.log`. `run-loop.cmd` starts it again each time it exits, with the mode in `mode.txt` and the Chromium flags in `flags.txt` beside it, so running `stop.cmd` over SSH restarts it with new settings and nobody has to start it by hand each time. Windows' firewall must allow that Electron on the private network. On the viewer computer, also set `YM_WINDOWS=1`.

On the viewer computer, copy the token, then:

```sh
export YM_HOST=192.168.1.53 YM_USER=host-account YM_TOKEN=/path/to/token-copy
export YM_BIND=192.168.1.52                              # this computer's address, for relay=
export YM_SSH="-i ~/.ssh/key host-account@192.168.1.53"  # optional: host statistics and the window's position
node tools/latency/measure.cjs label=good rounds=80
node tools/latency/measure.cjs label=bad rounds=80 relay=delay:15,jitter:25,loss:2,rate:8000
```

Without `YM_SSH`, pass `pattern=` with the JSON after `PATTERN` in the host's `/tmp/ym-latency.log`. Each run prints its result and appends it to `results.jsonl` in `YM_OUT`, which is a temporary folder by default.

`roundTripMs` runs from the synthetic pointer event in the viewer page to the expected display time of the first frame showing the change. It includes the viewer batching moves into animation frames, the host redrawing its window, capture, encoding, the network, decoding and the viewer's buffer. It does not include the viewer's display hardware.

`hostEval=<JavaScript>` runs code in the harness's host page before the viewer connects, for trying a setting without changing the app.

## A Mac host, and the Android app as the viewer

On a Mac the harness would need its own Screen Recording and Accessibility permissions, so the installed Yes Machine shares instead, and `pattern/` shows only the harness's windows, which need no permission. In the Android app, sign in to the Mac as usual. Then, on the Mac:

```sh
cd tools/latency/pattern
env -u ELECTRON_RUN_AS_NODE ../../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . > /tmp/ym-pattern.log &   # or with motion or heavy
grep PATTERN /tmp/ym-pattern.log
adb forward tcp:9336 localabstract:webview_devtools_remote_$(adb shell pidof local.yesmachine.android)
YM_CDP=127.0.0.1:9336 node ../measure.cjs label=mac-tablet rounds=80 pattern='<the JSON after PATTERN>'
```

`YM_CDP` attaches to the viewer page already connected instead of signing in from Chrome. The Mac's pointer moves on its own while it runs, so leave its mouse alone. Without the harness there are no host statistics.
