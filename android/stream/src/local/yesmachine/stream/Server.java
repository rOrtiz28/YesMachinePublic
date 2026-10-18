package local.yesmachine.stream;

import android.content.ClipData;
import android.graphics.Rect;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.net.LocalServerSocket;
import android.net.LocalSocket;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.system.Os;
import android.system.OsConstants;
import android.view.InputDevice;
import android.view.InputEvent;
import android.view.KeyCharacterMap;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.Surface;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.FileDescriptor;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.Arrays;

/**
 * Yes Machine's advanced mode on an Android device: the server that runs on the device itself.
 *
 * The computer pushes this jar to the device over Android's debugging connection (adb) and starts it there with
 * app_process (src/main/android/advanced-mode.cjs), so it runs with the shell's permissions and nothing needs to be
 * installed. It mirrors the screen into the hardware H.264 encoder, sends each encoded frame with its capture time,
 * injects the computer's touches, scrolls and keys as if they came from the device, sends what apps play (Sound),
 * shares the clipboard, and moves files (Files). Much of it uses Android's hidden APIs, through reflection.
 *
 * Arguments: the name of the local socket to listen on, then the bitrate in bits per second. The computer reaches the
 * socket through an adb port forward. The first connection is the stream; every later one is a file connection
 * (Files). The server prints "ready" once it listens, and exits when the stream's connection closes.
 *
 * The Yes Machine app chooses general or advanced mode, one at a time, since both capturing the screen at once breaks
 * the app's capture. So this server doesn't start while the app is in general mode, and ends when the app switches to
 * it. While a computer is connected, the server also beats every two seconds in a debug property, which the app can
 * read though it can't see this process (AdvancedSession), so the house on the app's home screen shows the device as
 * shared too.
 *
 * Wire format, big-endian. The device first sends "YMS1", the width and height (4 bytes each) and the encoder's name
 * (a 4-byte length and UTF-8). Then every message starts with a type byte.
 *
 * Device to computer:
 *
 *   1 video    capture time in microseconds (8 bytes), MediaCodec's flags (1 byte), length (4 bytes), the bytes
 *   2 pong     the ping's time (8 bytes), then the device's clock in nanoseconds (8 bytes)
 *   3 sound    length (4 bytes), then 48 kHz stereo 16-bit PCM in little-endian samples, as Android records it
 *   5 size     the new width and height (4 bytes each); the video restarts with a new configuration
 *   6 ended    the end of the session and why (1 byte; 1: the Yes Machine app here switched to general mode)
 *   7 copied   text copied here, for the shared clipboard (length, 4 bytes, then UTF-8)
 *
 * Computer to device:
 *
 *   2 ping       its time (8 bytes)
 *   4 touch      action (1 byte: 0 down, 1 up, 2 move), then x and y as fractions of the screen (4-byte floats)
 *   6 scroll     x and y as fractions of the screen, then the horizontal and vertical amounts (4-byte floats)
 *   7 key        action (1 byte: 0 down, 1 up), Android key code and meta state (4 bytes each)
 *   8 text       length (4 bytes) and UTF-8; one character the virtual keyboard can type is typed, anything else is
 *                pasted
 *   9 keyboard   on-screen keyboard (1 byte): 1 lets the device show its own keyboard for text fields, 0 hides it
 *                again, as it is at the start
 *   10 clipboard text copied on the computer, for this device's clipboard (length, 4 bytes, then UTF-8)
 *   11 report    whether to report what is copied here (1 byte: 1 or 0)
 *   12 check     a request to look at the clipboard now
 *
 * General mode (android/app, ShareService.java) sends the same stream, so the computer shows both modes the same way.
 */
public final class Server {

    // Messages to the computer, by type byte.
    private static final byte VIDEO = 1,
        PONG = 2,
        SOUND = 3,
        SIZE = 5,
        ENDED = 6,
        COPIED = 7,
        GENERAL_MODE = 1; // why the session ended: the app switched to general mode
    // Messages from the computer.
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

    // The stream to the computer. Several threads write to it, each message whole while holding its lock.
    private final DataOutputStream out;
    private final Input input;
    private final Keyboard keyboard = new Keyboard();
    private volatile int width, height; // the size of the screen being streamed, in pixels

    // --- Starting up ---

    private Server(OutputStream stream) throws Exception {
        out = new DataOutputStream(stream);
        input = new Input(keyboard);
    }

    /**
     * Unless the app is in general mode, listens on the local socket, and serves the first connection as the stream
     * until the session ends.
     */
    public static void main(String[] args) throws Exception {
        // app_process gives no main looper, as an app has, and some of Android's classes expect one.
        Looper.prepareMainLooper();
        String name = args.length > 0 ? args[0] : "yes-machine-stream";
        int bitRate = args.length > 1 ? Integer.parseInt(args[1]) : 8_000_000;
        if (generalMode()) {
            System.out.println("Yes Machine on this device is set to general mode.");
            return;
        }
        try (LocalServerSocket listener = new LocalServerSocket(name)) {
            System.out.println("ready");
            try (LocalSocket socket = listener.accept()) {
                // However the session ends, as the computer leaves, on an error or when the app switches to general
                // mode, the heartbeat is cleared on the way out, so the app's home screen shows it over at once.
                Runtime.getRuntime().addShutdownHook(
                    new Thread() {
                        @Override
                        public void run() {
                            beat("");
                        }
                    }
                );
                acceptFiles(listener);
                new Server(socket.getOutputStream()).run(
                    new DataInputStream(socket.getInputStream()),
                    bitRate
                );
            }
        }
    }

    /**
     * Takes each further connection to the socket as the computer's file connection (Files), on a thread of its own,
     * until the socket closes. Once a file connection says the computer's name, the heartbeat carries it.
     */
    private static void acceptFiles(final LocalServerSocket listener) {
        Thread accept = new Thread(
            new Runnable() {
                @Override
                public void run() {
                    while (true) {
                        try {
                            Files.serve(
                                listener.accept(),
                                new Files.Listener() {
                                    @Override
                                    public void computer(String name) {
                                        computer = name;
                                        beat(String.valueOf(SystemClock.elapsedRealtime()));
                                    }
                                }
                            );
                        } catch (IOException closed) {
                            return;
                        }
                    }
                }
            },
            "accept-files"
        );
        accept.setDaemon(true);
        accept.start();
    }

    // --- Heartbeat for the app ---

    // The heartbeat: the time of the last beat on SystemClock.elapsedRealtime(), then a space and the computer's name
    // once it's known; or nothing once the session is over. A session cut short, as by unplugging the cable, may stop
    // without clearing it, and the app notices the beat has gone stale (AdvancedSession).
    private static final String HEARTBEAT = "debug.yesmachine.advanced";
    private static volatile String computer = ""; // the computer's name, from its file connection

    /**
     * Writes the heartbeat property: time is the beat's time, or "" to clear it. A property holds at most 91 bytes, so
     * the name is cut to fit.
     */
    private static void beat(String time) {
        String value = time;
        if (!time.isEmpty() && !computer.isEmpty()) {
            value = time + " " + computer;
            while (value.getBytes(StandardCharsets.UTF_8).length > 91)
                value = value.substring(0, value.length() - 1);
        }
        // android.os.SystemProperties is hidden, and the shell may set debug properties.
        try {
            Class.forName("android.os.SystemProperties")
                .getMethod("set", String.class, String.class)
                .invoke(null, HEARTBEAT, value);
        } catch (Exception unavailable) {
            // then the app's home screen just doesn't show the session
        }
    }

    // --- Streaming the screen ---

    /**
     * Serves the stream: writes its header, wakes the screen, hides the on-screen keyboard, starts reading the
     * computer's messages, beating for the app and sending the sound, then encodes the screen on this thread for as
     * long as the session lasts. Each time the screen changes size, the computer gets a SIZE message and the encoder
     * and mirror start again at the new size.
     */
    private void run(DataInputStream in, int bitRate) throws Exception {
        int[] size = displaySize();
        // Rounded down to a multiple of 8, a size hardware encoders accept.
        width = size[0] & ~7;
        height = size[1] & ~7;
        synchronized (out) {
            out.writeBytes("YMS1");
            out.writeInt(width);
            out.writeInt(height);
            writeString(encoderName());
            out.flush();
        }
        input.key(KeyEvent.KEYCODE_WAKEUP);
        keyboard.show(false);
        startReader(in);
        beat(String.valueOf(SystemClock.elapsedRealtime()));
        watchMode();
        Sound.start(
            new Sound.Sink() {
                @Override
                public void audio(byte[] data, int length) throws IOException {
                    synchronized (out) {
                        out.writeByte(SOUND);
                        out.writeInt(length);
                        out.write(data, 0, length);
                        out.flush();
                    }
                }
            }
        );

        while (true) {
            MediaCodec codec = encoder(bitRate);
            Surface surface = codec.createInputSurface();
            Object display = mirror(width, height, surface);
            codec.start();
            boolean resized = stream(codec);
            codec.stop();
            codec.release();
            release(display);
            surface.release();
            if (!resized) return;
            synchronized (out) {
                out.writeByte(SIZE);
                out.writeInt(width);
                out.writeInt(height);
                out.flush();
            }
        }
    }

    /**
     * A hardware H.264 encoder at the current width and height and at bitRate, configured for low latency, whose
     * input is a surface (the screen's mirror).
     */
    private MediaCodec encoder(int bitRate) throws Exception {
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
        // Up to 60 frames per second, with a key frame every 10 seconds.
        format.setInteger(MediaFormat.KEY_BIT_RATE, bitRate);
        format.setInteger(MediaFormat.KEY_FRAME_RATE, 60);
        format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 10);
        // Encode the last frame again after 100 ms of stillness, so a static screen keeps the stream alive.
        format.setLong(MediaFormat.KEY_REPEAT_PREVIOUS_FRAME_AFTER, 100_000);
        format.setInteger(MediaFormat.KEY_LOW_LATENCY, 1);
        format.setInteger(MediaFormat.KEY_PRIORITY, 0); // 0 asks for real-time priority
        codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
        return codec;
    }

    /**
     * Sends encoded frames until the screen changes size, as when the device rotates, and returns true then, with
     * width and height set to the new size (checked four times a second). Each frame goes as a VIDEO message (1): its
     * capture time in microseconds, its flags, its length and its bytes. It never returns otherwise: the session ends
     * with an error here or with the reader ending the process.
     */
    private boolean stream(MediaCodec codec) throws Exception {
        MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
        byte[] copy = new byte[1 << 20];
        long checked = 0;
        while (true) {
            // Waits up to 100 ms for a frame, so the checks below go on while the screen is still.
            int index = codec.dequeueOutputBuffer(info, 100_000);
            long now = SystemClock.uptimeMillis();
            if (now - checked > 250) {
                checked = now;
                int[] size = displaySize();
                if ((size[0] & ~7) != width || (size[1] & ~7) != height) {
                    if (index >= 0) codec.releaseOutputBuffer(index, false);
                    width = size[0] & ~7;
                    height = size[1] & ~7;
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
    }

    /** Writes text as a 4-byte length and UTF-8. */
    private void writeString(String text) throws IOException {
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        out.writeInt(bytes.length);
        out.write(bytes);
    }

    /** The name of the encoder createEncoderByType picks, checked once without starting it. */
    private static String encoderName() throws IOException {
        MediaCodec codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC);
        try {
            return codec.getName();
        } finally {
            codec.release();
        }
    }

    /**
     * The main display's size in pixels as it is shown now, rotation included: { width, height }, from the hidden
     * DisplayManagerGlobal's information about display 0.
     */
    private static int[] displaySize() throws Exception {
        Object global = Class.forName("android.hardware.display.DisplayManagerGlobal")
            .getMethod("getInstance")
            .invoke(null);
        Object info = global.getClass().getMethod("getDisplayInfo", int.class).invoke(global, 0);
        return new int[] {
            info.getClass().getField("logicalWidth").getInt(info),
            info.getClass().getField("logicalHeight").getInt(info),
        };
    }

    /**
     * Mirrors display 0 onto the encoder's surface, and returns what release() later lets go of. Android 14 and later
     * have a direct call for that (DisplayManager's hidden, static createVirtualDisplay, which takes the display to
     * mirror), which returns a VirtualDisplay. Earlier versions build the mirror from a SurfaceControl display, and
     * return its token.
     */
    private static Object mirror(int width, int height, Surface surface) throws Exception {
        try {
            Method create = DisplayManager.class.getMethod(
                "createVirtualDisplay",
                String.class,
                int.class,
                int.class,
                int.class,
                Surface.class
            );
            return (VirtualDisplay) create.invoke(null, "yes-machine", width, height, 0, surface);
        } catch (NoSuchMethodException older) {
            // A new display, set up in one transaction: it draws on the encoder's surface, projects the screen's area
            // onto the whole surface, and shows display 0's layers (layer stack 0).
            Class<?> control = Class.forName("android.view.SurfaceControl");
            IBinder token = (IBinder) control
                .getMethod("createDisplay", String.class, boolean.class)
                .invoke(null, "yes-machine", false);
            control.getMethod("openTransaction").invoke(null);
            try {
                control
                    .getMethod("setDisplaySurface", IBinder.class, Surface.class)
                    .invoke(null, token, surface);
                Rect area = new Rect(0, 0, width, height);
                control
                    .getMethod(
                        "setDisplayProjection",
                        IBinder.class,
                        int.class,
                        Rect.class,
                        Rect.class
                    )
                    .invoke(null, token, 0, area, area);
                control
                    .getMethod("setDisplayLayerStack", IBinder.class, int.class)
                    .invoke(null, token, 0);
            } finally {
                control.getMethod("closeTransaction").invoke(null);
            }
            return token;
        }
    }

    /** Lets go of what mirror() made: a VirtualDisplay, or a SurfaceControl display's token. */
    private static void release(Object display) throws Exception {
        if (display instanceof VirtualDisplay) {
            ((VirtualDisplay) display).release();
        } else {
            Class.forName("android.view.SurfaceControl")
                .getMethod("destroyDisplay", IBinder.class)
                .invoke(null, (IBinder) display);
        }
    }

    // --- The app's mode ---

    /**
     * Whether the Yes Machine app here is in general mode: its screen-sharing service is on, which the shell sees in a
     * quick query of the package manager (the app turns the service off in advanced mode). Without the app, advanced
     * mode is all there is.
     */
    private static boolean generalMode() {
        try {
            Process query = new ProcessBuilder(
                "cmd",
                "package",
                "query-services",
                "--brief",
                "-a",
                "local.yesmachine.android.SHARE_SCREEN"
            )
                .redirectErrorStream(true)
                .start();
            InputStream output = query.getInputStream();
            ByteArrayOutputStream text = new ByteArrayOutputStream();
            byte[] chunk = new byte[4096];
            for (int count; (count = output.read(chunk)) != -1; ) text.write(chunk, 0, count);
            query.waitFor();
            return text.toString("UTF-8").contains("local.yesmachine.android/");
        } catch (Exception unknown) {
            return false;
        }
    }

    /**
     * Every two seconds, beats for the app and checks its mode. When the app switches to general mode, tells the
     * computer why (ENDED, GENERAL_MODE) and ends the session by ending the process.
     */
    private void watchMode() {
        Thread watch = new Thread(
            new Runnable() {
                @Override
                public void run() {
                    while (true) {
                        SystemClock.sleep(2000);
                        beat(String.valueOf(SystemClock.elapsedRealtime()));
                        if (!generalMode()) continue;
                        try {
                            synchronized (out) {
                                out.writeByte(ENDED);
                                out.writeByte(GENERAL_MODE);
                                out.flush();
                            }
                        } catch (IOException closed) {
                            // the computer is gone already
                        }
                        System.exit(0);
                    }
                }
            },
            "mode"
        );
        watch.setDaemon(true);
        watch.start();
    }

    // --- Messages from the computer ---

    /**
     * Reads the computer's messages on a thread of its own, and acts on each. When the connection closes, the process
     * ends; anything else unexpected ends it with status 1. Coordinates arrive as fractions of the screen.
     */
    private void startReader(final DataInputStream in) {
        Thread reader = new Thread(
            new Runnable() {
                @Override
                public void run() {
                    try {
                        while (true) {
                            byte type = in.readByte();
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
                                input.touch(
                                    in.readByte(),
                                    in.readFloat() * width,
                                    in.readFloat() * height
                                );
                            } else if (type == SCROLL) {
                                input.scroll(
                                    in.readFloat() * width,
                                    in.readFloat() * height,
                                    in.readFloat(),
                                    in.readFloat()
                                );
                            } else if (type == KEY) {
                                input.typedKey(
                                    in.readByte() == 0 ? KeyEvent.ACTION_DOWN : KeyEvent.ACTION_UP,
                                    in.readInt(),
                                    in.readInt()
                                );
                            } else if (type == TEXT) {
                                byte[] bytes = new byte[in.readInt()];
                                in.readFully(bytes);
                                input.text(new String(bytes, StandardCharsets.UTF_8));
                            } else if (type == KEYBOARD) {
                                keyboard.show(in.readByte() == 1);
                            } else if (type == CLIPBOARD) {
                                int length = in.readInt();
                                if (length < 0 || length > CLIPBOARD_LIMIT) throw new IOException(
                                    "Too much copied text"
                                );
                                byte[] bytes = new byte[length];
                                in.readFully(bytes);
                                copiedThere(new String(bytes, StandardCharsets.UTF_8));
                            } else if (type == REPORT) {
                                report(in.readByte() == 1);
                            } else if (type == CHECK) {
                                checkClipboard();
                            } else {
                                throw new IOException("Unknown message " + type);
                            }
                        }
                    } catch (IOException closed) {
                        System.exit(0);
                    } catch (Exception failed) {
                        failed.printStackTrace();
                        System.exit(1);
                    }
                }
            }
        );
        reader.setDaemon(true);
        reader.start();
    }

    // --- Shared clipboard ---

    // While the computer wants what is copied here, the clipboard is looked at twice a second and whenever the
    // computer asks, and new text goes across, except what this server put there itself: the computer's text, and what
    // a paste borrows it for. What the computer copied is put here at once.
    private volatile boolean reporting;
    private volatile int watching; // the watch that is current; one turned off and on again leaves the old one to end
    private String lastCopied; // the last text that went either way, so that it doesn't go back where it came from

    /** Puts text the computer copied (message 10) on this device's clipboard. */
    private synchronized void copiedThere(String text) {
        lastCopied = text;
        try {
            Clipboard.get().put(text);
        } catch (Exception unavailable) {
            System.err.println("Clipboard: " + unavailable);
        }
    }

    /**
     * Starts or stops reporting what is copied here (message 11). Starting runs a watch thread that looks at the
     * clipboard twice a second until reporting stops, or until a newer watch takes over.
     */
    private synchronized void report(boolean on) {
        if (on && !reporting) {
            // What was copied before stays here; only what is copied from now on goes across.
            try {
                lastCopied = Clipboard.get().text();
            } catch (Exception unavailable) {
                lastCopied = null;
            }
            reporting = true;
            final int mine = ++watching;
            Thread watch = new Thread(
                new Runnable() {
                    @Override
                    public void run() {
                        while (reporting && watching == mine) {
                            SystemClock.sleep(500);
                            if (watching == mine) checkClipboard();
                        }
                    }
                },
                "clipboard"
            );
            watch.setDaemon(true);
            watch.start();
        } else if (!on) {
            reporting = false;
        }
    }

    /**
     * Sends the clipboard's text to the computer (message 7) while it wants it, when the text is new: not empty, not
     * the last text that went either way, not borrowed by a paste, and no more than CLIPBOARD_LIMIT bytes. Runs on the
     * watch thread, and for the computer's requests (message 12).
     */
    private synchronized void checkClipboard() {
        if (!reporting) return;
        String text;
        try {
            Clipboard clipboard = Clipboard.get();
            if (clipboard.borrowed()) return;
            text = clipboard.text();
        } catch (Exception unavailable) {
            return;
        }
        if (text == null || text.isEmpty() || text.equals(lastCopied)) return;
        lastCopied = text;
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > CLIPBOARD_LIMIT) return;
        try {
            synchronized (out) {
                out.writeByte(COPIED);
                out.writeInt(bytes.length);
                out.write(bytes);
                out.flush();
            }
        } catch (IOException closed) {
            reporting = false;
        }
    }

    // --- Input ---

    /**
     * Injects the computer's input. Events arrive as if from the device's own screen, mouse and keyboard, through the
     * input manager's hidden injection call, which the shell is allowed to use.
     */
    private static final class Input {

        private final Object manager; // InputManagerGlobal, or InputManager before Android 14
        private final Method inject; // its injectInputEvent(InputEvent, int mode)
        // The virtual keyboard's layout: which keys type which characters.
        private final KeyCharacterMap characters = KeyCharacterMap.load(
            KeyCharacterMap.VIRTUAL_KEYBOARD
        );
        private final Keyboard keyboard;
        private long downTime; // when the finger went down, which every event of that touch carries
        // The last thing typed was a letter or digit, so the device's keyboard app may still be composing that word.
        private boolean inWord;

        Input(Keyboard keyboard) throws Exception {
            this.keyboard = keyboard;
            Object found;
            try {
                found = Class.forName("android.hardware.input.InputManagerGlobal")
                    .getMethod("getInstance")
                    .invoke(null);
            } catch (ClassNotFoundException olderThan14) {
                found = Class.forName("android.hardware.input.InputManager")
                    .getMethod("getInstance")
                    .invoke(null);
            }
            manager = found;
            inject = manager.getClass().getMethod("injectInputEvent", InputEvent.class, int.class);
        }

        /** Injects one event, in mode 0: asynchronously, without waiting for the app to handle it. */
        private void send(InputEvent event) throws Exception {
            inject.invoke(manager, event, 0);
        }

        /**
         * A touch on the touchscreen at x and y, in pixels: action 0 down, 1 up, anything else a move. A new touch
         * ends the word in progress.
         */
        void touch(byte action, float x, float y) throws Exception {
            if (action == 0) inWord = false;
            long now = SystemClock.uptimeMillis();
            int type =
                action == 0
                    ? MotionEvent.ACTION_DOWN
                    : action == 1
                      ? MotionEvent.ACTION_UP
                      : MotionEvent.ACTION_MOVE;
            if (type == MotionEvent.ACTION_DOWN) downTime = now;
            MotionEvent event = MotionEvent.obtain(downTime, now, type, x, y, 0);
            event.setSource(InputDevice.SOURCE_TOUCHSCREEN);
            send(event);
            event.recycle();
        }

        /** The mouse wheel at x and y, in pixels: horizontal and vertical are the scroll axes' amounts. */
        void scroll(float x, float y, float horizontal, float vertical) throws Exception {
            long now = SystemClock.uptimeMillis();
            MotionEvent.PointerProperties[] properties = { new MotionEvent.PointerProperties() };
            properties[0].id = 0;
            properties[0].toolType = MotionEvent.TOOL_TYPE_MOUSE;
            MotionEvent.PointerCoords[] coords = { new MotionEvent.PointerCoords() };
            coords[0].x = x;
            coords[0].y = y;
            coords[0].setAxisValue(MotionEvent.AXIS_HSCROLL, horizontal);
            coords[0].setAxisValue(MotionEvent.AXIS_VSCROLL, vertical);
            MotionEvent event = MotionEvent.obtain(
                now,
                now,
                MotionEvent.ACTION_SCROLL,
                1,
                properties,
                coords,
                0,
                0,
                1f,
                1f,
                0,
                0,
                InputDevice.SOURCE_MOUSE,
                0
            );
            send(event);
            event.recycle();
        }

        /** One key event, as from a keyboard: action ACTION_DOWN or ACTION_UP, an Android key code and meta state. */
        void key(int action, int code, int meta) throws Exception {
            long now = SystemClock.uptimeMillis();
            send(
                new KeyEvent(
                    now,
                    now,
                    action,
                    code,
                    0,
                    meta,
                    KeyCharacterMap.VIRTUAL_KEYBOARD,
                    0,
                    0,
                    InputDevice.SOURCE_KEYBOARD
                )
            );
        }

        /** A key from the computer's keyboard. Anything but Backspace ends the word in progress. */
        void typedKey(int action, int code, int meta) throws Exception {
            if (code != KeyEvent.KEYCODE_DEL) inWord = false;
            key(action, code, meta);
        }

        /** Presses and releases a key. */
        void key(int code) throws Exception {
            key(KeyEvent.ACTION_DOWN, code, 0);
            key(KeyEvent.ACTION_UP, code, 0);
        }

        /**
         * Types text from the computer. One character, as a key press makes, is typed with the virtual keyboard's
         * layout. A letter with an accent the layout has no key for, such as ñ or é, is typed as the layout's dead key
         * for the accent and then the letter, the way Alt+N, N types ñ. Anything else, such as ¿, ¡, emoji, or several
         * characters at once from dictation or an input method, is pasted: typed in a burst, an app's suggestions can
         * reorder the characters.
         */
        void text(String value) throws Exception {
            if (value.codePointCount(0, value.length()) == 1) {
                int point = value.codePointAt(0);
                // The key events that type the character, or null when the layout has no keys for it.
                KeyEvent[] events = characters.getEvents(Character.toChars(point));
                boolean deadKey = false;
                if (events == null) deadKey = (events = accented(point)) != null;
                if (events != null) {
                    if (deadKey) commitWord();
                    for (KeyEvent event : events) send(event);
                    inWord = Character.isLetterOrDigit(point);
                    return;
                }
            }
            commitWord();
            inWord = false;
            try {
                Clipboard.get().paste(value, this);
            } catch (Exception unavailable) {
                System.err.println("Paste: " + unavailable);
            }
        }

        /**
         * Makes the device's keyboard app keep the word it is composing. With the stand-in keyboard attached, the
         * keyboard app suggests words as they're typed, and a dead key or a paste in the middle of a word replaces the
         * word it is composing. Moving the cursor left and back right first makes it keep that word.
         */
        private void commitWord() throws Exception {
            if (!inWord || !keyboard.attached()) return;
            key(KeyEvent.KEYCODE_DPAD_LEFT);
            key(KeyEvent.KEYCODE_DPAD_RIGHT);
        }

        /**
         * The key events for an accented letter: the dead key for its accent, then the plain letter. The letter's
         * canonical decomposition gives the two (é is e and a combining acute accent). Returns null for anything else,
         * or when the layout lacks either key.
         */
        private KeyEvent[] accented(int point) {
            String parts = Normalizer.normalize(
                new String(Character.toChars(point)),
                Normalizer.Form.NFD
            );
            if (parts.length() != 2) return null;
            KeyEvent[] accent = characters.getEvents(new char[] { parts.charAt(1) });
            KeyEvent[] letter = characters.getEvents(new char[] { parts.charAt(0) });
            if (accent == null || letter == null) return null;
            KeyEvent[] events = new KeyEvent[accent.length + letter.length];
            System.arraycopy(accent, 0, events, 0, accent.length);
            System.arraycopy(letter, 0, events, accent.length, letter.length);
            return events;
        }
    }

    // --- Stand-in keyboard ---

    /**
     * Keeps the on-screen keyboard out of the way while the computer types. It would cover half the device's screen.
     * A stand-in hardware keyboard, made with Linux's uhid driver that the shell may use, hides it the way plugging in
     * a real keyboard does; typing still arrives as injected events (Input). Closing the stand-in, or this server
     * ending, removes it.
     */
    private static final class Keyboard {

        private static final int UHID_CREATE2 = 11, // the uhid event that creates a device
            BUS_VIRTUAL = 6;
        // A standard boot keyboard's HID report descriptor: modifier bits, a reserved byte, LED output and six key
        // slots.
        private static final byte[] REPORT = {
            // Usage page Generic Desktop, usage Keyboard; the application collection starts
            0x05,
            0x01,
            0x09,
            0x06,
            (byte) 0xa1,
            0x01,
            // Input: the eight modifier keys (key codes E0 to E7, Left Control to Right GUI), one bit each
            0x05,
            0x07,
            0x19,
            (byte) 0xe0,
            0x29,
            (byte) 0xe7,
            0x15,
            0x00,
            0x25,
            0x01,
            0x75,
            0x01,
            (byte) 0x95,
            0x08,
            (byte) 0x81,
            0x02,
            // Input: one reserved byte
            (byte) 0x95,
            0x01,
            0x75,
            0x08,
            (byte) 0x81,
            0x01,
            // Output: the five LEDs (Num Lock, Caps Lock, Scroll Lock, Compose, Kana), one bit each
            (byte) 0x95,
            0x05,
            0x75,
            0x01,
            0x05,
            0x08,
            0x19,
            0x01,
            0x29,
            0x05,
            (byte) 0x91,
            0x02,
            // Output: three bits that fill the LED byte
            (byte) 0x95,
            0x01,
            0x75,
            0x03,
            (byte) 0x91,
            0x01,
            // Input: six key slots, each a key code from 0 to 101
            (byte) 0x95,
            0x06,
            0x75,
            0x08,
            0x15,
            0x00,
            0x25,
            0x65,
            0x05,
            0x07,
            0x19,
            0x00,
            0x29,
            0x65,
            (byte) 0x81,
            0x00,
            // The collection ends
            (byte) 0xc0,
        };
        private FileDescriptor device; // the open /dev/uhid while the stand-in is attached

        /** Whether the stand-in keyboard is attached. */
        synchronized boolean attached() {
            return device != null;
        }

        /**
         * Lets the device show its own on-screen keyboard (onScreen true) by removing the stand-in, or hides it (false)
         * by attaching the stand-in. Without uhid the device keeps showing its own keyboard, which still works.
         */
        synchronized void show(boolean onScreen) {
            try {
                if (onScreen && device != null) {
                    Os.close(device);
                    device = null;
                } else if (!onScreen && device == null) {
                    device = create();
                }
            } catch (Exception unavailable) {
                System.err.println("On-screen keyboard: " + unavailable);
            }
        }

        /**
         * Attaches the stand-in keyboard: opens /dev/uhid and writes it a struct uhid_event with a uhid_create2_req, in
         * the device's byte order. The keyboard lasts until the returned file is closed.
         */
        private static FileDescriptor create() throws Exception {
            // The event's type (4 bytes), then the request: the name (128 bytes), phys and uniq (64 each), the report
            // descriptor's size and the bus (2 each), vendor, product, version and country (4 each), and room for the
            // report descriptor (4096).
            ByteBuffer event = ByteBuffer.allocate(4 + 128 + 64 + 64 + 2 + 2 + 4 * 4 + 4096).order(
                ByteOrder.nativeOrder()
            );
            event.putInt(UHID_CREATE2);
            event.put(
                Arrays.copyOf("Yes Machine keyboard".getBytes(StandardCharsets.US_ASCII), 128)
            );
            event.position(event.position() + 64 + 64); // phys and uniq stay empty
            event.putShort((short) REPORT.length).putShort((short) BUS_VIRTUAL);
            event.putInt(0).putInt(0).putInt(0).putInt(0); // vendor, product, version, country
            event.put(REPORT);
            FileDescriptor opened = Os.open("/dev/uhid", OsConstants.O_RDWR, 0);
            try {
                Os.write(opened, event.array(), 0, event.capacity());
            } catch (Exception failed) {
                Os.close(opened);
                throw failed;
            }
            return opened;
        }
    }

    // --- The device's clipboard ---

    /**
     * The device's clipboard, through its system service with the shell's identity: for the shared clipboard, and to
     * paste what the virtual keyboard can't type. Whatever the device had copied is put back a moment after the last
     * paste, unless the computer's own copy arrived meanwhile.
     */
    private static final class Clipboard {

        private static final long RESTORE_AFTER = 800; // ms after the last paste, before the clipboard is put back
        private static Clipboard instance;
        private final Object service; // the clipboard service's binder interface, IClipboard
        private final Method get, set; // its getPrimaryClip and setPrimaryClip
        private ClipData saved; // what was copied before a paste borrowed the clipboard
        private boolean holding; // a paste has borrowed the clipboard, and saved holds what goes back
        private long lastPaste; // when the last paste was, on SystemClock.uptimeMillis()

        /** The one Clipboard, made on first use. */
        static synchronized Clipboard get() throws Exception {
            if (instance == null) instance = new Clipboard();
            return instance;
        }

        /** The text of what is copied now, or null when it isn't text. */
        synchronized String text() throws Exception {
            ClipData clip = (ClipData) call(get, null);
            if (clip == null || clip.getItemCount() < 1) return null;
            CharSequence text = clip.getItemAt(0).getText();
            return text == null ? null : text.toString();
        }

        /** The computer's copy: it stays, even if a paste was about to put back what was there before. */
        synchronized void put(String text) throws Exception {
            holding = false;
            saved = null;
            call(set, ClipData.newPlainText(null, text));
        }

        /** Whether a paste has borrowed the clipboard, so what is on it now wasn't copied here. */
        synchronized boolean borrowed() {
            return holding;
        }

        /** Reaches the clipboard service: ServiceManager's binder for "clipboard", as an IClipboard. */
        private Clipboard() throws Exception {
            IBinder binder = (IBinder) Class.forName("android.os.ServiceManager")
                .getMethod("getService", String.class)
                .invoke(null, "clipboard");
            service = Class.forName("android.content.IClipboard$Stub")
                .getMethod("asInterface", IBinder.class)
                .invoke(null, binder);
            get = method("getPrimaryClip");
            set = method("setPrimaryClip");
        }

        /** The service's method by name; its parameters depend on the Android version (see call()). */
        private Method method(String name) throws NoSuchMethodException {
            for (Method method : service.getClass().getMethods())
                if (method.getName().equals(name)) return method;
            throw new NoSuchMethodException(name);
        }

        /**
         * Calls getPrimaryClip (clip null) or setPrimaryClip (with clip). The calls' parameters grew over the versions:
         * the calling package, then the user, an attribution tag before the user from Android 13, and a virtual device
         * from Android 14. So the clip goes first, when there is one, then the shell's package, then null for any
         * other String (the attribution tag) and 0 for the rest (the user, the virtual device).
         */
        private Object call(Method method, ClipData clip) throws Exception {
            Class<?>[] types = method.getParameterTypes();
            Object[] arguments = new Object[types.length];
            int i = 0;
            if (clip != null) arguments[i++] = clip;
            arguments[i++] = "com.android.shell";
            for (; i < types.length; i++) arguments[i] =
                types[i] == String.class ? null : (Object) 0;
            return method.invoke(service, arguments);
        }

        /**
         * Pastes text into the focused field: puts it on the clipboard and presses Paste. What was copied before is
         * saved at the first of a run of pastes, and put back RESTORE_AFTER ms after the last one.
         */
        void paste(String text, final Input input) throws Exception {
            synchronized (this) {
                if (!holding) {
                    try {
                        saved = (ClipData) call(get, null);
                    } catch (Exception unreadable) {
                        saved = null;
                    }
                    holding = true;
                }
                lastPaste = SystemClock.uptimeMillis();
            }
            call(set, ClipData.newPlainText(null, text));
            input.key(KeyEvent.KEYCODE_PASTE);
            Thread restore = new Thread(
                new Runnable() {
                    @Override
                    public void run() {
                        SystemClock.sleep(RESTORE_AFTER);
                        restore();
                    }
                }
            );
            restore.setDaemon(true);
            restore.start();
        }

        /**
         * Puts back what was copied before the pastes, unless a later paste's own restore is still to come (that paste
         * was less than RESTORE_AFTER ago), or the computer's copy took its place (put()).
         */
        private synchronized void restore() {
            if (!holding || SystemClock.uptimeMillis() - lastPaste < RESTORE_AFTER) return;
            holding = false;
            try {
                if (saved != null) call(set, saved);
            } catch (Exception failed) {
                System.err.println("Clipboard: " + failed);
            }
            saved = null;
        }
    }
}
