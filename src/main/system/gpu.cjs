'use strict';
// Detects a Windows virtual machine with VMware's virtual graphics card. main.cjs asks at startup,
// and when the answer is yes it starts Chromium with --ignore-gpu-blocklist.
//
// Why: Chromium stops using a graphics card whose driver is on its blocklist, and VMware's virtual
// card is on it, so in a VMware virtual machine Chromium drew and captured the screen in software.
// In the Windows 11 VM on October 12, 2026, using the card anyway:
// - took capture from 25 to 35 frames a second;
// - took a pointer move from 150 ms to 70 ms to come back as video, and from 339 ms to 77 ms with
//   video-like motion.
//
// Why only Windows: in the Ubuntu VM's Wayland session the same switch froze GNOME Shell as sharing
// started. So Linux keeps Chromium's own decision, as do computers with any other graphics card.

// The registry key of the Display adapters device class. Each adapter has a numbered subkey there
// whose MatchingDeviceId value names its hardware, such as PCI\VEN_15AD&DEV_0406&SUBSYS_040615AD.
const DISPLAY_CLASS =
  'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}';

/**
 * Returns true on Windows when a display adapter's hardware ID has PCI vendor 15AD, which is
 * VMware. `run(file, args)` runs a program and returns its output (main.cjs passes one built on
 * execFileSync). Any failure, and any other platform, means false.
 */
function vmwareGraphics({ platform = process.platform, run } = {}) {
  if (platform !== 'win32') return false;
  try {
    // The full path to reg.exe, so another program called reg on the PATH can't answer instead.
    const reg = `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\reg.exe`;
    return /\\VEN_15AD&/i.test(run(reg, ['query', DISPLAY_CLASS, '/s', '/v', 'MatchingDeviceId']));
  } catch {
    /* unreadable: leave Chromium's decision */
  }
  return false;
}

module.exports = { vmwareGraphics };
