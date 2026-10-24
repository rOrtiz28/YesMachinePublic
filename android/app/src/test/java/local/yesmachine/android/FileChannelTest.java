package local.yesmachine.android;

import static org.junit.Assert.*;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.PipedInputStream;
import java.io.PipedOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.Test;

/**
 * Tests FileChannel, general mode's file connection, with the test playing the computer's side. A file from the
 * computer is kept and answered with the name it was saved as; one the device can't take is refused with the reason; a
 * canceled one is thrown away; a file shared from this device goes in parts and gets the computer's answer; and names
 * are made safe to save. FileChannel's header describes the byte format the tests write and read.
 */
public class FileChannelTest {

    // --- Fixtures ---

    // A computer that sends a file, then reads the device's answer.
    private static byte[] file(String name, byte[] content, boolean canceled) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        DataOutputStream out = new DataOutputStream(bytes);
        byte[] title = name.getBytes(StandardCharsets.UTF_8);
        out.writeByte(1);
        out.writeLong(content.length);
        out.writeShort(title.length);
        out.write(title);
        out.writeByte(2);
        out.writeInt(content.length);
        out.write(content);
        out.writeByte(3);
        out.writeByte(canceled ? 1 : 0);
        return bytes.toByteArray();
    }

    private static final class Kept implements FileChannel.Target {

        final String name;
        final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        boolean kept, discarded;

        Kept(String name) {
            this.name = name;
        }

        public OutputStream stream() {
            return bytes;
        }

        public String keep() {
            kept = true;
            return name.replace(".pdf", " (1).pdf");
        }

        public void discard() {
            discarded = true;
        }
    }

    // --- Tests ---

    @Test
    public void aFileFromTheComputerIsSavedAndAnsweredWithItsName() throws IOException {
        List<Kept> targets = new ArrayList<>();
        List<String> arrived = new ArrayList<>();
        ByteArrayOutputStream answers = new ByteArrayOutputStream();
        byte[] stream = file("Informe año.pdf", "hola".getBytes(StandardCharsets.UTF_8), false);
        FileChannel channel = new FileChannel(
            new ByteArrayInputStream(stream),
            answers,
            (name, size) -> {
                Kept target = new Kept(name);
                targets.add(target);
                return target;
            },
            (name, target) -> arrived.add(name),
            null
        );
        try {
            channel.serve();
        } catch (IOException end) {
            /* the stream ended */
        }
        assertEquals(1, targets.size());
        assertEquals("hola", targets.get(0).bytes.toString());
        assertTrue(targets.get(0).kept);
        assertEquals(List.of("Informe año (1).pdf"), arrived);
        DataInputStream answer = new DataInputStream(
            new ByteArrayInputStream(answers.toByteArray())
        );
        assertEquals(4, answer.readByte());
        assertEquals(0, answer.readByte());
        byte[] text = new byte[answer.readUnsignedShort()];
        answer.readFully(text);
        assertEquals("Informe año (1).pdf", new String(text, StandardCharsets.UTF_8));
    }

    @Test
    public void aFileTheDeviceCantTakeIsRefusedWithTheReason() throws IOException {
        ByteArrayOutputStream answers = new ByteArrayOutputStream();
        byte[] stream = file("huge.mov", new byte[10], false);
        FileChannel channel = new FileChannel(
            new ByteArrayInputStream(stream),
            answers,
            (name, size) -> {
                throw new IOException("The device doesn’t have room for that file.");
            },
            null,
            null
        );
        try {
            channel.serve();
        } catch (IOException end) {}
        DataInputStream answer = new DataInputStream(
            new ByteArrayInputStream(answers.toByteArray())
        );
        assertEquals(4, answer.readByte());
        assertEquals(1, answer.readByte());
        byte[] text = new byte[answer.readUnsignedShort()];
        answer.readFully(text);
        assertEquals(
            "The device doesn’t have room for that file.",
            new String(text, StandardCharsets.UTF_8)
        );
    }

    @Test
    public void aCanceledFileIsThrownAway() throws IOException {
        List<Kept> targets = new ArrayList<>();
        FileChannel channel = new FileChannel(
            new ByteArrayInputStream(file("half.jpg", new byte[4], true)),
            new ByteArrayOutputStream(),
            (name, size) -> {
                Kept target = new Kept(name);
                targets.add(target);
                return target;
            },
            null,
            null
        );
        try {
            channel.serve();
        } catch (IOException end) {}
        assertTrue(targets.get(0).discarded);
        assertFalse(targets.get(0).kept);
    }

    @Test
    public void aSharedFileGoesInPartsAndTheComputersAnswerComesBack() throws Exception {
        PipedInputStream fromComputer = new PipedInputStream(1 << 20);
        PipedOutputStream computer = new PipedOutputStream(fromComputer);
        PipedInputStream toComputer = new PipedInputStream(1 << 20);
        PipedOutputStream device = new PipedOutputStream(toComputer);
        FileChannel channel = new FileChannel(
            fromComputer,
            device,
            (name, size) -> {
                throw new IOException("no");
            },
            null,
            null
        );
        Thread serving = new Thread(() -> {
            try {
                channel.serve();
            } catch (IOException end) {}
        });
        serving.start();
        byte[] content = new byte[200_000];
        for (int i = 0; i < content.length; i++) content[i] = (byte) i;
        // The computer reads the whole file, then answers that it got it.
        Thread reading = new Thread(() -> {
            try {
                DataInputStream in = new DataInputStream(toComputer);
                assertEquals(1, in.readByte());
                assertEquals(content.length, in.readLong());
                byte[] name = new byte[in.readUnsignedShort()];
                in.readFully(name);
                assertEquals("IMG_2041.jpg", new String(name, StandardCharsets.UTF_8));
                ByteArrayOutputStream got = new ByteArrayOutputStream();
                for (byte type; (type = in.readByte()) == 2; ) {
                    byte[] part = new byte[in.readInt()];
                    in.readFully(part);
                    got.write(part);
                }
                assertEquals(0, in.readByte());
                assertArrayEquals(content, got.toByteArray());
                DataOutputStream out = new DataOutputStream(computer);
                byte[] text = "IMG_2041.jpg".getBytes(StandardCharsets.UTF_8);
                out.writeByte(4);
                out.writeByte(0);
                out.writeShort(text.length);
                out.write(text);
                out.flush();
            } catch (IOException failed) {
                throw new AssertionError(failed);
            }
        });
        reading.start();
        List<Long> progress = new ArrayList<>();
        FileChannel.Result result = channel.send(
            "IMG_2041.jpg",
            content.length,
            new ByteArrayInputStream(content),
            (sent, size) -> progress.add(sent),
            new AtomicBoolean()
        );
        reading.join(5000);
        assertTrue(result.saved);
        assertEquals("IMG_2041.jpg", result.text);
        assertEquals(Long.valueOf(content.length), progress.get(progress.size() - 1));
        computer.close();
        serving.join(5000);
    }

    @Test
    public void namesAreMadeSafeToSave() {
        assertEquals("passwd", FileChannel.safeName("../../etc/passwd"));
        assertEquals("a_b.txt", FileChannel.safeName("a:b.txt"));
        assertEquals("file", FileChannel.safeName(".."));
        assertEquals("file.hidden", FileChannel.safeName(".hidden"));
        assertEquals("file", FileChannel.safeName("  "));
        assertEquals("a".repeat(179), FileChannel.safeName("a".repeat(179) + "\uD83D\uDE00.txt"));
    }
}
