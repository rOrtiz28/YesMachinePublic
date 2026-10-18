package local.yesmachine.android;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Finds the computers on the local network that share with Yes Machine, through mDNS (DNS-SD, with Android's
 * NsdManager), for the home screen's list. MainActivity starts and stops it and passes the list on to the home page.
 *
 * A sharing computer announces the service type "_yes-machine._tcp" with these TXT attributes: v (the announcement's
 * format, "1"), ip (the address it shares on), name, platform and os (its operating system and version). It also
 * announces its certificate's fingerprint (fp), which this app ignores. The announcement is only a hint: the address
 * must still be private IPv4 (HostEndpoint), and the certificate is read from the computer itself and checked before
 * anything is sent to it.
 *
 * Android often reports a computer that starts sharing late, or not at all, while one search runs. So the search
 * restarts every 10 seconds (each search is a "round") and keeps the list between rounds. A computer that is no
 * longer announced drops out after 35 seconds without being seen, checked at the start of each round, or at once
 * when it says goodbye.
 *
 * The class is used from the main thread, and NsdManager's callbacks are posted there too. Each round has a number
 * (generation), and callbacks that arrive late from an earlier round are ignored.
 */
final class LanDiscovery {

    /** Called on the main thread. status() carries an error to show, or null once discovery runs. */
    interface Listener {
        void changed(List<HostEndpoint> hosts);
        void status(String error);
    }

    // How often a new round starts, and how long a computer stays listed without being seen.
    private static final long ROUND_MS = 10_000,
        FORGET_MS = 35_000;
    private final NsdManager manager;
    private final WifiManager wifi;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Listener listener;
    // The list, by mDNS service name, in the order the computers were found, and when each was last resolved.
    private final Map<String, HostEndpoint> hosts = new LinkedHashMap<>();
    private final Map<String, Long> lastSeen = new HashMap<>();
    // The service names found in this round, so each is resolved once a round, and the ones waiting to be resolved.
    private final Set<String> seen = new HashSet<>();
    private final ArrayDeque<NsdServiceInfo> queue = new ArrayDeque<>();
    private final Runnable nextRound = this::round;
    private NsdManager.DiscoveryListener discovery;
    private WifiManager.MulticastLock multicast;
    private boolean running, resolving;
    private int generation;

    LanDiscovery(Context context, Listener listener) {
        manager = (NsdManager) context.getSystemService(Context.NSD_SERVICE);
        wifi = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        this.listener = listener;
    }

    // --- Starting and stopping ---

    /**
     * Starts discovering, if it isn't running yet. A Wi-Fi multicast lock is held meanwhile, since without one
     * Android's Wi-Fi may filter out the multicast packets mDNS uses. If the lock can't be had, discovery goes on
     * without it.
     */
    void start() {
        if (running) return;
        running = true;
        try {
            multicast = wifi.createMulticastLock("yes-machine-discovery");
            multicast.setReferenceCounted(false);
            multicast.acquire();
        } catch (Exception ignored) {}
        begin();
    }

    /** Starts a new round now, for the refresh button. */
    void refresh() {
        if (running) round();
    }

    /** Stops discovering and releases the multicast lock. The list stays for the next start. */
    void stop() {
        running = false;
        end();
        if (multicast != null && multicast.isHeld()) multicast.release();
        multicast = null;
    }

    // --- Rounds ---

    /** Ends the current search, drops the computers not seen for a while, and starts the next search. */
    private void round() {
        if (!running) return;
        end();
        prune();
        begin();
    }

    /** Starts one search, and schedules the next round. */
    private void begin() {
        final int token = ++generation;
        seen.clear();
        queue.clear();
        discovery = new NsdManager.DiscoveryListener() {
            public void onDiscoveryStarted(String type) {
                ui.post(() -> {
                    if (token == generation) listener.status(null);
                });
            }

            public void onDiscoveryStopped(String type) {}

            public void onStartDiscoveryFailed(String type, int code) {
                ui.post(() -> {
                    if (token == generation) listener.status(
                        "Discovery is unavailable right now. You can still add a computer by its address."
                    );
                });
            }

            public void onStopDiscoveryFailed(String type, int code) {}

            public void onServiceFound(NsdServiceInfo service) {
                ui.post(() -> {
                    // Android reports the type with or without the final dot.
                    if (
                        token != generation ||
                        !service.getServiceType().replaceAll("\\.$", "").equals("_yes-machine._tcp")
                    ) return;
                    // At most 100 services a round, so a flood of announcements can't grow the queue without end.
                    if (seen.size() < 100 && seen.add(service.getServiceName())) {
                        queue.add(service);
                        resolveNext();
                    }
                });
            }

            // A computer that stops sharing says goodbye, and leaves the list at once.
            public void onServiceLost(NsdServiceInfo service) {
                ui.post(() -> {
                    if (token != generation) return;
                    String name = service.getServiceName();
                    seen.remove(name);
                    lastSeen.remove(name);
                    queue.removeIf(item -> item.getServiceName().equals(name));
                    if (hosts.remove(name) != null) publish();
                });
            }
        };
        try {
            manager.discoverServices("_yes-machine._tcp.", NsdManager.PROTOCOL_DNS_SD, discovery);
        } catch (Exception error) {
            discovery = null;
            listener.status(
                "Discovery needs a local network. You can still add a computer by its address."
            );
        }
        // The next round comes even when this search couldn't start, so discovery recovers on its own.
        ui.postDelayed(nextRound, ROUND_MS);
    }

    /** Stops the current search and cancels the next round. Callbacks still on their way from it are then ignored. */
    private void end() {
        ui.removeCallbacks(nextRound);
        ++generation;
        queue.clear();
        if (discovery != null) {
            try {
                manager.stopServiceDiscovery(discovery);
            } catch (Exception ignored) {}
            discovery = null;
        }
    }

    /** Drops the computers not resolved in the last FORGET_MS, and tells the listener if any went. */
    private void prune() {
        long now = SystemClock.elapsedRealtime();
        boolean changed = false;
        for (
            Iterator<Map.Entry<String, HostEndpoint>> it = hosts.entrySet().iterator();
            it.hasNext();

        ) {
            String name = it.next().getKey();
            Long last = lastSeen.get(name);
            if (last == null || now - last > FORGET_MS) {
                it.remove();
                lastSeen.remove(name);
                changed = true;
            }
        }
        if (changed) publish();
    }

    // --- Resolving what was found ---

    /** A TXT attribute as text, or "" when it's missing or longer than 256 bytes. */
    private static String attribute(NsdServiceInfo service, String key) {
        byte[] bytes = service.getAttributes().get(key);
        return bytes == null || bytes.length > 256 ? "" : new String(bytes, StandardCharsets.UTF_8);
    }

    /**
     * Resolves the next service in the queue: asks Android for its address, port and TXT attributes. Android resolves
     * one service at a time, so resolutions run in a queue. A resolution still running from an earlier round finishes
     * before the next starts, and its result is ignored.
     */
    private void resolveNext() {
        if (resolving || queue.isEmpty()) return;
        resolving = true;
        final int token = generation;
        final NsdServiceInfo item = queue.remove();
        try {
            manager.resolveService(
                item,
                new NsdManager.ResolveListener() {
                    public void onResolveFailed(NsdServiceInfo service, int error) {
                        ui.post(() -> {
                            resolving = false;
                            resolveNext();
                        });
                    }

                    public void onServiceResolved(NsdServiceInfo service) {
                        ui.post(() -> {
                            resolving = false;
                            if (token == generation && running) accept(
                                item.getServiceName(),
                                service
                            );
                            resolveNext();
                        });
                    }
                }
            );
        } catch (Exception error) {
            resolving = false;
            ui.post(this::resolveNext);
        }
    }

    /**
     * Adds or updates a resolved computer. Only announcements in format "1" count. The address is the one the computer
     * announces in its ip attribute (the address it shares on, which its certificate names) when that's private IPv4,
     * or else the one mDNS resolved; HostEndpoint refuses anything that isn't private IPv4. The listener hears only of
     * real changes: a new computer, or a new address, port, name or system.
     */
    private void accept(String name, NsdServiceInfo service) {
        if (!"1".equals(attribute(service, "v"))) return;
        String ip = attribute(service, "ip");
        if (!HostEndpoint.isPrivate(ip) && service.getHost() != null) ip = service
            .getHost()
            .getHostAddress();
        HostEndpoint host;
        try {
            host = new HostEndpoint(
                ip,
                service.getPort(),
                attribute(service, "name"),
                attribute(service, "platform"),
                attribute(service, "os")
            );
        } catch (IllegalArgumentException ignored) {
            return;
        }
        lastSeen.put(name, SystemClock.elapsedRealtime());
        HostEndpoint previous = hosts.put(name, host);
        if (
            previous == null ||
            !previous.authority().equals(host.authority()) ||
            !previous.name.equals(host.name) ||
            !previous.system.equals(host.system)
        ) publish();
    }

    /** Gives the listener a copy of the list. */
    private void publish() {
        listener.changed(new ArrayList<>(hosts.values()));
    }
}
