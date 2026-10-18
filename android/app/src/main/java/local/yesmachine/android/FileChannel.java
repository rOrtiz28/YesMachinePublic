package local.yesmachine.android;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * General mode's file connection, this device's side. One connection carries files both ways: files from the computer
 * in control, which go to a Storage (Downloads), and files the person shares here to Yes Machine, which ShareActivity
 * sends with send().
 *
 * ShareService makes one for each "YMF1" connection from the computer in control, and runs serve() on that
 * connection's thread for as long as it lasts; meanwhile, send() runs on ShareActivity's thread.
 *
 * The format is the same as advanced mode's (android/stream, Files.java). Numbers are big-endian. Either side sends a
 * file as:
 *
 *   1 open:  8-byte size, 2-byte name length, the name in UTF-8
 *   2 data:  4-byte length, then that many bytes; as many as it takes
 *   3 close: 1 byte, 0 complete or 1 canceled
 *
 * and the side that got the file answers:
 *
 *   4 result: 1 byte, 0 saved or 1 failed, then a 2-byte length and the name it was saved as, or why not
 *
 * The answer may come before the file is complete, to refuse it; the sender then stops and closes the file as
 * canceled. One file goes each way at a time.
 */
final class FileChannel {

    /** Where arriving files go. create() throws, saying why, when it can't take a file; the computer shows why. */
    interface Storage {
        Target create(String name, long size) throws IOException;
    }

    /** One arriving file, while it's written. */
    interface Target {
        OutputStream stream();
        /** Keeps the file and returns the name it was saved as. */
        String keep() throws IOException;
        /** Throws away what was written, for a file that was canceled or arrived incomplete. */
        void discard();
    }

    /** Hears that a file arrived and was kept, with the name it was saved as. */
    interface Arrived {
        void arrived(String name, Target target);
    }

    /** Hears how much of a file send() has sent: sent bytes of size. */
    interface Progress {
        void at(long sent, long size);
    }

    /** The answer to a file: whether it was saved, and the name it was saved as or why not. */
    static final class Result {

        final boolean saved;
        final String text;

        Result(boolean saved, String text) {
            this.saved = saved;
            this.text = text;
        }
    }

    static final long LIMIT = 10L * 1024 * 1024 * 1024; // the largest file either way: 10 GB
    private static final byte OPEN = 1,
        DATA = 2,
        CLOSE = 3,
        RESULT = 4;
    private static final int CHUNK = 64 * 1024; // the size of each part this side sends

    private final DataInputStream in;
    private final DataOutputStream out;
    private final Storage storage;
    private final Arrived arrived;
    private final Object answered = new Object(); // guards answer; notified when it comes or the connection ends
    private final Object sending = new Object(); // one send() at a time
    private Result answer; // the answer to the file send() is sending, once it came
    private volatile boolean open = true;
    private final Runnable closer; // closes the connection itself

    /**
     * Wraps a connection's streams. closer closes the connection, which ends serve(); close() calls it.
     */
    FileChannel(
        InputStream in,
        OutputStream out,
        Storage storage,
        Arrived arrived,
        Runnable closer
    ) {
        // The output buffer holds a whole data message, so each one goes out in a single write.
        this.in = new DataInputStream(new BufferedInputStream(in, 4 * CHUNK));
        this.out = new DataOutputStream(new BufferedOutputStream(out, CHUNK + 16));
        this.storage = storage;
        this.arrived = arrived;
        this.closer = closer;
    }

    /** Whether the connection is still up: not once serve() has ended or close() was called. */
    boolean isOpen() {
        return open;
    }

    /** Closes the connection, which ends serve() and any send(). */
    void close() {
        open = false;
        if (closer != null) closer.run();
    }

    // --- Receiving ---

    /**
     * Reads what the computer sends until the connection closes: files, saved through storage, and the answers to the
     * files send() sends. Throws when the connection ends, or when the computer breaks the format. A file still
     * arriving then is discarded.
     */
    void serve() throws IOException {
        Target target = null;
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
                        answer = new Result(saved, text);
                        answered.notifyAll();
                    }
                } else if (type == OPEN) {
                    if (target != null) throw new IOException("A second file started at once.");
                    size = in.readLong();
                    name = safeName(readText());
                    received = 0;
                    refused = false;
                    try {
                        if (size < 0 || size > LIMIT) throw new IOException(
                            "Files must be 10 GB or smaller."
                        );
                        target = storage.create(name, size);
                    } catch (IOException cannot) {
                        refused = true;
                        result(
                            false,
                            cannot.getMessage() == null
                                ? "The device couldn’t save it."
                                : cannot.getMessage()
                        );
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
                    target.stream().write(bytes);
                    received += length;
                } else if (type == CLOSE) {
                    boolean canceled = in.readByte() != 0;
                    // A refused file was answered when it opened.
                    if (refused || target == null) {
                        refused = false;
                        continue;
                    }
                    Target done = target;
                    target = null;
                    // A canceled file gets no answer; an incomplete one is a failure.
                    if (canceled || received != size) {
                        done.discard();
                        if (!canceled) result(false, "The file arrived incomplete.");
                        continue;
                    }
                    String kept;
                    try {
                        kept = done.keep();
                    } catch (IOException failed) {
                        done.discard();
                        result(false, "The device couldn’t save it in its Download folder.");
                        continue;
                    }
                    result(true, kept);
                    if (arrived != null) arrived.arrived(kept, done);
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
            if (target != null) target.discard();
        }
    }

    // --- Sending ---

    /**
     * Sends one file and returns the computer's answer, or throws when the connection ends first. size is the file's
     * size: no more is read from source, and a source that ends sooner cancels the file. Files go one at a time.
     * progress (or null) hears how far it got; setting cancel stops this file, and the computer drops what it got.
     * After the last part, waits up to 30 seconds for the answer.
     */
    Result send(String name, long size, InputStream source, Progress progress, AtomicBoolean cancel)
        throws IOException {
        synchronized (sending) {
            if (size < 0 || size > LIMIT) return new Result(
                false,
                "Files must be 10 GB or smaller."
            );
            synchronized (answered) {
                answer = null;
            }
            // Open isn't flushed: it goes out with the first part.
            byte[] bytes = name.getBytes(StandardCharsets.UTF_8);
            synchronized (out) {
                out.writeByte(OPEN);
                out.writeLong(size);
                out.writeShort(bytes.length);
                out.write(bytes);
            }
            long sent = 0;
            boolean stopped = false;
            byte[] chunk = new byte[CHUNK];
            // Reads no more than size, even from a source that has more.
            for (
                int count;
                sent < size &&
                (count = source.read(chunk, 0, (int) Math.min(CHUNK, size - sent))) != -1;

            ) {
                // An answer before the end means the computer refused the file.
                synchronized (answered) {
                    if (answer != null) {
                        stopped = true;
                        break;
                    }
                }
                if (cancel != null && cancel.get()) {
                    stopped = true;
                    break;
                }
                synchronized (out) {
                    out.writeByte(DATA);
                    out.writeInt(count);
                    out.write(chunk, 0, count);
                    out.flush();
                }
                sent += count;
                if (progress != null) progress.at(sent, size);
            }
            // Canceled when it stopped early, or when the source ended before size.
            synchronized (out) {
                out.writeByte(CLOSE);
                out.writeByte(stopped || sent != size ? 1 : 0);
                out.flush();
            }
            // The computer doesn't answer a canceled file.
            if (cancel != null && cancel.get()) return new Result(false, "Canceled.");
            synchronized (answered) {
                long deadline = System.currentTimeMillis() + 30_000;
                while (answer == null && open && System.currentTimeMillis() < deadline) {
                    try {
                        answered.wait(500);
                    } catch (InterruptedException stop) {
                        Thread.currentThread().interrupt();
                        break;
                    }
                }
                if (answer != null) return answer;
            }
            throw new IOException(
                open ? "The computer didn’t answer." : "The computer disconnected."
            );
        }
    }

    // --- Messages and names ---

    /** Answers a file that arrived: saved, with the name it was saved as, or failed, with why. At most 1 KB of text. */
    private void result(boolean saved, String text) throws IOException {
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > 1024) bytes = java.util.Arrays.copyOf(bytes, 1024);
        synchronized (out) {
            out.writeByte(RESULT);
            out.writeByte(saved ? 0 : 1);
            out.writeShort(bytes.length);
            out.write(bytes);
            out.flush();
        }
    }

    /** Reads a 2-byte length, then that many bytes of UTF-8. */
    private String readText() throws IOException {
        byte[] bytes = new byte[in.readUnsignedShort()];
        in.readFully(bytes);
        return new String(bytes, StandardCharsets.UTF_8);
    }

    /**
     * A name from the other side, made safe to save under: only what follows its last slash or backslash, with
     * control characters and the characters Windows forbids (<>:"|?*) turned into _, and at most 180 characters. A
     * name that is empty or only dots becomes "file", and one that starts with a dot gets "file" in front, so it
     * isn't hidden.
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
}
