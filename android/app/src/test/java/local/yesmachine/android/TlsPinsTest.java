package local.yesmachine.android;

import static org.junit.Assert.*;

import java.io.InputStream;
import java.net.InetAddress;
import java.security.KeyFactory;
import java.security.KeyStore;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Base64;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLServerSocket;
import javax.net.ssl.SSLSocket;
import okhttp3.OkHttpClient;
import org.junit.Test;

/**
 * Tests TlsPins over real TLS, on loopback only. TestServer listens on 127.0.0.1 with the fixture certificate and key
 * in src/test/resources: a self-signed certificate for the IP address 192.168.1.20. The fixture key is public test
 * data, never a host identity. The tests open sockets with the pinned client's own socket factory, so its certificate
 * checks compare against the endpoint's address while the connection goes to loopback, and they call the client's
 * host name check directly.
 *
 * The fixture certificate is valid until 5 October 2027. After that, the test that expects a successful handshake fails
 * until the fixture is replaced.
 */
public class TlsPinsTest {

    // --- Fixtures ---

    private static X509Certificate certificate() throws Exception {
        try (InputStream input = TlsPinsTest.class.getResourceAsStream("/test-host-cert.pem")) {
            return (X509Certificate) CertificateFactory.getInstance("X.509").generateCertificate(
                input
            );
        }
    }

    private static class TestServer implements AutoCloseable {

        final SSLServerSocket listener;
        final ExecutorService worker = Executors.newSingleThreadExecutor();

        TestServer() throws Exception {
            String pem;
            try (InputStream input = TlsPinsTest.class.getResourceAsStream("/test-host-key.pem")) {
                pem = new String(input.readAllBytes(), java.nio.charset.StandardCharsets.US_ASCII);
            }
            byte[] key = Base64.getDecoder().decode(
                pem.replaceAll("-----[^-]+-----", "").replaceAll("\\s", "")
            );
            KeyStore store = KeyStore.getInstance("PKCS12");
            store.load(null, null);
            char[] password = "public-test-fixture".toCharArray();
            store.setKeyEntry(
                "host",
                KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(key)),
                password,
                new java.security.cert.Certificate[] { certificate() }
            );
            KeyManagerFactory keys = KeyManagerFactory.getInstance(
                KeyManagerFactory.getDefaultAlgorithm()
            );
            keys.init(store, password);
            SSLContext context = SSLContext.getInstance("TLS");
            context.init(keys.getKeyManagers(), null, null);
            listener = (SSLServerSocket) context
                .getServerSocketFactory()
                .createServerSocket(0, 4, InetAddress.getByName("127.0.0.1"));
            worker.submit(() -> {
                try (SSLSocket socket = (SSLSocket) listener.accept()) {
                    socket.setSoTimeout(5000);
                    socket.startHandshake();
                } catch (Exception ignored) {
                    /* Rejection is expected in negative tests. */
                }
            });
        }

        @Override
        public void close() throws Exception {
            listener.close();
            worker.shutdownNow();
        }
    }

    private static void close(OkHttpClient client) {
        client.dispatcher().executorService().shutdown();
        client.connectionPool().evictAll();
    }

    // --- Tests ---

    @Test
    public void exactApprovedLeafPinAllowsTlsAndBindsHostname() throws Exception {
        HostEndpoint host = new HostEndpoint("192.168.1.20", 4777, "Test host", "test");
        OkHttpClient client = TlsPins.client(host, TlsPins.fingerprint(certificate()));
        try (
            TestServer server = new TestServer();
            SSLSocket socket = (SSLSocket) client
                .sslSocketFactory()
                .createSocket("127.0.0.1", server.listener.getLocalPort())
        ) {
            socket.startHandshake();
            assertTrue(client.hostnameVerifier().verify(host.address, socket.getSession()));
            assertFalse(client.hostnameVerifier().verify("192.168.1.21", socket.getSession()));
            assertFalse(client.hostnameVerifier().verify("8.8.8.8", socket.getSession()));
        } finally {
            close(client);
        }
    }

    @Test
    public void aChangedCertificatePinRejectsTheHandshake() throws Exception {
        String actual = TlsPins.fingerprint(certificate());
        String wrong = (actual.charAt(0) == 'A' ? "B" : "A") + actual.substring(1);
        OkHttpClient client = TlsPins.client(
            new HostEndpoint("192.168.1.20", 4777, "Test", "test"),
            wrong
        );
        try (
            TestServer server = new TestServer();
            SSLSocket socket = (SSLSocket) client
                .sslSocketFactory()
                .createSocket("127.0.0.1", server.listener.getLocalPort())
        ) {
            assertThrows(javax.net.ssl.SSLHandshakeException.class, socket::startHandshake);
        } finally {
            close(client);
        }
    }

    @Test
    public void aMatchingPinCannotAuthorizeTheWrongIpAddress() throws Exception {
        OkHttpClient client = TlsPins.client(
            new HostEndpoint("192.168.1.21", 4777, "Test", "test"),
            TlsPins.fingerprint(certificate())
        );
        try (
            TestServer server = new TestServer();
            SSLSocket socket = (SSLSocket) client
                .sslSocketFactory()
                .createSocket("127.0.0.1", server.listener.getLocalPort())
        ) {
            assertThrows(javax.net.ssl.SSLHandshakeException.class, socket::startHandshake);
        } finally {
            close(client);
        }
    }

    @Test
    public void malformedOrMissingPinsNeverBuildATransport() {
        HostEndpoint host = new HostEndpoint("192.168.1.20", 4777, "Test", "test");
        for (String pin : new String[] { null, "", "trust-all", "00:11" }) {
            assertThrows(java.security.cert.CertificateException.class, () ->
                TlsPins.client(host, pin)
            );
        }
    }

    @Test
    public void systemProxyCannotRerouteTheLanConnection() throws Exception {
        java.net.ProxySelector previous = java.net.ProxySelector.getDefault();
        java.net.ProxySelector.setDefault(
            new java.net.ProxySelector() {
                public java.util.List<java.net.Proxy> select(java.net.URI uri) {
                    return java.util.Collections.singletonList(
                        new java.net.Proxy(
                            java.net.Proxy.Type.HTTP,
                            new java.net.InetSocketAddress("127.0.0.1", 8080)
                        )
                    );
                }

                public void connectFailed(
                    java.net.URI uri,
                    java.net.SocketAddress address,
                    java.io.IOException error
                ) {}
            }
        );
        OkHttpClient client = null;
        try {
            client = TlsPins.client(
                new HostEndpoint("192.168.1.20", 4777, "Test", "test"),
                TlsPins.fingerprint(certificate())
            );
            assertEquals(java.net.Proxy.NO_PROXY, client.proxy());
            assertEquals(
                java.util.Collections.singletonList(java.net.Proxy.NO_PROXY),
                client.proxySelector().select(new java.net.URI("https://192.168.1.20:4777/session"))
            );
            assertFalse(client.followRedirects());
            assertFalse(client.followSslRedirects());
        } finally {
            if (client != null) close(client);
            java.net.ProxySelector.setDefault(previous);
        }
    }
}
