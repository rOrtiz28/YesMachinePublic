package local.yesmachine.android;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.Point;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.Display;
import android.view.Surface;
import java.io.Closeable;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.cert.Certificate;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.SSLServerSocket;
import javax.net.ssl.SSLSocket;
import org.json.JSONObject;

/**
 * General mode's screen sharing: this device shares its screen with a computer on the same network.
 *
 * MainActivity starts this foreground service with ACTION_START once the person has accepted Android's prompt to
 * record the screen. The service then:
 *
 *   1. listens for computers on TLS port 4778, with this device's own certificate (DeviceIdentity), and announces
 *      itself on the network as _yes-machine-device._tcp;
 *   2. asks the person before letting a computer in, on the home screen and in a notification, unless they chose to
 *      always allow that computer (remembered by its certificate's fingerprint);
 *   3. records the screen into the hardware H.264 encoder and streams it, with what apps play (ShareSound), in the
 *      same format as advanced mode's stream server (android/stream, Server.java), so the desktop app's Android
 *      window shows both modes the same way;
 *   4. hands the computer's touches, keys and text to ControlService, the accessibility service that performs them.
 *
 * One computer is in control at a time. ShareState holds what the home screen shows about it. The computer's side of
 * all this is src/main/android/general-mode.cjs.
 *
 * Letting a computer in (big-endian): after the TLS handshake the computer sends "YMC1", then a 2-byte length and
 * JSON with its name and system. This device answers with a status byte: 2 (allowed), followed by the stream; or 0
 * (denied) or 3 (busy: another computer is in control), each followed by a 2-byte length and the reason in UTF-8.
 * When it has to ask the person first, it sends 1 (asking) before that answer.
 *
 * The stream starts with "YMS1", the width, the height and the encoder's name, then typed messages (Server.java
 * describes each one's fields). This device sends 1 video, 2 pong, 3 sound, 5 new screen size and 7 text copied here.
 * The computer sends 2 ping, 4 touch, 6 scroll, 7 key, 8 text, 9 on-screen keyboard, 10 text copied on the computer,
 * 11 whether to report what is copied here, and 12 a request to look at the clipboard now.
 *
 * Files: the computer in control may open a second connection to the same port, starting with "YMF1" instead of
 * "YMC1", for files (FileChannel).
 *
 * Shared clipboard: the computer's copies arrive as message 10 and go on this device's clipboard. Message 11 says
 * whether the computer wants this device's copies. While it does, the computer sends message 12 when the person there
 * leaves the device's window or copies in it, and this device answers with the text copied here since the computer
 * started wanting it (7). Android lets only the app in front read the clipboard, so ControlService reads it for a
 * moment from a window of its own.
 */
public final class ShareService extends Service {

    // Intent actions and extras. MainActivity sends ACTION_START with the screen recording consent (EXTRA_RESULT and
    // EXTRA_DATA, the result of Android's prompt); the notifications' buttons send the other actions.
    static final String ACTION_START = "local.yesmachine.android.START",
        ACTION_STOP = "local.yesmachine.android.STOP",
        ACTION_ALLOW = "local.yesmachine.android.ALLOW",
        ACTION_DENY = "local.yesmachine.android.DENY";
    static final String EXTRA_RESULT = "result",
        EXTRA_DATA = "data",
        EXTRA_REQUEST = "request"; // the id of the request that Allow or Deny answers
    static final int PORT = 4778;
    /** The running service, or null. The home screen and the share sheet reach it through this. */
    static volatile ShareService current;

    // Stream messages this device sends, by type byte.
    private static final byte VIDEO = 1,
        PONG = 2,
        SIZE = 5,
        COPIED = 7;
    // Stream messages the computer sends.
    private static final byte PING = 2,
        TOUCH = 4,
        SCROLL = 6,
        KEY = 7,
        TEXT = 8,
        KEYBOARD = 9,
        CLIPBOARD = 10,
        REPORT = 11,
        CHECK = 12;
    private static final int CLIPBOARD_LIMIT = 60000; // the most copied text that goes either way, in bytes
    // The status byte that answers the computer's hello.
    private static final byte DENIED = 0,
        ASKING = 1,
        ALLOWED = 2,
        BUSY = 3;
    // Notification ids: the ongoing one while sharing, and the question about a computer.
    private static final int SHARING = 1,
        ASK = 2;

    private MediaProjection projection; // the consent to record the screen, for as long as the service runs
    private VirtualDisplay display; // the screen's mirror into the encoder, made once and reused (see show())
    private SSLServerSocket listener;
    private NsdManager.RegistrationListener announcement; // the network announcement, to withdraw it at the end
    // The computer in control: its socket, certificate fingerprint, name and stream. The socket and the stream are
    // null while there is none; the fingerprint and the name stay those of the last one.
    private volatile Socket active;
    private volatile String activeFingerprint = "",
        activeName = "";
    private volatile DataOutputStream activeOut;
    private volatile FileChannel files; // its file connection, while there is one
    // The shared clipboard: whether the computer wants this device's copies, since when (System.currentTimeMillis()),
    // and the last text that went either way, so that it doesn't go back where it came from.
    private volatile boolean reporting;
    private volatile long reportSince;
    private volatile String lastCopied;
    // Sends copied text from a thread of its own: the clipboard is read on the main thread, which can't use the
    // network.
    private final ExecutorService clipboardSends = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    // The person's answer to the computer that asked: answered counts down once they answer, allowed says whether
    // they let it in, and always whether to let it in every time from now on.
    private volatile CountDownLatch answered;
    private volatile boolean allowed, always;
    private SharedPreferences remembered; // the computers always allowed: certificate fingerprint to computer name
    private volatile int width, height; // the size of the screen being streamed, in pixels

    // --- Service lifecycle ---

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /**
     * Handles the service's intents: ACTION_STOP stops sharing, ACTION_ALLOW and ACTION_DENY answer a computer from
     * the notification, and ACTION_START starts sharing with the screen recording consent it carries. A second
     * ACTION_START while sharing does nothing.
     */
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_ALLOW.equals(action) || ACTION_DENY.equals(action)) {
            // Allow in the notification also means always allow this computer.
            answer(intent.getStringExtra(EXTRA_REQUEST), ACTION_ALLOW.equals(action), true);
            return START_NOT_STICKY;
        }
        if (!ACTION_START.equals(action) || projection != null) return START_NOT_STICKY;
        current = this;
        remembered = getSharedPreferences("allowed-computers", MODE_PRIVATE);
        // A quiet channel for the ongoing notification, and an urgent one for the question about a computer.
        NotificationManager notifications = getSystemService(NotificationManager.class);
        notifications.createNotificationChannel(
            new NotificationChannel(
                "share",
                "Sharing this device",
                NotificationManager.IMPORTANCE_LOW
            )
        );
        notifications.createNotificationChannel(
            new NotificationChannel(
                "ask",
                "Computers asking to control this device",
                NotificationManager.IMPORTANCE_HIGH
            )
        );
        Notification sharing = new Notification.Builder(this, "share")
            .setSmallIcon(R.drawable.ic_launcher)
            .setOngoing(true)
            .setContentTitle("Yes Machine is sharing this device")
            .setContentText("Computers on this network can ask to control it.")
            .setContentIntent(home())
            .addAction(
                new Notification.Action.Builder(
                    null,
                    "Stop sharing",
                    service(ACTION_STOP, null, 1)
                ).build()
            )
            .build();
        // Android 10 and later want the service's type; Android 8 and 9 have only the plain call.
        if (Build.VERSION.SDK_INT >= 29) startForeground(
            SHARING,
            sharing,
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        );
        else startForeground(SHARING, sharing);
        MediaProjectionManager manager = getSystemService(MediaProjectionManager.class);
        projection = manager.getMediaProjection(
            intent.getIntExtra(EXTRA_RESULT, 0),
            intent.getParcelableExtra(EXTRA_DATA)
        );
        if (projection == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        // When Android ends the recording, as when the person stops it from the system's own controls, sharing ends.
        projection.registerCallback(
            new MediaProjection.Callback() {
                @Override
                public void onStop() {
                    stopSelf();
                }
            },
            new Handler(Looper.getMainLooper())
        );
        new Thread(this::serve, "share").start();
        ShareState.update("waiting", "");
        return START_NOT_STICKY;
    }

    /**
     * Stops everything: the listener, the computer in control, a question still waiting (answered as denied), the
     * network announcement, the mirror and the recording.
     */
    @Override
    public void onDestroy() {
        current = null;
        close(listener);
        disconnect();
        clipboardSends.shutdown();
        answer(ShareState.asking == null ? null : ShareState.asking.id, false, false);
        if (announcement != null) {
            try {
                getSystemService(NsdManager.class).unregisterService(announcement);
            } catch (Exception ignored) {}
        }
        if (display != null) display.release();
        if (projection != null) projection.stop();
        ShareState.update("off", "");
        super.onDestroy();
    }

    // --- Notification intents ---

    /** Opens the app's home screen, for tapping a notification. */
    private PendingIntent home() {
        return PendingIntent.getActivity(
            this,
            0,
            new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE
        );
    }

    /**
     * An intent that sends action to this service, for a notification's button. request is the id of the request the
     * button answers, or null, and code tells the buttons' intents apart.
     */
    private PendingIntent service(String action, String request, int code) {
        Intent intent = new Intent(this, ShareService.class)
            .setAction(action)
            .putExtra(EXTRA_REQUEST, request);
        return PendingIntent.getService(
            this,
            code,
            intent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
    }

    // --- Calls from the home screen and the share sheet ---

    /**
     * The person's answer to the computer that asked, from the home screen or the notification. id must be the id of
     * the request still waiting, or nothing happens. allow says whether to let the computer in, and rememberIt whether
     * to always let it in. Wakes ask(), which waits for this.
     */
    void answer(String id, boolean allow, boolean rememberIt) {
        ShareState.Request request = ShareState.asking;
        if (request == null || id == null || !id.equals(request.id)) return;
        allowed = allow;
        always = allow && rememberIt;
        getSystemService(NotificationManager.class).cancel(ASK);
        ShareState.ask(null);
        CountDownLatch latch = answered;
        if (latch != null) latch.countDown();
    }

    /** Ends the session of the computer in control, if there is one. */
    void disconnect() {
        close(active);
    }

    /** The file connection of the computer in control, while there is one, or null. Shared files go through it. */
    FileChannel files() {
        FileChannel channel = files;
        return channel != null && channel.isOpen() && active != null ? channel : null;
    }

    /** The name of the computer in control. After its session it's still that computer's name, "" before any. */
    String computer() {
        return activeName;
    }

    // --- Announcing this device and listening for computers ---

    /**
     * Closes a socket on a thread of its own, since closing a TLS socket says goodbye over the network, which Android
     * doesn't allow on the main thread. Does nothing for null.
     */
    private static void close(final Closeable socket) {
        if (socket == null) return;
        new Thread(() -> {
            try {
                socket.close();
            } catch (IOException ignored) {}
        }, "share-close").start();
    }

    /** "tablet" or "phone", for the announcement: a screen at least 600 dp wide on its short side is a tablet's. */
    String kind() {
        return getResources().getConfiguration().smallestScreenWidthDp >= 600 ? "tablet" : "phone";
    }

    /** The name the person gave the device in Settings, or its model when there is none. */
    static String deviceName(android.content.Context context) {
        String name = Settings.Global.getString(
            context.getContentResolver(),
            Settings.Global.DEVICE_NAME
        );
        return name == null || name.trim().isEmpty() ? Build.MODEL : name.trim();
    }

    /**
     * Announces this device on the network with DNS-SD, so computers find it: its name, system, platform, kind and
     * certificate fingerprint, in an announcement of format version 1.
     */
    private void announce(String fingerprint) {
        NsdServiceInfo info = new NsdServiceInfo();
        info.setServiceName(deviceName(this));
        info.setServiceType("_yes-machine-device._tcp");
        info.setPort(PORT);
        info.setAttribute("name", deviceName(this));
        info.setAttribute("system", "Android " + Build.VERSION.RELEASE);
        info.setAttribute("platform", "android");
        info.setAttribute("kind", kind());
        info.setAttribute("fingerprint", fingerprint);
        info.setAttribute("v", "1");
        // The announcement is best effort: nothing to do when it works or fails.
        announcement = new NsdManager.RegistrationListener() {
            @Override
            public void onServiceRegistered(NsdServiceInfo service) {}

            @Override
            public void onRegistrationFailed(NsdServiceInfo service, int error) {}

            @Override
            public void onServiceUnregistered(NsdServiceInfo service) {}

            @Override
            public void onUnregistrationFailed(NsdServiceInfo service, int error) {}
        };
        getSystemService(NsdManager.class).registerService(
            info,
            NsdManager.PROTOCOL_DNS_SD,
            announcement
        );
    }

    /**
     * Listens for computers until the listener closes, and welcomes each one on a thread of its own. Runs on the
     * "share" thread. If listening fails while the service still runs, sharing stops.
     */
    private void serve() {
        try (
            SSLServerSocket server =
                (SSLServerSocket) DeviceIdentity.serverSockets().createServerSocket()
        ) {
            listener = server;
            server.setReuseAddress(true); // the last session's connections may still be closing
            server.bind(new InetSocketAddress(PORT));
            // Ask each computer for its certificate, which the person can choose to always allow, without requiring
            // one: a computer without a certificate is asked about every time.
            server.setWantClientAuth(true);
            announce(DeviceIdentity.fingerprint());
            while (!server.isClosed()) {
                final SSLSocket socket = (SSLSocket) server.accept();
                new Thread(() -> welcome(socket), "share-computer").start();
            }
        } catch (Exception closed) {
            if (current == this) stopSelf();
        }
    }

    // --- Letting a computer in ---

    /**
     * Handles one connection from a computer, from its hello to the end of its session.
     *
     * A "YMF1" connection becomes the file connection of the computer in control. A "YMC1" connection asks to control
     * this device: it's refused while another computer is in control or waiting for an answer. Otherwise it's let in
     * at once when the person chose to always allow its certificate, or else once the person allows it here. Then it
     * gets the stream until it leaves or the person disconnects it. One computer at a time.
     */
    private void welcome(SSLSocket socket) {
        // The socket closes however this ends.
        try (Socket closing = socket) {
            socket.setSoTimeout(15_000); // for the handshake and the hello
            socket.startHandshake();
            DataInputStream in = new DataInputStream(socket.getInputStream());
            DataOutputStream out = new DataOutputStream(socket.getOutputStream());
            byte[] magic = new byte[4];
            in.readFully(magic);
            String kind = new String(magic, StandardCharsets.US_ASCII);
            if (!"YMC1".equals(kind) && !"YMF1".equals(kind)) return;
            byte[] hello = new byte[in.readUnsignedShort()];
            in.readFully(hello);
            JSONObject who = new JSONObject(new String(hello, StandardCharsets.UTF_8));
            // The name and system are shown to the person: an empty or overlong name becomes "A computer", and an
            // overlong system is left out.
            String name = who.optString("name", "A computer").trim(),
                system = who.optString("system", "").trim();
            if (name.isEmpty() || name.length() > 64) name = "A computer";
            if (system.length() > 64) system = "";
            Certificate[] chain = null;
            try {
                chain = socket.getSession().getPeerCertificates();
            } catch (Exception anonymous) {
                // The computer showed no certificate.
            }
            String fingerprint =
                chain == null || chain.length == 0 ? "" : DeviceIdentity.fingerprint(chain[0]);
            if ("YMF1".equals(kind)) {
                files(socket, in, out, fingerprint);
                return;
            }
            // A computer waiting for an answer counts as using the device too.
            if (active != null || ShareState.asking != null) {
                refuse(out, BUSY, "Another computer is using this device.");
                return;
            }
            // Not always allowed, or without a certificate to remember it by: the person decides.
            if (fingerprint.isEmpty() || !remembered.contains(fingerprint)) {
                out.writeByte(ASKING);
                out.flush();
                if (
                    !ask(
                        new ShareState.Request(
                            UUID.randomUUID().toString(),
                            name,
                            system,
                            socket.getInetAddress().getHostAddress(),
                            fingerprint
                        ),
                        socket,
                        in
                    )
                ) {
                    refuse(out, DENIED, "The person at the device didn't allow this computer.");
                    return;
                }
                if (always && !fingerprint.isEmpty()) remembered
                    .edit()
                    .putString(fingerprint, name)
                    .apply();
            }
            out.writeByte(ALLOWED);
            out.flush();
            socket.setSoTimeout(0); // from now on the computer may be quiet for as long as it likes
            activeFingerprint = fingerprint;
            activeName = name;
            activeOut = out;
            reporting = false;
            lastCopied = null;
            active = socket;
            ShareState.update("connected", name);
            // The on-screen keyboard stays hidden while the computer types, unless it asks for it (message 9).
            ControlService control = ControlService.current;
            if (control != null) control.keyboard(false);
            try {
                stream(out, in);
            } finally {
                // The session is over, however it ended.
                control = ControlService.current;
                if (control != null) control.keyboard(true);
                active = null;
                activeOut = null;
                reporting = false;
                FileChannel channel = files;
                if (channel != null) channel.close();
                if (current == this) ShareState.update("waiting", "");
            }
        } catch (Exception ended) {
            android.util.Log.i("YesMachine", "A computer's session ended: " + ended);
        }
    }

    /** Answers the computer's hello with status (DENIED or BUSY), then a 2-byte length and the reason, in UTF-8. */
    private void refuse(DataOutputStream out, byte status, String reason) throws IOException {
        byte[] text = reason.getBytes(StandardCharsets.UTF_8);
        out.writeByte(status);
        out.writeShort(text.length);
        out.write(text);
        out.flush();
    }

    /**
     * Asks the person whether to let a computer in, on the home screen (through ShareState) and in a notification,
     * and waits up to a minute for the answer. Returns whether they allowed it; always then says whether to remember
     * the computer.
     *
     * A computer that gives up meanwhile takes its question away. It sends nothing until it's allowed, so a read that
     * ends, with a byte, the end of the stream or an error, means it left. Each read waits 200 ms at most, so the loop
     * notices the person's answer.
     */
    private boolean ask(ShareState.Request request, Socket socket, InputStream in)
        throws IOException {
        allowed = false;
        always = false;
        answered = new CountDownLatch(1);
        ShareState.ask(request);
        Notification question = new Notification.Builder(this, "ask")
            .setSmallIcon(R.drawable.ic_launcher)
            .setAutoCancel(true)
            .setContentTitle(request.name + " wants to control this device")
            .setContentText("It will see the screen and can touch and type here.")
            .setContentIntent(home())
            .setTimeoutAfter(60_000)
            .setCategory(Notification.CATEGORY_MESSAGE)
            .addAction(
                new Notification.Action.Builder(
                    null,
                    "Deny",
                    service(ACTION_DENY, request.id, 2)
                ).build()
            )
            .addAction(
                new Notification.Action.Builder(
                    null,
                    "Allow",
                    service(ACTION_ALLOW, request.id, 3)
                ).build()
            )
            .build();
        try {
            getSystemService(NotificationManager.class).notify(ASK, question);
        } catch (SecurityException noPermission) {
            // Without permission to notify, the question shows only in the app.
        }
        socket.setSoTimeout(200);
        long deadline = SystemClock.uptimeMillis() + 60_000;
        while (answered.getCount() > 0 && SystemClock.uptimeMillis() < deadline) {
            try {
                in.read();
                break;
            } catch (SocketTimeoutException stillThere) {
                // no answer yet
            } catch (IOException left) {
                break;
            }
        }
        // No answer within the minute, or the computer left: that counts as denied, and the question goes away.
        if (answered.getCount() > 0) answer(request.id, false, false);
        return allowed;
    }

    // --- File connection ---

    /**
     * Serves a "YMF1" file connection until it closes. Only the computer in control may open one: its certificate
     * must be the one that was let in, or the connection is just closed. A new file connection replaces the one
     * before. Files that arrive are saved in Download and announced in a notification (Downloads).
     */
    private void files(
        final SSLSocket socket,
        DataInputStream in,
        DataOutputStream out,
        String fingerprint
    ) throws IOException {
        if (
            active == null || fingerprint.isEmpty() || !fingerprint.equals(activeFingerprint)
        ) return;
        socket.setSoTimeout(0); // quiet between files
        final String from = activeName;
        FileChannel channel = new FileChannel(
            in,
            out,
            Downloads.storage(this),
            (name, target) -> Downloads.announce(this, name, from, target),
            () -> close(socket)
        );
        FileChannel previous = files;
        files = channel;
        if (previous != null) previous.close();
        try {
            channel.serve();
        } finally {
            if (files == channel) files = null;
        }
    }

    // --- Shared clipboard ---

    /**
     * Puts text the computer copied (message 10) on this device's clipboard. It's remembered in lastCopied so that it
     * isn't sent back. The clipboard is set from the main thread, as Android likes it.
     */
    private void copiedThere(final String text) {
        lastCopied = text;
        main.post(() -> {
            try {
                getSystemService(ClipboardManager.class).setPrimaryClip(
                    ClipData.newPlainText("Yes Machine", text)
                );
            } catch (Exception refused) {}
        });
    }

    /**
     * Answers the computer's request to look at the clipboard (message 12). While the computer wants this device's
     * copies, sends the text copied here since it started asking (message 7), unless it's empty, the computer's own
     * copy, what was sent last, or more than CLIPBOARD_LIMIT bytes. ControlService does the reading.
     */
    private void checkClipboard() {
        ControlService control = ControlService.current;
        if (!reporting || control == null) return;
        // This callback runs on the main thread.
        control.readClipboard(clip -> {
            if (clip == null || clip.getItemCount() < 1 || !reporting) return;
            CharSequence text = clip.getItemAt(0).getText();
            // When the clip was copied, on the same clock as reportSince; 0 when Android doesn't say. Text copied
            // before the computer started asking stays here.
            long stamp = clip.getDescription() == null ? 0 : clip.getDescription().getTimestamp();
            if (text == null || text.length() == 0 || (stamp != 0 && stamp < reportSince)) return;
            final String value = text.toString();
            if (value.equals(lastCopied)) return;
            lastCopied = value;
            final byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
            final DataOutputStream out = activeOut;
            if (bytes.length > CLIPBOARD_LIMIT || out == null) return;
            clipboardSends.execute(() -> {
                try {
                    // The video and sound go on the same stream: each message is written whole, holding its lock.
                    synchronized (out) {
                        out.writeByte(COPIED);
                        out.writeInt(bytes.length);
                        out.write(bytes);
                        out.flush();
                    }
                } catch (IOException closed) {
                    /* the computer left */
                }
            });
        });
    }

    // --- Streaming the screen ---

    /** The screen's full size in pixels, as it is now: it swaps when the device turns. */
    private Point screenSize() {
        Display screen = getSystemService(DisplayManager.class).getDisplay(Display.DEFAULT_DISPLAY);
        Point size = new Point();
        screen.getRealSize(size);
        return size;
    }

    /**
     * Streams this device to the computer in control until the session ends: writes the stream's header, reads the
     * computer's messages on a thread of its own, sends what apps play (Android 10 and later), and encodes the screen
     * on this thread.
     */
    private void stream(final DataOutputStream out, final DataInputStream in) throws Exception {
        Point size = screenSize();
        // Rounded down to a multiple of 8, a size hardware encoders accept.
        width = size.x & ~7;
        height = size.y & ~7;
        MediaCodec codec = encoder();
        synchronized (out) {
            out.writeBytes("YMS1");
            out.writeInt(width);
            out.writeInt(height);
            byte[] name = codec.getName().getBytes(StandardCharsets.UTF_8);
            out.writeInt(name.length);
            out.write(name);
            out.flush();
        }
        // Cleared when the computer's side of the connection ends, which stops the encoding loop. It's an array so
        // that the reader's lambda can change it.
        final boolean[] open = { true };
        Thread reader = new Thread(() -> {
            try {
                read(in, out);
            } catch (Exception closed) {
                open[0] = false;
            }
        }, "share-input");
        reader.start();
        ShareSound sound =
            Build.VERSION.SDK_INT >= 29 ? ShareSound.start(this, projection, out) : null;
        try {
            show(codec, out, open);
        } finally {
            if (sound != null) sound.stop();
        }
    }

    /**
     * Mirrors the screen into the encoder and sends what it encodes, until the session ends. Each time the screen
     * changes size, as when the device turns, the computer gets a SIZE message (5) with the new size, and a new
     * encoder starts at that size.
     */
    private void show(MediaCodec codec, DataOutputStream out, boolean[] open) throws Exception {
        DisplayMetrics metrics = getResources().getDisplayMetrics();
        while (open[0]) {
            Surface surface = codec.createInputSurface();
            // Android 14 lets one consent to record make only one virtual display, so it's made once and then
            // resized and pointed at each new encoder, for every later size and session.
            if (display == null) {
                display = projection.createVirtualDisplay(
                    "Yes Machine",
                    width,
                    height,
                    metrics.densityDpi,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                    surface,
                    null,
                    null
                );
            } else {
                display.resize(width, height, metrics.densityDpi);
                display.setSurface(surface);
            }
            codec.start();
            boolean resized = send(codec, out, open);
            display.setSurface(null); // the mirror lets go of the encoder's surface before it goes away
            codec.stop();
            codec.release();
            surface.release();
            if (!resized) break;
            synchronized (out) {
                out.writeByte(SIZE);
                out.writeInt(width);
                out.writeInt(height);
                out.flush();
            }
            codec = encoder();
        }
    }

    /**
     * A hardware H.264 encoder at the current width and height, configured for low latency, whose input is a surface
     * (the screen's mirror).
     */
    private MediaCodec encoder() throws IOException {
        MediaCodec codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC);
        MediaFormat format = MediaFormat.createVideoFormat(
            MediaFormat.MIMETYPE_VIDEO_AVC,
            width,
            height
        );
        format.setInteger(
            MediaFormat.KEY_COLOR_FORMAT,
            MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface
        );
        // 8 Mbit/s at up to 60 frames per second, with a key frame every 10 seconds.
        format.setInteger(MediaFormat.KEY_BIT_RATE, 8_000_000);
        format.setInteger(MediaFormat.KEY_FRAME_RATE, 60);
        format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 10);
        // Encode the last frame again after 100 ms of stillness, so a static screen keeps the stream alive.
        format.setLong(MediaFormat.KEY_REPEAT_PREVIOUS_FRAME_AFTER, 100_000);
        if (Build.VERSION.SDK_INT >= 30) format.setInteger(MediaFormat.KEY_LOW_LATENCY, 1);
        format.setInteger(MediaFormat.KEY_PRIORITY, 0); // 0 asks for real-time priority
        codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
        return codec;
    }

    /**
     * Sends each encoded frame as a VIDEO message (1): its capture time in microseconds, its flags, its length and its
     * bytes. Returns true when the screen changes size, as when the device turns, with width and height set to the
     * new size (checked four times a second), and false when the session ends.
     */
    private boolean send(MediaCodec codec, DataOutputStream out, boolean[] open)
        throws IOException {
        MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
        byte[] copy = new byte[1 << 20];
        long checked = 0;
        while (open[0]) {
            // Waits up to 100 ms for a frame, so the checks below go on while the screen is still.
            int index = codec.dequeueOutputBuffer(info, 100_000);
            long now = SystemClock.uptimeMillis();
            if (now - checked > 250) {
                checked = now;
                Point size = screenSize();
                if ((size.x & ~7) != width || (size.y & ~7) != height) {
                    if (index >= 0) codec.releaseOutputBuffer(index, false);
                    width = size.x & ~7;
                    height = size.y & ~7;
                    return true;
                }
            }
            if (index < 0) continue;
            // The frame is copied out so the encoder gets its buffer back before the network write.
            ByteBuffer buffer = codec.getOutputBuffer(index);
            if (copy.length < info.size) copy = new byte[info.size * 2];
            buffer.position(info.offset);
            buffer.get(copy, 0, info.size);
            codec.releaseOutputBuffer(index, false);
            synchronized (out) {
                out.writeByte(VIDEO);
                out.writeLong(info.presentationTimeUs);
                out.writeByte(info.flags);
                out.writeInt(info.size);
                out.write(copy, 0, info.size);
                out.flush();
            }
        }
        return false;
    }

    // --- Messages from the computer ---

    /**
     * Reads the computer's messages until the connection ends, and acts on each: answers pings, passes input to
     * ControlService (input is dropped while Accessibility doesn't allow it), and handles the shared clipboard.
     * Coordinates arrive as fractions of the screen. Throws on a message it doesn't know.
     */
    private void read(DataInputStream in, DataOutputStream out) throws IOException {
        while (true) {
            byte type = in.readByte();
            ControlService control = ControlService.current;
            if (type == PING) {
                // The computer's time comes back with this device's clock, to measure the delay.
                long theirs = in.readLong();
                synchronized (out) {
                    out.writeByte(PONG);
                    out.writeLong(theirs);
                    out.writeLong(System.nanoTime());
                    out.flush();
                }
            } else if (type == TOUCH) {
                // 0 down, 1 up, 2 move.
                int action = in.readByte();
                float x = in.readFloat() * width,
                    y = in.readFloat() * height;
                if (control != null) control.touch(action, x, y);
            } else if (type == SCROLL) {
                float x = in.readFloat() * width,
                    y = in.readFloat() * height,
                    horizontal = in.readFloat(),
                    vertical = in.readFloat();
                if (control != null) control.scroll(x, y, horizontal, vertical);
            } else if (type == KEY) {
                // 0 is down and anything else up, then the Android key code and the meta state.
                int action = in.readByte() == 0 ? 0 : 1,
                    code = in.readInt(),
                    meta = in.readInt();
                if (control != null) control.key(action, code, meta);
            } else if (type == TEXT) {
                int length = in.readInt();
                if (length < 0 || length > 16_384) throw new IOException("Text too long");
                byte[] bytes = new byte[length];
                in.readFully(bytes);
                if (control != null) control.text(new String(bytes, StandardCharsets.UTF_8));
            } else if (type == KEYBOARD) {
                boolean show = in.readByte() == 1;
                if (control != null) control.keyboard(show);
            } else if (type == CLIPBOARD) {
                int length = in.readInt();
                if (length < 0 || length > CLIPBOARD_LIMIT) throw new IOException(
                    "Too much copied text"
                );
                byte[] bytes = new byte[length];
                in.readFully(bytes);
                copiedThere(new String(bytes, StandardCharsets.UTF_8));
            } else if (type == REPORT) {
                boolean on = in.readByte() == 1;
                // What was copied before stays here; only what is copied from now on goes across.
                if (on && !reporting) reportSince = System.currentTimeMillis();
                reporting = on;
            } else if (type == CHECK) {
                checkClipboard();
            } else {
                throw new IOException("Unknown message " + type);
            }
        }
    }
}
