package local.yesmachine.android;

import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;
import org.json.JSONObject;

/**
 * The viewer page's connection to one computer, as window.YesMachineNative. MainActivity attaches it only to the
 * bundled viewer (client.html), whose android-bridge.js replaces the browser's WebSocket with one backed by this
 * class, so the unchanged viewer code talks to the computer through Java, over an OkHttp client pinned to that
 * computer's approved certificate (TlsPins). The page can only reach the computer chosen on the home screen: nothing
 * here takes a URL, an address or a file path from the page.
 *
 * What it does for the page:
 * - The session WebSocket, wss://<computer>/session. The page numbers each socket it opens, and hears of it through
 *   Listener.event() as "open", "message", "close" or "error". Only the message types the viewer needs to send are
 *   let out (OUTGOING).
 * - Files the computer sends. The computer offers each file at a one-time HTTPS address ("download-offer"); this
 *   class downloads it into the app's cache over the pinned client, then Listener.save() asks the person where to
 *   save it. The older way, the file in base64 chunks over the session ("download-start", "download-chunk",
 *   "download-end"), is still accepted. One file at a time, up to 10 GB.
 * - The device's clipboard, for the viewer's shared clipboard and its clipboard buttons, up to about 60 KB of text.
 *   The text itself travels to the computer through the viewer's WebRTC connection, not through this class.
 *
 * The page calls in on a WebView thread and OkHttp calls back on its own threads, so the state is guarded by this
 * object's lock. Each new socket gets a new generation, and callbacks from an older socket are ignored.
 */
public final class NativeSession {

    /** How the session reaches MainActivity, which passes things on to the viewer page. */
    interface Listener {
        /**
         * A socket event for the page: type is "open", "message", "close" or "error", and value is the message's text,
         * the reason the socket closed, the error to show, or empty.
         */
        void event(int id, String type, String value);

        /** A short notice to show in the viewer. */
        void notice(String text);

        /**
         * A received file is ready in the cache: ask the person where to save it, as name, then run finished, which
         * deletes the cached copy, whether the file was saved or not.
         */
        void save(File file, String name, Runnable finished);
    }

    // What the page may send to the computer: the sign-in ticket, the WebRTC answer and ICE candidates, and the parts
    // of a file the person sends.
    private static final Set<String> OUTGOING = new HashSet<>(
        Arrays.asList("ticket", "answer", "ice", "file-start", "file-chunk", "file-end")
    );
    private final Context context;
    private final HostEndpoint host;
    private final OkHttpClient client;
    private final Listener listener;
    // The open session socket and the page's number for it. generation changes with each new socket and disconnect.
    private WebSocket socket;
    private int socketId;
    private long generation;
    private boolean destroyed;
    // The file the computer is sending: its copy in the cache, the stream writing it (base64 chunks only), its id, name
    // and declared size, the bytes written so far (base64 chunks only), whether it waits for the person to save it,
    // and the download in progress (offered files only).
    private File transferFile;
    private FileOutputStream transferStream;
    private String transferId, transferName;
    private long transferSize, received;
    private boolean pendingSave;
    private Call transferCall;

    /** A session with the computer over a client pinned to its approved fingerprint; throws if it isn't a valid pin. */
    NativeSession(Context context, HostEndpoint host, String fingerprint, Listener listener)
        throws Exception {
        this.context = context;
        this.host = host;
        this.listener = listener;
        client = TlsPins.client(host, fingerprint);
        clipStamp = clipStamp(); // what was copied before the session began stays on this device
    }

    // --- The session socket, for android-bridge.js ---

    /**
     * Opens the session WebSocket to the computer for the page's socket number id, replacing any earlier socket. The
     * Origin header is the computer's own origin, which the computer requires.
     */
    @JavascriptInterface
    public synchronized void open(int id) {
        if (destroyed || id < 1) return;
        disconnect();
        socketId = id;
        final long token = ++generation;
        Request request = new Request.Builder()
            .url("wss://" + host.authority() + "/session")
            .header("Origin", host.origin())
            .build();
        socket = client.newWebSocket(
            request,
            new WebSocketListener() {
                @Override
                public void onOpen(WebSocket webSocket, Response response) {
                    synchronized (NativeSession.this) {
                        if (destroyed || token != generation) {
                            webSocket.cancel();
                            return;
                        }
                        listener.event(id, "open", "");
                    }
                }

                @Override
                public void onMessage(WebSocket webSocket, String text) {
                    synchronized (NativeSession.this) {
                        if (destroyed || token != generation) return;
                        try {
                            if (
                                text.length() > 110000 ||
                                text.getBytes(StandardCharsets.UTF_8).length > 110000
                            ) throw new Exception("A host message exceeded the size limit.");
                            JSONObject message = new JSONObject(text);
                            // Files are handled here; every other message goes to the page as it came.
                            if (message.optString("type").startsWith("download-")) handleDownload(
                                message
                            );
                            else listener.event(id, "message", text);
                        } catch (Exception error) {
                            // A message too big or not JSON, or a file this device can't take, stops the file
                            // transfer in progress. The session stays open.
                            cleanupTransfer();
                            listener.notice("Transfer stopped: " + safeError(error));
                        }
                    }
                }

                // The computer only sends text; a binary message closes the socket (1003, data it can't accept).
                @Override
                public void onMessage(WebSocket webSocket, ByteString bytes) {
                    webSocket.close(1003, "Text messages required");
                }

                // The computer is closing: answer with the same code, to complete the closing handshake.
                @Override
                public void onClosing(WebSocket webSocket, int code, String reason) {
                    webSocket.close(code, reason);
                }

                @Override
                public void onClosed(WebSocket webSocket, int code, String reason) {
                    synchronized (NativeSession.this) {
                        if (token == generation && !destroyed) {
                            socket = null;
                            cleanupTransfer();
                            listener.event(id, "close", reason);
                        }
                    }
                }

                @Override
                public void onFailure(WebSocket webSocket, Throwable error, Response response) {
                    synchronized (NativeSession.this) {
                        if (token == generation && !destroyed) {
                            socket = null;
                            cleanupTransfer();
                            listener.event(
                                id,
                                "error",
                                "The verified host connection failed. Check that sharing is active, then reconnect."
                            );
                            listener.event(id, "close", "Connection failed");
                        }
                    }
                }
            }
        );
    }

    /**
     * Sends a message from the page on its current socket. It must be at most 100,000 characters and bytes (the
     * computer's limit) and of a type the page may send (OUTGOING). Returns false when it isn't sent, also when more
     * than 2 MiB is already waiting to go, so the page knows the connection is busy.
     */
    @JavascriptInterface
    public synchronized boolean send(int id, String text) {
        if (
            destroyed ||
            socket == null ||
            id != socketId ||
            text == null ||
            text.length() > 100000 ||
            text.getBytes(StandardCharsets.UTF_8).length > 100000
        ) return false;
        try {
            if (!OUTGOING.contains(new JSONObject(text).optString("type"))) return false;
        } catch (Exception ignored) {
            return false;
        }
        return socket.queueSize() <= 2 * 1024 * 1024 && socket.send(text);
    }

    /** The bytes still waiting to be sent on the page's socket, for its WebSocket's bufferedAmount. */
    @JavascriptInterface
    public synchronized long queued(int id) {
        return id == socketId && socket != null ? socket.queueSize() : 0;
    }

    /** Closes the page's socket, if it's still the current one. */
    @JavascriptInterface
    public synchronized void close(int id) {
        if (id == socketId) disconnect();
    }

    // --- The clipboard ---

    // The shared clipboard first asks whether anything was copied since it last looked (clipboardChanged), and reads
    // the clipboard only when something was. Android tells the person whenever an app reads what's on the clipboard,
    // so that notice appears only when there's something new; checking when the clip was copied doesn't read it. What
    // this app writes to the clipboard itself doesn't count as new.
    private long clipStamp;

    /** Whether something was copied since the last call, or since the session began. */
    @JavascriptInterface
    public synchronized boolean clipboardChanged() {
        long stamp = clipStamp();
        boolean changed = stamp != clipStamp;
        clipStamp = stamp;
        return changed;
    }

    /** When the current clip was copied, or 0 when the clipboard is empty. */
    private long clipStamp() {
        ClipDescription description = (
            (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE)
        ).getPrimaryClipDescription();
        return description == null ? 0 : description.getTimestamp();
    }

    /**
     * The clipboard's text, or "" when it holds no text or more than 60,000 bytes of it. The viewer calls this for its
     * Paste button, and for the shared clipboard when something new was copied, as the person comes back to the
     * viewer or pastes into it. Nothing reads clipboard content during discovery, navigation, sign-in or reconnect.
     */
    @JavascriptInterface
    public String readClipboard() {
        ClipboardManager clipboard = (ClipboardManager) context.getSystemService(
            Context.CLIPBOARD_SERVICE
        );
        ClipData clip = clipboard.getPrimaryClip();
        if (clip == null || clip.getItemCount() < 1) return "";
        CharSequence text = clip.getItemAt(0).getText();
        if (text == null) return "";
        String value = text.toString();
        return value.getBytes(StandardCharsets.UTF_8).length <= 60000 ? value : "";
    }

    /**
     * Puts text on the device's clipboard, labeled "Yes Machine". Returns false for more than 60,000 bytes. The new
     * clip's timestamp is remembered, so clipboardChanged() doesn't report it as something new to send back.
     */
    @JavascriptInterface
    public boolean writeClipboard(String text) {
        if (text == null || text.getBytes(StandardCharsets.UTF_8).length > 60000) return false;
        ClipboardManager clipboard = (ClipboardManager) context.getSystemService(
            Context.CLIPBOARD_SERVICE
        );
        clipboard.setPrimaryClip(ClipData.newPlainText("Yes Machine", text));
        synchronized (this) {
            clipStamp = clipStamp();
        }
        return true;
    }

    // --- Files the computer sends ---

    /**
     * Handles one of the computer's "download-…" messages, with the lock held. Throws when a message breaks the
     * rules, and the caller then stops the transfer.
     * - download-offer: a file at a one-time address, which take() downloads.
     * - download-progress, and download-end of an offered file: nothing to do, since take() counts the bytes itself.
     * - download-start, download-chunk, download-end: the older way, the file in base64 chunks over the session.
     * - download-error: the computer couldn't send the file.
     * While a received file waits for the person to save it, these messages are ignored.
     */
    private void handleDownload(JSONObject message) throws Exception {
        String type = message.optString("type"),
            id = message.optString("id");
        if (pendingSave) {
            if (type.equals("download-start")) listener.notice(
                "Finish saving the current file before receiving another one."
            );
            return;
        }
        if (type.equals("download-error")) {
            cleanupTransfer();
            listener.notice("The host could not finish sending the file.");
            return;
        }
        if (type.equals("download-offer")) {
            take(message, id);
            return;
        }
        // The computer reports how an offered file is going; this side counts what arrives itself.
        if (
            type.equals("download-progress") ||
            (type.equals("download-end") && transferCall != null)
        ) return;
        if (type.equals("download-start")) {
            if (transferFile != null || pendingSave) throw new Exception(
                "Finish saving the current file first."
            );
            // The size must be a whole number of at most 10 GiB that fits in the cache with 256 MiB to spare, and the
            // id 1 to 128 characters long.
            Object size = message.opt("size");
            if (
                !(size instanceof Number) ||
                ((Number) size).doubleValue() != ((Number) size).longValue()
            ) throw new Exception("Invalid file size.");
            transferSize = ((Number) size).longValue();
            if (
                transferSize < 0 ||
                transferSize > 10L * 1024 * 1024 * 1024 ||
                id.isEmpty() ||
                id.length() > 128
            ) throw new Exception("Files must be 10 GB or smaller.");
            if (
                transferSize + 256L * 1024 * 1024 > context.getCacheDir().getUsableSpace()
            ) throw new Exception("This device doesn't have room for that file.");
            transferId = id;
            received = 0;
            // A name safe to suggest when saving: no path separators, control characters or characters Windows
            // forbids, not "." or "..", and at most 180 characters.
            transferName = message
                .optString("name", "received-file")
                .replaceAll("[\\\\/\\p{Cntrl}<>:\"|?*]", "_");
            if (
                transferName.trim().isEmpty() ||
                transferName.equals(".") ||
                transferName.equals("..")
            ) transferName = "received-file";
            if (transferName.length() > 180) transferName = transferName.substring(0, 180);
            transferFile = File.createTempFile("ym-receive-", ".tmp", context.getCacheDir());
            transferStream = new FileOutputStream(transferFile);
            listener.notice("Receiving " + transferName + "…");
            return;
        }
        // A chunk or the end must belong to the file being received.
        if (transferFile == null || pendingSave || !id.equals(transferId)) throw new Exception(
            "Unexpected file transfer message."
        );
        if (type.equals("download-chunk")) {
            // Standard padded base64, at most 65,536 characters (48 KiB of data) a chunk.
            String base64 = message.optString("data");
            if (
                base64.length() > 65536 ||
                !base64.matches("(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?")
            ) throw new Exception("Invalid file chunk.");
            byte[] bytes = Base64.decode(base64, Base64.NO_WRAP);
            if (received + bytes.length > transferSize) throw new Exception(
                "File exceeded its declared size."
            );
            transferStream.write(bytes);
            received += bytes.length;
        } else if (type.equals("download-end")) {
            if (received != transferSize) throw new Exception("The file was incomplete.");
            transferStream.close();
            transferStream = null;
            pendingSave = true;
            File readyFile = transferFile;
            // Run once the person has saved the file or not: delete the cached copy, and forget the transfer unless
            // another one has started since.
            listener.save(readyFile, transferName, () -> {
                synchronized (NativeSession.this) {
                    if (transferFile == readyFile) cleanupTransfer();
                    else readyFile.delete();
                }
            });
        } else throw new Exception("Unknown file transfer request.");
    }

    /**
     * A file the computer offers: downloaded from its one-time address (/download/ and 48 hex digits) over this
     * session's verified connection, into the cache, then saved where the person chooses, as a file sent in chunks
     * is. The checks on the size and name are the same as for download-start. The download runs on OkHttp's threads.
     */
    private void take(JSONObject message, String id) throws Exception {
        if (transferFile != null || pendingSave) throw new Exception(
            "Finish saving the current file first."
        );
        Object size = message.opt("size");
        String path = message.optString("path");
        if (
            !(size instanceof Number) ||
            ((Number) size).doubleValue() != ((Number) size).longValue()
        ) throw new Exception("Invalid file size.");
        long expected = ((Number) size).longValue();
        if (
            expected < 0 ||
            expected > 10L * 1024 * 1024 * 1024 ||
            id.isEmpty() ||
            id.length() > 128 ||
            !path.matches("/download/[0-9a-f]{48}")
        ) throw new Exception("Files must be 10 GB or smaller.");
        if (
            expected + 256L * 1024 * 1024 > context.getCacheDir().getUsableSpace()
        ) throw new Exception("This device doesn't have room for that file.");
        String name = message
            .optString("name", "received-file")
            .replaceAll("[\\\\/\\p{Cntrl}<>:\"|?*]", "_");
        if (name.trim().isEmpty() || name.equals(".") || name.equals("..")) name = "received-file";
        if (name.length() > 180) name = name.substring(0, 180);
        final File file = File.createTempFile("ym-receive-", ".tmp", context.getCacheDir());
        final String saveAs = name;
        transferId = id;
        transferName = name;
        transferSize = expected;
        transferFile = file;
        listener.notice("Receiving " + name + "…");
        transferCall = client.newCall(new Request.Builder().url(host.origin() + path).build());
        transferCall.enqueue(
            new Callback() {
                @Override
                public void onFailure(Call call, IOException error) {
                    stopped(file);
                }

                @Override
                public void onResponse(Call call, Response response) {
                    // The file is written without holding the lock. If the transfer is stopped meanwhile, the call is
                    // canceled and the read fails.
                    try (
                        Response closing = response;
                        InputStream in = response.body().byteStream();
                        FileOutputStream out = new FileOutputStream(file)
                    ) {
                        if (response.code() != 200) throw new IOException(
                            "The host answered " + response.code() + "."
                        );
                        byte[] buffer = new byte[256 * 1024];
                        long total = 0;
                        for (int count; (count = in.read(buffer)) != -1; ) {
                            total += count;
                            if (total > expected) throw new IOException(
                                "The file exceeded its declared size."
                            );
                            out.write(buffer, 0, count);
                        }
                        if (total != expected) throw new IOException("The file was incomplete.");
                    } catch (IOException error) {
                        stopped(file);
                        return;
                    }
                    synchronized (NativeSession.this) {
                        // Stopped, replaced by another transfer, or the session ended while downloading.
                        if (transferFile != file || destroyed) {
                            file.delete();
                            return;
                        }
                        transferCall = null;
                        pendingSave = true;
                        listener.save(file, saveAs, () -> {
                            synchronized (NativeSession.this) {
                                if (transferFile == file) cleanupTransfer();
                                else file.delete();
                            }
                        });
                    }
                }
            }
        );
    }

    /** An offered file's download failed: stops the transfer and says so, if it's still the current one. */
    private synchronized void stopped(File file) {
        if (transferFile != file) {
            file.delete();
            return;
        }
        cleanupTransfer();
        if (!destroyed) listener.notice(
            "Transfer stopped: the file didn't arrive. Ask the host to send it again."
        );
    }

    /**
     * Stops the file transfer, if any: cancels the download, closes and deletes the cached file, and forgets it, so a
     * new transfer can start. Called with the lock held.
     */
    private void cleanupTransfer() {
        if (transferCall != null) {
            transferCall.cancel();
            transferCall = null;
        }
        try {
            if (transferStream != null) transferStream.close();
        } catch (Exception ignored) {}
        if (transferFile != null) transferFile.delete();
        transferFile = null;
        transferStream = null;
        transferId = null;
        pendingSave = false;
        received = 0;
    }

    // --- Ending the session ---

    /**
     * Closes the socket without telling the page, and stops any file transfer. The old socket's late callbacks are
     * ignored from now on (generation).
     */
    public synchronized void disconnect() {
        ++generation;
        if (socket != null) {
            socket.cancel();
            socket = null;
        }
        cleanupTransfer();
    }

    /** For when the app leaves the foreground: closes the session, and tells the page its socket closed. */
    public synchronized void pause() {
        boolean connected = socket != null;
        int id = socketId;
        disconnect();
        if (connected && !destroyed) listener.event(id, "close", "App left the foreground");
    }

    /** Ends the session for good, when the viewer closes: also shuts down the client's threads and connections. */
    public synchronized void destroy() {
        destroyed = true;
        disconnect();
        client.dispatcher().executorService().shutdown();
        client.connectionPool().evictAll();
    }

    /** The exception's message for a notice, or a general one when it has none. */
    private static String safeError(Exception error) {
        return error.getMessage() == null ? "Invalid host message." : error.getMessage();
    }
}
