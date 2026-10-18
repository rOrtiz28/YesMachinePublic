package local.yesmachine.android;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * General mode's sharing state, in one place for ShareService, which changes it, and MainActivity, whose home screen
 * shows it: whether this device is sharing, the computer in control, and a computer waiting for the person's answer.
 * Both run in this app's process, so plain static fields hold it.
 *
 * Listeners are called on the thread that made the change, often one of ShareService's network threads, so a
 * listener that changes the screen must move to the main thread first, as MainActivity does.
 */
final class ShareState {

    /** Hears every change to the sharing state. */
    interface Listener {
        void changed();
    }

    /** A computer that wants to control this device, until the person here allows or denies it. */
    static final class Request {

        // id: a random id for this request, which the person's answer carries back (ShareService.answer). name and
        // system: what the computer says about itself. address: its IP address. fingerprint: its certificate's
        // fingerprint, or "" when it showed no certificate.
        final String id, name, system, address, fingerprint;

        Request(String id, String name, String system, String address, String fingerprint) {
            this.id = id;
            this.name = name;
            this.system = system;
            this.address = address;
            this.fingerprint = fingerprint;
        }
    }

    static volatile String sharing = "off"; // off, waiting (for a computer) or connected
    static volatile String computer = ""; // the computer in control
    static volatile Request asking; // a computer waiting for an answer
    private static final List<Listener> listeners = new CopyOnWriteArrayList<>();

    private ShareState() {}

    static void listen(Listener listener) {
        listeners.add(listener);
    }

    static void unlisten(Listener listener) {
        listeners.remove(listener);
    }

    /** Sets whether this device is sharing ("off", "waiting" or "connected") and the computer in control. */
    static void update(String state, String name) {
        sharing = state;
        computer = name == null ? "" : name;
        tell();
    }

    /** Sets the computer waiting for an answer, or null once the person has answered. */
    static void ask(Request request) {
        asking = request;
        tell();
    }

    /** Tells every listener that something changed. */
    static void tell() {
        for (Listener listener : listeners) listener.changed();
    }
}
