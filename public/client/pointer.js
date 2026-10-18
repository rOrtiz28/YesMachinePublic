'use strict';
// The mouse and touch on the computer's screen. Positions go to the computer as fractions of its screen.
//  - A mouse: its buttons press and release, the wheel scrolls, and moves are sent at most once a frame. On a Mac
//    computer, a double-click goes as one message, since macOS needs the click count.
//  - Touch: one finger drags after it has stayed down 100 ms or moved 4 pixels (before that it may still become a
//    scroll), and two fingers scroll.
// Whenever the page or the video loses the focus, or the page is hidden, everything held down is let go.

// Pointer messages are numbered (pointerSeq), and the last move goes again on the reliable channel once the pointer
// rests (settleTimer, see pointer()).
let pointerSeq = 0;
let settleTimer = null;
// With a mouse, this device's own pointer can stand in for the computer's cursor, which then leaves the picture
// (a Windows computer offers it): it moves at once and takes the shape the computer's cursor has.
let localCursor = false;
// The cursor shapes the computer may name, which this device's pointer can take.
const CURSORS = new Set([
  'default',
  'text',
  'wait',
  'crosshair',
  'nwse-resize',
  'nesw-resize',
  'ew-resize',
  'ns-resize',
  'move',
  'not-allowed',
  'pointer',
  'progress',
  'help',
  'none',
]);
// The move waiting for the next frame, and that frame's request.
let moveFrame = null;
let queuedMove = null;
// Fingers on the screen by pointer id; the mouse buttons held; mouse pointers whose next pointerup is already
// handled (after a Mac double-click); and the touch gesture under way: 'pending', 'drag' or 'scroll'.
const touches = new Map();
const pointerButtons = new Set();
const suppressedPointerUps = new Set();
let touchMode = null;
let pendingTouch = null;
let touchTimer = null;
let scrollCenter = null;
let mousePointerId = null;

// --- Positions ------------------------------------------------------------------------------------------------

/**
 * Where an event is on the computer's screen, as fractions of its width and height, or null outside the picture.
 * The video keeps its shape inside its box, so the empty bands around the picture don't count. `clamp` keeps the
 * position at the picture's edge instead of returning null.
 */
function videoCoordinates(event, clamp = false) {
  if (!video.videoWidth || !video.videoHeight || video.readyState < 2) return null;
  const box = video.getBoundingClientRect();
  const scale = Math.min(box.width / video.videoWidth, box.height / video.videoHeight);
  const width = video.videoWidth * scale;
  const height = video.videoHeight * scale;
  if (!width || !height) return null;
  const x = (event.clientX - box.left - (box.width - width) / 2) / width;
  const y = (event.clientY - box.top - (box.height - height) / 2) / height;
  if (!clamp && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}

/** The middle of the fingers on the screen, in page coordinates. */
function touchCenter() {
  const values = [...touches.values()];
  return {
    x: values.reduce((sum, item) => sum + item.clientX, 0) / values.length,
    y: values.reduce((sum, item) => sum + item.clientY, 0) / values.length,
  };
}

// --- Sending ----------------------------------------------------------------------------------------------------

// Pointer messages are numbered so the host can drop a move that arrives after a newer one. Moves go on the
// host's pointer channel, which never waits for a lost packet; an older host has only the control channel.
// A lost move is replaced by the next one, so once the pointer stops, its final position goes again on the
// reliable channel and the remote pointer never rests short of where it was left.
function pointer(action, point, button = 0) {
  if (!point || activeInput === false) return;
  const message = { type: 'pointer', ...point, action, button, seq: ++pointerSeq };
  clearTimeout(settleTimer);
  settleTimer = null;
  if (
    action === 'move' &&
    moveChannel?.readyState === 'open' &&
    moveChannel.bufferedAmount < 65536
  ) {
    try {
      moveChannel.send(JSON.stringify(message));
      settleTimer = setTimeout(() => {
        settleTimer = null;
        sendControl({ ...message, seq: ++pointerSeq });
      }, 80);
      return;
    } catch {
      /* fall back to the control channel */
    }
  }
  sendControl(message);
}

/** Sends the move waiting for this frame, if there is one. */
function flushMove() {
  if (moveFrame !== null) cancelAnimationFrame(moveFrame);
  moveFrame = null;
  if (queuedMove) pointer('move', queuedMove);
  queuedMove = null;
}

/** Keeps the latest move for the next frame, so moves go at most once a frame. */
function queueMove(point) {
  queuedMove = point;
  if (moveFrame === null) moveFrame = requestAnimationFrame(flushMove);
}

/** A single finger that stayed down, or moved: it presses where it went down, and moves drag from there. */
function startTouchDrag() {
  clearTimeout(touchTimer);
  touchTimer = null;
  if (!pendingTouch || touches.size !== 1) return;
  pointer('down', pendingTouch.point);
  pendingTouch = null;
  touchMode = 'drag';
}

/** A button or finger let go: releases what it pressed. */
function pointerUp(event) {
  if (suppressedPointerUps.delete(event.pointerId)) {
    mousePointerId = null;
    if (video.hasPointerCapture(event.pointerId)) video.releasePointerCapture(event.pointerId);
    return;
  }
  if (event.pointerType === 'touch') {
    if (!touches.has(event.pointerId)) return;
    if (touchMode === 'pending') startTouchDrag();
    flushMove();
    if (touchMode === 'drag') pointer('up', videoCoordinates(event, true));
    touches.delete(event.pointerId);
    if (!touches.size) {
      touchMode = null;
      scrollCenter = null;
    } else if (touches.size >= 2) scrollCenter = touchCenter();
  } else if (pointerButtons.has(event.button)) {
    flushMove();
    pointer('up', videoCoordinates(event, true), event.button);
    pointerButtons.delete(event.button);
  }
  if (event.pointerType !== 'touch') mousePointerId = null;
  if (video.hasPointerCapture(event.pointerId)) video.releasePointerCapture(event.pointerId);
}

/**
 * Lets go of everything held down: the mouse buttons, the fingers and the keys, here and on the computer, and the
 * drawer's modifier keys.
 */
function releaseInput() {
  if (moveFrame !== null) cancelAnimationFrame(moveFrame);
  moveFrame = null;
  queuedMove = null;
  sendControl({ type: 'release' });
  keyboard.release();
  pointerButtons.clear();
  suppressedPointerUps.clear();
  mousePointerId = null;
  touches.clear();
  clearTimeout(touchTimer);
  touchTimer = null;
  pendingTouch = null;
  touchMode = null;
  scrollCenter = null;
  document
    .querySelectorAll('.modifier')
    .forEach((button) => button.setAttribute('aria-pressed', 'false'));
}

/** Connects the video's mouse, touch and wheel events, and lets go when the focus leaves. Called once by start.js. */
function setUpPointer() {
  video.addEventListener('pointerdown', (event) => {
    const point = videoCoordinates(event);
    if (!point || !paired) return;
    if (event.pointerType === 'touch') event.preventDefault();
    video.focus({ preventScroll: true });
    if (video.paused) video.play().catch(() => {});
    video.setPointerCapture(event.pointerId);
    if (event.pointerType === 'touch') {
      const previousTouch = touches.values().next().value;
      touches.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
      if (touches.size === 1 && !touchMode) {
        touchMode = 'pending';
        pendingTouch = { point, clientX: event.clientX, clientY: event.clientY };
        touchTimer = setTimeout(startTouchDrag, 100);
      } else if (touches.size >= 2) {
        clearTimeout(touchTimer);
        touchTimer = null;
        pendingTouch = null;
        if (touchMode === 'drag') {
          flushMove();
          pointer('up', videoCoordinates(previousTouch, true));
        }
        touchMode = 'scroll';
        scrollCenter = touchCenter();
      }
    } else mousePointerId = event.pointerId;
  });

  // MouseEvent.detail supplies the browser's click count; PointerEvent.detail
  // does not. Touch pointerdown prevents compatibility mouse events above.
  video.addEventListener('mousedown', (event) => {
    if (!paired || mousePointerId === null || ![0, 1, 2].includes(event.button)) return;
    const point = videoCoordinates(event);
    if (!point) return;
    event.preventDefault();
    if (
      hostPlatform === 'darwin' &&
      event.detail === 2 &&
      event.button === 0 &&
      activeInput !== false
    ) {
      flushMove();
      sendControl({ type: 'double-click', ...point, button: 0, seq: ++pointerSeq });
      suppressedPointerUps.add(mousePointerId);
    } else {
      for (const key of keyboard.pointer(event)) sendControl({ type: 'key', ...key });
      pointerButtons.add(event.button);
      pointer('down', point, event.button);
    }
  });

  video.addEventListener('pointermove', (event) => {
    if (!paired) return;
    if (event.pointerType === 'touch') {
      if (!touches.has(event.pointerId)) return;
      event.preventDefault();
      touches.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
      if (
        touchMode === 'pending' &&
        pendingTouch &&
        Math.hypot(event.clientX - pendingTouch.clientX, event.clientY - pendingTouch.clientY) > 4
      )
        startTouchDrag();
      if (touchMode === 'scroll' && touches.size >= 2) {
        const next = touchCenter();
        if (scrollCenter)
          sendControl({ type: 'wheel', dx: scrollCenter.x - next.x, dy: scrollCenter.y - next.y });
        scrollCenter = next;
      } else if (touchMode === 'drag') queueMove(videoCoordinates(event, true));
    } else {
      const point = videoCoordinates(event, pointerButtons.size > 0);
      if (point) queueMove(point);
    }
  });

  video.addEventListener('pointerup', pointerUp);
  // Mouseup also occurs when one of several held mouse buttons is released,
  // whereas pointerup occurs only after the last button is released.
  video.addEventListener('mouseup', (event) => {
    if (!pointerButtons.has(event.button)) return;
    flushMove();
    pointer('up', videoCoordinates(event, true), event.button);
    pointerButtons.delete(event.button);
  });
  video.addEventListener('pointercancel', () => releaseInput());
  video.addEventListener('lostpointercapture', (event) => {
    if (touches.has(event.pointerId) || (event.pointerType !== 'touch' && pointerButtons.size))
      releaseInput();
  });
  video.addEventListener('contextmenu', (event) => event.preventDefault());
  video.addEventListener(
    'wheel',
    (event) => {
      if (!videoCoordinates(event) || activeInput === false) return;
      event.preventDefault();
      const multiplier =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? video.clientHeight : 1;
      sendControl({ type: 'wheel', dx: event.deltaX * multiplier, dy: event.deltaY * multiplier });
    },
    { passive: false },
  );
  video.addEventListener('blur', releaseInput);
  window.addEventListener('blur', releaseInput);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseInput();
  });
}
