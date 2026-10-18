package local.yesmachine.android;

import android.Manifest;
import android.annotation.TargetApi;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.projection.MediaProjection;
import android.os.Process;
import android.util.Log;
import java.io.DataOutputStream;
import java.util.Arrays;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * General mode's sound: what this device's apps play, sent to the computer in control along with the screen.
 *
 * It uses Android 10's playback capture, which records what other apps play under the same consent that records the
 * screen (the MediaProjection). It captures media, games and unknown uses. Apps that don't allow capture stay out,
 * and the device keeps playing everything itself. It takes Android 10 and the permission to record audio; without
 * them, the stream simply has no sound.
 *
 * The sound goes out as the stream's sound message (3: a 4-byte length, then 48 kHz stereo 16-bit PCM, little-endian
 * samples as Android records them), as advanced mode's server sends it (android/stream, Sound.java). ShareService
 * starts it for each session and stops it when the session ends.
 */
@TargetApi(29)
final class ShareSound {

    private static final byte SOUND = 3; // the stream's message type for sound
    private static final int RATE = 48_000,
        CHUNK = (RATE / 50) * 4; // 20 ms of stereo 16-bit frames
    private final AudioRecord record;
    private volatile boolean open = true; // false once stopped or the computer is gone; both threads then end

    private ShareSound(AudioRecord record) {
        this.record = record;
    }

    /**
     * Starts sending the sound to out, or returns null when there is none to send: without the permission to record
     * audio, or when Android refuses the capture. out is the stream to the computer, which other threads write to
     * too, each message whole while holding out's lock.
     */
    static ShareSound start(Context context, MediaProjection projection, DataOutputStream out) {
        if (
            context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) !=
            PackageManager.PERMISSION_GRANTED
        ) return null;
        AudioRecord record;
        try {
            AudioPlaybackCaptureConfiguration playback =
                new AudioPlaybackCaptureConfiguration.Builder(projection)
                    .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                    .addMatchingUsage(AudioAttributes.USAGE_GAME)
                    .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                    .build();
            AudioFormat format = new AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(RATE)
                .setChannelMask(AudioFormat.CHANNEL_IN_STEREO)
                .build();
            int minimum = AudioRecord.getMinBufferSize(
                RATE,
                AudioFormat.CHANNEL_IN_STEREO,
                AudioFormat.ENCODING_PCM_16BIT
            );
            // Android's buffer: four times the larger of its minimum and one chunk.
            record = new AudioRecord.Builder()
                .setAudioPlaybackCaptureConfig(playback)
                .setAudioFormat(format)
                .setBufferSizeInBytes(Math.max(minimum, CHUNK) * 4)
                .build();
            record.startRecording();
        } catch (Exception refused) {
            Log.i("YesMachine", "No sound: " + refused);
            return null;
        }
        ShareSound sound = new ShareSound(record);
        sound.send(out);
        return sound;
    }

    /**
     * Starts the two threads that move the sound: one reads the capture all the time, and the other sends what it
     * read. They're apart because Android holds back the apps' own playback while a capture goes unread, so a slow
     * network must never stop the reading. Between them waits at most half a second of sound (25 chunks); when the
     * network falls behind, the oldest sound is dropped instead.
     */
    private void send(final DataOutputStream out) {
        final ArrayBlockingQueue<byte[]> waiting = new ArrayBlockingQueue<>(25);
        new Thread(() -> {
            Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO);
            byte[] buffer = new byte[CHUNK];
            try {
                while (open) {
                    int count = record.read(buffer, 0, buffer.length);
                    if (count < 0) break; // an error code: the recording is over
                    if (count == 0) continue;
                    byte[] chunk = Arrays.copyOf(buffer, count);
                    while (!waiting.offer(chunk)) waiting.poll(); // full: drop the oldest
                }
            } finally {
                // This thread owns the recording, and releases it when it ends.
                open = false;
                record.release();
            }
        }, "share-sound").start();
        new Thread(() -> {
            try {
                while (open) {
                    // Waits at most 200 ms, so it notices soon when the sound stops.
                    byte[] chunk = waiting.poll(200, TimeUnit.MILLISECONDS);
                    if (chunk == null) continue;
                    synchronized (out) {
                        out.writeByte(SOUND);
                        out.writeInt(chunk.length);
                        out.write(chunk);
                        out.flush();
                    }
                }
            } catch (Exception closed) {
                // the computer is gone
            }
            open = false;
        }, "share-sound-send").start();
    }

    /** Stops the sound. Both threads end within a moment, and the recording is released. */
    void stop() {
        open = false;
    }
}
