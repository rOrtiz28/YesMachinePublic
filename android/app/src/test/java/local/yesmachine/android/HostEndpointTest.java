package local.yesmachine.android;

import static org.junit.Assert.*;

import org.junit.Test;

/**
 * Tests HostEndpoint, which every computer's address passes through. Only numeric private IPv4 addresses are accepted
 * (no host names, loopback, public addresses, leading zeros, IPv6 or URL tricks); a typed address may start with
 * https:// and carry a port, but nothing else a URL can hold; and labels from the network come out short, without
 * control characters and never ending in half an emoji.
 */
public class HostEndpointTest {

    @Test
    public void onlyPrivateNumericIpv4IsAccepted() {
        for (String ip : new String[] {
            "10.0.0.1",
            "172.16.1.2",
            "172.31.255.1",
            "192.168.1.52",
            "169.254.1.2",
        })
            assertTrue(ip, HostEndpoint.isPrivate(ip));
        for (String ip : new String[] {
            "8.8.8.8",
            "localhost",
            "192.168.1.52.evil.test",
            "127.0.0.1",
            "0.0.0.0",
            "172.32.0.1",
            "192.168.1.999",
            "192.168.001.2",
            "[::1]",
            "192.168.1.2@8.8.8.8",
        })
            assertFalse(ip, HostEndpoint.isPrivate(ip));
    }

    @Test
    public void manualInputParsesHttpsWithoutPermittingUrlsOrCredentials() {
        assertEquals(
            "https://192.168.1.52:4777",
            HostEndpoint.parse("https://192.168.1.52:4777/").origin()
        );
        assertEquals("192.168.1.52:4777", HostEndpoint.parse("192.168.1.52").authority());
        for (String value : new String[] {
            "http://192.168.1.52",
            "https://user@192.168.1.52",
            "192.168.1.52/path",
            "192.168.1.52:0",
            "192.168.1.52:65536",
            "192.168.1.52#fragment",
            "192.168.1.52?query",
            "192.168.1.52:-1",
        }) {
            assertThrows(value, IllegalArgumentException.class, () -> HostEndpoint.parse(value));
        }
    }

    @Test
    public void discoveryLabelsAreBoundedAndPlain() {
        assertEquals("fallback", HostEndpoint.cleanLabel("  ", "fallback"));
        assertEquals(
            80,
            HostEndpoint.cleanLabel(
                new String(new char[100]).replace('\0', 'a'),
                "fallback"
            ).length()
        );
        assertEquals("safe name", HostEndpoint.cleanLabel("safe\nname", "fallback"));
        // A cut through an emoji drops its first half too.
        assertEquals(
            "a".repeat(79),
            HostEndpoint.cleanLabel("a".repeat(79) + "\uD83D\uDE00", "fallback")
        );
    }
}
