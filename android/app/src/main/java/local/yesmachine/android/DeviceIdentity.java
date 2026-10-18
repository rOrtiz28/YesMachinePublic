package local.yesmachine.android;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.math.BigInteger;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.security.spec.ECGenParameterSpec;
import java.util.Date;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLServerSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import javax.security.auth.x500.X500Principal;

/**
 * This device's TLS identity for general mode, in which it shares its own screen with a computer (ShareService): an
 * elliptic-curve key pair (P-256) kept in the Android Keystore, which never lets the private key out, and the
 * self-signed certificate the Keystore makes for it.
 *
 * Trust works as it does when this device connects to a computer that shares, the other way round: the first time a
 * computer connects, the person there checks this certificate's SHA-256 fingerprint (the home screen shows it, and
 * ShareService announces it on the network), and the computer then expects that certificate. The computer presents a
 * certificate of its own as well, and the person here decides whether to allow it.
 */
final class DeviceIdentity {

    private static final String ALIAS = "yes-machine-device";

    private DeviceIdentity() {}

    /** The Android Keystore, holding this device's key pair and certificate, which are created on first use. */
    private static KeyStore keys() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyPairGenerator generator = KeyPairGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_EC,
                "AndroidKeyStore"
            );
            long now = System.currentTimeMillis();
            // The certificate is valid from a day before it's made until ten years after, since computers remember its
            // fingerprint. The digests are the ones a TLS handshake may ask the key to sign with.
            generator.initialize(
                new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
                    .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                    .setDigests(
                        KeyProperties.DIGEST_NONE,
                        KeyProperties.DIGEST_SHA256,
                        KeyProperties.DIGEST_SHA384,
                        KeyProperties.DIGEST_SHA512
                    )
                    .setCertificateSubject(new X500Principal("CN=Yes Machine device"))
                    .setCertificateSerialNumber(BigInteger.valueOf(now))
                    .setCertificateNotBefore(new Date(now - 86_400_000L))
                    .setCertificateNotAfter(new Date(now + 10L * 365 * 86_400_000L))
                    .build()
            );
            generator.generateKeyPair();
            store.load(null);
        }
        return store;
    }

    /** SHA-256 of the certificate, as pairs of hex digits separated by colons, the way the desktop app shows them. */
    static String fingerprint() throws Exception {
        return fingerprint(keys().getCertificate(ALIAS));
    }

    /**
     * Any certificate's fingerprint, in the same form: this device's own, or the one a computer presents when it
     * connects (ShareService).
     */
    static String fingerprint(Certificate certificate) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded());
        StringBuilder text = new StringBuilder();
        for (byte value : digest) {
            if (text.length() > 0) text.append(':');
            text.append(String.format("%02X", value & 0xff));
        }
        return text.toString();
    }

    /**
     * A factory for server sockets that present this identity. ShareService also asks each computer for its own
     * certificate. Any certificate is accepted at the handshake: the person on this device decides whether to allow
     * that computer, by its name and its certificate's fingerprint, which is what "Always allow" remembers.
     */
    static SSLServerSocketFactory serverSockets() throws Exception {
        KeyManagerFactory managers = KeyManagerFactory.getInstance(
            KeyManagerFactory.getDefaultAlgorithm()
        );
        // Keystore entries have no password.
        managers.init(keys(), null);
        TrustManager[] anyComputer = {
            new X509TrustManager() {
                @Override
                public void checkClientTrusted(X509Certificate[] chain, String authType) {}

                @Override
                public void checkServerTrusted(X509Certificate[] chain, String authType) {}

                @Override
                public X509Certificate[] getAcceptedIssuers() {
                    return new X509Certificate[0];
                }
            },
        };
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(managers.getKeyManagers(), anyComputer, null);
        return context.getServerSocketFactory();
    }
}
