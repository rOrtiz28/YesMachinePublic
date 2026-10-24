package local.yesmachine.android;

import java.util.regex.Pattern;

/**
 * A computer to connect to: its private IPv4 address and port, and the labels the home screen shows for it.
 *
 * Every address the app's network code uses passes through this class, whether it came from mDNS discovery
 * (LanDiscovery) or from the home page's requests (MainActivity). Only numeric private IPv4 addresses are accepted, so
 * nothing is ever resolved through DNS, and an address can't carry a user name, a path or a second host the way a URL
 * can. A computer's "address:port" (authority()) is also the key under which the app keeps its approved certificate
 * and its remembered sign-in.
 */
public final class HostEndpoint {

    // Four numbers separated by dots, without leading zeros, so that no parser can read a part as octal and reach a
    // different address. isPrivate() checks that each number is at most 255.
    private static final Pattern IPV4 = Pattern.compile(
        "(?:0|[1-9][0-9]{0,2})(?:\\.(?:0|[1-9][0-9]{0,2})){3}"
    );
    /**
     * name and platform are the labels for the home screen, cleaned by cleanLabel(). system is the operating system
     * and version a computer announces, such as "Ubuntu 24.04", or empty.
     */
    public final String address, name, platform, system;
    public final int port;

    /** An endpoint whose operating system isn't known. */
    public HostEndpoint(String address, int port, String name, String platform) {
        this(address, port, name, platform, "");
    }

    /**
     * Checks the address and port, and cleans the labels: an empty name becomes the address, an empty platform
     * becomes "Computer", and system is cut to 48 characters.
     *
     * @throws IllegalArgumentException when the address isn't private IPv4 or the port is outside 1 to 65535
     */
    public HostEndpoint(String address, int port, String name, String platform, String system) {
        if (!isPrivate(address) || port < 1 || port > 65535) throw new IllegalArgumentException(
            "Enter a private IPv4 address and a valid port."
        );
        this.address = address;
        this.port = port;
        this.name = cleanLabel(name, address);
        this.platform = cleanLabel(platform, "Computer");
        String os = cleanLabel(system, "");
        this.system = Text.cut(os, 48);
    }

    /**
     * Reads an address written as text: "192.168.1.25", "192.168.1.25:4777" or "https://192.168.1.25:4777/". The
     * port defaults to 4777, the port Yes Machine shares on. Anything else a URL can hold (a user name, a path, a
     * query or a fragment) is rejected. The home page sends the address and port separately, so today only the tests
     * use this.
     *
     * @throws IllegalArgumentException when the text isn't a private IPv4 address with an optional valid port
     */
    public static HostEndpoint parse(String input) {
        String text = input == null ? "" : input.trim();
        if (text.startsWith("https://")) text = text.substring(8);
        if (text.endsWith("/")) text = text.substring(0, text.length() - 1);
        String[] parts = text.split(":", -1);
        if (parts.length > 2) throw new IllegalArgumentException(
            "Use an address such as 192.168.1.25:4777."
        );
        int port = parts.length == 2 ? Integer.parseInt(parts[1]) : 4777;
        return new HostEndpoint(parts[0], port, parts[0], "Computer");
    }

    /**
     * Whether the text is a numeric IPv4 address in a private range: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, or
     * the link-local 169.254.0.0/16. Loopback, 0.0.0.0, public addresses, host names and IPv6 are all refused.
     */
    public static boolean isPrivate(String address) {
        if (address == null || !IPV4.matcher(address).matches()) return false;
        String[] components = address.split("\\.");
        int[] octets = new int[4];
        for (int i = 0; i < 4; i++) {
            octets[i] = Integer.parseInt(components[i]);
            if (octets[i] > 255) return false;
        }
        return (
            octets[0] == 10 ||
            (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31) ||
            (octets[0] == 192 && octets[1] == 168) ||
            (octets[0] == 169 && octets[1] == 254)
        );
    }

    /**
     * A label from the network (or typed) made safe to show: control characters and Unicode's bidirectional
     * embedding, override and isolate marks (U+202A to U+202E, U+2066 to U+2069) become spaces, so a name can't break
     * a line or reorder the text around it, and it keeps at most 80 characters, never cutting an emoji in half.
     * Returns fallback when the value is empty.
     */
    public static String cleanLabel(String value, String fallback) {
        if (value == null || value.trim().isEmpty()) return fallback;
        String plain = value.replaceAll("[\\p{Cntrl}\\u202a-\\u202e\\u2066-\\u2069]", " ");
        return Text.cut(plain, 80).trim();
    }

    /** The address and port as "192.168.1.25:4777", the key for this computer's saved certificate and sign-in. */
    public String authority() {
        return address + ":" + port;
    }

    /** The computer's HTTPS origin, such as "https://192.168.1.25:4777". */
    public String origin() {
        return "https://" + authority();
    }
}
