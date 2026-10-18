package local.yesmachine.android;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * Whether a computer is connected in advanced mode, and which one.
 *
 * That session runs outside this app: the computer starts its server (android/stream, Server.java) over Android's
 * debugging connection, as the shell user, so the app can't see it. Instead, while a computer is connected, the
 * server beats every two seconds in a debug property, which the app can read, and clears it when the session ends. A
 * beat older than five seconds means the session ended without clearing it, as when the cable is unplugged.
 *
 * MainActivity checks it to show the device as shared on the home screen, and ShareActivity to send shared files
 * through advanced mode.
 */
final class AdvancedSession {

    static final String PROPERTY = "debug.yesmachine.advanced";
    private static final long STALE_MS = 5000;

    private AdvancedSession() {}

    /**
     * Whether the property's value is a beat from less than five seconds before now (SystemClock.elapsedRealtime()).
     *
     * The value is the last beat's time on SystemClock.elapsedRealtime, the clock the server and this app share, then,
     * once the computer opened its file connection, a space and the computer's name. It's empty when no session is on.
     */
    static boolean live(String value, long now) {
        if (value == null || value.trim().isEmpty()) return false;
        String time = value.trim().split(" ", 2)[0];
        try {
            long age = now - Long.parseLong(time);
            // A beat from the future can't be live; it may be from before the device restarted.
            return age >= 0 && age < STALE_MS;
        } catch (NumberFormatException other) {
            return false;
        }
    }

    /** The connected computer's name, or nothing while the server doesn't know it. */
    static String computer(String value) {
        String[] parts = value == null ? new String[0] : value.trim().split(" ", 2);
        return parts.length < 2 ? "" : parts[1].trim();
    }

    /**
     * Reads the property the way an app may, through getprop. Returns its value (128 bytes at most, more than a
     * property holds), or "" when it can't be read.
     */
    static String read() {
        try {
            Process getprop = new ProcessBuilder("/system/bin/getprop", PROPERTY)
                .redirectErrorStream(true)
                .start();
            byte[] bytes = new byte[128];
            int length = 0;
            try (InputStream output = getprop.getInputStream()) {
                for (
                    int count;
                    length < bytes.length &&
                    (count = output.read(bytes, length, bytes.length - length)) != -1;

                ) length += count;
            }
            getprop.waitFor();
            return new String(bytes, 0, length, StandardCharsets.UTF_8).trim();
        } catch (Exception unavailable) {
            return "";
        }
    }
}
