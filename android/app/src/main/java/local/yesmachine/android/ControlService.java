package local.yesmachine.android;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.accessibilityservice.InputMethod;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.Point;
import android.hardware.display.DisplayManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Display;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;

/**
 * General mode's hands on this device: an accessibility service that does what the computer in control asks.
 *
 * The person allows it in Android's Accessibility settings. ShareService reads the computer's messages and calls this
 * service through ControlService.current, which is null while it isn't allowed:
 *
 *   - touches and the mouse wheel become gestures;
 *   - Back, Home and Recents (and Escape, as Back) become the system's own actions;
 *   - other keys and typed text go to the focused field, through the input connection that Android 13 gives
 *     accessibility services (res/xml/control_service.xml asks for it); earlier versions get no typing;
 *   - keyboard() keeps the on-screen keyboard out of the way while the computer types;
 *   - readClipboard() looks at the clipboard when the computer asks, for the shared clipboard.
 *
 * It ignores accessibility events and reads nothing on the screen. Touches, the wheel, the clipboard and the keyboard
 * are handled on the main thread; keys and text go straight to the input connection, from the caller's thread.
 */
public final class ControlService extends AccessibilityService {

    /** The running service, or null while Accessibility doesn't allow it. */
    static volatile ControlService current;

    private final Handler main = new Handler(Looper.getMainLooper());
    private GestureDescription.StrokeDescription stroke; // the finger that is down, if any
    private float lastX, lastY; // where the finger was at the last touch
    private long lastTime; // when that touch played, on SystemClock.uptimeMillis()

    // --- Service lifecycle ---

    @Override
    protected void onServiceConnected() {
        current = this;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {}

    @Override
    public void onInterrupt() {}

    @Override
    public void onDestroy() {
        if (current == this) current = null;
        super.onDestroy();
    }

    // --- Touches ---

    /**
     * Plays one touch from the computer, at x and y in screen pixels: action 0 puts the finger down, 2 moves it and 1
     * lifts it. One finger is one stroke that goes on until the computer lifts it: each move continues it with a line
     * from the last point, played over the time since the last touch (1 to 50 ms), so the gesture keeps the
     * computer's pace. A move or lift without a finger down is ignored.
     */
    void touch(final int action, final float x, final float y) {
        main.post(
            new Runnable() {
                @Override
                public void run() {
                    long now = SystemClock.uptimeMillis();
                    Path path = new Path();
                    if (action == 0) {
                        // A stroke of one point that stays down (willContinue) for the next touch.
                        path.moveTo(x, y);
                        stroke = new GestureDescription.StrokeDescription(path, 0, 1, true);
                    } else {
                        if (stroke == null) return;
                        path.moveTo(lastX, lastY);
                        path.lineTo(x, y);
                        long duration = Math.max(1, Math.min(now - lastTime, 50));
                        // Only a move leaves the finger down.
                        stroke = stroke.continueStroke(path, 0, duration, action == 2);
                    }
                    lastX = x;
                    lastY = y;
                    lastTime = now;
                    dispatchGesture(
                        new GestureDescription.Builder().addStroke(stroke).build(),
                        null,
                        null
                    );
                    if (action == 1) stroke = null;
                }
            }
        );
    }

    // --- Wheel ---

    // The wheel becomes a short swipe, which pauses before the finger lifts so that the page doesn't fling. Small
    // steps, as a trackpad sends, add up until they are worth a swipe. The swipe stays on the screen: Android refuses a
    // gesture that goes past its top or left edge.
    private static final float SCROLL_STEP = 90f; // pixels of swipe for one step of the wheel
    private float pendingX, pendingY; // swipe that has added up but not played yet, in pixels
    private boolean scrolling; // a swipe is playing; steps that arrive meanwhile wait for the next one

    /**
     * Scrolls at x and y (screen pixels) by the wheel's horizontal and vertical steps. Once 12 pixels or more have
     * added up on either axis, plays them as a swipe from that point, at most 600 pixels each way, over 80 ms; the
     * finger then stays still for 60 ms and lifts. One swipe plays at a time.
     */
    void scroll(final float x, final float y, final float horizontal, final float vertical) {
        main.post(
            new Runnable() {
                @Override
                public void run() {
                    pendingX += horizontal * SCROLL_STEP;
                    pendingY += vertical * SCROLL_STEP;
                    if (scrolling || (Math.abs(pendingX) < 12 && Math.abs(pendingY) < 12)) return;
                    Point size = new Point();
                    getSystemService(DisplayManager.class)
                        .getDisplay(Display.DEFAULT_DISPLAY)
                        .getRealSize(size);
                    final float startX = inside(x, size.x),
                        startY = inside(y, size.y);
                    final float endX = inside(
                        startX + Math.max(-600, Math.min(600, pendingX)),
                        size.x
                    );
                    final float endY = inside(
                        startY + Math.max(-600, Math.min(600, pendingY)),
                        size.y
                    );
                    pendingX = 0;
                    pendingY = 0;
                    Path move = new Path();
                    move.moveTo(startX, startY);
                    move.lineTo(endX, endY);
                    final GestureDescription.StrokeDescription swipe =
                        new GestureDescription.StrokeDescription(move, 0, 80, true);
                    scrolling = true;
                    dispatchGesture(
                        new GestureDescription.Builder().addStroke(swipe).build(),
                        new GestureResultCallback() {
                            // The swipe is done: hold the finger still at its end, then lift it.
                            @Override
                            public void onCompleted(GestureDescription gesture) {
                                Path hold = new Path();
                                hold.moveTo(endX, endY);
                                dispatchGesture(
                                    new GestureDescription.Builder()
                                        .addStroke(swipe.continueStroke(hold, 0, 60, false))
                                        .build(),
                                    new GestureResultCallback() {
                                        @Override
                                        public void onCompleted(GestureDescription done) {
                                            scrolling = false;
                                        }

                                        @Override
                                        public void onCancelled(GestureDescription done) {
                                            scrolling = false;
                                        }
                                    },
                                    main
                                );
                            }

                            @Override
                            public void onCancelled(GestureDescription gesture) {
                                scrolling = false;
                            }
                        },
                        main
                    );
                }
            }
        );
    }

    /** value, moved onto the screen if needed: from 0 to size - 1. */
    private static float inside(float value, int size) {
        return Math.max(0, Math.min(size - 1, value));
    }

    // --- Keys and text ---

    /**
     * Plays a key from the computer: action is KeyEvent.ACTION_DOWN or ACTION_UP, code an Android key code, and meta
     * its modifier state. Back, Home and Recents are the system's own actions, and Escape works as Back; they happen
     * when the key is released. Other keys reach the focused field, on Android 13 and later.
     */
    void key(int action, int code, int meta) {
        if (
            code == KeyEvent.KEYCODE_BACK ||
            code == KeyEvent.KEYCODE_ESCAPE ||
            code == KeyEvent.KEYCODE_HOME ||
            code == KeyEvent.KEYCODE_APP_SWITCH
        ) {
            if (action != KeyEvent.ACTION_UP) return;
            performGlobalAction(
                code == KeyEvent.KEYCODE_HOME
                    ? GLOBAL_ACTION_HOME
                    : code == KeyEvent.KEYCODE_APP_SWITCH
                      ? GLOBAL_ACTION_RECENTS
                      : GLOBAL_ACTION_BACK
            );
            return;
        }
        if (Build.VERSION.SDK_INT < 33) return;
        InputMethod input = getInputMethod();
        InputMethod.AccessibilityInputConnection connection =
            input == null ? null : input.getCurrentInputConnection();
        if (connection == null) return;
        long now = SystemClock.uptimeMillis();
        connection.sendKeyEvent(new KeyEvent(now, now, action, code, 0, meta));
    }

    /** Types text into the focused field, on Android 13 and later. */
    void text(String value) {
        if (Build.VERSION.SDK_INT < 33) return;
        InputMethod input = getInputMethod();
        InputMethod.AccessibilityInputConnection connection =
            input == null ? null : input.getCurrentInputConnection();
        if (connection != null) connection.commitText(value, 1, null);
    }

    // --- Clipboard ---

    /** Hears what readClipboard() found, on the main thread: the clip, or null when there was none to read. */
    interface Copied {
        void copied(ClipData clip);
    }

    /**
     * Reads the clipboard and hands what it found to done.
     *
     * Android lets only the app in front read the clipboard. So this service shows a window of its own, one pixel and
     * invisible, takes the focus for a moment, reads the clipboard, and gives the focus back by removing the window.
     * Without the focus within half a second, it answers with what it could read, maybe nothing.
     */
    void readClipboard(final Copied done) {
        main.post(
            new Runnable() {
                @Override
                public void run() {
                    final ClipboardManager clipboard = getSystemService(ClipboardManager.class);
                    final WindowManager windows = getSystemService(WindowManager.class);
                    final View probe = new View(ControlService.this);
                    // So that the focus and the half-second wait don't both answer.
                    final boolean[] finished = { false };
                    final Runnable finish = new Runnable() {
                        @Override
                        public void run() {
                            if (finished[0]) return;
                            finished[0] = true;
                            ClipData clip = null;
                            try {
                                clip = clipboard.getPrimaryClip();
                            } catch (Exception denied) {}
                            try {
                                windows.removeView(probe);
                            } catch (Exception gone) {}
                            done.copied(clip);
                        }
                    };
                    // A focusable window (it doesn't say FLAG_NOT_FOCUSABLE) that lets touches outside it through,
                    // and that the on-screen keyboard leaves alone.
                    WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                        1,
                        1,
                        WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                        WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL |
                            WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM,
                        PixelFormat.TRANSLUCENT
                    );
                    params.gravity = Gravity.TOP | Gravity.START;
                    probe.getViewTreeObserver().addOnWindowFocusChangeListener(hasFocus -> {
                        if (hasFocus) finish.run();
                    });
                    try {
                        windows.addView(probe, params);
                    } catch (Exception refused) {
                        finished[0] = true;
                        done.copied(null);
                        return;
                    }
                    main.postDelayed(finish, 500);
                }
            }
        );
    }

    // --- On-screen keyboard ---

    /**
     * Hides the on-screen keyboard (show false), as while a computer is in control, or lets Android show it as usual
     * again (show true).
     */
    void keyboard(final boolean show) {
        main.post(
            new Runnable() {
                @Override
                public void run() {
                    getSoftKeyboardController().setShowMode(
                        show ? SHOW_MODE_AUTO : SHOW_MODE_HIDDEN
                    );
                }
            }
        );
    }
}
