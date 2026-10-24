package local.yesmachine.android;

import static org.junit.Assert.*;

import org.junit.Test;

/**
 * Tests Text.cut, which cuts computers' labels and received file names to a length. The emoji in them, written
 * as \uD83D\uDE00 and \uD83C\uDF4E, take two chars each (a surrogate pair), so a cut can land between the two.
 */
public class TextTest {

    @Test
    public void aCutNeverEndsInHalfAnEmoji() {
        assertEquals("a".repeat(179), Text.cut("a".repeat(179) + "\uD83D\uDE00b", 180));
        assertEquals(
            "a".repeat(178) + "\uD83D\uDE00",
            Text.cut("a".repeat(178) + "\uD83D\uDE00b", 180)
        );
        assertEquals("abc", Text.cut("abcdef", 3));
    }

    @Test
    public void shortTextStaysAsItIs() {
        assertEquals("Alejandro’s Mac \uD83C\uDF4E", Text.cut("Alejandro’s Mac \uD83C\uDF4E", 80));
        assertEquals("", Text.cut("", 80));
    }
}
