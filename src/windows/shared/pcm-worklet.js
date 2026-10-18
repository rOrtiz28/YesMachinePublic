'use strict';
// An AudioWorklet processor, registered as 'pcm-player', that plays raw sound as it arrives: 48 kHz
// stereo, as interleaved 16-bit little-endian samples (4 bytes per frame, left then right). The
// page posts the bytes to the node's port. Two windows use it:
//  - The desktop app's main window (src/windows/host/sharing.js), when a Linux computer shares its
//    sound. The main process records the system's output with parec and passes the bytes on; this
//    processor plays them into a MediaStream destination whose track joins the shared screen's
//    WebRTC stream.
//  - The Android window (src/windows/android/viewer.js), for the sound an Android device sends.
//
// The sound waits in a ring buffer that holds one second. Under load, old audio is dropped instead
// of letting the delay grow. Options (processorOptions) can keep the buffer shorter, as the Android
// window does to stay close to the picture:
//  - most: the frames it may hold after a message before the oldest are dropped, down to keep;
//  - keep: how many of the newest frames remain when that happens;
//  - start: frames to gather before playing, and again each time it runs dry (0 plays at once).

/**
 * Plays the PCM bytes posted to its port. The main window uses the defaults (most and keep 12000
 * frames, a quarter of a second, and start 0); the Android window passes shorter ones.
 */
class PCMPlayer extends AudioWorkletProcessor {
  /** @param options the node's options, with { most, keep, start } in processorOptions. */
  constructor(options) {
    super();
    // The ring: one second of frames, each a left and a right sample. read is the next frame to
    // play, write the next free one, and count how many are waiting.
    this.frames = 48000;
    this.samples = new Float32Array(this.frames * 2);
    this.read = 0;
    this.write = 0;
    this.count = 0;
    // The bytes of a frame that the end of a message cut in two, kept for the next message.
    this.carry = new Uint8Array(0);
    const { most = 12000, keep = 12000, start = 0 } = options?.processorOptions || {};
    this.most = most;
    this.keep = keep;
    this.start = start;
    // True while gathering the start frames; it plays silence meanwhile.
    this.waiting = start > 0;
    // Each message is a chunk of PCM bytes from the page.
    this.port.onmessage = (event) => {
      // Join the bytes left over from the last chunk, then convert only whole 4-byte frames.
      const input = new Uint8Array(event.data);
      const bytes = new Uint8Array(this.carry.length + input.length);
      bytes.set(this.carry);
      bytes.set(input, this.carry.length);
      const usable = bytes.length - (bytes.length % 4);
      const view = new DataView(bytes.buffer);
      for (let i = 0; i < usable; i += 4) {
        // A full ring drops its oldest frame to make room.
        if (this.count >= this.frames) {
          this.read = (this.read + 1) % this.frames;
          this.count--;
        }
        this.samples[this.write * 2] = view.getInt16(i, true) / 32768;
        this.samples[this.write * 2 + 1] = view.getInt16(i + 2, true) / 32768;
        this.write = (this.write + 1) % this.frames;
        this.count++;
      }
      this.carry = bytes.slice(usable);
      // Keep realtime latency bounded even if a large native chunk arrives: past `most` frames,
      // skip ahead so that only the newest `keep` remain.
      if (this.count > this.most) {
        this.read = (this.write - this.keep + this.frames) % this.frames;
        this.count = this.keep;
      }
      if (this.waiting && this.count >= this.start) this.waiting = false;
    };
  }
  /**
   * Called on the audio thread for each block of output (128 frames in today's browsers). Fills it
   * from the ring, or with silence while the ring is empty or still gathering. Returning true keeps
   * the processor alive.
   */
  process(_inputs, outputs) {
    const out = outputs[0];
    // Running dry starts the gathering again, so playback resumes with some sound in hand.
    if (!this.waiting && this.start && !this.count) this.waiting = true;
    for (let i = 0; i < out[0].length; i++) {
      if (this.count && !this.waiting) {
        out[0][i] = this.samples[this.read * 2];
        if (out[1]) out[1][i] = this.samples[this.read * 2 + 1]; // a mono output gets the left only
        this.read = (this.read + 1) % this.frames;
        this.count--;
      } else {
        out[0][i] = 0;
        if (out[1]) out[1][i] = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-player', PCMPlayer);
