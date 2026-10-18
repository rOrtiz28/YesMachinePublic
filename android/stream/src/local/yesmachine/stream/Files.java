package local.yesmachine.stream;

import android.net.LocalSocket;
import android.os.StatFs;
import android.os.SystemClock;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.UUID;

/**
 * Files between the computer and this device in advanced mode, over a connection of their own beside the stream, so a
 * large file never holds up the picture or a touch. Server hands each connection after the stream to serve().
 *
 * The computer opens it with "YMF1", a 2-byte length and JSON with its name. Then either side sends a file the same
 * way, big-endian as the stream, and in the same format as general mode's file connection (android/app,
 * FileChannel.java):
 *
 *   1 open:  8-byte size, 2-byte name length, the name in UTF-8
 *   2 data:  4-byte length, then that many bytes; as many as it takes
 *   3 close: 1 byte, 0 complete or 1 canceled
 *
 * and the side that got the file answers:
 *
 *   4 result: 1 byte, 0 saved or 1 failed, then a 2-byte length and the name it was saved as, or why not
 *
 * What the computer sends goes to the Download folder, under a new name if the name is taken, and the Yes Machine app
 * tells the person it arrived (FileReceiver). What the person here shares to Yes Machine, the app (ShareActivity)
 * leaves in its outbox folder, which this server, with the shell's access to the app's folder, takes from and sends
 * on, saying how far it got.
 */
final class Files {

    private static final byte OPEN = 1,
        DATA = 2,
        CLOSE = 3,
        RESULT = 4;
    private static final long LIMIT = 10L * 1024 * 1024 * 1024, // the largest file either way: 10 GB
        ROOM = 256L * 1024 * 1024; // what an arriving file must leave free
    private static final int CHUNK = 64 * 1024; // the size of each part this side sends
    private static final File DOWNLOADS = new File("/sdcard/Download");
    private static final File OUTBOX = new File(
        "/sdcard/Android/data/local.yesmachine.android/files/outbox"
    );

    private final DataInputStream in;
    private final DataOutputStream out;
    private final String computer; // the computer's name, for the app's notification
    private final Object answered = new Object(); // guards answer and answerText; notified when they come
    private volatile boolean open = true; // false once the connection has ended, which stops the outbox too
    private Boolean answer; // the computer's answer to the file being sent, once it came
    private String answerText = "";

    private Files(LocalSocket socket, String computer) throws IOException {
        // The output buffer holds a whole data message, so each one goes out in a single write.
        in = new DataInputStream(new BufferedInputStream(socket.getInputStream(), 4 * CHUNK));
        out = new DataOutputStream(new BufferedOutputStream(socket.getOutputStream(), CHUNK + 16));
        this.computer = computer;
    }

    // --- The connection ---

    /**
     * Reads the computer's hello, tells the listener the computer's name, then serves the connection until it closes,
     * on a thread of its own. A connection that doesn't start with "YMF1" is closed.
     */
    static void serve(final LocalSocket socket, final Listener listener) {
        Thread thread = new Thread(
            new Runnable() {
                @Override
                public void run() {
                    try {
                        DataInputStream hello = new DataInputStream(socket.getInputStream());
                        byte[] magic = new byte[4];
                        hello.readFully(magic);
                        if (!"YMF1".equals(new String(magic, StandardCharsets.US_ASCII))) return;
                        byte[] json = new byte[hello.readUnsignedShort()];
                        hello.readFully(json);
                        String name = new org.json.JSONObject(
                            new String(json, StandardCharsets.UTF_8)
                        )
                            .optString("name", "")
                            .trim();
                        if (name.isEmpty() || name.length() > 64) name = "A computer";
                        listener.computer(name);
                        Files files = new Files(socket, name);
                        files.startOutbox();
                        files.read();
                    } catch (Exception closed) {
                        // the computer left; files in the middle stop
                    } finally {
                        try {
                            socket.close();
                        } catch (IOException ignored) {}
                    }
                }
            },
            "files"
        );
        thread.setDaemon(true);
        thread.start();
    }

    /** Hears the computer's name from its hello. */
    interface Listener {
        void computer(String name);
    }

    // --- Files from the computer ---

    /**
     * Everything the computer sends: its own file in parts, or its answer to the one this side is sending. A file
     * arrives as a hidden part file in Download, and takes its name only once it's complete; one left unfinished when
     * the connection ends is deleted.
     */
    private void read() throws IOException {
        File part = null;
        FileOutputStream target = null;
        String name = null;
        long size = 0,
            received = 0;
        boolean refused = false; // the file arriving was refused when it opened; its data is skipped
        try {
            while (true) {
                byte type = in.readByte();
                if (type == RESULT) {
                    // The answer send() waits for.
                    boolean saved = in.readByte() == 0;
                    String text = readText();
                    synchronized (answered) {
                        answer = saved;
                        answerText = text;
                        answered.notifyAll();
                    }
                } else if (type == OPEN) {
                    if (part != null) throw new IOException("A second file started at once.");
                    size = in.readLong();
                    name = safeName(readName());
                    received = 0;
                    refused = false;
                    String problem =
                        size < 0 || size > LIMIT
                            ? "Files must be 10 GB or smaller."
                            : !room(size)
                              ? "The device doesn’t have room for that file."
                              : null;
                    if (problem == null) {
                        if (!DOWNLOADS.isDirectory()) DOWNLOADS.mkdirs();
                        part = new File(DOWNLOADS, ".yes-machine-" + UUID.randomUUID() + ".part");
                        try {
                            target = new FileOutputStream(part);
                        } catch (IOException unwritable) {
                            part = null;
                            problem = "The device couldn’t save to its Download folder.";
                        }
                    }
                    if (problem != null) {
                        refused = true;
                        result(false, problem);
                    }
                } else if (type == DATA) {
                    int length = in.readInt();
                    if (length < 0 || length > 4 * CHUNK) throw new IOException(
                        "A file part was too large."
                    );
                    // Every part is read in full, even one that's skipped, to stay in step.
                    byte[] bytes = new byte[length];
                    in.readFully(bytes);
                    if (refused || target == null) continue;
                    if (received + length > size) throw new IOException(
                        "More arrived than the file's size."
                    );
                    target.write(bytes);
                    received += length;
                } else if (type == CLOSE) {
                    boolean canceled = in.readByte() != 0;
                    // A refused file was answered when it opened.
                    if (refused || target == null) {
                        refused = false;
                        continue;
                    }
                    target.close();
                    target = null;
                    // A canceled file gets no answer; an incomplete one is a failure.
                    if (canceled || received != size) {
                        part.delete();
                        part = null;
                        if (!canceled) result(false, "The file arrived incomplete.");
                        continue;
                    }
                    File kept = unique(name);
                    if (!part.renameTo(kept)) {
                        part.delete();
                        part = null;
                        result(false, "The device couldn’t save it in its Download folder.");
                        continue;
                    }
                    part = null;
                    result(true, kept.getName());
                    arrived(kept.getName());
                } else {
                    throw new IOException("Unknown file message " + type);
                }
            }
        } finally {
            // Wakes a send() waiting for an answer that won't come now.
            open = false;
            synchronized (answered) {
                answered.notifyAll();
            }
            try {
                if (target != null) target.close();
            } catch (IOException ignored) {}
            if (part != null) part.delete();
        }
    }

    /** Whether the storage has room for size bytes and still ROOM free. When it can't tell, it says yes. */
    private boolean room(long size) {
        try {
            StatFs disk = new StatFs(DOWNLOADS.getParent());
            return disk.getAvailableBytes() >= size + ROOM;
        } catch (Exception unknown) {
            return true;
        }
    }

    /** Answers a file the computer sent: saved, with the name it was saved as, or failed, with why. */
    private void result(boolean saved, String text) throws IOException {
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        synchronized (out) {
            out.writeByte(RESULT);
            out.writeByte(saved ? 0 : 1);
            out.writeShort(bytes.length);
            out.write(bytes);
            out.flush();
        }
    }

    /** Reads a 2-byte length, then that many bytes of UTF-8. */
    private String readName() throws IOException {
        byte[] bytes = new byte[in.readUnsignedShort()];
        in.readFully(bytes);
        return new String(bytes, StandardCharsets.UTF_8);
    }

    /** The text of a result, read as a name is. */
    private String readText() throws IOException {
        return readName();
    }

    /**
     * A name from the computer, made safe to save under, as the app's FileChannel.safeName does: only what follows
     * its last slash or backslash, with control characters and the characters Windows forbids (<>:"|?*) turned into
     * _, and at most 180 characters. A name that is empty or only dots becomes "file", and one that starts with a dot
     * gets "file" in front, so it isn't hidden.
     */
    static String safeName(String name) {
        String clean = name
            .replaceAll(".*[\\\\/]", "")
            .replaceAll("[\\p{Cntrl}<>:\"|?*]", "_")
            .trim();
        if (clean.length() > 180) clean = clean.substring(0, 180);
        if (clean.isEmpty() || clean.matches("\\.+")) return "file";
        return clean.startsWith(".") ? "file" + clean : clean; // not hidden
    }

    /** Download/name, or name (1), name (2)… as Android names a copy: the first that isn't taken. */
    private static File unique(String name) {
        File file = new File(DOWNLOADS, name);
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name,
            extension = dot > 0 ? name.substring(dot) : "";
        for (int copy = 1; file.exists(); copy++) file = new File(
            DOWNLOADS,
            base + " (" + copy + ")" + extension
        );
        return file;
    }

    /**
     * Asks the Yes Machine app to say in a notification that a file arrived, with a broadcast to its FileReceiver,
     * which only takes this from the shell or the system.
     */
    private void arrived(String name) {
        try {
            new ProcessBuilder(
                "am",
                "broadcast",
                "-a",
                "local.yesmachine.android.FILE_RECEIVED",
                "-n",
                "local.yesmachine.android/.FileReceiver",
                "--es",
                "name",
                name,
                "--es",
                "computer",
                computer
            )
                .redirectErrorStream(true)
                .start();
        } catch (IOException noApp) {
            // the file is in Download all the same
        }
    }

    // --- Files shared here: the outbox ---

    /**
     * Watches the app's outbox for as long as the connection is open, and sends each file that is ready, in the order
     * of the folders' names, which start with the time they were made.
     *
     * The outbox has one folder per file the person shared, holding the file in its own folder named file and, once
     * the app has copied it all, a mark named ready. This side marks a folder taken, writes how far it got in
     * progress, and ends with sent or failed; the app may mark it cancel. The app reads the marks to show how it's
     * going, and deletes the folder at the end.
     */
    private void startOutbox() {
        Thread thread = new Thread(
            new Runnable() {
                @Override
                public void run() {
                    while (open) {
                        SystemClock.sleep(400);
                        File[] folders = OUTBOX.listFiles();
                        if (folders == null) continue;
                        Arrays.sort(folders);
                        for (File folder : folders) {
                            if (!open) return;
                            File ready = new File(folder, "ready");
                            // A folder the app left behind long ago, as when it was stopped, is not sent now.
                            if (
                                !ready.exists() ||
                                new File(folder, "taken").exists() ||
                                System.currentTimeMillis() - ready.lastModified() > 60_000
                            ) continue;
                            try {
                                send(folder);
                            } catch (Exception failed) {
                                mark(
                                    folder,
                                    "failed",
                                    "The file didn’t go: " + failed.getMessage()
                                );
                            }
                        }
                    }
                }
            },
            "outbox"
        );
        thread.setDaemon(true);
        thread.start();
    }

    /**
     * Sends the file in one outbox folder to the computer, marking the folder taken, then its progress every 5
     * percent, then sent (with the name the computer saved it as) or failed (with why). Stops early when the computer
     * answers before the end, which means it refused the file, or when the app marks the folder cancel. Waits up to
     * 30 seconds for the computer's answer.
     */
    private void send(File folder) throws IOException {
        mark(folder, "taken", "");
        // The file itself is alone in a folder of its own, so no name can pass for one of the marks.
        File file = null;
        File[] inside = new File(folder, "file").listFiles();
        if (inside != null) for (File each : inside) if (each.isFile()) file = each;
        if (file == null) {
            mark(folder, "failed", "The shared file wasn’t there.");
            return;
        }
        long size = file.length();
        if (size > LIMIT) {
            mark(folder, "failed", "Files must be 10 GB or smaller.");
            return;
        }
        synchronized (answered) {
            answer = null;
            answerText = "";
        }
        // Open isn't flushed: it goes out with the first part.
        byte[] name = file.getName().getBytes(StandardCharsets.UTF_8);
        synchronized (out) {
            out.writeByte(OPEN);
            out.writeLong(size);
            out.writeShort(name.length);
            out.write(name);
        }
        long sent = 0;
        int reported = -1;
        byte[] chunk = new byte[CHUNK];
        boolean refused = false,
            canceled = false;
        try (InputStream source = new FileInputStream(file)) {
            for (
                int count, part = 0;
                sent < size &&
                (count = source.read(chunk, 0, (int) Math.min(CHUNK, size - sent))) != -1;
                part++
            ) {
                synchronized (answered) {
                    if (answer != null) {
                        refused = true;
                        break;
                    }
                }
                // The person canceled it on the device. Looked for every 16 parts, a megabyte.
                if (part % 16 == 0 && new File(folder, "cancel").exists()) {
                    canceled = true;
                    break;
                }
                synchronized (out) {
                    out.writeByte(DATA);
                    out.writeInt(count);
                    out.write(chunk, 0, count);
                    out.flush();
                }
                sent += count;
                int percent = (int) ((sent * 100) / Math.max(1, size));
                if (percent / 5 != reported / 5) {
                    reported = percent;
                    mark(folder, "progress", String.valueOf(percent));
                }
            }
        }
        // Canceled when it stopped early, or when the file ended before its size.
        synchronized (out) {
            out.writeByte(CLOSE);
            out.writeByte(refused || canceled || sent != size ? 1 : 0);
            out.flush();
        }
        // The computer doesn't answer a canceled file.
        if (canceled) {
            mark(folder, "failed", "Canceled.");
            return;
        }
        long deadline = SystemClock.uptimeMillis() + 30_000;
        synchronized (answered) {
            while (answer == null && open && SystemClock.uptimeMillis() < deadline) {
                try {
                    answered.wait(500);
                } catch (InterruptedException stop) {
                    return;
                }
            }
            if (answer == null) mark(
                folder,
                "failed",
                open ? "The computer didn’t answer." : "The computer disconnected."
            );
            else if (answer) mark(folder, "sent", answerText);
            else mark(folder, "failed", answerText);
        }
    }

    /**
     * Writes a mark in the folder, holding text. It's written under a temporary name first and then renamed, so the
     * app never reads half a mark. A mark that can't be written is left out.
     */
    private static void mark(File folder, String marker, String text) {
        File temporary = new File(folder, marker + ".tmp");
        try (FileOutputStream write = new FileOutputStream(temporary)) {
            write.write(text.getBytes(StandardCharsets.UTF_8));
        } catch (IOException unwritable) {
            return;
        }
        temporary.renameTo(new File(folder, marker));
    }
}
