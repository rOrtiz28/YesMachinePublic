'use strict';
// The Add device dialog. A switch at its top chooses what to add:
//  - a computer, by its private address (and port, 4777 unless given); it is saved and listed with a cat badge;
//  - an Android device, for advanced mode. On the Cable tab the dialog waits for a device on the USB cable. On the
//    Wi-Fi tab it shows a pairing code for the device to scan in Android's Wireless debugging settings, then follows
//    the pairing, which the main process does with adb (src/main/android/advanced-mode.cjs), until the device
//    connects. Then "Open" opens the device's window.
// A device whose Yes Machine app is set to general mode connects through the app instead, so the dialog says how to
// switch it to advanced mode.

// The Android tab shown ('usb' or 'wifi'), the device ready to open ({ id, name, transport }) or null, and what the
// dialog adds ('computer' or 'android').
let pairTab = 'usb',
  pairReady = null,
  addKind = 'computer';

// --- Opening the dialog ---------------------------------------------------------------------------------------

/** Opens the dialog on a computer, or on an Android device's Cable or Wi-Fi tab. */
function openAddDialog(kind = 'computer', tab = 'usb') {
  $('add-form').reset();
  $('add-error').hidden = true;
  chooseAddKind(kind, tab);
  if (!$('add-dialog').open) $('add-dialog').showModal();
  if (kind === 'computer') $('add-address').focus();
}

/** Opens the dialog on an Android tab, from an Android card's Cable | Wi-Fi choice. */
function openPairDialog(tab) {
  openAddDialog('android', tab);
}

/** The switch at the top: a computer or an Android device. Leaving Android stops any pairing under way. */
function chooseAddKind(kind, tab = pairTab) {
  addKind = kind;
  const android = kind === 'android';
  $('add-title').textContent = android ? 'Add an Android device' : 'Add a computer';
  $('add-kind-computer').setAttribute('aria-checked', String(!android));
  $('add-kind-android').setAttribute('aria-checked', String(android));
  $('add-form').hidden = android;
  $('add-android').hidden = !android;
  if (android) showPairTab(tab);
  else {
    pairReady = null;
    api.stopAndroidPairing().catch(() => {});
  }
}

// --- A computer -----------------------------------------------------------------------------------------------

/** Saves the computer typed in, once its address is a private IPv4 address and its port is valid. */
function addComputer(event) {
  event.preventDefault();
  const match = /^\s*([\d.]+)(?::(\d{1,5}))?\s*$/.exec($('add-address').value),
    port = Number(match?.[2] || 4777);
  if (!match || !privateAddress(match[1]) || port < 1 || port > 65535) {
    $('add-error').textContent =
      'Enter a private IPv4 address such as 192.168.29.100, optionally followed by :4777.';
    $('add-error').hidden = false;
    return;
  }
  const entry = {
    name: $('add-name').value.trim().slice(0, 64) || match[1],
    address: match[1],
    port,
    platform: '',
    fingerprint: '',
    manual: true,
  };
  storeSaved(entry);
  $('add-dialog').close();
  probeAll();
  notice(`Saved ${entry.name}. Double-click it to connect.`);
}

// --- An Android device ----------------------------------------------------------------------------------------

/** Shows the Cable or Wi-Fi tab. Every change of tab stops the pairing under way; the Wi-Fi tab starts a new one. */
function showPairTab(tab) {
  pairTab = tab;
  pairReady = null;
  $('pair-usb').setAttribute('aria-selected', String(tab === 'usb'));
  $('pair-wifi').setAttribute('aria-selected', String(tab === 'wifi'));
  $('pair-usb-panel').hidden = tab !== 'usb';
  $('pair-wifi-panel').hidden = tab !== 'wifi';
  $('pair-note').hidden = tab !== 'wifi';
  api.stopAndroidPairing().catch(() => {});
  if (tab === 'usb') renderPairUsb();
  else startPairing();
}

/**
 * The Cable tab: whether a device is on the cable. start.js calls it again each time the main process reports the
 * Android devices.
 */
function renderPairUsb() {
  if (pairTab !== 'usb') return;
  const device = androidDevices.find((candidate) => (candidate.connections || {}).usb);
  pairReady =
    device && !device.general ? { id: device.id, name: device.name, transport: 'usb' } : null;
  if (info?.android && !info.android.available) pairStatus(adbMissing(), 'error');
  else if (device?.general) pairStatus(generalModeNote(device.name, 'by cable'), 'error');
  else
    pairStatus(
      device ? `${device.name} is connected by cable.` : 'Waiting for a device on the cable…',
      device ? 'ready' : 'waiting',
    );
  renderPairActions();
}

/** The Wi-Fi tab: asks the main process for a new pairing code and shows it. */
async function startPairing() {
  $('pair-qr').replaceChildren();
  pairStatus('Making a pairing code…');
  renderPairActions();
  try {
    const { modules } = await api.startAndroidPairing();
    if (pairTab !== 'wifi') return;
    drawPairingCode(modules);
    pairStatus('Waiting for the device to scan the code…');
  } catch (error) {
    pairStatus(info?.android && !info.android.available ? adbMissing() : reason(error), 'error');
    renderPairActions('failed');
  }
}

/**
 * Draws the pairing code (a QR code, as rows of dark and light modules from src/main/android/qr.cjs) as pixels, with
 * a light margin so the device's camera finds its edges.
 */
function drawPairingCode(modules) {
  const ns = 'http://www.w3.org/2000/svg',
    svg = document.createElementNS(ns, 'svg'),
    path = document.createElementNS(ns, 'path'),
    size = modules.length;
  svg.setAttribute('viewBox', `-3 -3 ${size + 6} ${size + 6}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  path.setAttribute(
    'd',
    modules.flatMap((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : ''))).join(''),
  );
  svg.append(path);
  $('pair-qr').replaceChildren(svg);
}

/**
 * Follows the Wi-Fi pairing, from the main process's 'android-pairing' events: pairing, connecting, then ready (or
 * failed, or the code expired). A device that turns out to be in general mode can't be opened from here.
 */
function onPairing(event) {
  if (pairTab !== 'wifi' || addKind !== 'android' || !$('add-dialog').open) return;
  if (event.state === 'ready' && event.general) {
    pairReady = null;
    rememberTransport(event.id, 'wifi');
    pairStatus(generalModeNote(event.name, 'through Wi-Fi debugging'), 'error');
  } else if (event.state === 'ready') {
    pairReady = { id: event.id, name: event.name, transport: 'wifi' };
    rememberTransport(event.id, 'wifi');
    renderDevices();
    pairStatus(`${event.name} is on Wi-Fi.`, 'ready');
  } else if (event.state === 'failed')
    pairStatus(event.reason || 'The device didn’t pair. Scan a new code.', 'error');
  else if (event.state === 'expired')
    pairStatus('The code expired. Make a new one to try again.', 'error');
  else
    pairStatus(
      { pairing: 'Pairing with the device…', connecting: 'Paired. Connecting over Wi-Fi…' }[
        event.state
      ] || 'Waiting for the device to scan the code…',
    );
  renderPairActions(event.state);
}

/** The status line under the tabs: 'waiting', 'ready' or 'error'. */
function pairStatus(text, state = 'waiting') {
  $('pair-status-text').textContent = text;
  $('pair-status').classList.toggle('ready', state === 'ready');
  $('pair-status').classList.toggle('error', state === 'error');
}

/** "Open <device>" once a device is ready, and "New code" after a Wi-Fi pairing failed or its code expired. */
function renderPairActions(state) {
  $('pair-open').hidden = !pairReady;
  if (pairReady) $('pair-open').textContent = `Open ${pairReady.name}`;
  $('pair-new').hidden = !(pairTab === 'wifi' && ['failed', 'expired'].includes(state));
}

/** A device whose Yes Machine app is in general mode connects through the app, so advanced mode waits for Advanced. */
function generalModeNote(name, how) {
  return `${name} is set to general mode in Yes Machine. To connect it ${how}, choose Advanced in Yes Machine’s Settings on it.`;
}

/** What to install when adb, Android's platform tools, isn't on this computer. */
function adbMissing() {
  return `Yes Machine needs Android’s platform tools (adb) on this computer. ${info?.platform === 'darwin' ? 'Install them with brew install --cask android-platform-tools, or with Android Studio.' : info?.platform === 'linux' ? 'Install them with sudo apt install adb, or with Android Studio.' : 'Install them with Android Studio or Google’s SDK Platform-Tools.'} Then open Yes Machine again.`;
}

/** Connects the dialog's buttons. Called once by start.js. */
function setUpAddDialog() {
  $('add-form').addEventListener('submit', addComputer);
  $('add-cancel').onclick = () => $('add-dialog').close();
  $('pair-usb').onclick = () => showPairTab('usb');
  $('pair-wifi').onclick = () => showPairTab('wifi');
  $('pair-close').onclick = () => $('add-dialog').close();
  $('add-kind-computer').onclick = () => {
    if (addKind !== 'computer') {
      chooseAddKind('computer');
      $('add-address').focus();
    }
  };
  $('add-kind-android').onclick = () => {
    if (addKind !== 'android') chooseAddKind('android', 'usb');
  };
  $('pair-new').onclick = () => {
    renderPairActions();
    startPairing();
  };
  $('pair-open').onclick = () => {
    const device = pairReady;
    $('add-dialog').close();
    if (device) {
      rememberTransport(device.id, device.transport);
      renderDevices();
      api.openAndroid(device.id, device.transport).catch((error) => notice(reason(error), true));
    }
  };
  // Closing the dialog, however it closes, stops the pairing.
  $('add-dialog').addEventListener('close', () => api.stopAndroidPairing().catch(() => {}));
}
