package local.yesmachine.android;

import android.Manifest;
import android.app.Activity;
import android.app.UiModeManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.drawable.ColorDrawable;
import android.media.projection.MediaProjectionManager;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.ContextThemeWrapper;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.security.cert.CertificateException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.net.ssl.SSLException;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The app's only screen. It shows one of two bundled pages, each in its own WebView:
 * - The home screen (home.html): a pixel-art house that lists the computers on the network, checks their certificates
 *   and signs in, with Settings and the controls for general mode (sharing this device's screen). Its bridge to Java
 *   is window.YesMachineHome (HomeBridge): the page sends requests, and gets the answers through window.__homeReply
 *   and updates (computers found, general mode's state, events) through window.__homeEvent.
 * - The viewer (client.html, the same viewer page that browsers and the desktop app use), which shows one computer.
 *   Its android-bridge.js sends the page's WebSocket through window.YesMachineNative (NativeSession).
 *
 * Both pages load only local assets, from https://appassets.androidplatform.net, which localAsset() answers with each
 * page's own list of files and a strict Content-Security-Policy. Every other request and every navigation is blocked.
 *
 * Native code checks certificates, keeps the approved fingerprints and the remembered sign-ins, and signs in.
 * Connecting to a computer goes like this: the home page asks to inspect it, and its certificate is read without
 * anything being sent (TlsPins.inspect). The first time, the person compares the fingerprint with the one the computer
 * shows and trusts it, and the fingerprint is kept for that address and port. The user name and password then go to
 * the computer's /login over a connection pinned to that certificate, and the computer answers with a one-time ticket.
 * The viewer opens with the ticket in its URL (#ticket=...), so no PIN is used and the page never sees the password.
 * When the session ends, the viewer changes its URL to #ended-<reason>, and the app goes back to the home screen.
 *
 * MainActivity also starts general mode's screen sharing (ShareService) with Android's consent, shows its state on
 * the home screen, and keeps Android's bars and window in the night or day theme the home screen chose.
 */
public final class MainActivity extends Activity {

    // The origin both pages load from, the domain Android sets aside for apps' own content. localAsset() answers the
    // pages' requests from the app's assets.
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    // The viewer's URL once its session is over: #ended-lost (the connection dropped), #ended-closed (the person
    // disconnected) or #ended-replaced (another device signed in and took over).
    private static final Pattern ENDED = Pattern.compile(
        "^" + Pattern.quote(ORIGIN) + "/#ended-(lost|closed|replaced)$"
    );
    // The Content-Security-Policy sent with every file: everything from the app's own files only, plus blob: media
    // and data: images; no frames, plugins, <base> or form submissions.
    private static final String POLICY =
        "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
    // Request codes: a file to send, where to save a received file, the consent to record the screen, and the
    // permissions sharing asks for (notifications and recording audio).
    private static final int OPEN_FILE = 101,
        SAVE_FILE = 102,
        RECORD_SCREEN = 103,
        NOTIFY = 104;
    // The night and day themes' color, for the window and Android's bars.
    private static final int NIGHT = 0xff0d1115,
        DAY = 0xffeef2f5;
    // tasks runs the home page's requests and other slow work off the main thread; probes checks up to eight
    // computers at a time.
    private final ExecutorService tasks = Executors.newCachedThreadPool(),
        probes = Executors.newFixedThreadPool(8);
    private final Handler ui = new Handler(Looper.getMainLooper());
    // The fingerprint last read from each computer, by "address:port". Trusting a computer approves the one read
    // here, never one the page sends.
    private final Map<String, String> seen = new ConcurrentHashMap<>();
    // Saved settings: the approved fingerprints by "address:port", general mode's settings, and the theme. day is
    // whether the day theme is on; advancedConnected whether a computer is connected in advanced mode.
    private SharedPreferences pins, control, appearance;
    private boolean day, advancedConnected;
    // Shows general mode's state on the home page whenever ShareService changes it.
    private final ShareState.Listener sharing = () -> ui.post(this::pushControl);
    private CredentialStore credentials;
    private LanDiscovery discovery;
    // What discovery found last, and its error to show, if any.
    private List<HostEndpoint> discovered = Collections.emptyList();
    private String discoveryError = "";
    // The two pages, and the name of the computer the viewer shows. viewer is null on the home screen.
    private WebView home, viewer;
    private String viewerName;
    private NativeSession session;
    // externalUi is true while a screen this app opened is in front: a file picker, Settings, or a permission or
    // consent dialog. Leaving the app for one of those doesn't end the session.
    private boolean externalUi, destroyed, foreground;
    // The viewer's file chooser, waiting for the file picked to send.
    private ValueCallback<Uri[]> fileChooser;
    // A received file waiting for the person to choose where to save it, and what to run afterwards, which deletes
    // the cached copy.
    private File savingFile;
    private Runnable finishSave;
    // The page's element shown full screen, while it is, and how to tell WebView it no longer is.
    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;

    // --- Startup ---

    /** Sets up the theme, the saved settings, discovery and general mode's listener, then shows the home page. */
    @Override
    public void onCreate(Bundle state) {
        // Night or day, as the home screen's sun and moon last chose, from the first frame.
        appearance = getSharedPreferences("appearance", MODE_PRIVATE);
        day = "day".equals(appearance.getString("theme", "night"));
        setTheme(day ? R.style.YesMachine_Day : R.style.YesMachine_Night);
        super.onCreate(state);
        pins = getSharedPreferences("approved-host-certificates", MODE_PRIVATE);
        control = getSharedPreferences("control", MODE_PRIVATE);
        ShareState.listen(sharing);
        // ShareService is on in general mode and off in advanced mode.
        applyMode(control.getString("mode", "general"));
        credentials = new CredentialStore(this);
        discovery = new LanDiscovery(
            this,
            new LanDiscovery.Listener() {
                public void changed(List<HostEndpoint> hosts) {
                    discovered = hosts;
                    discoveryError = "";
                    pushDiscovery();
                }

                public void status(String error) {
                    discoveryError = error == null ? "" : error;
                    pushDiscovery();
                }
            }
        );
        // Delete received files that an interrupted run left in the cache (NativeSession's ym-receive-... files).
        File[] old = getCacheDir().listFiles((directory, name) -> name.startsWith("ym-receive-"));
        if (old != null) for (File file : old) file.delete();
        home = page(true);
        home.addJavascriptInterface(new HomeBridge(), "YesMachineHome");
        setContentView(home);
        applyBars();
        tellAndroid();
        home.loadUrl(ORIGIN + "/home.html");
    }

    // --- Night and day ---

    /**
     * Switches between night and day when the home page asks (setTheme). The home page asks halfway through
     * Sarigüeya's walk, as its own colors change.
     */
    private void changeTheme(boolean next) {
        if (destroyed || next == day) return;
        day = next;
        applyBars();
        tellAndroid();
        if (home != null) home.setBackgroundColor(day ? DAY : NIGHT);
    }

    /**
     * Gives Android's status and navigation bars, and the window behind the pages, the app's colors. By day the bars'
     * icons turn dark.
     */
    private void applyBars() {
        int color = day ? DAY : NIGHT;
        getWindow().setStatusBarColor(color);
        getWindow().setNavigationBarColor(color);
        getWindow().setBackgroundDrawable(new ColorDrawable(color));
        if (Build.VERSION.SDK_INT >= 30) {
            int light =
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS |
                WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            WindowInsetsController bars = getWindow().getInsetsController();
            if (bars != null) bars.setSystemBarsAppearance(day ? light : 0, light);
        } else {
            // Before Android 11, the same through the older system UI flags.
            View decor = getWindow().getDecorView();
            int light =
                    View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR,
                flags = decor.getSystemUiVisibility() & ~light;
            decor.setSystemUiVisibility(day ? flags | light : flags);
        }
    }

    /**
     * Tells Android 12 and later whether the app is in night or day mode. They keep the choice and open the app in it
     * next time, splash screen included (res/values-notnight-v31).
     */
    private void tellAndroid() {
        if (Build.VERSION.SDK_INT < 31) return;
        UiModeManager modes = (UiModeManager) getSystemService(UI_MODE_SERVICE);
        if (modes != null) modes.setApplicationNightMode(
            day ? UiModeManager.MODE_NIGHT_NO : UiModeManager.MODE_NIGHT_YES
        );
    }

    // --- The pages' WebViews and the files they may load ---

    /**
     * A WebView for one of the two pages, locked down: no file access, no mixed content, no new windows and no cache.
     * localAsset() answers every request, and every navigation away is refused. Only the viewer, which sends files
     * the person picks, may read content:// URIs. The viewer's page follows prefers-color-scheme, which WebView takes
     * from its context's theme, so its WebView is made in the app's theme and the page opens in the app's current mode.
     */
    private WebView page(boolean isHome) {
        WebView web = new WebView(
            isHome
                ? this
                : new ContextThemeWrapper(
                      this,
                      day ? R.style.YesMachine_Day : R.style.YesMachine_Night
                  )
        );
        web.setBackgroundColor(day ? DAY : NIGHT);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(!isHome);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setSafeBrowsingEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        web.setWebViewClient(
            new WebViewClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(
                    WebView view,
                    WebResourceRequest request
                ) {
                    return localAsset(request, isHome);
                }

                // The page can't navigate anywhere else.
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    return true;
                }

                // A certificate error is never bypassed.
                @Override
                public void onReceivedSslError(
                    WebView view,
                    SslErrorHandler handler,
                    SslError error
                ) {
                    handler.cancel();
                }

                // The viewer reports the end of its session by changing its fragment, as it does in the desktop app.
                @Override
                public void doUpdateVisitedHistory(WebView view, String url, boolean reload) {
                    Matcher ended = ENDED.matcher(url == null ? "" : url);
                    if (!isHome && view == viewer && ended.matches()) ui.post(() ->
                        endViewer(ended.group(1))
                    );
                }
            }
        );
        return web;
    }

    /**
     * Answers a request from one of the pages. Only a GET for https://appassets.androidplatform.net, with no port and
     * no query, can get a file, and only a file on that page's list or one of the bundled fonts. Anything else gets an
     * empty 403. Every answer carries the Content-Security-Policy, and forbids caching and guessing the content type.
     */
    private WebResourceResponse localAsset(WebResourceRequest request, boolean isHome) {
        Uri uri = request.getUrl();
        String file = null,
            mime = null,
            path = uri.getPath() == null ? "" : uri.getPath();
        if (
            "GET".equals(request.getMethod()) &&
            "https".equals(uri.getScheme()) &&
            "appassets.androidplatform.net".equals(uri.getHost()) &&
            uri.getPort() == -1 &&
            uri.getQuery() == null
        ) {
            // The files each page may load, by path. Both pages load the pixel icons and scenes.
            Map<String, String> files = new HashMap<>();
            files.put("/pixel-icons.js", "pixel-icons.js");
            files.put("/pixel-scene.js", "pixel-scene.js");
            if (isHome) {
                files.put("/home.html", "home.html");
                files.put("/bridge.js", "bridge.js");
                files.put("/common.js", "common.js");
                files.put("/night-and-day.js", "night-and-day.js");
                files.put("/devices.js", "devices.js");
                files.put("/connecting.js", "connecting.js");
                files.put("/general-mode.js", "general-mode.js");
                files.put("/settings.js", "settings.js");
                files.put("/start.js", "start.js");
                files.put("/home.css", "home.css");
                files.put("/host.css", "host.css");
                files.put("/pixel-house.js", "pixel-house.js");
                files.put("/setup-guides.js", "setup-guides.js");
                files.put("/pixel-day.js", "pixel-day.js");
                files.put("/pixel-home.js", "pixel-home.js");
                files.put("/theme.js", "theme.js");
            } else {
                // The viewer's page is at the root, where the computer serves it too.
                files.put("/", "client.html");
                files.put("/client/common.js", "client/common.js");
                files.put("/client/cats.js", "client/cats.js");
                files.put("/client/session.js", "client/session.js");
                files.put("/client/stream.js", "client/stream.js");
                files.put("/client/sign-in.js", "client/sign-in.js");
                files.put("/client/screens.js", "client/screens.js");
                files.put("/client/pointer.js", "client/pointer.js");
                files.put("/client/keyboard.js", "client/keyboard.js");
                files.put("/client/clipboard.js", "client/clipboard.js");
                files.put("/client/files.js", "client/files.js");
                files.put("/client/layout.js", "client/layout.js");
                files.put("/client/start.js", "client/start.js");
                files.put("/android-bridge.js", "android-bridge.js");
                files.put("/style.css", "style.css");
                files.put("/keys.js", "keys.js");
            }
            file = files.get(path);
            // Fonts, at /fonts/... for the viewer's style sheet, or /public/fonts/... for host.css, whose relative
            // paths are written for the desktop app's folders.
            Matcher font = Pattern.compile("^/(?:public/)?fonts/([a-z0-9-]+\\.woff2)$").matcher(
                path
            );
            if (file == null && font.matches()) {
                file = "fonts/" + font.group(1);
                mime = "font/woff2";
            } else if (file != null) mime = file.endsWith(".html")
                ? "text/html"
                : file.endsWith(".css")
                  ? "text/css"
                  : "text/javascript";
        }
        Map<String, String> headers = new HashMap<>();
        headers.put("Content-Security-Policy", POLICY);
        headers.put("Cache-Control", "no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        try {
            if (file != null) return new WebResourceResponse(
                mime,
                mime.startsWith("font/") ? null : "UTF-8",
                200,
                "OK",
                headers,
                getAssets().open(file)
            );
        } catch (Exception ignored) {}
        return new WebResourceResponse(
            "text/plain",
            "UTF-8",
            403,
            "Blocked",
            headers,
            new ByteArrayInputStream(new byte[0])
        );
    }

    // --- The home page's bridge ---

    /** Sends the home page the computers discovery found, and the discovery error to show, if any. */
    private void pushDiscovery() {
        try {
            JSONArray devices = new JSONArray();
            for (HostEndpoint host : discovered)
                devices.put(
                    new JSONObject()
                        .put("name", host.name)
                        .put("address", host.address)
                        .put("port", host.port)
                        .put("platform", host.platform)
                        .put("os", host.system)
                );
            push(
                "discovery",
                new JSONObject().put("devices", devices).put("error", discoveryError)
            );
        } catch (Exception ignored) {}
    }

    /** Sends the home page an update, as window.__homeEvent({kind, value}): "discovery", "control" or "event". */
    private void push(String kind, JSONObject value) {
        if (home == null || destroyed) return;
        try {
            String script =
                "window.__homeEvent&&window.__homeEvent(" +
                new JSONObject().put("kind", kind).put("value", value) +
                ")";
            home.evaluateJavascript(script, null);
        } catch (Exception ignored) {}
    }

    /**
     * The home page's only way to native code, as window.YesMachineHome. The page calls request(id, method, json),
     * and the answer comes back as window.__homeReply(id, ok, value). Every argument is validated before use (handle(),
     * target()), and the requests run on the tasks pool, so network work stays off the main thread.
     */
    private final class HomeBridge {

        @JavascriptInterface
        public void request(String id, String method, String json) {
            if (id == null || id.length() > 16 || method == null) return;
            // Arguments over 8 KB count as none. A failure carries its message and, for a sign-in the computer
            // refused, its HTTP status.
            tasks.execute(() -> {
                try {
                    reply(
                        id,
                        true,
                        handle(
                            method,
                            json == null || json.length() > 8192
                                ? new JSONObject()
                                : new JSONObject(json)
                        )
                    );
                } catch (SignInException error) {
                    reply(id, false, failure(error.getMessage(), error.status));
                } catch (Exception error) {
                    reply(
                        id,
                        false,
                        failure(
                            error.getMessage() == null
                                ? "Something went wrong. Try again."
                                : error.getMessage(),
                            0
                        )
                    );
                }
            });
        }

        /** The value of a failed request: the message to show, and the HTTP status of a refused sign-in, or 0. */
        private JSONObject failure(String message, int status) {
            try {
                return new JSONObject().put("error", message).put("status", status);
            } catch (Exception error) {
                return new JSONObject();
            }
        }

        /** Answers request id on the main thread, if the home page is still there. value goes in as JSON text. */
        private void reply(String id, boolean ok, Object value) {
            ui.post(() -> {
                if (home != null && !destroyed) home.evaluateJavascript(
                    "window.__homeReply&&window.__homeReply(" +
                        JSONObject.quote(id) +
                        "," +
                        ok +
                        "," +
                        value +
                        ")",
                    null
                );
            });
        }
    }

    /** The computer a request names, by address, port and name; throws unless the address is private IPv4. */
    private static HostEndpoint target(JSONObject args) {
        return new HostEndpoint(
            args.optString("address"),
            args.optInt("port"),
            args.optString("name"),
            "Computer"
        );
    }

    /**
     * Carries out one request from the home page, on the tasks pool, and returns its result for the reply. Work that
     * needs the main thread is posted there. Throws, with a message for the page, when the request fails.
     */
    private Object handle(String method, JSONObject args) throws Exception {
        switch (method) {
            // This device: the app version, the network, and whether passwords can be remembered.
            case "info":
                return new JSONObject()
                    .put("version", version())
                    .put("network", network())
                    .put("credentialsAvailable", credentials.available());
            // A new discovery round, for the refresh button, while the home screen shows.
            case "refresh":
                ui.post(() -> {
                    if (foreground && viewer == null) discovery.refresh();
                });
                return new JSONObject();
            // Whether the listed computers are sharing; one computer's certificate, before connecting.
            case "probe":
                return probe(args.optJSONArray("targets"));
            case "inspect":
                return inspect(target(args));
            // Approves the fingerprint just read from that computer by inspect, never one the page sends.
            case "trust": {
                HostEndpoint host = target(args);
                String fingerprint = seen.get(host.authority());
                if (fingerprint == null) throw new Exception(
                    "Check the computer again before trusting it."
                );
                pins.edit().putString(host.authority(), fingerprint).apply();
                return new JSONObject();
            }
            case "signIn":
                return signIn(
                    target(args),
                    args.optString("user").trim(),
                    args.optString("password"),
                    args.optBoolean("remember")
                );
            case "signInSaved":
                return signInSaved(target(args));
            // Settings: the trusted certificates and the remembered sign-ins.
            case "trustedCount":
                return new JSONObject().put("count", pins.getAll().size());
            case "forgetTrusted":
                pins.edit().clear().apply();
                return new JSONObject();
            case "credentialsInfo":
                return new JSONObject()
                    .put("available", credentials.available())
                    .put("count", credentials.count());
            case "forgetCredentials":
                credentials.clear();
                return new JSONObject();
            // General mode.
            case "control":
                return controlState();
            case "setMode": {
                String mode = args.optString("mode");
                if (!mode.equals("general") && !mode.equals("advanced")) throw new Exception(
                    "Unknown mode."
                );
                control.edit().putString("mode", mode).apply();
                // Advanced mode ends general mode's sharing.
                if (mode.equals("advanced")) stopService(new Intent(this, ShareService.class));
                applyMode(mode);
                return controlState();
            }
            // These open other screens, so they run on the main thread.
            case "openAccessibility":
                ui.post(this::openAccessibility);
                return new JSONObject();
            case "openDeveloperOptions":
                ui.post(this::openDeveloperOptions);
                return new JSONObject();
            case "startSharing":
                ui.post(this::startSharing);
                return new JSONObject();
            case "stopSharing":
                stopService(new Intent(this, ShareService.class));
                return new JSONObject();
            case "disconnectComputer": {
                ShareService service = ShareService.current;
                if (service != null) service.disconnect();
                return new JSONObject();
            }
            // The answer to a computer that asks to control this device; always means "Always allow".
            case "answer": {
                ShareService service = ShareService.current;
                if (service != null) service.answer(
                    args.optString("id"),
                    args.optBoolean("allow"),
                    args.optBoolean("always")
                );
                return new JSONObject();
            }
            // Forgets the computers that are always allowed.
            case "forgetComputers":
                getSharedPreferences("allowed-computers", MODE_PRIVATE).edit().clear().apply();
                return controlState();
            // Saved at once; the bars change on the main thread.
            case "setTheme": {
                boolean next = "day".equals(args.optString("mode"));
                appearance
                    .edit()
                    .putString("theme", next ? "day" : "night")
                    .apply();
                ui.post(() -> changeTheme(next));
                return new JSONObject();
            }
            default:
                throw new Exception("Unknown request.");
        }
    }

    // --- General mode: sharing this device's screen ---

    /**
     * General mode, as the home screen shows it: the chosen mode, whether Accessibility allows Yes Machine (its
     * service, ControlService, carries the computer's touches and keys), this device's name, system and certificate
     * fingerprint, and the sharing state with its computer, including one waiting for an answer. Also how many
     * computers are always allowed, and whether a computer is connected in advanced mode.
     */
    private JSONObject controlState() throws Exception {
        ShareState.Request asking = ShareState.asking;
        // Without the Keystore there's no fingerprint to show.
        String fingerprint = "";
        try {
            fingerprint = DeviceIdentity.fingerprint();
        } catch (Exception unavailable) {}
        return new JSONObject()
            .put("mode", control.getString("mode", "general"))
            .put("accessibility", accessibilityAllowed())
            .put("sharing", ShareState.sharing)
            .put("computer", ShareState.computer)
            .put("name", ShareService.deviceName(this))
            .put("system", "Android " + Build.VERSION.RELEASE)
            .put("fingerprint", fingerprint)
            .put(
                "allowedComputers",
                getSharedPreferences("allowed-computers", MODE_PRIVATE).getAll().size()
            )
            .put("advancedConnected", advancedConnected)
            .put(
                "asking",
                asking == null
                    ? JSONObject.NULL
                    : new JSONObject()
                          .put("id", asking.id)
                          .put("name", asking.name)
                          .put("system", asking.system)
                          .put("address", asking.address)
            );
    }

    /** Sends general mode's state to the home page. It's gathered off the main thread, since it reads the Keystore. */
    private void pushControl() {
        tasks.execute(() -> {
            try {
                JSONObject state = controlState();
                ui.post(() -> push("control", state));
            } catch (Exception ignored) {}
        });
    }

    // In advanced mode, whether a computer is connected, from its server's heartbeat (AdvancedSession). It's checked
    // every two seconds while the home screen shows, so its house can show the device as shared, as in general mode.
    // It stops in the background and while the viewer shows; onResume starts it again.
    private final Runnable advancedCheck = new Runnable() {
        @Override
        public void run() {
            if (!foreground || destroyed || viewer != null) return;
            if (control.getString("mode", "general").equals("advanced")) tasks.execute(() -> {
                boolean live = AdvancedSession.live(
                    AdvancedSession.read(),
                    SystemClock.elapsedRealtime()
                );
                ui.post(() -> {
                    if (live != advancedConnected) {
                        advancedConnected = live;
                        pushControl();
                    }
                });
            });
            else if (advancedConnected) {
                advancedConnected = false;
                pushControl();
            }
            ui.postDelayed(this, 2000);
        }
    };

    /**
     * Whether Yes Machine's accessibility service (ControlService) is on. Android lists the services that are on as
     * component names separated by colons.
     */
    private boolean accessibilityAllowed() {
        String enabled = Settings.Secure.getString(
            getContentResolver(),
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        );
        ComponentName mine = new ComponentName(this, ControlService.class);
        if (enabled != null) for (String entry : enabled.split(":"))
            if (mine.equals(ComponentName.unflattenFromString(entry))) return true;
        return false;
    }

    /** Opens Android's Accessibility settings, where Yes Machine is listed among the installed apps. */
    private void openAccessibility() {
        externalUi = true;
        try {
            startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
        } catch (Exception none) {
            externalUi = false;
        }
    }

    /**
     * Opens Developer options, for advanced mode, which works over Android's debugging connection. When they are off,
     * opens About instead, where tapping Build number turns them on.
     */
    private void openDeveloperOptions() {
        externalUi = true;
        boolean on =
            Settings.Global.getInt(
                getContentResolver(),
                Settings.Global.DEVELOPMENT_SETTINGS_ENABLED,
                0
            ) == 1;
        try {
            startActivity(
                new Intent(
                    on
                        ? Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS
                        : Settings.ACTION_DEVICE_INFO_SETTINGS
                )
            );
        } catch (Exception none) {
            externalUi = false;
        }
    }

    /**
     * Advanced mode turns general mode's sharing service (ShareService) off, and general mode turns it back on. That
     * is also how Yes Machine on a computer, over adb, tells the modes apart: it starts advanced mode only while the
     * service is off.
     */
    private void applyMode(String mode) {
        getPackageManager().setComponentEnabledSetting(
            new ComponentName(this, ShareService.class),
            mode.equals("advanced")
                ? PackageManager.COMPONENT_ENABLED_STATE_DISABLED
                : PackageManager.COMPONENT_ENABLED_STATE_DEFAULT,
            PackageManager.DONT_KILL_APP
        );
    }

    /**
     * Starts sharing this device's screen, unless it's sharing already or in advanced mode. Sharing needs Android's
     * consent to record the screen each time; the answer arrives in onActivityResult, which starts ShareService.
     */
    private void startSharing() {
        if (
            ShareService.current != null || control.getString("mode", "general").equals("advanced")
        ) return;
        // The permissions come first. Notifications let sharing ask about computers, and recording audio lets a
        // computer hear what apps play. Each is asked for once (onRequestPermissionsResult then comes back here), and
        // sharing goes on without them.
        List<String> ask = new ArrayList<>();
        if (
            Build.VERSION.SDK_INT >= 33 &&
            missing(Manifest.permission.POST_NOTIFICATIONS, "askedNotifications")
        ) ask.add(Manifest.permission.POST_NOTIFICATIONS);
        if (
            Build.VERSION.SDK_INT >= 29 && missing(Manifest.permission.RECORD_AUDIO, "askedSound")
        ) ask.add(Manifest.permission.RECORD_AUDIO);
        if (!ask.isEmpty()) {
            externalUi = true;
            requestPermissions(ask.toArray(new String[0]), NOTIFY);
            return;
        }
        externalUi = true;
        try {
            startActivityForResult(
                getSystemService(MediaProjectionManager.class).createScreenCaptureIntent(),
                RECORD_SCREEN
            );
        } catch (Exception none) {
            externalUi = false;
        }
    }

    /**
     * Whether to ask for a permission: one not granted yet that hasn't been asked for (the asked flag in the control
     * settings), which now counts as asked.
     */
    private boolean missing(String permission, String asked) {
        if (
            checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED ||
            control.getBoolean(asked, false)
        ) return false;
        control.edit().putBoolean(asked, true).apply();
        return true;
    }

    /** After the permission dialog, sharing goes on, whatever the answers. */
    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        externalUi = false;
        if (requestCode == NOTIFY) startSharing();
    }

    // --- This device, for the home page ---

    /** The app's version name, or "" if it can't be read. */
    private String version() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception error) {
            return "";
        }
    }

    /**
     * This device's private IPv4 address, prefix and kind (wifi, ethernet or other) on the active network, or null.
     * The home page uses it to tell which computers are on this device's network.
     */
    private Object network() throws Exception {
        ConnectivityManager manager = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        Network active = manager == null ? null : manager.getActiveNetwork();
        LinkProperties properties = active == null ? null : manager.getLinkProperties(active);
        NetworkCapabilities capabilities =
            active == null ? null : manager.getNetworkCapabilities(active);
        String kind =
            capabilities == null
                ? "other"
                : capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
                  ? "ethernet"
                  : capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                    ? "wifi"
                    : "other";
        if (properties != null) for (LinkAddress link : properties.getLinkAddresses()) {
            if (!(link.getAddress() instanceof Inet4Address)) continue;
            String address = link.getAddress().getHostAddress();
            if (HostEndpoint.isPrivate(address)) return new JSONObject()
                .put("address", address)
                .put("prefix", link.getPrefixLength())
                .put("kind", kind);
        }
        return JSONObject.NULL;
    }

    // --- Checking computers' certificates ---

    /**
     * Whether each listed computer is sharing, for the home page's regular check: a quick TLS handshake to each (up
     * to 32), in parallel, eight at a time. Nothing is sent after the handshake (TlsPins.inspect). Each result has the
     * address, port and online, and the fingerprint when online. Invalid entries are skipped, and the list is empty
     * while the viewer shows.
     */
    private JSONArray probe(JSONArray targets) throws Exception {
        JSONArray results = new JSONArray();
        if (targets == null || viewer != null) return results;
        List<HostEndpoint> hosts = new ArrayList<>();
        for (int i = 0; i < targets.length() && hosts.size() < 32; i++) {
            try {
                hosts.add(target(targets.getJSONObject(i)));
            } catch (Exception ignored) {}
        }
        List<Future<String>> checks = new ArrayList<>();
        for (HostEndpoint host : hosts)
            checks.add(probes.submit(() -> TlsPins.fingerprint(TlsPins.inspect(host, 1500))));
        for (int i = 0; i < hosts.size(); i++) {
            // Waits up to four seconds for each check. One that fails, or takes longer (it's canceled), means offline.
            String fingerprint = null;
            try {
                fingerprint = checks.get(i).get(4, TimeUnit.SECONDS);
            } catch (Exception ignored) {
                checks.get(i).cancel(true);
            }
            JSONObject result = new JSONObject()
                .put("address", hosts.get(i).address)
                .put("port", hosts.get(i).port)
                .put("online", fingerprint != null);
            if (fingerprint != null) result.put("fingerprint", fingerprint);
            results.put(result);
        }
        return results;
    }

    /**
     * Reads a computer's certificate before connecting, for the home page: whether it's online, its fingerprint,
     * whether that's the approved one (trusted) or differs from it (changed), and whether a sign-in is remembered for
     * it. The fingerprint is kept in seen, so trusting the computer approves exactly this certificate. A certificate
     * the app can't use fails with the reason; a computer that can't be reached is only offline.
     */
    private JSONObject inspect(HostEndpoint host) throws Exception {
        String fingerprint;
        try {
            fingerprint = TlsPins.fingerprint(TlsPins.inspect(host, 4000));
        } catch (CertificateException error) {
            throw new Exception(
                error.getMessage() == null
                    ? "This computer's certificate could not be checked."
                    : error.getMessage()
            );
        } catch (IOException error) {
            return new JSONObject().put("online", false);
        }
        seen.put(host.authority(), fingerprint);
        String approved = pins.getString(host.authority(), null);
        return new JSONObject()
            .put("online", true)
            .put("fingerprint", fingerprint)
            .put("trusted", fingerprint.equals(approved))
            .put("changed", approved != null && !fingerprint.equals(approved))
            .put("remembered", credentials.has(host.authority()));
    }

    /** The computer's approved fingerprint; throws, asking to verify the computer, when there's none. */
    private String approved(HostEndpoint host) throws Exception {
        String fingerprint = pins.getString(host.authority(), null);
        if (fingerprint == null) throw new Exception("Verify this computer before connecting.");
        return fingerprint;
    }

    // --- Signing in ---

    /**
     * Signs in with the user name and password the person entered, then opens the viewer. With remember, the sign-in
     * is kept (CredentialStore); without it, any kept one is forgotten. Returns whether it was kept.
     */
    private JSONObject signIn(HostEndpoint host, String user, String password, boolean remember)
        throws Exception {
        if (user.isEmpty() || password.isEmpty()) throw new Exception(
            "Enter the user name and password of that computer."
        );
        String fingerprint = approved(host),
            ticket = requestTicket(host, fingerprint, user, password);
        boolean remembered = remember && credentials.set(host.authority(), user, password);
        if (!remember) credentials.forget(host.authority());
        ui.post(() -> openViewer(host, fingerprint, ticket));
        return new JSONObject().put("remembered", remembered);
    }

    /**
     * Uses a remembered sign-in, then opens the viewer. Returns needsCredentials when there's none, or when the
     * computer refused it (401): a refused one is forgotten, so the user is asked again.
     */
    private JSONObject signInSaved(HostEndpoint host) throws Exception {
        String fingerprint = approved(host);
        CredentialStore.Credential saved = credentials.get(host.authority());
        if (saved == null) return new JSONObject().put("needsCredentials", true);
        try {
            String ticket = requestTicket(host, fingerprint, saved.user, saved.password);
            ui.post(() -> openViewer(host, fingerprint, ticket));
            return new JSONObject().put("connected", true);
        } catch (SignInException error) {
            if (error.status != 401) throw error;
            credentials.forget(host.authority());
            return new JSONObject()
                .put("needsCredentials", true)
                .put("user", saved.user)
                .put("error", "The saved password no longer works. Enter it again.");
        }
    }

    /** A sign-in the computer refused, with the HTTP status it answered (401 for a wrong user name or password). */
    static final class SignInException extends Exception {

        final int status;

        SignInException(int status, String message) {
            super(message);
            this.status = status;
        }
    }

    /**
     * Posts the sign-in to the computer's /login over the pinned connection, so the password only goes out after the
     * handshake shows the approved certificate. Returns the one-time ticket (64 hex digits) the computer answers with.
     * Throws SignInException when the computer refuses, with its status and message, or an exception with a message
     * for the person when the certificate changed or the computer didn't answer.
     */
    private String requestTicket(
        HostEndpoint host,
        String fingerprint,
        String user,
        String password
    ) throws Exception {
        // The pinned client, made for this one request: timeouts for a sign-in rather than a long session, and no
        // pings. It's shut down at the end.
        OkHttpClient client = TlsPins.client(host, fingerprint)
            .newBuilder()
            .readTimeout(25, TimeUnit.SECONDS)
            .callTimeout(30, TimeUnit.SECONDS)
            .pingInterval(0, TimeUnit.SECONDS)
            .build();
        String body = new JSONObject().put("user", user).put("password", password).toString();
        Request request = new Request.Builder()
            .url(host.origin() + "/login")
            .post(RequestBody.create(body, MediaType.get("application/json; charset=utf-8")))
            .build();
        try (Response response = client.newCall(request).execute()) {
            // At most 8 KB of the answer is read; an answer that isn't JSON counts as empty.
            JSONObject data;
            try {
                data = new JSONObject(response.peekBody(8192).string());
            } catch (Exception error) {
                data = new JSONObject();
            }
            String ticket = data.optString("ticket");
            if (response.code() == 200 && ticket.matches("[0-9a-f]{64}")) return ticket;
            throw new SignInException(
                response.code(),
                data.optString("error", "Sign-in failed. Try again.")
            );
        } catch (SSLException error) {
            throw new Exception("This computer's certificate changed. Tap it again to verify it.");
        } catch (IOException error) {
            throw new Exception(
                "The computer did not answer. Check that Yes Machine is sharing on it."
            );
        } finally {
            client.dispatcher().executorService().shutdown();
            client.connectionPool().evictAll();
        }
    }

    // --- The viewer ---

    /**
     * Replaces the home screen with the viewer for a computer, once sign-in gave a ticket, unless the app went to the
     * background meanwhile. Discovery stops while the viewer shows. The page gets a NativeSession as
     * window.YesMachineNative, and opens with the ticket in its URL fragment.
     */
    private void openViewer(HostEndpoint host, String fingerprint, String ticket) {
        if (destroyed || !foreground) return;
        discovery.stop();
        closeViewer();
        WebView web = page(false);
        try {
            session = new NativeSession(
                this,
                host,
                fingerprint,
                new NativeSession.Listener() {
                    // Socket events go to android-bridge.js, while this viewer is still the one showing.
                    public void event(int id, String type, String value) {
                        ui.post(() -> {
                            if (viewer == web && !destroyed) web.evaluateJavascript(
                                "window.__yesMachineSocketEvent&&window.__yesMachineSocketEvent(" +
                                    id +
                                    "," +
                                    JSONObject.quote(type) +
                                    "," +
                                    JSONObject.quote(value) +
                                    ")",
                                null
                            );
                        });
                    }

                    public void notice(String text) {
                        ui.post(() -> {
                            if (viewer == web) MainActivity.this.notice(text);
                        });
                    }

                    // A received file: Android asks the person where to save it, and onActivityResult copies it
                    // there. When this viewer is gone, the app is closing or in the background, or another file is
                    // waiting to be saved, the file is dropped instead.
                    public void save(File file, String name, Runnable finished) {
                        ui.post(() -> {
                            if (viewer != web || destroyed || !foreground || savingFile != null) {
                                finished.run();
                                return;
                            }
                            savingFile = file;
                            finishSave = finished;
                            externalUi = true;
                            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                                .addCategory(Intent.CATEGORY_OPENABLE)
                                .setType("application/octet-stream")
                                .putExtra(Intent.EXTRA_TITLE, name);
                            try {
                                startActivityForResult(intent, SAVE_FILE);
                            } catch (Exception error) {
                                externalUi = false;
                                finishSaving();
                                notice("No file-save application is available.");
                            }
                        });
                    }
                }
            );
        } catch (Exception error) {
            // No session without a valid pin; the home screen stays.
            web.destroy();
            discovery.start();
            return;
        }
        viewer = web;
        viewerName = host.name;
        web.addJavascriptInterface(session, "YesMachineNative");
        web.setWebChromeClient(
            new WebChromeClient() {
                // No camera, microphone or other protected resource for the page.
                @Override
                public void onPermissionRequest(PermissionRequest request) {
                    request.deny();
                }

                // The page's file picker, for a file to send: Android's document picker, answered in
                // onActivityResult. A chooser still waiting is answered with nothing first.
                @Override
                public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams params
                ) {
                    if (fileChooser != null) fileChooser.onReceiveValue(null);
                    fileChooser = callback;
                    externalUi = true;
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                        .addCategory(Intent.CATEGORY_OPENABLE)
                        .setType("*/*");
                    try {
                        startActivityForResult(intent, OPEN_FILE);
                    } catch (Exception error) {
                        externalUi = false;
                        fileChooser = null;
                        callback.onReceiveValue(null);
                    }
                    return true;
                }

                // Full screen: the page's element covers the window, without the system bars.
                @Override
                public void onShowCustomView(View view, CustomViewCallback callback) {
                    if (customView != null) {
                        callback.onCustomViewHidden();
                        return;
                    }
                    customView = view;
                    customCallback = callback;
                    ((FrameLayout) getWindow().getDecorView()).addView(
                        view,
                        new FrameLayout.LayoutParams(-1, -1)
                    );
                    getWindow()
                        .getDecorView()
                        .setSystemUiVisibility(
                            View.SYSTEM_UI_FLAG_FULLSCREEN |
                                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        );
                }

                @Override
                public void onHideCustomView() {
                    hideFullscreen();
                }
            }
        );
        // The home page's WebView pauses while the viewer shows.
        home.onPause();
        setContentView(web);
        web.loadUrl(ORIGIN + "/#ticket=" + ticket);
    }

    /**
     * Back on the home screen after a session, which ended for reason "lost", "closed" or "replaced". A dropped or
     * taken-over connection gets a dialog there; one the user ended gets a short notice.
     */
    private void endViewer(String reason) {
        if (viewer == null) return;
        String name = viewerName;
        closeViewer();
        setContentView(home);
        if (foreground) {
            home.onResume();
            discovery.start();
        }
        try {
            push(
                "event",
                new JSONObject().put("type", "viewer-ended").put("name", name).put("reason", reason)
            );
        } catch (Exception ignored) {}
    }

    /** Shows a short notice in the viewer. */
    private void notice(String text) {
        if (viewer != null) viewer.evaluateJavascript(
            "window.__yesMachineNotice&&window.__yesMachineNotice(" + JSONObject.quote(text) + ")",
            null
        );
    }

    /** Leaves full screen, if the page is in it, and gives the system bars back their theme colors. */
    private void hideFullscreen() {
        if (customView == null) return;
        ((FrameLayout) getWindow().getDecorView()).removeView(customView);
        customView = null;
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        applyBars();
        if (customCallback != null) customCallback.onCustomViewHidden();
        customCallback = null;
    }

    /**
     * Closes the viewer, if open: ends its session, destroys its WebView, and answers a waiting file chooser or save
     * with nothing, which deletes a received file. Showing the home screen again is up to the caller.
     */
    private void closeViewer() {
        hideFullscreen();
        if (session != null) {
            session.destroy();
            session = null;
        }
        if (viewer != null) {
            viewer.removeJavascriptInterface("YesMachineNative");
            viewer.stopLoading();
            if (viewer.getParent() instanceof ViewGroup) (
                (ViewGroup) viewer.getParent()
            ).removeView(viewer);
            viewer.destroy();
            viewer = null;
        }
        if (fileChooser != null) {
            fileChooser.onReceiveValue(null);
            fileChooser = null;
        }
        finishSaving();
    }

    /** Ends a waiting save: runs its finish action, which deletes the received file's cached copy. */
    private void finishSaving() {
        if (finishSave != null) finishSave.run();
        finishSave = null;
        savingFile = null;
    }

    /**
     * Answers from the screens this app opened: the consent to record the screen (which starts ShareService), the file
     * picked to send (for the viewer's file chooser), or where to save a received file (copied there off the main
     * thread). Only content:// URIs are taken.
     */
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent result) {
        super.onActivityResult(requestCode, resultCode, result);
        externalUi = false;
        if (requestCode == RECORD_SCREEN) {
            if (resultCode == RESULT_OK && result != null) startForegroundService(
                new Intent(this, ShareService.class)
                    .setAction(ShareService.ACTION_START)
                    .putExtra(ShareService.EXTRA_RESULT, resultCode)
                    .putExtra(ShareService.EXTRA_DATA, result)
            );
            return;
        }
        Uri uri = resultCode == RESULT_OK && result != null ? result.getData() : null;
        if (uri != null && !"content".equals(uri.getScheme())) uri = null;
        if (requestCode == OPEN_FILE && fileChooser != null) {
            fileChooser.onReceiveValue(uri == null ? null : new Uri[] { uri });
            fileChooser = null;
        } else if (requestCode == SAVE_FILE && savingFile != null) {
            if (uri == null) {
                finishSaving();
                notice("File save canceled.");
                return;
            }
            // The copy now owns the file, and runs its finish action when done.
            final Uri destination = uri;
            final File source = savingFile;
            final Runnable finished = finishSave;
            savingFile = null;
            finishSave = null;
            tasks.execute(() -> {
                String status = "File saved.";
                try (
                    FileInputStream input = new FileInputStream(source);
                    OutputStream output = getContentResolver().openOutputStream(destination, "w")
                ) {
                    if (output == null) throw new Exception("No output stream.");
                    byte[] chunk = new byte[48 * 1024];
                    int count;
                    while ((count = input.read(chunk)) != -1) output.write(chunk, 0, count);
                } catch (Exception error) {
                    status = "The file could not be saved. Ask the host to send it again.";
                } finally {
                    if (finished != null) finished.run();
                }
                final String message = status;
                ui.post(() -> notice(message));
            });
        }
    }

    // --- Activity lifecycle ---

    /**
     * Back in the foreground, in the viewer or on the home screen. The home screen starts discovery and the
     * advanced-mode check again, and its page hears that the app resumed.
     */
    @Override
    protected void onResume() {
        super.onResume();
        foreground = true;
        // Back in the viewer, which may send what was copied meanwhile (the shared clipboard).
        if (viewer != null) {
            viewer.onResume();
            viewer.evaluateJavascript("window.dispatchEvent(new Event('focus'))", null);
            return;
        }
        home.onResume();
        discovery.start();
        try {
            push("event", new JSONObject().put("type", "resumed"));
        } catch (Exception ignored) {}
        pushControl();
        ui.removeCallbacks(advancedCheck);
        ui.post(advancedCheck);
    }

    /**
     * Leaving the foreground: discovery and the advanced-mode check stop, the viewer's page gets a blur event, and
     * the session ends, unless the screen now in front is one the app opened itself (externalUi).
     */
    @Override
    protected void onPause() {
        foreground = false;
        discovery.stop();
        ui.removeCallbacks(advancedCheck);
        if (viewer != null) {
            viewer.evaluateJavascript("window.dispatchEvent(new Event('blur'))", null);
            viewer.onPause();
        } else home.onPause();
        if (!externalUi && session != null) session.pause();
        super.onPause();
    }

    /** Back leaves full screen first, then the viewer, then what the home page has open; then the app closes. */
    @Override
    public void onBackPressed() {
        if (customView != null) {
            hideFullscreen();
            return;
        }
        if (viewer != null) {
            endViewer("closed");
            return;
        }
        // The page closes an open dialog or returns from Settings first; otherwise the app closes.
        home.evaluateJavascript("window.__homeBack?window.__homeBack():false", handled -> {
            if (!"true".equals(handled)) finish();
        });
    }

    /** Releases everything: discovery, the viewer and its session, the listener, the home page and the threads. */
    @Override
    protected void onDestroy() {
        destroyed = true;
        discovery.stop();
        closeViewer();
        ShareState.unlisten(sharing);
        if (home != null) {
            home.removeJavascriptInterface("YesMachineHome");
            home.destroy();
            home = null;
        }
        tasks.shutdownNow();
        probes.shutdownNow();
        super.onDestroy();
    }
}
