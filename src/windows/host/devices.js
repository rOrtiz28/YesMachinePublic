'use strict';
// The list of devices on the home page, drawn as the windows of the house: this computer first, then every computer
// and Android device this one can connect to, then "Add device".
//
// Where the devices come from:
//  - computers sharing on the network, found by the main process's discovery (src/main/network/discovery.cjs);
//  - computers saved by the user (ym.saved), from a discovered card's Save button or added by address;
//  - Android devices sharing through the Yes Machine app, for general mode (src/main/android/general-mode.cjs);
//  - Android devices reached through adb, by cable or Wi-Fi debugging, for advanced mode
//    (src/main/android/advanced-mode.cjs).
// Every listed computer is probed every few seconds (probeAll), so one that stops sharing drops out quickly.
//
// Computers are identified by a key, their address and port ("192.168.1.20:4777").

/** Names for the systems computers announce. */
const PLATFORMS = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };

// Computers found on the network, and why discovery isn't working, when it isn't.
let discovered = [],
  discoveryError = '';
// The last probe of each listed computer, by key, and how many probes in a row it has missed.
let probes = new Map(),
  misses = new Map();
// The cards already shown once (a new card plays its "appear" animation only once), and what was last drawn, so a
// list that hasn't changed isn't drawn again.
let appeared = new Set(),
  lastDevices = '';
// Whether the house shows every card, or only its first two floors.
let expanded = false;
// The keys of the computers this one is connected to right now.
let connectedKeys = new Set();
// Android devices reached through adb (advanced mode), Android devices sharing through the app (general mode), the
// ids of those whose window is open, and the way chosen for each device that can be reached both ways: 'usb' or
// 'wifi' (ym.androidTransport).
let androidDevices = [],
  androidSharing = [],
  androidConnected = new Set(),
  androidTransport = read('ym.androidTransport', {});
// The saved computers. Entries that aren't valid are left out.
let saved = read('ym.saved', []).filter(validSaved);

// --- Addresses and keys ---------------------------------------------------------------------------------------

/** Whether `value` is a private IPv4 address: 10/8, 172.16/12, 192.168/16, or link-local 169.254/16. */
function privateAddress(value) {
  const parts = String(value).split('.');
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255))
    return false;
  const [first, second] = parts.map(Number);
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

/** Whether a saved entry has a name, a private address and a valid port. */
function validSaved(entry) {
  return (
    !!entry &&
    typeof entry.name === 'string' &&
    privateAddress(entry.address) &&
    Number.isInteger(entry.port) &&
    entry.port > 0 &&
    entry.port < 65536
  );
}

const keyOf = (device) => `${device.address}:${device.port}`;
const targetOf = (device) => ({ address: device.address, port: device.port });
// Discovered computers come from the network and always get their own card. Computers added by hand are separate
// cards with a cat badge, even when discovery also sees the same address. An entry without the manual flag counts as
// added by hand when it has no platform.
const manualEntry = (entry) =>
  entry.manual === true || (entry.manual === undefined && !entry.platform);
// A discovered computer that misses two probes in a row is gone, even if its network announcement lingers.
const reachable = (device) => (misses.get(keyOf(device)) || 0) < 2;

// --- What the list holds --------------------------------------------------------------------------------------

/**
 * Every card the house shows besides this computer and "Add device", sorted: online first, then discovered before
 * added by hand, then by name. Each item says how to reach the device and its state (online, connected, certificate
 * changed since it was saved).
 */
function deviceItems() {
  const present = discovered.filter(reachable),
    items = [],
    live = new Map(present.map((device) => [keyOf(device), device]));
  for (const device of present) {
    const known = saved.find((entry) => !manualEntry(entry) && keyOf(entry) === keyOf(device));
    items.push({
      id: `net:${keyOf(device)}`,
      name: device.name,
      address: device.address,
      port: device.port,
      platform: device.platform,
      os: device.os || '',
      manual: false,
      saved: !!known,
      savedFingerprint: known?.fingerprint,
      online: true,
      seen: device.fingerprint,
    });
  }
  // Saved computers that discovery doesn't see right now, and every computer added by hand.
  for (const entry of saved) {
    const key = keyOf(entry),
      manual = manualEntry(entry),
      probe = probes.get(key);
    if (!manual && live.has(key)) continue;
    items.push({
      id: `${manual ? 'manual' : 'net'}:${key}`,
      name: entry.name,
      address: entry.address,
      port: entry.port,
      platform: entry.platform || live.get(key)?.platform,
      os: live.get(key)?.os || '',
      manual,
      saved: true,
      savedFingerprint: entry.fingerprint,
      online: live.has(key) || !!probe?.online,
      seen: live.get(key)?.fingerprint || (probe?.online ? probe.fingerprint : ''),
    });
  }
  for (const item of items) {
    item.changed = !!(item.savedFingerprint && item.seen && item.seen !== item.savedFingerprint);
    item.connected = connectedKeys.has(keyOf(item));
  }
  // Android devices sharing through the Yes Machine app, for general mode. The app uses one mode at a time, so while a
  // device shares this way, its advanced mode card steps aside unless its window is open.
  const sharing = new Set(androidSharing.map((device) => device.name));
  for (const device of androidSharing) {
    items.push({
      id: `share:${device.id}`,
      share: device.id,
      name: device.name,
      address: device.address,
      port: device.port,
      os: device.system || 'Android',
      platform: 'android',
      manual: false,
      saved: false,
      online: true,
      changed: false,
      connected: androidConnected.has(device.id),
    });
  }
  // Android devices reached through adb, by cable or Wi-Fi debugging, for advanced mode. A device reachable both ways
  // is reached the way chosen on its card, or by cable when nothing was chosen. A device whose app is set to general
  // mode isn't offered.
  for (const device of androidDevices) {
    if ((device.general || sharing.has(device.name)) && !androidConnected.has(device.id)) continue;
    const connections = Object.keys(device.connections || { [device.transport]: device.serial }),
      chosen = connections.includes(androidTransport[device.id])
        ? androidTransport[device.id]
        : connections.includes('usb')
          ? 'usb'
          : 'wifi';
    items.push({
      id: `android:${device.id}`,
      android: device.id,
      name: device.name,
      address: chosen === 'usb' ? 'USB cable' : 'Wi-Fi',
      os: device.system,
      platform: 'android',
      manual: false,
      saved: false,
      online: true,
      changed: false,
      connected: androidConnected.has(device.id),
      transport: chosen,
      connections,
    });
  }
  return items.sort(
    (a, b) => b.online - a.online || a.manual - b.manual || a.name.localeCompare(b.name),
  );
}

/** A card's description for its tooltip and screen readers: its system, then its state. */
function describe(item) {
  if (item.android) return `${item.os} · ${item.connected ? 'connected' : item.address}`;
  if (item.share)
    return `${item.os} · ${item.connected ? 'connected' : 'sharing'} · ${item.address}`;
  const state = item.connected
    ? 'connected'
    : item.changed
      ? 'certificate changed'
      : item.online
        ? 'online'
        : 'offline';
  return `${item.manual ? 'Added by you' : item.os || PLATFORMS[item.platform] || 'On your network'} · ${state}`;
}

// --- Cards ----------------------------------------------------------------------------------------------------

function element(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/** A pixel icon (public/pixel-icons.js draws it when PixelIcons.render runs). */
function icon(name) {
  const node = element('span', 'icon');
  node.dataset.icon = name;
  return node;
}

/** A card's text: the name, then the operating system when the device announces it, then the address or state. */
function label(name, detail, system) {
  const text = element('span', 'device-text'),
    strong = element('strong'),
    small = element('small');
  strong.textContent = name;
  small.textContent = detail;
  text.append(strong);
  if (system) {
    const os = element('small');
    os.textContent = system;
    text.append(os);
  }
  text.append(small);
  return text;
}

function statusDot() {
  const dot = element('span', 'status');
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}

/** This computer's own card, the first in the list. It shows as online while sharing. */
function currentDevice() {
  const card = element('div', 'device current' + (media ? ' online' : '')),
    main = element('div', 'device-main');
  card.setAttribute('role', 'listitem');
  main.append(
    icon(info?.platform === 'darwin' ? 'laptop' : 'monitor'),
    label(info?.name || 'This computer', 'This device', info?.system),
    statusDot(),
  );
  card.append(main);
  return card;
}

/** The badge of a computer added by hand. */
function catBadge() {
  const node = icon('cat');
  node.classList.add('badge');
  node.setAttribute('aria-hidden', 'true');
  return node;
}

/**
 * The card of one device. A double-click or Enter connects: an Android device in advanced mode opens its window
 * directly, one in general mode goes through connectDevice, and a computer through connectTo (connecting.js).
 * A computer's card also has a Save or Forget button; an Android device's card has its Cable | Wi-Fi choice.
 */
function deviceCard(item) {
  const card = element('div', 'device'),
    main = element('button', 'device-main'),
    action = element('button', 'device-action');
  card.dataset.key = item.id;
  card.setAttribute('role', 'listitem');
  card.classList.toggle('online', item.online);
  card.classList.toggle('changed', item.changed);
  card.classList.toggle('manual', item.manual);
  card.classList.toggle('connected', item.connected);
  card.classList.toggle('android', !!item.android);
  if (!appeared.has(item.id)) {
    appeared.add(item.id);
    card.classList.add('appear');
  }
  main.type = 'button';
  main.title = describe(item);
  // An Android card's own Cable | Wi-Fi choice says how it's reached, so its last line only says when it's connected.
  const detail = item.android
    ? item.connected
      ? 'Connected'
      : '\u00a0'
    : item.connected
      ? `Connected · ${item.address}`
      : item.changed
        ? 'Certificate changed'
        : item.address;
  main.append(
    icon(item.android || item.share ? 'tablet' : item.platform === 'darwin' ? 'laptop' : 'monitor'),
    label(item.name, detail, item.os),
    item.manual ? catBadge() : statusDot(),
  );
  main.setAttribute(
    'aria-label',
    `${item.name}, ${item.address}, ${describe(item)}. Press Enter or double-click to ${item.connected ? 'show its window' : 'connect'}.`,
  );
  const open = () =>
    item.android
      ? api.openAndroid(item.android, item.transport).catch((error) => notice(reason(error), true))
      : item.share
        ? connectDevice(item)
        : connectTo(item);
  main.addEventListener('dblclick', open);
  main.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      open();
    }
  });
  if (item.android) {
    card.append(main, transportChoice(item));
    return card;
  }
  if (item.share) {
    card.append(main);
    return card;
  }
  action.type = 'button';
  action.textContent = item.saved ? 'Forget' : 'Save';
  action.setAttribute('aria-label', `${action.textContent} ${item.name}`);
  action.addEventListener('click', () => (item.saved ? forget(item) : remember(item)));
  card.append(main, action);
  return card;
}

/** Cable or Wi-Fi for an Android device. Choosing a way the device doesn't have yet opens the steps to set it up. */
function transportChoice(item) {
  const group = element('div', 'device-transport');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', `Connect to ${item.name} by`);
  for (const [value, text] of [
    ['usb', 'Cable'],
    ['wifi', 'Wi-Fi'],
  ]) {
    const button = element('button'),
      have = item.connections.includes(value),
      name = value === 'usb' ? 'USB cable' : 'Wi-Fi';
    button.type = 'button';
    button.textContent = text;
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(item.transport === value));
    button.title = have ? `Connect by ${name}` : `Set up ${name} for ${item.name}`;
    button.addEventListener('click', () => {
      if (!have) {
        openPairDialog(value);
        return;
      }
      rememberTransport(item.android, value);
      renderDevices();
    });
    group.append(button);
  }
  return group;
}

/** The last card, which opens the Add device dialog. */
function addCard(text, key, open) {
  const card = element('div', 'device add'),
    button = element('button', 'device-main');
  card.dataset.key = key;
  card.setAttribute('role', 'listitem');
  button.type = 'button';
  button.append(icon('plus'), text);
  button.addEventListener('click', open);
  card.append(button);
  return card;
}

// --- Drawing the list -----------------------------------------------------------------------------------------

/**
 * Draws the list again when anything in it changed. The house shows two floors of windows until the user asks for
 * the rest; how many windows a floor has depends on the window's width. The card that had the focus keeps it.
 */
function renderDevices() {
  const tracks = getComputedStyle($('devices')).gridTemplateColumns,
    columns = tracks.includes('repeat') ? 4 : Math.max(1, tracks.split(' ').length);
  const items = deviceItems(),
    limit = columns * 2 - 2,
    shown = expanded || items.length <= limit ? items : items.slice(0, limit);
  const signature = JSON.stringify([items, !!media, info?.name, info?.platform, expanded, limit]);
  $('discovery-status').textContent =
    discoveryError ||
    (items.some((item) => item.online)
      ? 'Double-click a computer to connect.'
      : 'Looking for computers sharing on your network…');
  renderSavedList();
  if (signature === lastDevices) return;
  lastDevices = signature;
  const list = $('devices'),
    active = document.activeElement,
    focusKey = active?.closest?.('[data-key]')?.dataset.key,
    onAction = active?.classList.contains('device-action');
  list.replaceChildren(
    currentDevice(),
    ...shown.map(deviceCard),
    addCard('Add device', 'add', () => openAddDialog('computer')),
  );
  $('house-more').hidden = items.length <= limit;
  $('show-all-label').textContent = expanded ? 'Show fewer' : `Show all ${items.length} computers`;
  $('show-all-icon').dataset.icon = expanded ? 'chevron-up' : 'chevron-down';
  PixelIcons.render($('house'));
  applyHouseLight();
  if (focusKey)
    list
      .querySelector(
        `[data-key="${CSS.escape(focusKey)}"] ${onAction ? '.device-action' : '.device-main'}`,
      )
      ?.focus();
}

// --- Saving and forgetting ------------------------------------------------------------------------------------

// The same saved entry: the same address and port, and both discovered or both added by hand.
const sameEntry = (a, b) => keyOf(a) === keyOf(b) && manualEntry(a) === manualEntry(b);

/**
 * Saves an entry, replacing the same one if it was already saved. It keeps when it was first saved (since, in
 * milliseconds), for Settings' list.
 */
function storeSaved(entry) {
  const since = saved.find((other) => sameEntry(other, entry))?.since || Date.now();
  saved = [...saved.filter((other) => !sameEntry(other, entry)), { ...entry, since }];
  write('ym.saved', saved);
  renderDevices();
}

/** A discovered computer's Save button. It keeps the certificate fingerprint seen, to notice a change later. */
function remember(item) {
  const fingerprint =
    discovered.find((device) => keyOf(device) === keyOf(item))?.fingerprint ||
    probes.get(keyOf(item))?.fingerprint ||
    '';
  storeSaved({
    name: item.name,
    address: item.address,
    port: item.port,
    platform: PLATFORMS[item.platform] ? item.platform : '',
    fingerprint,
    manual: false,
  });
  notice(`Saved ${item.name}.`);
}

/** A saved computer's Forget button. */
function forget(item) {
  saved = saved.filter((entry) => !sameEntry(entry, item));
  write('ym.saved', saved);
  renderDevices();
  notice(`Forgot ${item.name}.`);
}

/** Remembers the way ('usb' or 'wifi') to reach an Android device that has both. */
function rememberTransport(id, transport) {
  androidTransport = { ...androidTransport, [id]: transport };
  write('ym.androidTransport', androidTransport);
}

// --- Who is online --------------------------------------------------------------------------------------------

/**
 * Probes every listed computer, up to 32, through the main process (src/main/network/probe.cjs). start.js runs it
 * every 5 seconds; it does nothing while the window is hidden.
 */
async function probeAll() {
  const keys = [...new Set([...discovered, ...saved].map(keyOf))].slice(0, 32);
  if (document.hidden || !keys.length) return;
  try {
    for (const result of await api.probe(
      keys.map((key) => {
        const [address, port] = key.split(':');
        return { address, port: Number(port) };
      }),
    )) {
      const key = keyOf(result);
      probes.set(key, result);
      misses.set(key, result.online ? 0 : (misses.get(key) || 0) + 1);
    }
    renderDevices();
  } catch {}
}

/** The refresh button: discovery asks the network again, and every listed computer is probed. */
async function refreshList() {
  const button = $('refresh');
  button.disabled = true;
  button.classList.add('busy');
  try {
    await api.refreshDiscovery();
    await probeAll();
  } catch {}
  setTimeout(() => {
    button.disabled = false;
    button.classList.remove('busy');
  }, 800);
}

/** Connects the list's buttons and the main process's discovery. Called once by start.js. */
function setUpDeviceList() {
  // The number of cards on a floor depends on the window's width.
  addEventListener('resize', renderDevices);
  $('show-all').onclick = () => {
    expanded = !expanded;
    renderDevices();
  };
  $('refresh').onclick = refreshList;
  api.onDiscovery(({ devices, error }) => {
    discovered = Array.isArray(devices) ? devices : [];
    discoveryError = error || '';
    renderDevices();
  });
}
