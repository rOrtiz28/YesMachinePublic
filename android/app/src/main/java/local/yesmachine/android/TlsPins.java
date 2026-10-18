package local.yesmachine.android;

import java.net.InetSocketAddress;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import okhttp3.OkHttpClient;

/**
 * TLS for connecting to a computer that shares its screen. A computer's certificate is self-signed, so no certificate
 * authority vouches for it. Instead, the first time, the person compares the certificate's SHA-256 fingerprint with
 * the one Yes Machine shows on that computer, and the app then accepts exactly that certificate (it "pins" it) for
 * that address and port. Every connection that carries app data requires such an explicitly approved pin of the exact
 * leaf certificate.
 *
 * Connecting happens in two steps:
 * - Before trust, inspect() reads the certificate: it starts a TLS handshake, keeps the certificate the computer sends,
 *   and aborts, so nothing (no HTTP request, no password) is ever sent to a computer nobody approved.
 * - After trust, client() makes the OkHttp client for everything else: sign-in (/login), the session WebSocket and
 *   file downloads. It accepts only the pinned certificate, and only when that certificate names the computer's IP
 *   address. It connects directly, never through a proxy, and never follows redirects.
 *
 * MainActivity uses both, to check computers and to sign in; NativeSession uses client() for the viewer's session.
 */
public final class TlsPins {

    private TlsPins() {}

    // --- Fingerprints and addresses ---

    /**
     * The certificate's SHA-256 fingerprint as 32 pairs of uppercase hex digits separated by colons ("AB:01:…"), the
     * form in which Yes Machine shows fingerprints and the app stores its pins.
     */
    public static String fingerprint(X509Certificate certificate) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded());
        StringBuilder result = new StringBuilder();
        for (byte value : digest) {
            if (result.length() > 0) result.append(':');
            result.append(String.format(Locale.ROOT, "%02X", value & 255));
        }
        return result.toString();
    }

    /** Whether the certificate names this IP address among its subject alternative names. */
    static boolean hasAddress(X509Certificate certificate, String address)
        throws CertificateException {
        Collection<List<?>> names = certificate.getSubjectAlternativeNames();
        if (names == null) return false;
        // Each entry is a list of the name's type and its value. Type 7 is an IP address, given as text.
        for (List<?> entry : names)
            if (
                entry.size() >= 2 &&
                Integer.valueOf(7).equals(entry.get(0)) &&
                address.equals(entry.get(1))
            ) return true;
        return false;
    }

    // --- Before trust: reading a computer's certificate ---

    /** inspect() with a timeout of six seconds. */
    public static X509Certificate inspect(HostEndpoint host) throws Exception {
        return inspect(host, 6000);
    }

    /**
     * Connects to the computer and returns its certificate without trusting it, so the person can compare its
     * fingerprint (and the home screen can tell whether the computer is sharing at all). The handshake is aborted as
     * soon as the certificate arrives.
     *
     * @param timeoutMs how long to wait for the connection, and then for each read during the handshake
     * @throws CertificateException when the computer sends no certificate, or one outside its validity dates, or one
     *     that doesn't name this IP address
     * @throws java.io.IOException when the computer can't be reached or doesn't answer TLS
     */
    public static X509Certificate inspect(HostEndpoint host, int timeoutMs) throws Exception {
        final X509Certificate[] captured = new X509Certificate[1];
        X509TrustManager inspector = new X509TrustManager() {
            public X509Certificate[] getAcceptedIssuers() {
                return new X509Certificate[0];
            }

            public void checkClientTrusted(X509Certificate[] chain, String auth)
                throws CertificateException {
                throw new CertificateException("Client certificates are not accepted.");
            }

            public void checkServerTrusted(X509Certificate[] chain, String auth)
                throws CertificateException {
                if (chain != null && chain.length > 0) captured[0] = chain[0];
                // Abort on purpose. This probe never trusts the certificate, and never sends an HTTP request, a
                // WebSocket request, a password or any other app data.
                throw new CertificateException(
                    "Certificate inspection only: handshake intentionally aborted."
                );
            }
        };
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(null, new TrustManager[] { inspector }, new SecureRandom());
        try (SSLSocket socket = (SSLSocket) context.getSocketFactory().createSocket()) {
            socket.setSoTimeout(timeoutMs);
            socket.connect(new InetSocketAddress(host.address, host.port), timeoutMs);
            try {
                socket.startHandshake();
            } catch (Exception error) {
                // The handshake is meant to fail once the certificate is in hand. Failing before means no certificate.
                if (captured[0] == null) throw error;
            }
        }
        if (captured[0] == null) throw new CertificateException(
            "The host did not provide a certificate."
        );
        // The same checks client() makes later, so a certificate that could never connect isn't offered for trust.
        captured[0].checkValidity();
        if (!hasAddress(captured[0], host.address)) throw new CertificateException(
            "The host certificate does not identify this IP address. Restart sharing on the selected network."
        );
        return captured[0];
    }

    // --- After trust: the pinned client ---

    /**
     * An OkHttp client that talks only to this computer, and only while it presents the approved certificate. Each
     * handshake checks that the certificate is the pinned one (the same SHA-256 fingerprint), is within its validity
     * dates, and names this IP address. The host name check then requires the request to go to that same address.
     * Connecting times out after 8 seconds; reads never time out, and an open WebSocket is pinged every 15 seconds, so
     * a computer that stops answering ends the session.
     *
     * @param pin the approved fingerprint, in the form fingerprint() returns
     * @throws CertificateException when the pin is missing or malformed, so no client exists without one
     */
    public static OkHttpClient client(HostEndpoint host, String pin) throws Exception {
        if (
            pin == null || !pin.matches("(?:[0-9A-F]{2}:){31}[0-9A-F]{2}")
        ) throw new CertificateException("No valid approved certificate pin.");
        X509TrustManager pinned = new X509TrustManager() {
            public X509Certificate[] getAcceptedIssuers() {
                return new X509Certificate[0];
            }

            public void checkClientTrusted(X509Certificate[] chain, String auth)
                throws CertificateException {
                throw new CertificateException("Client certificates are not accepted.");
            }

            public void checkServerTrusted(X509Certificate[] chain, String auth)
                throws CertificateException {
                try {
                    if (chain == null || chain.length == 0) throw new CertificateException(
                        "Missing host certificate."
                    );
                    // Only the leaf certificate matters: it must be the approved one itself, not one signed by it.
                    chain[0].checkValidity();
                    if (
                        !hasAddress(chain[0], host.address) ||
                        !MessageDigest.isEqual(
                            pin.getBytes(java.nio.charset.StandardCharsets.US_ASCII),
                            fingerprint(chain[0]).getBytes(
                                java.nio.charset.StandardCharsets.US_ASCII
                            )
                        )
                    ) {
                        throw new CertificateException(
                            "The host certificate changed. Reopen the computer and verify its fingerprint."
                        );
                    }
                } catch (CertificateException error) {
                    throw error;
                } catch (Exception error) {
                    // fingerprint() can throw any exception; the handshake must fail as a certificate error.
                    throw new CertificateException(error);
                }
            }
        };
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(null, new TrustManager[] { pinned }, new SecureRandom());
        return new OkHttpClient.Builder()
            .sslSocketFactory(context.getSocketFactory(), pinned)
            // Straight to the computer's address: a system proxy must not see or reroute the connection.
            .proxy(java.net.Proxy.NO_PROXY)
            // After the handshake, OkHttp checks the host name. Only the computer's own address passes, and only when
            // the certificate it presented names it.
            .hostnameVerifier((hostname, session) -> {
                try {
                    return (
                        host.address.equals(hostname) &&
                        hasAddress((X509Certificate) session.getPeerCertificates()[0], hostname)
                    );
                } catch (Exception ignored) {
                    return false;
                }
            })
            // No redirects either: every request goes to this computer's address and nowhere else.
            .followRedirects(false)
            .followSslRedirects(false)
            .connectTimeout(8, java.util.concurrent.TimeUnit.SECONDS)
            .readTimeout(0, java.util.concurrent.TimeUnit.SECONDS)
            .pingInterval(15, java.util.concurrent.TimeUnit.SECONDS)
            .build();
    }
}
