package local.yesmachine.stream;

import android.content.AttributionSource;
import android.content.Context;
import android.content.ContextWrapper;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.os.Build;
import android.os.Process;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.concurrent.ArrayBlockingQueue;

/**
 * The device's sound in advanced mode: what its apps play, captured with the shell's permissions as 48 kHz stereo
 * 16-bit PCM while the device keeps playing it too, the way Android's own screen recorder captures it. Server sends it
 * to the computer as the stream's sound messages (3). Android 13 and later allow it; on earlier versions, or when
 * Android refuses, the stream has no sound and the picture goes on.
 */
final class Sound {

    static final int RATE = 48_000;
    static final int CHUNK = (RATE / 50) * 4; // 20 ms of stereo 16-bit frames

    /** Where the sound goes: data's first length bytes are one chunk. Throwing stops the sending. */
    interface Sink {
        void audio(byte[] data, int length) throws Exception;
    }

    private Sound() {}

    /**
     * Starts the capture, or says on stderr why there is none. One thread reads the device's sound all the time and
     * another sends it: Android holds back the apps' playback while a capture goes unread, so when the network falls
     * behind, the oldest sound is dropped instead, keeping at most half a second (25 chunks) waiting.
     */
    static void start(final Sink sink) {
        if (Build.VERSION.SDK_INT < 33) {
            System.err.println("Sound: needs Android 13 or later");
            return;
        }
        final AudioRecord record;
        try {
            record = capture();
            record.startRecording();
        } catch (Exception refused) {
            System.err.println("Sound: " + refused);
            return;
        }
        final ArrayBlockingQueue<byte[]> waiting = new ArrayBlockingQueue<>(25);
        Thread reader = new Thread(
            new Runnable() {
                @Override
                public void run() {
                    Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO);
                    byte[] buffer = new byte[CHUNK];
                    try {
                        while (true) {
                            int count = record.read(buffer, 0, buffer.length);
                            if (count < 0) throw new IllegalStateException(
                                "read returned " + count
                            );
                            if (count == 0) continue;
                            byte[] chunk = Arrays.copyOf(buffer, count);
                            while (!waiting.offer(chunk)) waiting.poll(); // full: drop the oldest
                        }
                    } catch (Exception ended) {
                        System.err.println("Sound: " + ended);
                    } finally {
                        record.release();
                    }
                }
            },
            "sound"
        );
        Thread sender = new Thread(
            new Runnable() {
                @Override
                public void run() {
                    try {
                        while (true) {
                            byte[] chunk = waiting.take();
                            sink.audio(chunk, chunk.length);
                        }
                    } catch (Exception closed) {
                        // the computer is gone
                    }
                }
            },
            "sound-send"
        );
        reader.setDaemon(true);
        sender.setDaemon(true);
        reader.start();
        sender.start();
    }

    /**
     * A recording of what apps play for media, games and unknown uses. Their sound is mixed, looped back for capture
     * and still played on the device, through an audio policy registered the way Android's own capture does it: the
     * shell may change audio routing. The policy's recording reads the mix at a fixed volume, whatever the device's
     * own volume is. Building it takes Android's hidden audio policy classes, through reflection; the comments show
     * each step as plain calls.
     */
    private static AudioRecord capture() throws Exception {
        AudioFormat format = new AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(RATE)
            .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
            .build(); // a mix is described as playback

        // mixingRule = new AudioMixingRule.Builder()
        //     .setTargetMixRole(AudioMixingRule.MIX_ROLE_PLAYERS)
        //     .addMixRule(AudioMixingRule.RULE_MATCH_ATTRIBUTE_USAGE, attributes) for each usage
        //     .build();
        Class<?> rules = Class.forName("android.media.audiopolicy.AudioMixingRule");
        Class<?> ruleBuilder = Class.forName("android.media.audiopolicy.AudioMixingRule$Builder");
        Object rule = ruleBuilder.getConstructor().newInstance();
        ruleBuilder
            .getMethod("setTargetMixRole", int.class)
            .invoke(rule, rules.getField("MIX_ROLE_PLAYERS").getInt(null));
        Method addRule = ruleBuilder.getMethod("addMixRule", int.class, Object.class);
        int byUsage = rules.getField("RULE_MATCH_ATTRIBUTE_USAGE").getInt(null);
        for (int usage : new int[] {
            AudioAttributes.USAGE_MEDIA,
            AudioAttributes.USAGE_GAME,
            AudioAttributes.USAGE_UNKNOWN,
        }) {
            addRule.invoke(rule, byUsage, new AudioAttributes.Builder().setUsage(usage).build());
        }
        Object mixingRule = ruleBuilder.getMethod("build").invoke(rule);

        // audioMix = new AudioMix.Builder(mixingRule)
        //     .setFormat(format)
        //     .setRouteFlags(AudioMix.ROUTE_FLAG_LOOP_BACK_RENDER) // looped back, and still played
        //     .build();
        Class<?> mixes = Class.forName("android.media.audiopolicy.AudioMix");
        Class<?> mixBuilder = Class.forName("android.media.audiopolicy.AudioMix$Builder");
        Object mix = mixBuilder.getConstructor(rules).newInstance(mixingRule);
        mixBuilder.getMethod("setFormat", AudioFormat.class).invoke(mix, format);
        mixBuilder
            .getMethod("setRouteFlags", int.class)
            .invoke(mix, mixes.getField("ROUTE_FLAG_LOOP_BACK_RENDER").getInt(null));
        Object audioMix = mixBuilder.getMethod("build").invoke(mix);

        // policy = new AudioPolicy.Builder(shell()).addMix(audioMix).build();
        // AudioManager.registerAudioPolicyStatic(policy), which answers 0 when it's accepted;
        // record = policy.createAudioRecordSink(audioMix);
        // record.unregisterAudioPolicyOnRelease(policy), so that releasing the recording removes the policy too.
        Class<?> policies = Class.forName("android.media.audiopolicy.AudioPolicy");
        Class<?> policyBuilder = Class.forName("android.media.audiopolicy.AudioPolicy$Builder");
        Object building = policyBuilder.getConstructor(Context.class).newInstance(shell());
        policyBuilder.getMethod("addMix", mixes).invoke(building, audioMix);
        Object policy = policyBuilder.getMethod("build").invoke(building);
        Method register = AudioManager.class.getDeclaredMethod(
            "registerAudioPolicyStatic",
            policies
        );
        register.setAccessible(true);
        int status = (Integer) register.invoke(null, policy);
        if (status != 0) throw new IllegalStateException(
            "the audio policy was refused (" + status + ")"
        );
        AudioRecord record = (AudioRecord) policies
            .getMethod("createAudioRecordSink", mixes)
            .invoke(policy, audioMix);
        if (record == null) throw new IllegalStateException("the audio policy gave no recording");
        Method unregister = AudioRecord.class.getDeclaredMethod(
            "unregisterAudioPolicyOnRelease",
            policies
        );
        unregister.setAccessible(true);
        unregister.invoke(record, policy);
        return record;
    }

    /**
     * A context that says it is the shell, whose permissions this server has: Android checks who is recording. It
     * wraps the system context of a new ActivityThread, made through reflection, since app_process has no app context.
     */
    private static Context shell() throws Exception {
        Class<?> threads = Class.forName("android.app.ActivityThread");
        Constructor<?> create = threads.getDeclaredConstructor();
        create.setAccessible(true);
        Method systemContext = threads.getDeclaredMethod("getSystemContext");
        systemContext.setAccessible(true);
        Context system = (Context) systemContext.invoke(create.newInstance());
        return new ContextWrapper(system) {
            @Override
            public String getPackageName() {
                return "com.android.shell";
            }

            @Override
            public String getOpPackageName() {
                return "com.android.shell";
            }

            // Who is recording: this process's user, the shell, with the shell's package.
            @Override
            public AttributionSource getAttributionSource() {
                return new AttributionSource.Builder(Process.myUid())
                    .setPackageName("com.android.shell")
                    .build();
            }

            @Override
            public Context getApplicationContext() {
                return this;
            }
        };
    }
}
