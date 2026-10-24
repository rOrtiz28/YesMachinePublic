package local.yesmachine.android;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Map;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The sign-ins kept by the home screen's "Remember on this device": a user name and password for each computer, keyed
 * by its "address:port". MainActivity uses them to sign in again without asking, and forgets one the computer refuses.
 *
 * Passwords are encrypted with AES-256-GCM under a key kept in the Android Keystore, which never lets the key leave
 * the device. Each entry is a small JSON object in the app's private "remembered-sign-ins" preferences: the user name
 * in plain text, the cipher's random IV and the encrypted password, both in Base64, and for Settings' list the
 * computer's name and the time it was saved (earlier versions kept neither). An entry that can no longer be decrypted
 * is removed, and the person is asked to sign in again.
 *
 * The methods are synchronized because the home page's requests run on several threads at once.
 */
final class CredentialStore {

    /** One remembered sign-in. */
    static final class Credential {

        final String user, password;

        Credential(String user, String password) {
            this.user = user;
            this.password = password;
        }
    }

    private static final String ALIAS = "yes-machine-sign-ins";
    private final SharedPreferences preferences;

    CredentialStore(Context context) {
        preferences = context.getSharedPreferences("remembered-sign-ins", Context.MODE_PRIVATE);
    }

    // --- The Keystore key ---

    /** Whether the Keystore can provide the key. When it can't, the home screen says passwords are never remembered. */
    boolean available() {
        try {
            key();
            return true;
        } catch (Exception error) {
            return false;
        }
    }

    /** The app's AES key in the Android Keystore, created the first time it's needed: 256 bits, for GCM. */
    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return (
            (KeyStore.SecretKeyEntry) store.getEntry(ALIAS, null)
        ).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore"
        );
        generator.init(
            new KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return generator.generateKey();
    }

    // --- Remembered sign-ins ---

    /**
     * Remembers a sign-in for a computer ("address:port") named name, replacing any earlier one. Returns false, and
     * keeps nothing for that computer, when the password can't be encrypted.
     */
    synchronized boolean set(String host, String user, String password, String name) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            // The Keystore picks a new random IV for each encryption; it's stored with the entry.
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] secret = cipher.doFinal(password.getBytes(StandardCharsets.UTF_8));
            JSONObject entry = new JSONObject()
                .put("user", user)
                .put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                .put("secret", Base64.encodeToString(secret, Base64.NO_WRAP))
                .put("name", name)
                .put("since", System.currentTimeMillis());
            preferences.edit().putString(host, entry.toString()).apply();
            return true;
        } catch (Exception error) {
            forget(host);
            return false;
        }
    }

    /**
     * The remembered sign-in for a computer ("address:port"). Returns null when nothing is saved, or when the entry
     * can no longer be decrypted (it is then removed).
     */
    synchronized Credential get(String host) {
        String stored = preferences.getString(host, null);
        if (stored == null) return null;
        try {
            JSONObject entry = new JSONObject(stored);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            // GCM with a 128-bit authentication tag, the length the Keystore used when encrypting.
            cipher.init(
                Cipher.DECRYPT_MODE,
                key(),
                new GCMParameterSpec(128, Base64.decode(entry.getString("iv"), Base64.NO_WRAP))
            );
            String password = new String(
                cipher.doFinal(Base64.decode(entry.getString("secret"), Base64.NO_WRAP)),
                StandardCharsets.UTF_8
            );
            return new Credential(entry.getString("user"), password);
        } catch (Exception error) {
            forget(host);
            return null;
        }
    }

    /** Whether a sign-in is remembered for the computer, without decrypting it. */
    synchronized boolean has(String host) {
        return preferences.contains(host);
    }

    synchronized void forget(String host) {
        preferences.edit().remove(host).apply();
    }

    /** Forgets every remembered sign-in, for Settings. */
    synchronized void clear() {
        preferences.edit().clear().apply();
    }

    /** How many sign-ins are remembered, for Settings. */
    synchronized int count() {
        return preferences.getAll().size();
    }

    /**
     * Settings' list: {key, user, name, since} for each sign-in, without decrypting anything. since is the time it was
     * saved in milliseconds, or 0 when it isn't known.
     */
    synchronized JSONArray list() {
        JSONArray list = new JSONArray();
        for (Map.Entry<String, ?> each : preferences.getAll().entrySet()) {
            try {
                JSONObject entry = new JSONObject(String.valueOf(each.getValue()));
                list.put(
                    new JSONObject()
                        .put("key", each.getKey())
                        .put("user", entry.optString("user"))
                        .put("name", entry.optString("name"))
                        .put("since", entry.optLong("since"))
                );
            } catch (Exception unreadable) {
                // An entry that isn't JSON can't sign in either; get() removes it when it's tried.
            }
        }
        return list;
    }
}
