# Validation record

**Yes Machine 1.0.1 — updated October 17, 2026**

This record separates implemented features, automated checks, and observed device behavior. Yes Machine is an original app, not a NoMachine replacement. These results do not establish full NoMachine feature parity, and the limits below still apply.

The October 9–10 pixel redesign changed how apps connect: the desktop and Android apps sign in with the host computer's account. On October 11, browsers moved to the same sign-in and the six-digit PIN was removed. The sections from October 4 describe the earlier PIN-only version and are kept as history.

## Automated checks

**All 188 desktop tests passed on October 17, 2026**, on the Apple Silicon Mac with Node.js 24.7. Run the suite from the project directory with:

```sh
npm test
```

| Area | Tests | Evidence |
| --- | ---: | --- |
| Input controller | 16 | Mocked native input and clipboard methods. Coordinate validation, malformed messages, authorization gates, native availability, held-key/button cleanup, modifier handling, bounded wheel input, clipboard byte limits, Unicode restrictions, and native double-click dispatch. |
| Server and sign-in | 19 | Real HTTPS/WebSocket listeners on `127.0.0.1`. Security headers, Host/Origin rejection, the viewer page's assets and fonts, a session that refuses everything (including an old PIN) until it spends a sign-in ticket, readiness, a newer sign-in taking over from the current viewer, the five-per-minute sign-in budget and its recovery, one certificate per address that survives moving between networks and back, an identity saved by the previous version, private-only ICE, exact file bytes in both directions, a file that would fill the disk refused before anything is written, a file for the viewer offered at a one-time address that only the viewer can take, once, with its name and bytes, and gone when the viewer leaves, cleanup of incomplete uploads, and revocation on disconnect and stop. Sign-in tests cover a ticket that opens exactly one session, foreign origins, malformed requests, hosts without sign-in, too many attempts, tickets that expire after one minute, and a desktop sign-in that sends the password only to the approved certificate. |
| Local discovery | 18 | A mocked mDNS implementation with deterministic timers. Private IPv4 records only, malformed and unrelated records, bounded and deduplicated lists, moved services, goodbyes and expiry, announcements that never carry the PIN, the operating system label, manual fallback after multicast errors, bounded diagnostics, and refresh. Android devices sharing in general mode: their records, with the address they came from and without trusting their fingerprint, kept in a list of their own and browsed for only when asked. They do not prove discovery between physical devices. |
| Security helpers | 4 | Private address allowlist, safe file names, and ICE/SDP candidate restrictions. |
| Network names | 4 | Wi-Fi, Ethernet and virtual adapters told apart on macOS, Linux and Windows, virtual adapters listed last, macOS hardware ports read again only for a new device, and the real port list parsed on this Mac. |
| Mac package identity | 6 | Deterministic application-specific Mach-O UUIDs, supported byte orders and CPU slices, and rejection of unsafe executable layouts. |
| Account check | 4 | Only the account running Yes Machine can sign in, the password never appears in process arguments, each platform uses its own helper, bad account names never reach a helper, and another account waits as long as a wrong password before being refused. |
| Saved computers check | 4 | A sharing computer reports online with its certificate fingerprint, a closed port reports offline, public or malformed targets are never contacted, and one call checks a bounded number of computers. |
| Wayland remote control | 9 | The saved portal approval reaches the helper on stdin, never in its arguments; pointer, button, wheel, key and text events become portal calls in the shared screen's coordinates; a declined or missing portal leaves control off; the Python helper compiles. The clipboard goes through the same session: what the helper reports as copied is the computer's clipboard, and text from the viewer is offered for pasting; an approval saved before the clipboard was asked for is set aside once. The helper's own reading code, run against stand-in portal signals and pipes, takes the types of a copy as a plain list or as GNOME's tuple, prefers UTF-8 text, ignores pictures, its own offers and other sessions, and drops a slow read once something newer is copied. |
| Shared clipboard | 2 | The computer's clipboard watch, with a stand-in clipboard and timer: only what is copied after a viewer connects goes across, once per change; text the viewer sent isn't sent back, and nothing goes across once it stops. |
| Starting at login | 8 | The Linux autostart entry quotes its paths for the Exec key, the macOS LaunchAgent escapes them, Windows gets the login item with the hidden flag, and turning the switch off removes the entry. An installed copy turns the switch on the first time it runs and notes it privately, so a switch turned off afterwards stays off; a copy run from source never turns it on by itself. Only `--hidden` marks a start at login. |
| Approved certificates | 4 | Approvals persist privately, the viewer engine accepts only the approved fingerprint for that address, and tampered entries are rejected. |
| Remembered sign-ins | 3 | Passwords are stored encrypted and privately, nothing is remembered without real encryption (including Linux plain-text storage), and clearing forgets everything. |
| Android devices | 17 | A stand-in adb and device server. `adb devices` is read by tab, so serials with spaces survive, and the notes adb prints when it starts are ignored; a device reached both ways is listed once, by cable; only ready devices are listed; adb is found from the environment or Android Studio's folder; each device is described once, by its model when it has no name; the list empties when adb fails. A session pushes the server, starts it under a fresh socket name, forwards a port and connects. Closing it stops the server and removes the forward once, and it also ends when the server exits or the connection drops. A server that doesn't start is reported with what it printed. The server builds against the oldest platform from API 30 with the newest d8. A screenshot is a PNG the device takes with `screencap`, and anything else is refused. A device reached both ways keeps both, connects over Wi-Fi when asked, and `adb mdns services` is read by tab. Wi-Fi pairing waits for the device that scanned the code, pairs with the address it announces and the code's one-time password, and waits for it to connect; a refused pairing is reported and a cancelled one goes quiet. A device whose Yes Machine app is in general mode is marked from one package query per device, shows again when the app switches back, and is refused advanced mode before anything is pushed to it; a server that finds the app in general mode is reported the same way. |
| QR codes | 4 | Reed-Solomon codewords against the standard's worked example, format and version information against the published tables, the smallest version for the text, and the fixed patterns where readers look for them. |
| Light mode | 8 | Sarigüeya's way from the night roof by the air conditioner and the trash can to the balustrade, with no leap between frames and about seven seconds long; the way back as the same steps reversed; daylight reaching the top left first; by day the garage and the gates following sharing while her mood follows the connection; a tap's heart and happy seconds, and the house drawn without her. The viewer page's night and day colors are the main window's, every one of its colors has a day value, and both viewer pages offer both schemes. In the Android app she sits up while a computer is ready to connect, without opening the garage or the gates. |
| Android app files | 2 | Every script and style sheet the Android app's home, viewer and share pages load is copied into the app by the build and served to that page by the app. The viewer's keyboard rules were copied but not served, so the app's viewer would have stopped at the missing `DesktopKeys`. |
| Viewer bars | 1 | Both viewers' **Hide bars** sits beside **Full screen**, right of it in the Android window and left of it in the computer viewer, and each small bar has **Show bars** and **Full screen**. |
| Android viewer window | 4 | Stand-ins for Electron's windows. **Disconnect** closes the window, ends the device's session and tells the main window it disconnected, once; pressed while the person at the device is still being asked, it says the same without a cancel error; closing the window then still reports the cancel. A new window opens in the app's current colors. The clipboard with a device follows the clipboard card: what the device copied lands on this computer's clipboard, what is copied here goes to the device and never comes back, one way only stops the device reporting, and off sends nothing. |
| Screens | 4 | The screens a computer can share in the order it places them, left to right then top to bottom, with their size in pixels, the main one marked, names without control characters and a number for unnamed ones, broken entries left out; the chosen screen while it is connected, then the main one, then the first. |
| Windows cursor | 6 | The helper starts with the first request for the viewer's own pointer, in hidden PowerShell, and gets hide on stdin; shapes are read from its output however it arrives and anything else is ignored; stopping closes its stdin and clears the mark, the next request starts a new helper, and a mark left by a crash runs one only to give the cursors back; the helper's code gives them back when it starts, when its stdin closes and when the mouse at the computer moves (Windows' injected-input flag tells the viewer's moves apart), and blanks them again only after that mouse is still for two seconds and the viewer moves; turning the viewer's pointer off keeps the helper. |
| VMware graphics | 2 | VMware's virtual graphics card is found in Windows' display adapter registry entries, other cards and unreadable entries are left alone, and Linux and macOS are never checked. |
| Desktop keyboard | 12 | The viewer's keys for a Mac controlling Windows or Linux: ⌘ works as Ctrl and reaches the computer only with its key; ⌘ and ⌥ with the arrows and Delete become the line, text and word moves and deletes Windows and Linux use, never Alt+←; ⌥ with other keys is Alt; the Mac's Control and Shift stay themselves; the Mac's window keys stay with the Mac; ⌘-click and ⌥-click arrive as Ctrl- and Alt-click. Between two Macs, between PCs, and before the host says what it is, keys go as pressed. Simulated key events. |
| Android keyboard | 5 | The viewer's key decisions for macOS, Windows and Linux: characters, accents and AltGr arrive as text in the computer's layout; Ctrl shortcuts, and ⌘ shortcuts on a Mac, reach the device by the letter on the key, or by its place where letters aren't Latin; keys that aren't characters keep their modifiers, the number pad's arrows included; the Mac's window keys, F11, ⌃⌘F and Escape in full screen stay with the computer. These are simulated key events, not a real Windows or Linux keyboard. |
| Android stream protocol | 8 | The device's stream parses the same whole or a byte at a time, with sound among the video, frames keep their bytes, the device can end the session and say why, sound of an odd or oversized length is refused, foreign or oversized data is refused, touch, scroll, key and text messages are encoded byte for byte, and out-of-range input is dropped. The shared clipboard's messages both ways, with their 60 KB limit, and the file connection's hello, open, data, close and result, whole or a byte at a time, with files over 10 GB and oversized parts refused. |
| Android files | 5 | Real sockets with a stand-in device. Files go one after another and each says the name the device saved it as; a device without room turns a file down at once, and the rest isn't sent; a file the device shares arrives in a private folder (mode 600), is handed over to be saved and is gone afterwards; one is refused without room here, and an unsafe name is made safe; a dropped connection ends both ways' transfers and leaves nothing behind. |
| Android general mode | 7 | A stand-in device over real TLS on `127.0.0.1`. The hello's bytes; this computer's certificate, made once and kept privately; a device certificate that must be approved, where only the one just seen can be and a changed one says so; the device asking, then allowing, with the stream's first bytes kept for the window; denied and busy answers; closing the window while the device asks; and screenshots from the window that must be PNG. |

The input tests do not move a real pointer, type into applications, or change the system clipboard, and the account tests use stand-in helpers rather than real passwords. Test success does not prove native input or sign-in works on each operating system.

The Android project passed **16 Java tests** (`./gradlew :app:testDebugUnitTest`) and **4 JavaScript bridge tests** (`node --test android/test/bridge.test.cjs`) on October 17, 2026, and `./gradlew :app:lintDebug` found warnings only. The Java tests cover endpoint labels, real loopback TLS checks for approved and rejected certificate/IP pins, malformed pin rejection, and isolation from a configured system HTTP proxy. The bridge tests cover its local origin, selected-session routing, stale events, and explicit clipboard access. Android lint ran on October 17 with no errors. Its 12 warnings are the target SDK, an attribute only newer Android versions read, JavaScript in the WebViews (now with the share dialog's), free-space checks that use the plain usable space, and the custom certificate checks, which are deliberate: the app pins approved computers, and in general mode it accepts any computer's certificate for the person at the device to allow or deny. Lint found that sharing in general mode called a method Android 8 and 9 don't have, which was fixed.

## Devices

| Device | Role | Build |
| --- | --- | --- |
| Apple Silicon Mac, macOS 27 | Host and desktop viewer | Ad hoc signed app in `/Applications`, built with `npx electron-builder --dir --mac --arm64` |
| Ubuntu 24.04 ARM64 VM in VMware Fusion, Xorg session, bridged network | Host and desktop viewer | Run from source with `npm start` |
| Samsung Galaxy Tab SM-X230 | Android viewer, and controlled from the Mac in general and advanced mode | Debug APK installed over ADB; advanced mode installs nothing |
| Windows 11 ARM64 VM (build 26300) in VMware Fusion, bridged network, display 2048×1536 at 200% | Host | Unsigned build from `npx electron-builder --win --arm64 --dir` on the Mac, run unpacked |

All four are on the same home network. No Windows PC, Intel Mac, or x64 Linux computer has been tested.

## Checked on the devices during the redesign (October 9–10, 2026)

The user tried these on the devices above while they were built, and reported that they worked:

- The pixel home screen, with the network list drawn as a house and the cat on the roof, on the Mac and the Ubuntu VM.
- Sharing that starts when the app opens, and the **Share when Yes Machine opens** switch that turns it off.
- Signing in with the host computer's own user name and password from the desktop app and from the Android app, with **Remember**.
- The viewer window with the pixel monitor, the napping cat, the tool drawer (keyboard, clipboard, files) and full screen.
- The viewer window closing, and the main window naming the computer, when a connection drops.
- The Android home screen rebuilt as the same house, discovery that finds a computer within seconds, and the **Another network** explanation for a virtual machine behind NAT, which led to the VM's bridged adapter.
- Each computer's operating system and version under its name, such as **Ubuntu 24.04**.
- **Know the rooftop cat**, the heart when tapping the cat, the setup guides, and the new pixel `ym` icon.

These are the user's observations. No timings, logs, or screenshots were kept as separate evidence, and keyboard, audio, clipboard, and file transfer were not checked one by one.

## Checked on October 11, 2026

- The Mac app was rebuilt from commit `5e367dc` and installed in `/Applications`. Every file in its `src/` and `public/` is byte-identical to the source.
- The Ubuntu VM runs the same `src/`, `public/`, and `assets/` files, compared by SHA-1.
- Electron 44.5.1 starts from the source tree, and the native input module loads inside it on the Mac.

## Browser sign-in and Ethernet (October 11, 2026)

- **Browser sign-in**, in headless Chrome against the real server running on the Mac with a stand-in account check: a wrong password showed **That user name or password is not correct.** and kept the form with the password selected; the right one opened the session, showed the host's name, and cleared the password field. The page was also checked at phone width.
- **Host window**, in headless Chrome with a stand-in for the app's main process: the network list read **192.168.1.52 · Wi-Fi** and **172.16.106.1 · Virtual (bridge101)**. When Wi-Fi went away and Ethernet appeared, sharing moved to Ethernet and said so. With no network left, sharing stopped and said it would start again; when Ethernet came back, it did. Opened with no network, as at login, it started sharing once a network appeared. The **Connect from a browser** panel and the new **Browser** setup guide were inspected.
- **Ubuntu VM**: its bridged adapter `enp2s0` is named **Ethernet**, and the VM runs this branch.
- **Android**: the APK built, its 8 Java and 4 bridge tests passed, and it was installed on the SM-X230. On the tablet's Wi-Fi the network label read **Wi-Fi**. With the screen off, Android withholds the network from the app and the label reads **No network** until it wakes.

- **Browser sign-in on real devices**: the user connected from Chrome on the Mac to the Ubuntu VM through the browser sign-in and reported that it worked. Chrome first showed `ERR_ADDRESS_UNREACHABLE` while the VM answered HTTP 200 to `curl` from the same Mac; allowing Chrome in **Local Network** fixed it. The browser guide and the README now say so.

- **From the tablet**: the user signed in from the tablet's browser and reported that it worked. They also played sound on the host and heard it on the tablet in three cases, all reported as working perfectly: the tablet's browser to the Mac, the Android app to the Mac, and the Android app to the Ubuntu VM.

Not checked yet: the browser sign-in from other browsers such as Firefox and Safari, and plugging or unplugging an Ethernet cable on a physical computer.

## Responsiveness (October 11, 2026)

Measured with [tools/latency](../tools/latency/README.md). The host was the Ubuntu VM, which encodes in software with no GPU, so its capture tops out near 40 frames per second. The viewer was headless Chrome on the Mac. The round trip runs from a pointer move in the viewer to the first displayed frame where a window on the host has changed color. A second window kept scrolling text, so the encoder worked the whole time. Poor Wi-Fi was stood in for by a relay on the Mac that delayed, varied, limited and dropped every packet in both directions. Each run took 40 to 80 samples.

**What held the picture back.** Frames reached the viewer about 55 ms after the move, then waited another 120 to 300 ms in its buffer. The viewer sizes that buffer for the slowest frame it has seen, usually the first full frame, and keeps that size for minutes. Frames arrived within 3 ms of their expected times on the local network.

**Changes:**

- The host asks the viewer to show each frame within 40 ms (`WebRTC-ForceSendPlayoutDelay`, min 0, max 40). A 0 ms limit was as fast on good networks and stuttered more on poor ones; 80 ms was slower everywhere.
- Capture at up to 60 frames per second at the screen's own size, up to 1920×1200. Previously it was 30 frames per second, scaled to 1080 lines; 1920×1200 became 1728×1080, which blurred text and cost more to encode.
- Pointer moves on their own data channel that never waits for a lost packet, with sequence numbers so a late move never undoes a newer one. When the pointer stops, its final position goes again on the reliable channel.
- Video up to 10 Mbps instead of 2.5 Mbps. With video-like motion, quality went from QP 69 to QP 15 (lower is sharper). 20 Mbps made very poor Wi-Fi worse.

**Round trip, with the text scrolling (typical / 90th percentile, through the relay):**

| Network as emulated | Before | After |
| --- | --- | --- |
| Good: no added delay or loss | 159 / 199 ms | 84 / 113 ms |
| Busy: 5 ± 10 ms, 0.5% loss, 30 Mbps | 198 / 246 ms | 97 / 116 ms |
| Poor: 15 ± 25 ms, 2% loss, 8 Mbps | 189 / 221 ms | 140 / 179 ms |
| Very poor: 30 ± 40 ms, 5% loss, 3 Mbps | 314 / 433 ms | 183–227 / 264–736 ms |

Without the relay, the same setup measured 72 / 97 ms. On every network, picture quality went from QP 54–75 before to QP 15–16 after, except very poor Wi-Fi at QP 37–55. Frame rate went from 30 to the VM's 35–40. Very poor Wi-Fi still varies a lot from run to run, with occasional stalls near one second.

The relay sometimes added pauses of its own, up to about 300–500 ms once or twice per run, also with no impairment. They did not appear without it.

Not measured yet: a real Mac or Windows host with hardware encoding, the tablet as the viewer, desktop viewer windows, and Firefox, which may ignore the host's request to show frames quickly.

## Session takeover (October 11, 2026)

The user found that signing in from the tablet while the Mac was viewing the Ubuntu VM looked like a failed connection. Now the newer sign-in takes over. The host tells the current viewer `replaced`, closes its connection with code 4000, and admits the new one.

- An automated test checks that the first viewer receives `replaced`, its socket closes with code 4000, and the host reports the first viewer leaving and the second joining as a replacement.
- With two headless Chrome viewers against the real server: in a browser, the first returned to its sign-in screen with **Another device connected to osiris, so this session ended.**, and the second kept the session. Opened as the apps open it, the first viewer reported `#ended-replaced`, the signal on which the desktop and Android apps close the viewer. The desktop app's dialog was rendered and inspected: **Disconnected from osiris** with the same explanation.

On the devices, with the Ubuntu VM sharing, the Mac viewing it, and then the tablet signing in, the user reported that it works.

## Wayland (October 11, 2026)

The Ubuntu VM was switched to its Wayland session: GNOME 46, xdg-desktop-portal 1.18 with RemoteDesktop version 2 and ScreenCast version 5, and PipeWire. Yes Machine ran there natively on Wayland.

- Starting to share opened GNOME's **Share Screen** dialog ("Yes Machine wants to share your screen"). The first time, a dialog with a switch to allow controlling the computer followed. After the user allowed both, they reported that viewing and control worked perfectly.
- The portal's restore token was saved in the app's data folder with mode 600, and GNOME's permission store gained a `remote-desktop` entry. When sharing started again, only the Share Screen dialog appeared: the user confirmed that control was not asked for a second time.
- If the app closed or stopped sharing while the control dialog was still open, the helper kept waiting for an answer. It also left the dialog on screen. Now it stops as soon as its input closes: in the VM, a helper let go four seconds into the dialog exited at that moment, and no process was left behind.
- Six automated tests cover the portal input with a stand-in helper. They check that the saved token goes to the helper on stdin, not in its arguments, and that pointer, button, wheel, key and text events become the right portal calls in the shared screen's coordinates. They also check that a declined or missing portal leaves control off, and that the Python helper compiles.

**Responsiveness on Wayland** was measured on October 11 with `tools/latency` (`YM_SESSION=wayland`). The color window filled the screen, changing color in its top half while its bottom half scrolled text. The viewer was headless Chrome on the Mac, as for X11.

| Network as emulated | X11 (typical / 90th) | Wayland (typical / 90th) |
| --- | --- | --- |
| Direct, no relay | 72 / 97 ms | 219–249 / 348–352 ms |
| Good, through the relay | 84 / 113 ms | 239 / 359 ms |
| Busy | 97 / 116 ms | 294 / 397 ms |
| Poor | 140 / 179 ms | 366 / 437 ms |
| Very poor | 183–227 / 264–736 ms | 437 / 723 ms |

The extra time was spent on the host. Frames reached the viewer 185–226 ms after the move instead of 51–61 ms, and capture ran at 19–23 frames per second instead of 33–35. The viewer's buffer added about 50 ms instead of 15–18 ms, and there were 11 to 26 freezes per run. Picture quality was QP 38–43 on a good network instead of 15.

The two sessions differ in more than the protocol. The VM's Wayland session ran at 3,024 × 1,898, scaled down to 1,912 × 1,200 for sending, while its X11 session ran at 1,920 × 1,200. The VM has no GPU, so GNOME composites and hands frames to PipeWire in software.

The Wayland run was repeated with the VM's screen set to 1,920 × 1,200, the same as X11. VMware Fusion had to be set to stretch the picture instead of resizing the VM:

| Network as emulated | X11 (typical / 90th) | Wayland at 3,024 × 1,898 | Wayland at 1,920 × 1,200 |
| --- | --- | --- | --- |
| Direct, no relay | 72 / 97 ms | 219–249 / 348–352 ms | 133–135 / 209–222 ms |
| Good, through the relay | 84 / 113 ms | 239 / 359 ms | 129 / 213 ms |
| Busy | 97 / 116 ms | 294 / 397 ms | 139 / 290 ms |
| Poor | 140 / 179 ms | 366 / 437 ms | 217 / 370 ms |
| Very poor | 183–227 / 264–736 ms | 437 / 723 ms | 389 / 478 ms |

At the same size, most of the gap closed, and the picture was as sharp as on X11, at QP 15. Wayland was still about 50 ms slower. Frames reached the viewer about 105–110 ms after the move instead of 51–61 ms. Capture ran at 18–25 frames per second instead of 33–35, with 25 to 45 freezes per run. The remaining cost is in the VM's Wayland capture path, which works in software without a GPU. A Linux computer with a GPU, which hands frames to PipeWire as GPU buffers, has not been measured.



## Running in the background (October 11, 2026)

Checked on the Ubuntu VM's Wayland session, driving the app's main process through Node's inspector:

- Closing the window the way its close button does left it hidden, not destroyed, with the app still running. The first time, a notification says that Yes Machine is still running.
- Starting Yes Machine again ended the new copy at once and showed the window of the copy already running.
- **Start Yes Machine when you log in** read off at first. Turned on, it wrote `~/.config/autostart/yes-machine.desktop` with mode 644, running this copy with `--hidden`. Turned off, it removed the entry. It was left off.
- Started with `--hidden`, the app ran with its page loaded and no window on screen.

The VM's Ubuntu AppIndicators extension had been turned off, so GNOME showed no tray icons at first. With the user's OK it was turned on, and Yes Machine's icon registered with GNOME. The user then checked the icon and its menu on the VM and in the Mac's menu bar, with the Mac app built from this branch, and reported that everything worked.

Not checked yet: Windows, and starting at a real login on each system.

## Several computers at once (October 11, 2026)

The desktop app already opened one viewer window per computer, so several could be open at once. Now the list marks the computers it is connected to, and double-clicking one of them brings its window forward instead of signing in again.

Checked on the Mac with two stand-in computers, real servers on ports 4801 and 4802 with a test account. A separate copy of the app, run from this branch with its own data folder, was driven through its DevTools:

- It signed in to both, and two viewer windows were open at once.
- Both cards read **Connected · 192.168.1.52** with a mint frame.
- Connecting to the first computer again made no new sign-in, one per computer, and opened no third window.
- Closing the first viewer window cleared its mark, and the second stayed connected.
- The house was also rendered with two connected computers and inspected.

The user then checked it on the Mac with the Ubuntu VM sharing: the VM's card was marked as connected, and double-clicking it brought its window forward.

Not checked yet with two real computers sharing at the same time.

## Controlling an Android tablet: speed experiment (October 11, 2026)

The first step toward controlling an Android device from a computer. `android/stream` is our own small server for the device. The computer starts it over adb, so it runs with the debugging shell's permissions and needs no prompt on the device. It mirrors the screen with Android 14's virtual display call into the device's hardware H.264 encoder, with Android's low-latency settings, and sends each frame with its capture time. It can also inject touches through the input manager. Measured on the Samsung SM-X230 (Android 16, MediaTek MT8775, encoder `c2.mtk.avc.encoder`, 1,920 × 1,200 at 90 Hz) and the Mac:

| | USB cable (typical / 90th) | Wi-Fi through adb (typical / 90th) |
| --- | --- | --- |
| Capture on the tablet to arrival on the Mac, screen moving | 14.8 / 18.1 ms | 19.1 / 25.3 ms |
| Touch from the Mac to the change seen in decoded video | 54 / 62 ms | 65.5 / 82 ms |

- With the home screen sliding, the stream ran at 91 frames per second, matching the tablet's 90 Hz screen, at about 4.5 Mbps.
- The touch test, `tools/android-stream/probe`, opens a black page in the tablet's browser that turns white while touched. The Mac decodes in hardware with WebCodecs, at 2 ms a frame, and watches the middle of the picture. Over 80 touches nothing was missed. One USB outlier reached 447 ms.
- About 17 ms of the USB round trip is ours: encoding, sending and decoding. Most of the rest is the tablet reacting and redrawing the browser page, which happens when it is used by hand too.

Not measured yet: the time to show a frame on the Mac's screen, scrcpy on the same test, and apps other than the browser.

## Controlling an Android tablet from the desktop app (October 11, 2026)

Advanced mode in the desktop app, built on the experiment's server. The app lists the devices adb reaches, and double-clicking one opens a window that decodes its stream with WebCodecs and sends the mouse, wheel and keyboard back. Checked on the Mac with a separate copy of the app run from this branch and driven through its DevTools, and the SM-X230 on its USB-C cable with wireless debugging also on:

- The tablet was listed once, under its name, with **Android 16** and **USB cable**, although adb reached it both by cable and over Wi-Fi. Opening it connected by cable at 1,920 × 1,200, and its card read **Connected**.
- A dragged swipe on the home screen ran at 53 frames per second. Wheel scrolling in Brave, **Back**, **Home** and **Recents** worked, and clicking a button left the keyboard on the device's screen.
- Typing went through the window's hidden text field into a text field in Brave: "Hola mundo" in the computer's layout, accents composed the way macOS composes them (´ then a, ˜ then n), ⌘A selecting everything, Backspace, and the arrows. Ctrl+L, an address and Enter loaded a page in the same tab. The stream server typed ñ á é í ó ú ü Ñ É ç à ê as each accent's dead key followed by the letter; ¿, ¡ and emoji were skipped, because the device's virtual keyboard has no key for them. The tablet's own on-screen keyboard still opened for a text field, because the tablet sees no physical keyboard.
- The on-screen keyboard: while the window was open, the tablet listed **Yes Machine keyboard** as an alphabetic keyboard, and selecting a text field in Brave opened no on-screen keyboard. Typing from the Mac ("Teclado oculto ñé") showed only Samsung Keyboard's slim suggestion strip for physical keyboards. The first time, Android posted "Yes Machine keyboard configured", English (US); later sessions brought no notice. Turning on **On-screen keyboard** removed the stand-in and the tablet's own keyboard appeared; turning it off hid it again at once. Brave kept its page throughout, and closing the window left no keyboard, notice or server on the tablet.
- The user then used the installed Mac app, built from this branch, with the tablet and reported that it worked very well. At their request the switch moved to the middle of the bar and the buttons back to its right end.
- **Settings → Swap Back and Recents** reordered the open window's buttons at once, both ways.
- Cable or Wi-Fi: with the tablet reached both ways, its card offered **Cable | Wi-Fi**. Chosen, Wi-Fi opened the window as **Connected over Wi-Fi**, with adb's port forward on the wireless connection, and Cable opened it by USB. **Add Android device** said the tablet was connected by cable, with a button to open it. Its Wi-Fi tab showed a pairing code that Chromium's own QR reader read from a screenshot of the dialog as `WIFI:T:ADB;S:yes-machine-…;P:…;;`, and codes from the encoder in versions 1 to 10, one with ñ, ¿ and an emoji, all read back exactly. The user then paired the tablet by scanning the code with it in Wireless debugging, and it connected. A connected Android card now says only **Connected**, since its Cable | Wi-Fi already shows the way, after the user saw "Connected · USB cable" run under the selector.
- **Screenshot**, with a real click, saved a 1,200 × 1,920 PNG the tablet took of its own screen, named with the tablet's name and the time ("… 2026-10-12 at 00.22.36.png"), and the window said where, with **Show**. The keyboard stayed on the device's screen. The bar fits at every width: below 1,100 pixels the middle buttons keep only their icons.
- **Full screen** from the bar, with a real click, filled the Mac's 2,560 × 1,440 screen with the tablet's picture at 2,304 × 1,440 and showed the small bar at the top. A click there landed on Brave's icon on the tablet and opened it. Escape left full screen, and ⌃⌘F entered and left it.
- Typed text kept its order at typing speed, but a whole address sent in one burst reached Brave's address bar reordered ("1921.68…" for "192.168…"), as its suggestions caught up with the keys. Pasted instead, the address arrived whole in three tries out of three.
- Typing one character at a time, as from a keyboard, with the stand-in keyboard attached: "ñandú qué ¿cómo estás? ¡bien! 😀 papá" arrived whole. Accents typed with dead keys in the middle of a word had made Samsung Keyboard drop the word it was suggesting for ("ú é" for "ñandú qué"), but not with its own keyboard shown. Of six keys tried before the accent, only moving the cursor left and back right kept the word, so the server does that when the accent follows a letter. ¿, ¡ and emoji are pasted; text copied on the tablet beforehand ("ORIGINAL") was back on its clipboard afterwards. Samsung Keyboard's clipboard history lists what was pasted, and marking the clip sensitive didn't keep it out. The test entries were then removed from that history, leaving the user's own, and the clipboard was given back what it held before the tests. The window now loads JetBrains Mono and Pixelify Sans from the app; before, it fell back to the system's monospace font.
- Turned to portrait, the tablet restarted the stream at 1,200 × 1,920, and the window kept the screen's shape inside it. Turning back returned to 1,920 × 1,200.
- Stopping the server on the tablet closed the window. The main window said **Disconnected from** with the tablet's name, and to check the USB cable or Wi-Fi debugging, and the card went back to **USB cable**. Each closed window's server had ended on the tablet.
- The Mac package (`npx electron-builder --dir --mac --arm64`) built the server before packing and carries it as `Contents/Resources/yes-machine-stream.jar`, identical to the one built from source, and its signature verified. The packaged app was not run, because the installed copy was running and shares its data folder.

Speed inside the app over the cable, with the experiment's black page that turns white while touched. Over 80 touches and releases, none was missed.

| Step | Typical | 90th percentile |
| --- | --- | --- |
| Viewer page to the app's main process | 0.4 ms | 0.6 ms |
| Main process to the tablet and back with the changed frame: adb, the tablet reacting and redrawing, encoding | 55 ms | 65 ms |
| Main process to the viewer page | 0.5 ms | 0.8 ms |
| Decoding | 2.3 ms | 3.2 ms |
| Touch to decoded frame | 58 ms | 70 ms |

The experiment's tool measured 59 / 70 ms just before, so the app's own path adds about 1 ms. Reading the pixel back to check it takes another 11 ms, which an earlier run inside the app counted by mistake (68 ms). Asking the encoder for no B-frames and one frame of latency left capture-to-arrival at 16 ms either way, so the settings were kept.

Over Wi-Fi through adb's wireless debugging, with the cable hidden from a test copy of the app, a touch reached the decoded frame in 57 / 65.5 ms (80 touches, none missed): the same as by cable. With the screen moving, capture to arrival took, in alternating runs of the same minutes:

| Path | Typical | 90th percentile |
| --- | --- | --- |
| USB cable | 27.4–27.8 ms | 32.1–32.6 ms |
| A direct socket on the tablet's Wi-Fi address (test-only server) | 30.7–31.4 ms | 35.2–35.6 ms |
| Wi-Fi debugging | 31.8–32.9 ms | 36.9–38.9 ms |

A direct connection would save 1 to 3 ms against wireless debugging, out of about 57 ms per touch, at the cost of its own encryption, an open port on the tablet and a fallback path, so advanced mode keeps adb's connection. Not using adb at all over Wi-Fi is the general mode's job.

Not checked yet: a real unplug of the cable, Android versions before 16, apps other than the browser (including ones that restart when a keyboard is plugged in), and Windows or Linux computers with adb.

## Earlier checks with the PIN-only version (October 4, 2026)

### Development Mac

| Feature | Observed result | Evidence boundary |
| --- | --- | --- |
| PIN interface | The Mac app displayed a six-digit PIN and a decreasing 10-minute countdown. The tablet paired with it, and the host showed the connection. | Expiration at 10 minutes has automated coverage only. |
| Screen capture and stream | The Mac's primary display reached Brave on the Mac, Brave on the SM-X230 tablet, and the native Android app. Screenshots from the tablet showed the actual Mac desktop. | Latency and sustained motion were not measured. |
| Text clipboard | A Unicode clipboard round trip succeeded between the Mac and a browser. | Not every browser, platform, or size boundary. |
| System audio capture | The host detected an audio signal while a test tone played. | Playback was not heard on the viewer. |
| Native input | The user confirmed controlling the Mac through the native Android app's pointer and touch input. | Keyboard, modifiers, double-clicks, and detailed gestures were not checked separately. |
| Interface layout | The browser interface was checked at 390 × 844 and at 1280 pixels wide. | Layout inspection does not verify touch gestures. |

### Android browser session

On the SM-X230, Brave first returned `ERR_EMPTY_RESPONSE` for the host's address without a scheme. Opening **https://192.168.1.52:4777/** fixed it: the HTTPS address answered with HTTP 200 and plain HTTP got an empty response. The tablet then paired with the PIN and showed the host desktop.

### Discovery

Two discovery instances on the Mac found each other over real multicast and removed each other after a goodbye. The packaged Mac app sent no multicast (`EHOSTUNREACH`) until the user allowed **Local Network**, then discovered a test listener. The Android app discovered a test listener and the installed Mac app, showing the Mac's name, ending in **.local**, **macOS**, and **192.168.1.52:4777**, and removed the test listener's card after it stopped.

### Packages

## Controlling an Android tablet in general mode (October 12, 2026)

General mode works through the Yes Machine app, with Android's own permissions instead of debugging. An experiment first, in a test build, showed it workable on the SM-X230: the app's screen capture ran at 60 frames per second with capture to arrival about 25 ms, as in advanced mode; touches made by the app's accessibility service reached the decoded frame in 110 / 133 ms (typical / 90th percentile), against 57 / 65 ms in advanced mode; the accessibility service's own input method typed any character, ñ, ¿ and emoji included, with no clipboard, and hid the on-screen keyboard without Samsung's suggestion strip; and Back, Home and Recents worked as the system's own actions. It also found that once advanced mode's mirror display was released, the app's capture stopped showing the screen until Android's consent was given again.

The built version, with the Mac app built from this branch:

- The user approved the designs first: **Control from a computer** in the app's Settings, with **General | Advanced** and each mode's steps behind **See instructions**, the dialog that explains advanced mode, the **This tablet** card in each state, and **Allow this computer?**. The app's pages were compared with the approved mockups in each state in Electron at the tablet's size, and in the idle and advanced states on the tablet itself.
- The user allowed Yes Machine in Accessibility and shared the tablet. Its log showed the sharing service listening over TLS with a key from the Android Keystore and announcing `_yes-machine-device._tcp` with its fingerprint. The Mac listed the tablet, asked to verify its certificate the first time, and the session started once the tablet allowed the Mac.
- That first test crashed the app twice. Stopping the share with a computer connected closed its TLS socket on the main thread, which Android refuses, and a wheel scroll near the top of the screen made a gesture that went past the edge, which Android also refuses. Both were fixed. In the user's second test, stopping the share with the Mac connected ended the session cleanly, and the tablet's log showed no crash.
- After connecting both modes at once, the user asked for one at a time. Advanced mode now turns the app's sharing service off, and the shell over adb reads that from the package manager in 20 ms; asking the app's own provider through `content query` took 1.1 s, too slow to check every few seconds. With the app in general mode, the desktop's adb code, run from Node against the tablet, marked it as in general mode and refused advanced mode with the tablet's name and **is set to general mode in Yes Machine…**, and the stream server, started by hand, refused too. The main window, with a stand-in for the main process, hid such a device's Cable | Wi-Fi card and explained in **Add Android device**. With an advanced session open from the same code, switching the app to general mode through its page ended the session 666 ms later, the device saying why. The app was then put back in advanced mode, as the user had it.
- The **Advanced mode** pill on the card is lit now, as the user asked.
- The user then tested the installed build again and reported that it worked perfectly.

Not checked yet: the built general mode's speed (the experiment's numbers are above), Android versions before 16, including 10 to 12, which can't type in general mode, and 8 and 9, phones, a second computer asking while one is connected, **Deny** and the notification's buttons, and a device whose certificate changed.

## Sound, Add device and larger files (October 12, 2026)

- **Add device**: the user approved a prototype of one card and one dialog, with the card reading **Add device** at their request. In Electron with a stand-in bridge, the house showed one card, the dialog opened on **Computer** with the address field focused, **Android device** showed the cable and Wi-Fi steps, and Wi-Fi drew a pairing code.
- **Device, not tablet**: the Android app and the desktop now say "device", as the user asked. At a phone's width, 412 pixels, the This device card put its title and its button on two lines and the mode row in Settings ran past the screen's edge; both fit after the fix.
- **Sound in advanced mode**: Samsung's Android 16 has no `AudioRecord.Builder.setAudioMix`, so the server registers an audio policy with the mix of what apps play, as Android's own capture does, with the shell's permissions (`MODIFY_AUDIO_ROUTING`, `CAPTURE_AUDIO_OUTPUT`). On the tablet, while YouTube played, sound arrived at 192 KB/s in 20 ms pieces, the first 0.4 s after connecting, and a muted test copy of the app reported its Android window audible 1.5 s after opening it. With the tablet's media volume at 0 the capture still carried the sound. A test script that stopped reading the stream froze the tablet's own playback, because Android holds back apps' playback while a capture goes unread, so the server now reads all the time and drops the oldest sound when the network falls behind.
- **Sound in general mode**: the user tested it with the installed builds and reported that it worked perfectly, and asked for a way to mute it from the computer: the speaker in the window's bar, checked in Electron at 1,280, 1,120 and 1,000 pixels and in full screen, with the choice remembered.
- **Larger files**, on this Mac's loopback with the real host server, a stand-in account check and the real viewer page in Electron: uploads of 100 MB and 2 GB arrived intact at about 49 MB/s, the page under 190 MB; the fixed pause they had before held them to about 13 MB/s. Downloads went first as base64 over the session socket into blobs in the page: 2 GB arrived at about 90 MB/s, but in a session that keeps blobs in memory, as the desktop app's viewer windows do, 5 GB arrived and couldn't be saved, and in a disk-backed session 10 GB worked with the browser process at 4.6 GB. With each file offered at a one-time address on the host instead, 10 GB went from offer to saved file in 11 s, intact, with the browser process under 350 MB.

The user then tested the installed builds of this branch on October 12 and reported that everything worked.

Not recorded in detail yet: transfers between separate devices and over Wi-Fi, Safari and Firefox, the Android app taking an offered file, general mode's speed in the built app, and a remembered sign-in after restarting the app.

## Windows (October 12, 2026)

- **Setup**: the app built on the Mac for Windows on ARM, with the native input module's win32-arm64 build, started and shared in the VM. Windows' firewall had rules blocking Yes Machine while the network was public; after marking the network private and allowing the app, the Mac's app listed the VM and reached it.
- **Sign-in**: the VM's account is a Microsoft account. While **only allow Windows Hello sign-in** was on, Windows turned down the password with error 1326. With it off, Windows' own sign-in sent the password to Microsoft, which answered that it was wrong (`0x80048821` in the LiveId log); the user thinks it was an old password. After they changed it, the Mac's app signed in.
- **The user's test from the Mac's app**: picture, sound and files both ways worked. The pointer landed above and left of the Mac's: Windows was at 200%, where native input takes physical pixels and Electron measures the screen in points, so the host now gives it physical pixels and updates them when the display changes. The user also asked that ⌘ do what it does on a Mac (above). With both in place the user reported that everything worked as expected and that it was quite smooth, after first finding it less smooth than the Ubuntu VM.
- Once, before these changes, sharing stopped by itself with **Screen sharing was stopped by the system**, probably when the VM's display changed. Not seen again.

Not checked yet: Windows as the viewer, the Mac shortcuts on a Linux host, **Remember** after restarting on Windows, UAC prompts, Windows PCs, and a measured round trip with Windows as the host.

## Windows performance (October 12, 2026)

Measured with `tools/latency` and the Windows 11 VM as the host (display 2048×1536 at 200%, shared at 1600×1200), the Mac's headless Chrome as the viewer, 40 rounds each. *Window to capture* is the time from the color window's change to the first captured frame showing it, both read on the VM's clock.

| Run | Round trip p50 / p90 | Window to capture p50 | Capture / sent fps | Encoder, ms per frame |
| --- | --- | --- | --- | --- |
| Scrolling text | 150 / 203 ms | 108 ms | 25 / 25 | VP8 libvpx, 7.1 |
| Scrolling text, H.264 first | 258 / 368 ms | 104 ms | 25 / 24 | H.264 OpenH264, 31.5 |
| Video-like motion | 339 / 472 ms | 105 ms | 23 / 17 | VP8 libvpx, 43.8 |
| Scrolling text, VMware's graphics card | 70 / 111 ms | 37 ms | 35 / 35 | VP8 libvpx, 6.3 |
| Video-like motion, VMware's graphics card | 77 / 139 ms | 36 ms | 35 / 34 | VP8 libvpx, 7.7 |
| Scrolling text, the card chosen by Yes Machine itself | 73 / 142 ms | 37 ms | 36 / 36 | VP8 libvpx, 6.4 |

- Most of the time was on the host, before frames left it: the screen capture gave about 28 frames a second on its own, while the windows on screen drew at 55 to 65, and taking frames at smaller sizes didn't change that.
- WebGL in Yes Machine reported **Microsoft Basic Render Driver**: Chromium has VMware's virtual card on its blocklist, so it drew and captured in software although VMware had 3D acceleration on. With `--ignore-gpu-blocklist` it reported **VMware SVGA 3D** and capture alone went from 28 to 36 frames a second. Yes Machine now passes that switch when it finds VMware's card, and the next run, without the switch set by hand, matched.
- Capture that hands frames over as textures (`WebRtcAllowWgcUsingTexture`) failed in the VM (*Failed to get GpuChannelHost*) and sent no video. Chromium's 50% CPU limit on desktop capture has no switch in this version. H.264 cost four times VP8's encoding time, so VP8 stays.
- The first measurement, before the run above and with another window open, was slower and blurrier (round trip p50 205 ms, QP 48); the table's runs were made one after another with only the harness on screen.

The user then connected from the Mac's app to the build with this change, installed in the VM, and reported that it worked incredibly well.

In the Ubuntu VM's Wayland session, with the same switch, GNOME Shell froze as the harness started sharing, and stayed frozen after the harness was closed: its main thread kept waking about 800 times a second without answering D-Bus, and the kernel logged no GPU errors. The switch now applies only on Windows. After restarting the VM with this change, the user shared from it again and reported that it worked.

Not checked yet: Windows on a PC with a real graphics card.

## The viewer's own pointer on Windows (October 12, 2026, prototype)

Checked with `tools/latency`'s harness running this branch in the Windows 11 VM and headless Chrome on the Mac as the viewer:

- Chromium offers no `cursor` constraint (`getSupportedConstraints()` has none) and reports `cursor: "always"`; a frame read straight from the capture, before encoding, had Windows' arrow in it.
- With the viewer connected, the frame had no cursor (0 near-white pixels where the arrow had 159), and the viewer's pointer took Windows' shapes: `pointer` over a link, `text` over a text area, `default` over plain text and `none` over a window that hides the cursor. The first shape arrived about 2 s after connecting, while PowerShell starts.
- When the viewer left, the arrow was back (159), the helper had exited and its mark was gone. After killing only the app, the cursors came back; after killing the app and the helper together, they came back when the app started again, from the mark.

The user tried it from the Mac's app on October 13 and liked how it looked, but pointed out that someone at the Windows computer had no cursor until the viewer disconnected. Now the cursor belongs to whoever moved last; the helper's C# compiled in the VM.

The user then tried that version and approved it. Linux and Mac computers stay as they were, at the user's choice: on Wayland only a GNOME extension could hide the cursor, and macOS has no public way.

Not checked yet: apps with their own cursors, and several monitors.

## Small fixes (October 13, 2026)

- The user tried Windows as the viewer of the Mac and reported that it worked, though the local cursor couldn't be judged with the Mac showing itself inside the VM; **Remember** kept the password; Ethernet seemed to work and has low priority.
- An eye beside the password in the desktop sign-in dialog, the browser's sign-in form and the Android app's dialog shows what was typed; the password is hidden again when the dialog opens or the browser session ends. Checked in headless Chrome: the desktop dialog (with `host.css`) and the browser form served by the real host server, before and after the click (the field turned to text and the button to **Hide password**). The Android dialog has the same markup and styles; not yet installed on the tablet.
- The viewer's file panel said *Up to 50 MB per file*; it now says 10 GB, the real limit. The Windows setup guide now says to turn off *only allow Windows Hello sign-in* if the password is turned down, and explains the viewer's own pointer.

## Choosing the screen (October 13, 2026)

The user approved the design in `docs/design/monitor-preview.html`. Four tests cover the list of screens (their order as the computer places them, sizes in pixels, the main one, names) and the choice (the chosen screen while connected, then the main one). The user tried a build on the Mac with its own display and two external ones, viewed from the Windows VM:

- Switching screens while sharing worked, and unplugging the shared monitor moved the picture to another screen by itself.
- The **Share screen** field in the Mac's card overlapped its label: it sat in a wrapper without the card's gap, which the labels' negative margin counts on. Fixed, and checked in headless Chrome with the card's real styles.
- Choosing from the card sometimes took a couple of tries: a screen chosen while another switch was under way was dropped while the list showed it. Now the last choice is switched to when the first finishes.
- Clicks while controlling the Mac from the VM running on that same Mac felt unreliable, as expected: the Mac's cursor leaves the VM's window, and one mouse drives both. Not judged; it needs two separate computers.

The user then opened the build with both fixes, switched screens again and unplugged one while connected, and reported that everything worked.

Not checked yet: a Windows or Linux X11 computer with two screens, and the Screen menu in full screen (it isn't offered there).

## Light mode (October 13, 2026)

Designed with the user from photos of the house in prototypes (`docs/design/day-preview.html`, `docs/design/transition-preview.html`), which the user approved before it was built. In the app: `public/pixel-day.js` draws the house by day, `public/pixel-home.js` the night house, the day house and the walk between them, and the page switches its colors halfway while each window of the house changes as the light reaches it. The app's page was checked in headless Chrome with a stand-in for its Electron bridge: night, the walk to day, day, and Settings by day, with no script errors and the choice kept in `ym.theme`.

Not checked yet: the user's try of the installed apps, Windows' title bar buttons in day colors, the viewer window and the Android app (both stay as they were).

### The viewers by day, and Disconnect for Android

The user asked for the viewers in light mode, and for a **Disconnect** in the Android viewer window, which had none: the only way out was closing the window. The prototype (`docs/design/viewer-light-preview.html`, the real markup with the proposed styles) showed both viewers and the sign-in page by night and day, white or black frames by day, and the Android bar with **Disconnect** at the far right; the user approved it with the white frames.

- The viewer page follows `prefers-color-scheme`. The app sets it for every window from the sun and moon (`nativeTheme.themeSource`), and new viewer windows open in the current background. In headless Chrome the real page, sign-in and session, was right both ways, and switching while open redrew the napping cat in cream without a reload.
- In the Android window the labels now go in order as it narrows, as the bar had no room for **Disconnect** at 1280 pixels, the size it opens at: the middle buttons' first (below 1580, below 1700 since Hide bars), then Back, Home and Recents (below 1230), then Disconnect's (below 900). Checked from 1600 to 500 pixels with nothing overlapping.
- In the app run from source on the Mac, with the SM-X230 on the cable in advanced mode: the window by night with **Disconnect** at the far right; the sun in the main window turned it to day halfway through Sarigüeya's walk; **Disconnect** closed it, the main window said "Disconnected from" with the tablet's name, and no adb forward or device server was left. The moon turned everything back to night.

Not checked yet: a computer's viewer window by day in the app, which needs the computer being viewed to run this version, as its page comes from there; the user's try.

### The Android app by day

The user asked for light mode in the Android app. The prototype (`docs/design/tablet-light-preview.html`: the app's own page with the proposed changes and a stand-in for the Java bridge, inside a tablet with Android's bars, at tablet, upright and phone sizes) was approved as it was, and so was the same scroll for the computer: when part of the house is out of view, pressing the sun scrolls it in before she walks.

- The home page takes the computer's switch, house and colors (`public/pixel-home.js`). Java keeps the mode, starts the activity in a night or day theme, colors Android's status and navigation bars and their icons when the page's colors change, and tells Android 12 and later the app's own mode, so the screen Android opens it on matches. The viewer's WebView is created in the same theme, and WebView takes `prefers-color-scheme` from it.
- `public/theme.js` sets the mode before the page draws, on the tablet and the computer. Without it, a launch by day showed the night page for about a quarter of a second (seen frame by frame in a screen recording); the splash was black, also fixed by giving each theme its splash color.
- On the SM-X230 (Android 16), with the debug APK installed over USB: the sun scrolled to the house, the light crossed it while Sarigüeya walked to the balustrade, the status bar and the taskbar turned light with dark icons at the halfway point, and three cars passed; relaunched by day, the splash and the first frame were light and the home page reported `prefers-color-scheme: light`; the moon turned everything back to night.

In advanced mode the computer reaches the device outside the app, so the house didn't show it, as the user noticed. Advanced mode's server now beats every two seconds in the debug property `debug.yesmachine.advanced`, which the shell may set and the app may read (checked with `run-as`), and clears it as it exits; the app reads it every two seconds while the home screen shows (`AdvancedSession`, 2 Java tests) and treats a beat older than five seconds as over. On the SM-X230 with the Mac's app run from source: opening the device's window opened the garage and the gates and she wagged; **Disconnect** cleared the beat at once and closed them; killing the server with SIGKILL, as a pulled cable would, left a stale beat, and the house closed within about five seconds. Connecting also attached the stand-in keyboard, which restarted the app's activity, so its page reloaded and scrolled back to the top on every connection and disconnection (Android's log: not-handles CONFIG_KEYBOARD); the manifest now handles keyboard and navigation changes, and the page stays as it was.

Not checked yet: the tablet's viewer by day connected to a computer, general mode's garage and gates on the device, a phone, and Android before 12, where the app opens in night colors for a moment before turning to day.

## A Mac host and the tablet as the viewer (October 13, 2026)

Measured with `tools/latency` on the real Wi-Fi: the user's Mac shared with its installed Yes Machine (main screen 2560×1440, sent at 1920×1080), and the SM-X230's Android app was the viewer, signed in by the user. `pattern/` showed the black and white window on the Mac, and `measure.cjs` attached to the app's viewer through `adb forward` (`YM_CDP`). A YouTube video played full screen on the Mac the whole time, so the encoder had a moving picture to deal with, as a person watching something would give it. 80 rounds; no host statistics, as the installed app has no DevTools.

| Round trip p50 / p90 / max | Until the tablet receives the frame, p50 | Viewer | Frames | Link |
| --- | --- | --- | --- | --- |
| 93 / 151 / 452 ms | 55 ms | VP8, 1920×1080, QP 19, decode 8.4 ms, jitter buffer 15 ms | 41 a second sent, 36 shown, 20 gaps over 50 ms in 4 s, 2 freezes | 5.8 Mbps, no loss, round trip time 7 ms |

- The tablet spends about 38 ms between receiving a frame and showing it (decoding, buffering, drawing); the rest, about 55 ms, is the Mac drawing the change, capturing, encoding and sending it, and the touch reaching it.
- Compared with the VMs as hosts and Chrome on the Mac as the viewer (70 to 80 ms), it's somewhat slower and less steady, with a video playing on the Mac at the same time. Not yet compared: the Mac without the video, and the Mac encoding H.264 in hardware.
- The first try missed 32 of 80 rounds: the video was in full screen, which macOS gives a space of its own, so the black and white window opened behind it. `pattern/` now shows its windows over full-screen apps too, and the second try, the table's, saw every round.

The user found the result good as it is.

## Hide bars (October 13, 2026)

The user wanted full screen to clear away the window's buttons and information without taking the whole monitor, and the whole monitor only when wanted. The prototype (`docs/design/clean-view-preview.html`, the real windows) added **Hide bars** beside **Full screen**, showing full screen's layout inside the window, with **Show bars** in its small bar; the user approved it, with the Android window's button moved to the right of **Full screen**.

- Both viewers keep the bars' state apart from full screen, so leaving full screen goes back to the window with or without bars, as it was; where a page can't go full screen, hiding the bars is the closest. In headless Chrome the computer viewer's page went through every step in order: bars hidden, full screen from the small bar, back to the window without bars, bars shown, full screen from the main bar, and back with bars.
- In the Mac's app run from source, with the SM-X230 on the cable: **Hide bars** made the device's screen 1280×800 in the 1280×900 window, edge to edge, and **Show bars** brought back the bar and 1181×746. The Android window's top bar had only been covered in full screen, and its buttons could still be reached with Tab; it is now hidden.
- The Android bar's middle buttons need 1700 pixels for their names now; below that they show only their icons.

## Shared clipboard (October 13, 2026)

The user asked for the clipboard to be shared on its own, on by default and both ways, with a three-way slider in the same Settings card as its switch. The prototype (`docs/design/clipboard-preview.html`, the real Settings card and viewer panel) was approved as it was.

- While a device is connected, the computer checks its clipboard twice a second and sends what changes, up to 60 KB. The viewer puts it on its own clipboard, or keeps it until the page may write there. The viewer's clipboard goes to the computer when the viewer comes back into focus, and before ⌘V or Ctrl+V; Safari and Firefox let the page read it only from the paste itself. The Android app compares the time of the clipboard's last change, so what it wrote itself doesn't go back. **Settings → Share the clipboard** turns it off or sends it one way only, and the viewer's Clipboard panel says which.
- Electron runs natively on Wayland, and a Wayland window reaches the clipboard only while it has focus, which a computer under remote control seldom gives it. The helper now asks the RemoteDesktop session for the clipboard too (the portal's Clipboard interface). GNOME keeps the clipboard choice in the saved approval, so an approval from before is set aside once, and the dialog asks again with a clipboard switch, on by default.
- On the Ubuntu VM in its Wayland session, nothing copied there reached the tablet at first. `dbus-monitor` showed the portal announcing each copy to the helper with its types wrapped in a tuple, `(as)`, where the portal's description has a plain list `as`; the helper looked for text in the tuple and found none. When it offers text, GNOME takes the plain list. The helper now reads both forms. It also reads the copied text on a thread of its own, so an app slow to answer can't hold up remote control; it gives up after five seconds.

Checked with the Ubuntu VM (GNOME 46, Wayland) sharing, and the SM-X230's app as the viewer:

- Text copied in an X11 app on the VM ("Yes Machine test: copied on osiris") was on the tablet's clipboard about a second later.
- Text put on the tablet's clipboard from the shell, as another app copying would ("Yes Machine test: copied on the tablet"), went to the VM when the viewer was focused again, and an X11 app on the VM pasted it. The paste went through the portal (SelectionTransfer, SelectionWrite, SelectionWriteDone), so it doesn't depend on Yes Machine's window having focus. Nothing came back to the tablet.
- With **Only to this computer**, a copy on the VM stayed there, and the tablet's Clipboard panel read "Shared to osiris only". Back on **Both ways**, the next copy reached the tablet.
- The VM's Settings card showed the switch on and the slider on **Both ways**, as in the prototype.
- From the tablet, the pointer and Shift reached the portal (NotifyPointerMotionAbsolute, NotifyKeyboardKeysym 0xffe1 down and up), and the picture kept moving.
- Viewing the VM in the Mac app's viewer window, whose page comes from the VM, the user copied on the VM and pasted on the Mac, then copied on the Mac and got the text on the VM: both worked. VMware Fusion also shares the clipboard between the Mac and its VMs (VMware Tools was running in the VM), so these tries don't show which of the two carried the text. The tablet's tries, above, went through Yes Machine.

Samsung Keyboard's clipboard history kept the three test texts that reached the tablet: "copied on osiris", "copied on the tablet" and "both ways again", each after "Yes Machine test:". The tablet's clipboard was emptied afterwards, as it was before the tests.

Not checked yet: the Mac's viewer window apart from VMware's clipboard sharing, a Linux computer in an X11 session, a Mac or Windows computer sharing its clipboard, a browser as the viewer (Chrome, Safari, Firefox), and ⌘V or Ctrl+V on a hardware keyboard.

## The night and day switch (October 13, 2026)

The house reports the light on every frame of Sarigüeya's walk, 0 or 1 while she is still on her way. The page took that for the end of the walk and turned the switch back on. A second press then left the page in one mode while it remembered the other. The switch now waits for the house to stop changing. In the VM's app, the sun and then the moon each took about eight seconds. The switch stayed off until the walk ended, and the page's mode and the remembered choice agreed both times.

On October 4, desktop archives for Apple Silicon Mac, Intel Mac, Linux x64, Linux ARM64, and Windows x64 and a debug APK were built and their contents compared with the source. They predate the redesign, were never run on their target systems apart from the Apple Silicon Mac, and are withdrawn. Packages will be published as GitHub Releases once this version is stable.

## Files and the clipboard with Android devices (October 16–17, 2026)

The user noticed that a computer controlling the tablet had no way to pass files, and asked for files and the clipboard both ways. The prototype (`docs/design/android-files-preview.html`: the device's real window with a **Files** drawer and a drop target, Share then Yes Machine on the device with the app's own dialog, and the clipboard card covering Android devices) was approved as it was.

- Files travel over a second connection beside the stream, so a large file doesn't hold up the picture or a touch: in advanced mode a second connection to the server's socket, through the same adb forward; in general mode a second TLS connection, which the app takes only from the computer in control (same certificate). Either side sends open, data and close, and the receiver answers with the name it saved the file as, or why not.
- To the device: advanced mode's server writes to the Download folder itself, under a new name when taken (`name (1).ext`), and tells the app through a broadcast only the shell and the system may send (DUMP), so the app says in a notification that it arrived. General mode's app saves through MediaStore and its notification opens the file.
- From the device: Share, then Yes Machine, in any app. In general mode the app sends straight over its file connection; in advanced mode it copies the file into its own outbox folder, which the server, with the shell's access to that folder, takes and sends, writing how far it got for the app's dialog. The computer keeps the file in a private folder and asks where to save it.
- The clipboard follows the computer's clipboard card. In advanced mode the server looks at the device's clipboard twice a second while the computer wants it and never sends what it put there itself; the pastes it borrows the clipboard for are skipped. In general mode Android lets only the app in front read the clipboard, so when the computer asks (its window loses focus, or Ctrl+C or Ctrl+X goes to the device) the accessibility service shows a one-pixel window of its own for a moment, reads the clipboard there, and sends it if it was copied since the computer started asking.
- Before building it, the shell's access was checked on the SM-X230 (Android 16): it could read and write the app's external folder (group `ext_data_rw`), and a file it wrote and renamed in Download was in MediaStore at once.

Checked on the SM-X230 with the Mac:

- **Advanced mode**, driven by a test script with the real server: a copy on the tablet reached the computer, the computer's copy was on the tablet's clipboard and didn't come back, and nothing went with reporting off. A file sent to the tablet arrived in Download with all its bytes, the same name again became `ym-test-advanced (1).txt`, and the tablet's notification read "ym-test-advanced.txt from Yes Machine test · Saved in Download." A file left in the app's outbox (300 KB) reached the computer with the same bytes, marked sent.
- **Advanced mode, the real window** in a separate test copy of the app run from source, with its clipboard off so the Mac's clipboard was never touched: a 2.5 MB file chosen in the **Files** drawer arrived in the tablet's Download with the same MD5, and the drawer listed it. A 400 KB file from the tablet arrived in the private folder with the same MD5; the user chose **Save file**, the window said "Saved ym-outbox-test.bin in Downloads." with **Show**, and the private folder was empty again.
- **General mode**, which the user turned on and shared themselves: a 3 MB file arrived intact, with a notification that named the file and the Mac and said **Saved in Download.**; the user shared it back from **My Files** with Share, then Yes Machine, saved it, and it was identical. A test script holding the computer's certificate checked the clipboard: asked to look, the tablet sent what had been copied there, the computer's copy reached the tablet, and nothing came back or was sent when nothing was new.
- A file the shell offered to the share screen was refused by Android (only the app that shares a file can let another read it), and the dialog showed Android's error text; it now says the app that shared it didn't let Yes Machine read the file.

The test texts are in Samsung Keyboard's clipboard history ("Yes Machine test: copied on the tablet", "from the computer" and "not reported", in advanced and general mode), the tablet kept three test notifications, and its clipboard was emptied as before. The test files were deleted from the tablet and the Mac.

Not checked yet: dropping files from Finder onto the window (the drawer's chooser was used), a file canceled midway, Windows and Linux computers, devices before Android 16, Android 8 and 9 (which keep files in the app's own folder), and the installed builds.

## Starting at login by default (October 17, 2026)

The user wanted Yes Machine to open with the computer, like the apps that start at login, on every platform. **Start Yes Machine when you log in** is now on by default: the first time an installed copy runs, it turns the switch on (the LaunchAgent on macOS, the autostart entry on Linux, the login item on Windows) and notes that in its private data, so turning it off afterwards sticks. With **Share when Yes Machine opens**, already on by default, the computer shares as soon as someone logs in. A copy run from source leaves the switch alone, so working on Yes Machine never registers a development build to start at login. Two automated tests cover it.

## Readable code (October 17, 2026)

The code was formatted the standard way, moved into folders by what it does, and commented throughout, and the four largest page scripts were split into files by topic (see [ARCHITECTURE.md](ARCHITECTURE.md)). None of it was meant to change what the app does, and that was checked three ways:

- **The code itself.** Every JavaScript file was compared with its previous version as a syntax tree, scope by scope: each function is the same code apart from local variables given clearer names, and everything that runs as a page opens still runs in the same order. The Java was compiled before and after and compared class by class. Style sheets, pages and the Android resources were compared with their comments removed.
- **The pages, step by step.** The main window, the Android home page and the browser viewer were driven through the same steps with the old and the new code, and the page was recorded after each step. That made 38 steps in the main window and 37 in the Android home page, with a stand-in for its Java bridge. The browser viewer ran a whole session against the real sharing server, with a stand-in host answering over WebRTC: sign-in, the picture, the Screen menu, pointer, wheel and keys, the clipboard, and a file each way. Every recording matched, except a file offer's random one-time address, and every element of every page kept its position.
- **On the devices**, with the new code on all of them. The Mac was on both networks at once: Ethernet to the two VMs, and Wi-Fi to the tablet.
  - The Mac app opened the Ubuntu VM (Wayland, over Ethernet) with its remembered sign-in: the picture at 1920×1200, input reached the VM, and the clipboard was shared both ways.
  - The user signed in from the Mac app to the Windows VM.
  - The Mac app opened the tablet in advanced mode over wireless debugging, at 89 fps, with its file connection ready.
  - With the tablet switched to general mode by the user, the Mac app opened it over Wi-Fi as an always allowed computer. The tablet showed the Mac in control, with both of its connections open, the stream and the files.
  - The tablet app signed in to the Mac over Wi-Fi with its remembered sign-in, with the picture at 1920×1080 and input available.
  - Disconnect ended each session on both sides, and the window that started it said so.

## Checks still required

1. Run the app on Windows PCs, an Intel Mac, and x64 Linux (Windows on ARM was checked in a VM). Check native module loading, capture, input, permissions, sign-in, audio, and shutdown on each.
2. Verify left/right click variants, double-clicks, dragging, scrolling, typing, modifier shortcuts, and release of held controls after disconnect, from each viewer.
3. On Android, verify detailed touch gestures, two-finger scrolling, the software keyboard, clipboard permission flows, and downloads.
4. Audible sound now reaches the tablet from the Mac and the Ubuntu VM. Check it on a desktop viewer, and check mute and unmute and stopping the session.
5. Send real files in both directions between separate devices, over Wi-Fi, including files of several gigabytes and one that doesn't fit the receiving disk, from Safari and Firefox too, and to the Android app. Confirm the host Save dialog, cancellation, and exact saved bytes.
6. Sign in with a wrong password until the five-per-minute limit applies, and check that **Remember** survives an app restart on each platform.
7. Sign in from more browsers (Firefox, Safari, and an Android browser) with a real account, including a wrong password and the password manager.
8. Connect over Ethernet as well as Wi-Fi, including a computer with both, and unplug and plug the cable while sharing.
9. Check international keyboard layouts, composed text, display scaling, sleep and wake, and a changed network address.
10. Disconnect the internet while the local network stays up and confirm everything still works.
11. Measure the round trip with the Mac as the host and a desktop viewer window as the viewer, and without a video playing (the tablet as the viewer was measured on October 13).
12. Control an Android device from the app in advanced mode over wireless debugging and unplug its cable during a session. Try both modes on Android 8 to 15 devices and phones, with apps other than the browser, from Windows and Linux computers. In general mode, also try a second computer while one is connected, **Deny**, the notification's buttons, and a changed device certificate.

## Unverified limits and exclusions

- There has been no independent security audit, penetration test, or comprehensive denial-of-service assessment.
- The automated validation covers specific authorization and protocol cases. It does not establish protection against every hostile client or operating system failure.
- Windows UAC, secure attention, locked screens, login screens, and headless sessions were not tested. Yes Machine does not implement a privileged service to control them.
- Wayland was checked only on GNOME 46 in the Ubuntu VM. KDE and other compositors with a RemoteDesktop portal are untested.
- Printer/USB forwarding, shared folders and unattended login are outside version 1.0. The shared clipboard carries plain text only.
- Long sessions, concurrent network load, connection recovery, low-bandwidth conditions, and performance across different hardware remain unmeasured.

The [README](../README.md) describes setup and current functionality. This record should be updated only when new checks produce concrete evidence.
