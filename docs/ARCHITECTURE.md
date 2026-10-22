# How Yes Machine's code is organized

Yes Machine is four programs that talk to each other over the local network:

| Program | Where | What it does |
| --- | --- | --- |
| The desktop app | `src/` | An Electron app for macOS, Windows and Linux. It shares this computer's screen, opens other computers in its own windows, and controls Android devices. |
| The browser viewer | `public/` | The page that shows a sharing computer and controls it. The sharing computer serves it to any browser on the network; the desktop app's viewer windows load the same page, and the Android app bundles it. |
| The Android app | `android/app/` | Views a computer on the network, and in general mode shares the device's own screen with a computer. |
| The stream server | `android/stream/` | Advanced mode's server. The desktop app pushes it to an Android device over adb and runs it there; nothing is installed. |

There is no cloud service: devices find each other with mDNS on the local network, and everything travels directly between them.

## A session, end to end

When a computer shares its screen and another device views it:

1. **Sharing starts.** The main window's page captures the chosen screen (`getDisplayMedia`; the main process picks which screen it gets) and asks the main process to listen. The main process starts the sharing server (`src/main/sharing/server.cjs`) on the chosen private address, port 4777, with a self-signed TLS certificate, and announces the computer on the network (`src/main/network/discovery.cjs`).
2. **Signing in.** The viewer opens `https://<address>:4777/`, the server sends `public/client.html`, and the viewer posts the user name and password of an account on the sharing computer to `/login`. The server checks them against the system's own accounts (`src/main/sharing/auth.cjs`: PAM on Linux, Open Directory on macOS, LogonUser on Windows) and answers with a one-time ticket.
3. **The session socket.** The viewer opens a WebSocket at `/session` and spends the ticket on it. From then on the socket carries the WebRTC signaling and the files. The server tells the main process a viewer joined, and the main window's page (`src/windows/host/viewer-connection.js`) opens a WebRTC connection to it: the offer goes out through the socket, and the answer and network candidates come back the same way.
4. **The stream.** Over WebRTC the viewer gets the screen and the sound, and two data channels: `control` (ordered and reliable: clicks, keys, the clipboard, the screen choice, status) and `pointer` (pointer moves, which may be lost because the next move replaces them). There are no STUN or TURN servers. The viewer reports on `control` how large it shows the picture, in its device pixels, and the main window captures the screen at that size, up to the screen's own and at most 3840×2400, without restarting the stream.
5. **Input.** Messages from the viewer reach the main window's page, which hands them to the main process (`api.input`), which checks them and plays them on the computer (`src/main/control/input.cjs` with RobotJS, or `portal-input.cjs` through the RemoteDesktop portal in a Wayland session).
6. **Files and the clipboard.** A file from the viewer goes over the session socket in pieces and is saved where the person at the computer chooses. A file from the computer is offered at a one-time address that the viewer downloads straight to disk. Copied text goes over the `control` channel, both ways, as Settings allows (`src/main/control/clipboard-watch.cjs` watches the computer's clipboard).

Only one viewer holds a session at a time: a newer sign-in takes over, and the previous viewer is told why.

Opening a computer from the desktop app works the same way, with the desktop app as the viewer: `src/main/viewing/viewer.cjs` checks the computer's certificate (the first time, the person compares its fingerprint with the one the other computer shows), signs in, and opens a sandboxed window on the computer's page with the ticket in the address (`#ticket=...`). That window accepts only the certificate that was approved.

Controlling an Android device has its own paths, described under [Android devices](#android-devices) below.

## The desktop app (`src/`)

The desktop app is three kinds of code, kept apart by Electron:

- **The main process** (`src/main/`) runs Node.js. It owns the windows, the network, the sharing server, input, and everything that touches the operating system.
- **Preload bridges** (`src/preload/`) are the only way a window reaches the main process. Every window is sandboxed with context isolation, so a page can do only what its bridge offers, and the main process checks that each call comes from the window it expects.
- **The windows' pages** (`src/windows/`) are ordinary web pages: HTML, CSS and classic scripts.

### The main process (`src/main/`)

`main.cjs` starts the app and connects the rest: command-line switches, the single instance lock, permission handlers, the main window and its tray icon, the helpers below, and the IPC handlers the main window calls. Its header comment lists the startup order.

| Folder | Files | Purpose |
| --- | --- | --- |
| `sharing/` | `server.cjs`, `auth.cjs`, `screens.cjs` | This computer as a host: the HTTPS and WebSocket server, the account check behind `/login`, and the choice of screen to share. |
| `control/` | `input.cjs`, `portal-input.cjs`, `cursor-win.cjs`, `clipboard-watch.cjs` | Being controlled: keyboard and mouse (RobotJS, or the Wayland portal), the viewer's own cursor on Windows, and the computer's side of the shared clipboard. |
| `network/` | `discovery.cjs`, `networks.cjs`, `security.cjs`, `probe.cjs`, `trust.cjs` | The local network: mDNS discovery and announcements, network names, the private-address checks, online checks, and approved certificates. |
| `viewing/` | `viewer.cjs`, `signin.cjs`, `credentials.cjs` | Viewing other computers: the viewer windows, signing in for them, and remembered sign-ins (encrypted with the system's keychain). |
| `android/` | `advanced-mode.cjs`, `general-mode.cjs`, `protocol.cjs`, `files.cjs`, `windows.cjs`, `qr.cjs` | Android devices: both ways of reaching them, their stream's messages, files, their windows, and the QR code for Wi-Fi pairing. |
| `system/` | `login-item.cjs`, `private-json.cjs`, `gpu.cjs` | Starting at login, the private settings files, and a graphics check for Windows virtual machines. |

### The bridges (`src/preload/`)

- `host.cjs` gives the main window `window.yesMachine`: sharing, the computers and devices, signing in, settings and permissions.
- `android.cjs` gives an Android device's window `window.device`: the device's stream in; touches, keys, files and the rest out.

The viewer windows for other computers have no bridge at all: they are the browser viewer, loaded from the other computer.

### The windows (`src/windows/`)

- **`host/`, the main window.** `host.html` and `host.css`, and ten scripts that run in this order: `common.js` (the bridge, saved settings, messages, the three pages), `night-and-day.js` (the light and dark switch and the house), `devices.js` (the list of computers and devices, drawn as the windows of a house), `connecting.js` (certificates, sign-in, and why a session ended), `add-device.js` (adding a computer by address, or an Android device by cable or Wi-Fi), `sharing.js` (capturing the screen and sound, screens, networks), `viewer-connection.js` (the WebRTC connection to the viewer), `clipboard.js`, `settings.js`, and `start.js`.
- **`android/`, a window for one Android device.** `viewer.html`, `viewer.css` (on top of the browser viewer's `style.css`), `viewer.js` (hardware-decoded video drawn as it arrives, sound, touch, keys, files, screenshots, full screen) and `keys.js` (which keys go to the device as key codes).
- **`shared/pcm-worklet.js`** plays raw sound through the Web Audio API: a Linux computer's system sound into its shared stream, and an Android device's sound in its window.
- **`shared/picture-size.js`** decides how large the shared screen is captured for a viewer: the area the viewer reports (`view` messages, once the computer's status says it takes them), at most the screen's own size and 3840×2400, and 1920×1200 for viewers that don't report.

## The browser viewer (`public/`)

`client.html` is the page; `style.css` styles it. Its own scripts are in `public/client/` and run in this order:

| Script | Purpose |
| --- | --- |
| `common.js` | The page's main elements, size limits, notices, and switching between the welcome screen and the session. |
| `cats.js` | The pixel cats on the welcome screen and on the monitor. |
| `session.js` | The session socket: signing in with a ticket, the WebRTC signaling, and ending a session. |
| `stream.js` | The WebRTC connection: the video, the sound, and the messages on the `control` channel. |
| `sign-in.js` | The welcome screen's form, which posts to `/login`. |
| `screens.js` | The Screen menu, when the computer has several screens. |
| `pointer.js` | The mouse and touch on the computer's screen. |
| `keyboard.js` | Keys, and the drawer's Keyboard panel. |
| `clipboard.js` | The shared clipboard, and the Clipboard panel. |
| `files.js` | Files both ways, and the Files panel. |
| `layout.js` | Fitting the screen to the window, Hide bars and full screen, and the tool drawer. |
| `start.js` | Starts the page. |

The rest of `public/` is shared with the desktop app and the Android app: the pixel art (`pixel-icons.js`, `pixel-scene.js` for the rooftop cat, `pixel-house.js` and `pixel-day.js` for the house by night and by day, `pixel-home.js` for the walk between them), `keys.js` (what keys a viewer sends, such as ⌘ shortcuts from a Mac to Windows), `theme.js` (applies the saved light or dark mode before a page draws), `setup-guides.js`, and the bundled fonts.

## Android devices

The desktop app reaches an Android device in one of two modes, chosen in the Android app's Settings. Either way the device appears in the main window's list, and double-clicking it opens its window (`src/main/android/windows.cjs`, showing `src/windows/android/viewer.html`).

- **Advanced mode** works through Android's USB or wireless debugging. `src/main/android/advanced-mode.cjs` finds devices with adb, pushes the stream server (`android/stream`) to the device, starts it with the debugging shell's permissions, and connects through an adb port forward. The add dialog's Wi-Fi tab pairs a device by QR code (`qr.cjs`).
- **General mode** works through the Yes Machine app with Android's own permissions. The app shares the screen over the network (`ShareService.java`) once the person at the device allows the computer, and touches and types through an accessibility service (`ControlService.java`). The computer finds it with mDNS and connects over TLS (`src/main/android/general-mode.cjs`), with a certificate of its own that the device can remember as always allowed.

Both modes speak the same protocol, described byte by byte at the top of `src/main/android/protocol.cjs`: the device sends H.264 video, sound, size changes and copied text; the computer sends touches, scrolls, keys, text and the clipboard. Files have a second connection of their own (`src/main/android/files.cjs`), so a large file never holds up the picture.

## The Android app (`android/app/`)

The app is one activity with two web pages, plus the services general mode needs. The Java is in `src/main/java/local/yesmachine/android/`:

| Class | Purpose |
| --- | --- |
| `MainActivity` | The app's only screen: the home page or the viewer, each in a WebView, and the bridge the home page uses. |
| `NativeSession` | The viewer's connection to one computer, which the bundled viewer's WebSocket goes through. |
| `TlsPins`, `HostEndpoint`, `LanDiscovery`, `CredentialStore` | Pinned certificates, computer addresses, mDNS discovery, and remembered sign-ins (encrypted with a key in the Android Keystore). |
| `ShareService`, `ShareSound`, `ShareState`, `ControlService`, `DeviceIdentity` | General mode: sharing the screen and its sound, its state, the accessibility service that touches and types, and the device's own TLS identity. |
| `FileChannel`, `Downloads`, `FileReceiver`, `ShareActivity` | Files: general mode's file connection, where received files go and their notification, advanced mode's arrivals, and Yes Machine in Android's share sheet. |
| `AdvancedSession` | Whether a computer is connected in advanced mode. |

The pages:

- `src/main/home/`: the home screen, `home.html` and `home.css` (on top of the desktop app's `host.css`), and its scripts in this order: `bridge.js` (requests to Java and updates from it), `common.js`, `night-and-day.js`, `devices.js`, `connecting.js`, `general-mode.js`, `settings.js` and `start.js`. It is the desktop app's main window on a touch screen.
- `src/main/viewer/android-bridge.js`: added to the browser viewer in the app, so its WebSocket goes through Java.
- `src/main/share/`: the share dialog.

The build (`build.gradle`, task `syncViewerAssets`) copies the browser viewer, the pixel art and `host.css` from the desktop app's folders into the app's assets, with the licenses (see [Conventions](#conventions)), and inserts `android-bridge.js` into the viewer. `MainActivity` serves each page only the files on its list, so a new page file goes in both places (`test/android/app-files.test.cjs` checks it). See [android/README.md](../android/README.md) for building and installing the app.

## The stream server (`android/stream/`)

Three classes that run on the device as the shell user: `Server` (the screen mirror, the hardware H.264 encoder, input through a virtual keyboard and Android's input manager, and the clipboard), `Files` (files both ways), and `Sound` (what the device's apps play, from Android 13). `npm run android-stream` builds the jar; packaging the desktop app builds it first.

## How the page scripts are written

The pages load from three places: from disk in the desktop app, from the sharing computer's server in a browser, and from the Android app's assets. All of them have a strict Content Security Policy (`script-src 'self'`), and there is no build step, so the scripts are plain classic scripts:

- Each page lists its scripts in order in its HTML. They share one global scope.
- Every script but the last only **declares** state and functions. The state a part owns sits at the top of its file, with a comment for each variable.
- **`start.js` runs last** and does everything that happens as the page opens, in order. Each part connects its own buttons and events in a `setUp...()` function, which `start.js` calls once.
- The desktop app's Android window (`src/windows/android/viewer.js`) is small enough to stay one script, wrapped in a function of its own.

## Tests and tools

- `npm test` runs the tests in `test/`, whose folders follow `src/main/`: `sharing/`, `control/`, `network/`, `viewing/`, `android/` and `system/`. They use real loopback TLS and WebSocket servers, a stand-in adb and a stand-in Android device. `test/pages/` checks the pages' source; `test/scripts/` checks the build scripts and the license notices.
- `android/app/src/test/` has the Android app's unit tests (`./gradlew :app:testDebugUnitTest`); `android/test/bridge.test.cjs` tests the viewer's Android bridge (`node --test android/test/bridge.test.cjs`).
- `tools/latency/` and `tools/android-stream/` measure response times. They are test tools and are not packaged.
- `docs/VALIDATION.md` records what was tested on real devices, and how. `docs/design/` holds the previews used to design the visual work; they are not packaged.

## Conventions

- **Formatting:** Prettier (`npm run format`, and `npm run format:check` to verify), with Java formatted by its plugin. Lines are at most 100 characters of code; comments wrap at 120.
- **Comments:** every file starts with a header that says what it is for and who uses it; long files have section labels (`// --- Name ---`); functions that matter have doc comments (`/** ... */`); comments inside functions say why, not what.
- **Settings in pages** are saved in `localStorage` under keys that start with `ym.`; the main process keeps its own in private JSON files in the app's data folder.
- **Licenses:** Yes Machine is under the MIT license (`LICENSE`). `THIRD_PARTY_NOTICES.md` lists the software the apps include, with its licenses. Both apps carry it, with `LICENSE` and the fonts' licenses (`public/fonts/OFL-*.txt`), and a Mac build also gets Electron's and Chromium's license files, which electron-builder leaves out there. A dependency that is added, removed or updated changes the notices too (`test/scripts/license-notices.test.cjs` checks).
- **Publishing:** `npm run publish-public` sends a version to the public repository, YesMachinePublic, as one commit with exactly that version's files and its tag, after the last version published (`scripts/publish-public.cjs`). The history of the work isn't published, and a version whose files hold a word from `.git/info/private-words` (a list kept outside the repository) isn't either.
- **Security:** only private-network addresses are served or contacted (`src/main/network/security.cjs`); every certificate is self-signed and approved by the person the first time, by fingerprint, then pinned; sign-in uses the computer's own accounts and gives one-time tickets; every message, file and connection has a limit; windows are sandboxed.
