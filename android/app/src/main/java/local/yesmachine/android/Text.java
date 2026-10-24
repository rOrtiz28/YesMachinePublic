package local.yesmachine.android;

/**
 * Cutting names to a length: computers' labels (HostEndpoint) and the names of received files (FileChannel,
 * NativeSession). Advanced mode's stream server, a separate program, cuts its file names the same way (Files).
 */
final class Text {

    private Text() {}

    /**
     * text cut to at most length chars, as String.length() counts, without leaving half a character behind. Most
     * emoji, and every other character outside the Basic Multilingual Plane, take two chars (a surrogate pair); a cut
     * between the two drops the first.
     */
    static String cut(String text, int length) {
        if (text.length() <= length) return text;
        int end = Character.isHighSurrogate(text.charAt(length - 1)) ? length - 1 : length;
        return text.substring(0, end);
    }
}
