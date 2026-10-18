package local.yesmachine.android;

import static org.junit.Assert.*;

import org.junit.Test;

/**
 * Tests how AdvancedSession reads advanced mode's heartbeat. Advanced mode's stream server (android/stream) keeps a
 * debug property holding the time of its last beat on SystemClock.elapsedRealtime, then, once it knows it, a space and
 * the connected computer's name. A beat less than five seconds old means that a computer is connected.
 */
public class AdvancedSessionTest {

    @Test
    public void aRecentBeatMeansAComputerIsConnected() {
        assertTrue(AdvancedSession.live("100000", 100000));
        assertTrue(AdvancedSession.live(" 100000\n", 104999));
    }

    @Test
    public void aStaleMissingOrForeignBeatDoesNot() {
        assertFalse("five seconds without a beat", AdvancedSession.live("100000", 105000));
        assertFalse("cleared at the end", AdvancedSession.live("", 100000));
        assertFalse(AdvancedSession.live(null, 100000));
        assertFalse("from before a restart", AdvancedSession.live("200000", 100000));
        assertFalse(AdvancedSession.live("soon", 100000));
    }

    @Test
    public void theBeatCarriesTheComputersNameOnceItIsKnown() {
        assertTrue(AdvancedSession.live("100000 Alejandros-MacBook-Pro", 101000));
        assertEquals(
            "Alejandros-MacBook-Pro",
            AdvancedSession.computer("100000 Alejandros-MacBook-Pro")
        );
        assertEquals(
            "Alejandro’s Mac mini",
            AdvancedSession.computer(" 100000 Alejandro’s Mac mini\n")
        );
        assertEquals("", AdvancedSession.computer("100000"));
        assertEquals("", AdvancedSession.computer(""));
        assertEquals("", AdvancedSession.computer(null));
    }
}
