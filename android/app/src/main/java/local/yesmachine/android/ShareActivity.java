package local.yesmachine.android;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Parcelable;
import android.os.SystemClock;
import android.provider.OpenableColumns;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONObject;

/**
 * Yes Machine in Android's share sheet: Share, then Yes Machine, from any app sends the files to the computer that
 * controls this device. A small dialog in the app's own look, over the app the files came from, says how it's going.
 *
 * How the files travel depends on the mode:
 *
 *   - General mode: through the file connection of the computer in control (ShareService.files(), a FileChannel).
 *   - Advanced mode: the computer's stream server runs on this device as the shell user (android/stream, Files.java),
 *     and takes the files from this app's outbox folder, Android/data/local.yesmachine.android/files/outbox, which
 *     the shell can read. Each file gets a folder of its own there, and the two sides talk through small files in it:
 *
 *       file/       holds the file under its own name, alone, so that no file name can pass for one of the marks
 *       ready       this app has copied the whole file in
 *       taken       the server started sending it
 *       progress    how far the server got, in percent
 *       sent        the computer saved it; holds the name it was saved as
 *       failed      it didn't go; holds why
 *       cancel      the person canceled it here
 *
 *     AdvancedSession tells whether an advanced mode session is live, and the computer's name.
 *
 * The dialog is a WebView showing share.html, share.js and share.css (android/app/src/main/share) from the app's own
 * files, with a strict Content Security Policy. This activity pushes each new state to the page with
 * window.__share(state), and the page calls back through the YesMachineShare bridge. A state is JSON whose "state" is
 * one of waiting, preparing (copying a file before sending it), sending, sent, failed, canceled, none (no computer is
 * connected) and nothing (nothing to send); while a file goes, it also has the computer's name, the file's name, size,
 * index and count, the percent done, and a detail, such as why it failed.
 */
public final class ShareActivity extends Activity {

    // The page's address. WebView never fetches it from the network: asset() answers every request from the app.
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    // Only the page's own scripts, styles and fonts, and data: images; nothing from anywhere else.
    private static final String POLICY =
        "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
    private static final long ROOM = 256L * 1024 * 1024; // what copying a file into the outbox must leave free
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final AtomicBoolean cancel = new AtomicBoolean(); // the person canceled; sending stops at its next check
    private volatile JSONObject state = state("waiting"); // what the dialog shows now
    private volatile boolean busy = true; // still sending, so Back cancels instead of closing
    private WebView page;

    // --- Activity lifecycle ---

    /** Shows the dialog's page, and starts sending the shared files on a thread of its own. */
    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        final List<Uri> files = shared(getIntent());
        page = new WebView(this);
        page.setBackgroundColor(Color.TRANSPARENT);
        WebSettings settings = page.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true); // the app's night or day choice
        // The page reaches nothing but its own files: no file or content URLs, no new windows, no cache.
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        page.addJavascriptInterface(new Bridge(), "YesMachineShare");
        page.setWebViewClient(
            new WebViewClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(
                    WebView view,
                    WebResourceRequest request
                ) {
                    return asset(request);
                }

                // The page never goes anywhere else.
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    return true;
                }
            }
        );
        setContentView(page);
        page.loadUrl(ORIGIN + "/share.html");
        new Thread(() -> send(files), "share-send").start();
    }

    /** Back cancels the files while they go, and closes the dialog once they're done. */
    @Override
    public void onBackPressed() {
        if (busy) cancel.set(true);
        else finish();
    }

    /** Leaving the dialog for good cancels what is still going. */
    @Override
    protected void onDestroy() {
        if (isFinishing()) cancel.set(true);
        if (page != null) page.destroy();
        super.onDestroy();
    }

    // --- The shared files ---

    /**
     * The files shared with this activity: content the sending app lets this app read, never a path. Anything that
     * isn't a content: URI is left out.
     */
    private static List<Uri> shared(Intent intent) {
        List<Uri> uris = new ArrayList<>();
        if (intent == null) return uris;
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri != null) uris.add(uri);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) {
            ArrayList<Parcelable> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) for (Parcelable each : list)
                if (each instanceof Uri) uris.add((Uri) each);
        }
        uris.removeIf(uri -> !"content".equals(uri.getScheme()));
        return uris;
    }

    // --- What the dialog shows ---

    /** A state with only its name, such as "waiting". */
    private static JSONObject state(String name) {
        JSONObject json = new JSONObject();
        try {
            json.put("state", name);
        } catch (Exception ignored) {}
        return json;
    }

    /** Makes next the dialog's state, and shows it on the page from the main thread. */
    private void show(JSONObject next) {
        state = next;
        ui.post(() -> {
            if (page != null) page.evaluateJavascript(
                "window.__share&&window.__share(" + next + ")",
                null
            );
        });
    }

    /**
     * Shows a state about one file: name is the state's name, computer the computer's name, file the file's name,
     * size its size in bytes (-1 when unknown), index its place among count files (from 1), percent how far it got,
     * and detail any more to say, such as why it failed.
     */
    private void show(
        String name,
        String computer,
        String file,
        long size,
        int index,
        int count,
        int percent,
        String detail
    ) {
        JSONObject next = state(name);
        try {
            next.put("computer", computer)
                .put("name", file)
                .put("size", size)
                .put("index", index)
                .put("count", count)
                .put("percent", percent)
                .put("detail", detail);
        } catch (Exception ignored) {}
        show(next);
    }

    // --- Sending ---

    /**
     * Sends the files one after another, on the "share-send" thread, through general mode's file connection or
     * advanced mode's outbox, and shows how it goes. Stops at the first file that fails, or when the person cancels.
     */
    private void send(List<Uri> files) {
        try {
            if (files.isEmpty()) {
                show(state("nothing"));
                return;
            }
            // General mode while a computer in control has its file connection open; otherwise advanced mode, when
            // its server's heartbeat says a session is live.
            ShareService service = ShareService.current;
            FileChannel channel = service == null ? null : service.files();
            String beat = AdvancedSession.read();
            boolean advanced =
                channel == null && AdvancedSession.live(beat, SystemClock.elapsedRealtime());
            if (channel == null && !advanced) {
                show(state("none"));
                return;
            }
            String computer = channel != null ? service.computer() : AdvancedSession.computer(beat);
            if (computer == null || computer.isEmpty()) computer = "the computer";
            String last = "";
            for (int i = 0; i < files.size(); i++) {
                Uri uri = files.get(i);
                String[] described = describe(uri);
                String name = FileChannel.safeName(described[0]);
                long size = Long.parseLong(described[1]);
                last = name;
                FileChannel.Result result = advanced
                    ? throughOutbox(uri, name, size, computer, i + 1, files.size())
                    : directly(channel, uri, name, size, computer, i + 1, files.size());
                if (cancel.get()) {
                    show(state("canceled"));
                    return;
                }
                if (!result.saved) {
                    show("failed", computer, name, size, i + 1, files.size(), 0, result.text);
                    return;
                }
            }
            show("sent", computer, last, -1, files.size(), files.size(), 100, "");
        } catch (SecurityException denied) {
            show(
                "failed",
                "",
                "",
                -1,
                0,
                0,
                0,
                "The app that shared it didn’t let Yes Machine read the file."
            );
        } catch (Exception failed) {
            String message = failed.getMessage();
            show(
                "failed",
                "",
                "",
                -1,
                0,
                0,
                0,
                cancel.get()
                    ? "Canceled."
                    : message == null || message.isEmpty()
                      ? "The file didn’t go."
                      : message
            );
        } finally {
            busy = false;
        }
    }

    /**
     * A shared file's name and size, as the app that shares it says: { name, size }, the size as text and -1 when
     * that app doesn't say. Without a name, it's the last part of the URI, or "file".
     */
    private String[] describe(Uri uri) {
        String name = uri.getLastPathSegment() == null ? "file" : uri.getLastPathSegment();
        long size = -1;
        try (
            Cursor row = getContentResolver().query(
                uri,
                new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE },
                null,
                null,
                null
            )
        ) {
            if (row != null && row.moveToFirst()) {
                if (!row.isNull(0)) name = row.getString(0);
                if (!row.isNull(1)) size = row.getLong(1);
            }
        } catch (Exception unknown) {}
        return new String[] { name, String.valueOf(size) };
    }

    /**
     * General mode: sends one file straight over the file connection, and returns the computer's answer. The
     * connection needs the size before the file, so a file whose size isn't known is first copied to the cache, to
     * know it. index and count say which file this is, for the dialog.
     */
    private FileChannel.Result directly(
        FileChannel channel,
        Uri uri,
        String name,
        long size,
        String computer,
        int index,
        int count
    ) throws IOException {
        File copy = null;
        try {
            if (size < 0) {
                copy = File.createTempFile("ym-share-", ".tmp", getCacheDir());
                copy(uri, copy, name, size, computer, index, count);
                size = copy.length();
            }
            final long total = size;
            show("sending", computer, name, total, index, count, 0, "");
            try (
                InputStream source = copy != null
                    ? new FileInputStream(copy)
                    : getContentResolver().openInputStream(uri)
            ) {
                if (source == null) throw new IOException(
                    "The app that shared it didn’t give the file."
                );
                return channel.send(
                    name,
                    total,
                    source,
                    // The dialog hears about each whole percent once.
                    new FileChannel.Progress() {
                        int reported = -1;

                        @Override
                        public void at(long sent, long all) {
                            int percent = (int) ((sent * 100) / Math.max(1, all));
                            if (percent != reported) {
                                reported = percent;
                                show("sending", computer, name, all, index, count, percent, "");
                            }
                        }
                    },
                    cancel
                );
            }
        } finally {
            if (copy != null) copy.delete();
        }
    }

    /**
     * Advanced mode: copies one file into a new outbox folder and marks it ready, then follows the marks the server
     * writes there (see the class comment) until it says sent or failed, and returns that. Gives up when the server
     * hasn't taken the file within 10 seconds, or when its progress hasn't moved for a minute. The folder is deleted
     * at the end, however it ends.
     */
    private FileChannel.Result throughOutbox(
        Uri uri,
        String name,
        long size,
        String computer,
        int index,
        int count
    ) throws IOException {
        File outbox = new File(getExternalFilesDir(null), "outbox");
        sweep(outbox);
        // The folder's name starts with the time, so the server, which goes through folders in name order, sends
        // files in the order they were shared.
        File folder = new File(
            outbox,
            System.currentTimeMillis() + "-" + UUID.randomUUID().toString().substring(0, 8)
        );
        if (!folder.mkdirs()) throw new IOException("Yes Machine couldn’t get the file ready.");
        try {
            if (size >= 0 && folder.getUsableSpace() < size + ROOM) throw new IOException(
                "The device doesn’t have room to get that file ready."
            );
            File box = new File(folder, "file");
            if (!box.mkdirs()) throw new IOException("Yes Machine couldn’t get the file ready.");
            File copy = new File(box, name);
            copy(uri, copy, name, size, computer, index, count);
            long total = copy.length();
            if (cancel.get()) return new FileChannel.Result(false, "Canceled.");
            // The server sends only folders marked ready, so it never sees a file half copied.
            if (!new File(folder, "ready").createNewFile()) throw new IOException(
                "Yes Machine couldn’t get the file ready."
            );
            show("sending", computer, name, total, index, count, 0, "");
            long started = SystemClock.uptimeMillis(),
                changed = started;
            String progress = "";
            // Looks at the marks four times a second.
            while (true) {
                SystemClock.sleep(250);
                if (cancel.get()) {
                    new File(folder, "cancel").createNewFile();
                    return new FileChannel.Result(false, "Canceled.");
                }
                File sent = new File(folder, "sent"),
                    failed = new File(folder, "failed");
                if (sent.exists()) return new FileChannel.Result(true, read(sent));
                if (failed.exists()) return new FileChannel.Result(false, read(failed));
                String now = read(new File(folder, "progress"));
                if (!now.equals(progress)) {
                    progress = now;
                    changed = SystemClock.uptimeMillis();
                    try {
                        show(
                            "sending",
                            computer,
                            name,
                            total,
                            index,
                            count,
                            Integer.parseInt(now.trim()),
                            ""
                        );
                    } catch (NumberFormatException ignored) {}
                }
                // Not taken within 10 seconds: no server is there to take it. Taken, but no progress for a minute:
                // the transfer is stuck.
                boolean taken = new File(folder, "taken").exists();
                if (
                    !taken && SystemClock.uptimeMillis() - started > 10_000
                ) return new FileChannel.Result(
                    false,
                    "The computer didn’t take the file. Check that it’s still connected."
                );
                if (
                    taken && SystemClock.uptimeMillis() - changed > 60_000
                ) return new FileChannel.Result(false, "The transfer stopped.");
            }
        } finally {
            delete(folder);
        }
    }

    /**
     * Copies a shared file to target, showing the preparing state with how far it got (when the size is known). The
     * other arguments are for the dialog, as in show(). Returns early, leaving part of the file, when the person
     * cancels; throws when the file grows past FileChannel.LIMIT.
     */
    private void copy(
        Uri uri,
        File target,
        String name,
        long size,
        String computer,
        int index,
        int count
    ) throws IOException {
        show("preparing", computer, name, size, index, count, 0, "");
        try (
            InputStream source = getContentResolver().openInputStream(uri);
            OutputStream out = new FileOutputStream(target)
        ) {
            if (source == null) throw new IOException(
                "The app that shared it didn’t give the file."
            );
            byte[] chunk = new byte[256 * 1024];
            long done = 0;
            int reported = -1;
            for (int read; (read = source.read(chunk)) != -1; ) {
                if (cancel.get()) return;
                out.write(chunk, 0, read);
                done += read;
                if (done > FileChannel.LIMIT) throw new IOException(
                    "Files must be 10 GB or smaller."
                );
                int percent = size > 0 ? (int) Math.min(100, (done * 100) / size) : 0;
                if (percent != reported) {
                    reported = percent;
                    show("preparing", computer, name, size, index, count, percent, "");
                }
            }
        }
    }

    // --- Outbox helpers ---

    /**
     * Deletes outbox folders more than ten minutes old: ones a send left behind without cleaning up, such as when the
     * app was stopped.
     */
    private static void sweep(File outbox) {
        File[] old = outbox.listFiles();
        if (old != null) for (File folder : old)
            if (System.currentTimeMillis() - folder.lastModified() > 10 * 60_000) delete(folder);
    }

    /** Deletes a file, or a folder and everything in it. */
    private static void delete(File file) {
        File[] inside = file.listFiles();
        if (inside != null) for (File each : inside) delete(each);
        file.delete();
    }

    /** A mark's text (its first 2 KB, as UTF-8), or "" when it isn't there or can't be read. */
    private static String read(File file) {
        if (!file.exists()) return "";
        try (InputStream in = new FileInputStream(file)) {
            byte[] bytes = new byte[2048];
            int length = 0;
            for (
                int count;
                length < bytes.length &&
                (count = in.read(bytes, length, bytes.length - length)) != -1;

            ) length += count;
            return new String(bytes, 0, length, StandardCharsets.UTF_8);
        } catch (IOException unreadable) {
            return "";
        }
    }

    // --- The dialog's page ---

    /**
     * What the dialog's page may call, as window.YesMachineShare. The page's calls arrive on a WebView thread, so the
     * ones that change the activity go to the main thread.
     */
    private final class Bridge {

        /** The current state, as JSON, for the page to show when it loads. */
        @JavascriptInterface
        public String state() {
            return state.toString();
        }

        /** The Cancel button: stops sending. */
        @JavascriptInterface
        public void cancel() {
            cancel.set(true);
        }

        /** The OK and Close buttons: close the dialog. */
        @JavascriptInterface
        public void close() {
            ui.post(ShareActivity.this::finish);
        }

        /** Open Yes Machine, offered when no computer is connected: opens the app and closes the dialog. */
        @JavascriptInterface
        public void openApp() {
            ui.post(() -> {
                startActivity(
                    new Intent(ShareActivity.this, MainActivity.class).addFlags(
                        Intent.FLAG_ACTIVITY_NEW_TASK
                    )
                );
                finish();
            });
        }
    }

    /**
     * Answers the page's requests from the app's own files only: GET requests to ORIGIN for the dialog's page, its
     * scripts and styles, and the bundled fonts. Anything else gets an empty 403. Every answer carries the Content
     * Security Policy and forbids caching and guessing the type.
     */
    private WebResourceResponse asset(WebResourceRequest request) {
        Uri uri = request.getUrl();
        String path = uri.getPath() == null ? "" : uri.getPath(),
            file = null,
            mime = null;
        if (
            "GET".equals(request.getMethod()) &&
            "https".equals(uri.getScheme()) &&
            "appassets.androidplatform.net".equals(uri.getHost()) &&
            uri.getPort() == -1 &&
            uri.getQuery() == null
        ) {
            // The page's files, by the path the page asks for, and the asset that answers it.
            Map<String, String> files = new HashMap<>();
            files.put("/share.html", "share.html");
            files.put("/share.js", "share.js");
            files.put("/share.css", "share.css");
            files.put("/host.css", "host.css");
            files.put("/home.css", "home.css");
            files.put("/pixel-icons.js", "pixel-icons.js");
            files.put("/theme.js", "theme.js");
            file = files.get(path);
            // Fonts are asked for under /fonts/, or under /public/fonts/ from host.css, which is written for the
            // desktop app's folders.
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
}
