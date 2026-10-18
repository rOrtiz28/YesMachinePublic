# Yes Machine for Android

An Android client for the desktop Yes Machine host. It discovers computers advertising `_yes-machine._tcp` on the local network, signs in with the computer's own account, and opens the bundled remote desktop viewer inside the app.

The home screen is the desktop app's pixel network house: discovered computers, computers added by address with a cat badge, and Settings. It has no account, cloud relay, microphone access, camera access, location permission, or broad storage permission.

## Connect

1. Start sharing in the desktop Yes Machine app. Connect the Android device to the same network as the host.
2. Open **Yes Machine**. A host that advertises discovery appears under **On your network**, usually within a few seconds. Tap it, or choose **Add computer** and enter its private IPv4 address.
3. On the first connection, compare the displayed SHA-256 certificate fingerprint with the host app. Check the confirmation box only if they match, then choose **Trust and connect**.
4. Sign in with that computer's account, the user name and password you use to log in to it. **Remember on this device** stores the password encrypted with an Android Keystore key. A remembered password that stops working is forgotten and the app asks again.
5. Use the remote viewer's screen, audio, keyboard, clipboard, file, and full screen controls. **Disconnect** or Android's back button returns to the list. A dropped connection returns there too, with a dialog naming the computer.

Certificate trust is stored for the exact IP address and port. A changed certificate requires verification again. **Settings** forgets saved computers, remembered sign-ins, and trusted certificates. DNS-SD advertisements are discovery hints, not trusted identities.

A computer announced at an address outside this device's network, such as a virtual machine behind its host's NAT, is dimmed and labeled **Another network**. Tapping it explains why it can't be reached. For a virtual machine, use a bridged network adapter so it gets an address on the same Wi-Fi.

Leaving the app disconnects the active session, except while Android's file picker/save chooser is open. Keep the app in the foreground for a desktop session. Android is a client only.

## Build

Use Java 17, an Android SDK with platform/build tools 34, and an up-to-date Android System WebView on the device. This project declares Android 8.0/API 26 as its minimum and targets API 34. The minimum API declaration is not evidence of a physical test on every Android version.

```sh
export JAVA_HOME=/path/to/java-17
export ANDROID_HOME=/path/to/Android/sdk
./gradlew :app:assembleDebug :app:testDebugUnitTest
```

The wrapper uses Gradle 8.5 and Android Gradle Plugin 8.1.2. The first build may download dependencies. The viewer HTML, JavaScript, and CSS, the pixel icon, cat, and house scripts, and the bundled fonts with their licenses are copied from `../public/`, `host.css` from `../src/windows/host/`, and the license notices from the repository's root, during the build. The Android bridge loads before the viewer's own scripts (`public/client/`), and the home page in `app/src/main/home/` is copied alongside.

The APK is created at `app/build/outputs/apk/debug/app-debug.apk`. It is a debug-signed development build.

A release is built with `./gradlew :app:assembleRelease` and signed with the release key, which is kept outside the repository. The key is created once, and the signing tools come with the Android SDK's build tools:

```sh
keytool -genkeypair -keystore <release key> -alias yes-machine -keyalg RSA -keysize 4096 -validity 36500 -dname "CN=Yes Machine"
$ANDROID_HOME/build-tools/36.1.0/zipalign -p -f 4 app/build/outputs/apk/release/app-release-unsigned.apk aligned.apk
$ANDROID_HOME/build-tools/36.1.0/apksigner sign --ks <release key> --ks-key-alias yes-machine --out YesMachine-<version>-android.apk aligned.apk
```

Every release must be signed with that same key: Android updates an app only with an APK of the same signature, so without the key the app has to be uninstalled before the next version goes in. For the same reason, a debug build and a release build can't replace each other.

Additional checks:

```sh
./gradlew :app:lintDebug
node --test test/bridge.test.cjs
```

## Connection design

- Android NSD discovers `_yes-machine._tcp`. The search restarts every 10 seconds and keeps the list between rounds, because Android may miss a computer that starts sharing during a long search. A computer that stops announcing drops out after a few rounds, or at once when it says goodbye. The home page also checks every listed computer every 5 seconds with a TLS handshake. Adding a computer by address remains available if multicast discovery is unavailable.
- Initial certificate inspection deliberately aborts TLS after receiving the certificate. It sends no HTTP request, WebSocket upgrade, password, or application data.
- Sign-in posts the user name and password to the host's `/login` over a connection pinned to the approved certificate, so the password goes out only after the handshake shows that certificate. The host answers with a one-time ticket that the viewer uses for its session.
- After user verification, every native WebSocket connection checks the exact SHA-256 leaf certificate pin, validity period, and IP subject alternative name. Connections go directly to the selected private IP, bypass system proxies, and disable redirects.
- Two WebViews load only bundled resources from `https://appassets.androidplatform.net`: the home page and the viewer, each with its own fixed list of files. All other resource requests and navigations are blocked. WebView SSL errors are canceled, never bypassed.
- The home page's bridge (`YesMachineHome`) takes a small set of requests, validates every address as a private IPv4 endpoint, and only approves a fingerprint it just observed. The viewer's bridge supplies a WebSocket for the selected verified host and explicit clipboard operations. Neither exposes an arbitrary network URL, filesystem path, or command execution API.
- Screen, audio, keyboard, and pointer traffic use the bundled WebRTC client. Files use the pinned WebSocket connection. A received file is staged in app-private cache and saved only through a user-chosen document URI.
- Plain-text clipboard messages are limited to about 60 KB. Files are limited to 10 GB each, and a received file must fit in the app's cache with 256 MiB to spare. Only one pending received-file Save dialog is supported at a time.

## Verification status

The APK compiled successfully and its Android APK Signature Scheme v2 signature was verified. Sixteen Java tests pass: three endpoint-validation checks; five transport checks, including real loopback TLS handshakes that accept the approved pin and reject a changed pin or wrong IP, plus a system-proxy isolation check; five for general mode's file connection; and three for advanced mode's session state. Four JavaScript bridge tests pass for origin confinement, socket routing, stale events, and explicit clipboard access. Android lint completes with **zero errors and 12 warnings**: the API 34 target, the API 31 data-extraction attribute, the WebViews' JavaScript, the custom pinned TLS trust managers, and free-space checks that could also count clearable cache. Physical-device behavior is recorded separately in the parent project's [validation record](../docs/VALIDATION.md).

A successful build does not prove discovery works on a particular router, that the fingerprint UI was verified, or that actual remote input/audio/files work. Test those features on the intended devices. Guest Wi-Fi isolation and multicast filtering can block discovery or connections.

## Source guide

[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) describes every class and page, and how the app fits with the desktop app.

- `MainActivity.java`: the home and viewer WebViews, the home bridge, certificate checks, sign-in, and document choosers.
- `home/home.html`, `home.css` and the scripts beside them (`bridge.js` first, `start.js` last): the home screen, built on the desktop app's `host.css` and network house.
- `LanDiscovery.java`: bounded NSD discovery in repeating rounds.
- `CredentialStore.java`: remembered sign-ins encrypted with an Android Keystore key.
- `HostEndpoint.java`: numeric private IPv4 parsing.
- `TlsPins.java`: aborted certificate probe and exact-pinned TLS transport.
- `NativeSession.java`: scoped WebSocket/clipboard bridge and bounded incoming files.
- `android-bridge.js`: adapter between the bundled browser client and native transport.

Platform references: [Android NSD](https://developer.android.com/develop/connectivity/wifi/use-nsd), [local WebView content](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content), and [WebView SSL error handling](https://developer.android.com/reference/android/webkit/WebViewClient#onReceivedSslError(android.webkit.WebView,%20android.webkit.SslErrorHandler,%20android.net.http.SslError)).

Yes Machine source uses the parent project's [MIT license](../LICENSE). Dependencies retain their own licenses.
