'use strict';
// The list of computers on the home page, drawn as the windows of the house, then "Add computer". Computers come
// from discovery on the network, which Java runs (LanDiscovery), and from the ones saved here (ym.saved): saved from
// a discovered card, or added by address. Every listed computer is probed every few seconds (probeAll), so one that
// stops sharing drops out quickly.
//
// Unlike on the desktop, a computer can be discovered on another network than this device's (a virtual machine
// behind its host's NAT, for example): such a computer is shown as on another network, and tapping it explains why
// it can't be reached.

const PLATFORMS = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };
// Whether the house shows every card, or only its first floors. Whether the house's cat sits up: while a computer is
// online.
let expanded = false;
let catReady = false;
// Computers found on the network, and why discovery isn't working, when it isn't. The last probe of each listed
// computer by key, how many probes in a row it has missed, and the keys that have answered at least once. The cards
// already shown once, and what was last drawn.
let discovered = [],
  discoveryError = '',
  probes = new Map(),
  misses = new Map(),
  online = new Set(),
  appeared = new Set(),
  lastDevices = '';
// The saved computers. Entries that aren't valid are left out.
let saved = read('ym.saved', []).filter(validSaved);

// --- Addresses and networks -----------------------------------------------------------------------------------

/** The four numbers of an IPv4 address, or null when it isn't one. */
function octets(value) {
  const parts = String(value).split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
    ? parts.map(Number)
    : null;
}

/** Whether an address is a private IPv4 address: 10/8, 172.16/12, 192.168/16, or link-local 169.254/16. */
function privateAddress(value) {
  const n = octets(value);
  return (
    !!n &&
    (n[0] === 10 ||
      (n[0] === 172 && n[1] >= 16 && n[1] <= 31) ||
      (n[0] === 192 && n[1] === 168) ||
      (n[0] === 169 && n[1] === 254))
  );
}

/** Whether a saved entry has a name, a private address and a valid port. */
function validSaved(d) {
  return (
    !!d &&
    typeof d.name === 'string' &&
    privateAddress(d.address) &&
    Number.isInteger(d.port) &&
    d.port > 0 &&
    d.port < 65536
  );
}
const keyOf = (d) => `${d.address}:${d.port}`;
const targetOf = (d) => ({ address: d.address, port: d.port });
// True when the address is on this device's local network. A computer outside it, such as a virtual machine
// behind its host's NAT, may be discovered but can't be reached from here.
function onThisNetwork(address) {
  const net = info?.network,
    a = octets(address),
    b = net && octets(net.address);
  if (!a || !b) return true;
  const bits = Math.max(0, Math.min(32, net.prefix | 0)),
    mask = bits ? (~0 << (32 - bits)) >>> 0 : 0;
  const value = (n) => ((n[0] << 24) | (n[1] << 16) | (n[2] << 8) | n[3]) >>> 0;
  return (value(a) & mask) >>> 0 === (value(b) & mask) >>> 0;
}

/** This device's network as people write it: 192.168.1.x for a /24, otherwise address/prefix. */
function networkLabel() {
  const n = info?.network && octets(info.network.address);
  if (!n) return 'this network';
  const bits = info.network.prefix | 0;
  return bits === 24 ? `${n[0]}.${n[1]}.${n[2]}.x` : `${info.network.address}/${bits}`;
}

/** The pill in the title bar: Wi-Fi, Ethernet or Local, with this device's address as a tooltip. */
function renderNetworkPill() {
  const network = info?.network,
    pill = $('network-pill');
  pill.textContent = !network
    ? 'No network'
    : network.kind === 'wifi'
      ? 'Wi-Fi'
      : network.kind === 'ethernet'
        ? 'Ethernet'
        : 'Local';
  pill.className = `pill ${network ? 'live' : 'warn'}`;
  pill.title = network
    ? network.address
    : 'Join the same network as your computers, over Wi-Fi or Ethernet.';
}

// The device can switch networks while the app is open, so the pill and the Another network check follow it.
async function followNetwork() {
  try {
    const current = await api.info();
    if (JSON.stringify(current.network) === JSON.stringify(info?.network)) return;
    info = current;
    renderNetworkPill();
    lastDevices = '';
    renderDevices();
  } catch {}
}

// --- What the list holds --------------------------------------------------------------------------------------

// Computers added by hand get their own card with a cat badge, even when discovery sees the same address. An entry
// without the manual flag counts as added by hand when it has no platform.
const manualEntry = (d) => d.manual === true || (d.manual === undefined && !d.platform);
// A discovered computer that answered before and then misses two probes in a row has closed, even if its
// announcement lingers. One that never answered and sits on another network stays listed, so tapping it can
// explain why it can't be reached.
function present(d) {
  const key = keyOf(d);
  if ((misses.get(key) || 0) < 2) return true;
  return !online.has(key) && !onThisNetwork(d.address);
}

/**
 * Every card the house shows besides "Add computer", sorted: online first, then discovered before added by hand,
 * then by name.
 */
function deviceItems() {
  const shown = discovered.filter(present),
    items = [],
    live = new Map(shown.map((d) => [keyOf(d), d]));
  for (const d of shown) {
    const key = keyOf(d),
      known = saved.find((s) => !manualEntry(s) && keyOf(s) === key),
      probe = probes.get(key);
    // Discovery alone counts as online, except for an address on another network, which must answer a probe first.
    const live = (misses.get(key) || 0) < 2 && (onThisNetwork(d.address) || online.has(key));
    items.push({
      id: `net:${key}`,
      name: d.name,
      address: d.address,
      port: d.port,
      platform: d.platform,
      os: d.os || '',
      manual: false,
      saved: !!known,
      savedFingerprint: known?.fingerprint,
      online: live,
      seen: probe?.online ? probe.fingerprint : '',
    });
  }
  for (const s of saved) {
    const key = keyOf(s),
      manual = manualEntry(s),
      probe = probes.get(key);
    if (!manual && live.has(key)) continue;
    items.push({
      id: `${manual ? 'manual' : 'net'}:${key}`,
      name: s.name,
      address: s.address,
      port: s.port,
      platform: s.platform || live.get(key)?.platform,
      os: live.get(key)?.os || '',
      manual,
      saved: true,
      savedFingerprint: s.fingerprint,
      online: !!probe?.online,
      seen: probe?.online ? probe.fingerprint : '',
    });
  }
  for (const item of items) {
    item.changed = !!(item.savedFingerprint && item.seen && item.seen !== item.savedFingerprint);
    item.away = !onThisNetwork(item.address);
  }
  return items.sort(
    (a, b) => b.online - a.online || a.manual - b.manual || a.name.localeCompare(b.name),
  );
}

/** A card's description for screen readers: its system, then its state. */
function describe(item) {
  const state = item.changed
    ? 'certificate changed'
    : item.online
      ? 'online'
      : item.away
        ? 'on another network'
        : 'offline';
  return `${item.manual ? 'Added by you' : item.os || PLATFORMS[item.platform] || 'On your network'} · ${state}`;
}

// --- Cards ----------------------------------------------------------------------------------------------------

function element(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
function icon(name) {
  const node = element('span', 'icon');
  node.dataset.icon = name;
  return node;
}
// The name, then the operating system when the computer announces it, then the address or state.
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
function catBadge() {
  const node = icon('cat');
  node.classList.add('badge');
  node.setAttribute('aria-hidden', 'true');
  return node;
}

/** The card of one computer. A tap connects (connecting.js); its button saves or forgets it. */
function deviceCard(item) {
  const card = element('div', 'device'),
    main = element('button', 'device-main'),
    action = element('button', 'device-action');
  card.dataset.key = item.id;
  card.setAttribute('role', 'listitem');
  card.classList.toggle('online', item.online);
  card.classList.toggle('changed', item.changed);
  card.classList.toggle('manual', item.manual);
  card.classList.toggle('away', item.away && !item.online);
  if (!appeared.has(item.id)) {
    appeared.add(item.id);
    card.classList.add('appear');
  }
  main.type = 'button';
  main.append(
    icon(item.platform === 'darwin' ? 'laptop' : 'monitor'),
    label(
      item.name,
      item.changed
        ? 'Certificate changed'
        : item.away && !item.online
          ? 'Another network'
          : item.address,
      item.os,
    ),
    item.manual ? catBadge() : statusDot(),
  );
  main.setAttribute(
    'aria-label',
    `${item.name}, ${item.address}, ${describe(item)}. Tap to connect.`,
  );
  main.addEventListener('click', () => connectTo(item));
  action.type = 'button';
  action.textContent = item.saved ? 'Forget' : 'Save';
  action.setAttribute('aria-label', `${action.textContent} ${item.name}`);
  action.addEventListener('click', () => (item.saved ? forget(item) : remember(item)));
  card.append(main, action);
  return card;
}

/** The last card, which opens the Add computer dialog. */
function addCard() {
  const card = element('div', 'device add'),
    button = element('button', 'device-main');
  card.dataset.key = 'add';
  card.setAttribute('role', 'listitem');
  button.type = 'button';
  button.append(icon('plus'), 'Add computer');
  button.addEventListener('click', openAddDialog);
  card.append(button);
  return card;
}

// --- Drawing the list -----------------------------------------------------------------------------------------

// The house shows two floors of windows (four on a one-column phone) until the user asks for the rest.
function renderDevices() {
  const tracks = getComputedStyle($('devices')).gridTemplateColumns,
    columns = tracks.includes('repeat') ? 4 : Math.max(1, tracks.split(' ').length);
  const items = deviceItems(),
    limit = columns === 1 ? 4 : columns * 2 - 1,
    shown = expanded || items.length <= limit ? items : items.slice(0, limit);
  const signature = JSON.stringify([items, expanded, limit]);
  // The cat sleeps while there's no computer to connect to and sits up when one is online.
  const ready = items.some((i) => i.online);
  if (ready !== catReady) {
    catReady = ready;
    house?.setState({ ready });
  }
  $('discovery-status').textContent =
    discoveryError ||
    (items.some((i) => i.online)
      ? 'Tap a computer to connect.'
      : 'Looking for computers sharing on your network…');
  $('saved-summary').textContent = saved.length
    ? `${saved.length} saved ${saved.length === 1 ? 'computer' : 'computers'}.`
    : 'No saved computers yet.';
  $('forget-all').disabled = !saved.length;
  if (signature === lastDevices) return;
  lastDevices = signature;
  $('devices').replaceChildren(...shown.map(deviceCard), addCard());
  $('house-more').hidden = items.length <= limit;
  $('show-all-label').textContent = expanded ? 'Show fewer' : `Show all ${items.length} computers`;
  $('show-all-icon').dataset.icon = expanded ? 'chevron-up' : 'chevron-down';
  PixelIcons.render($('house'));
  applyHouseLight();
}

// --- Saving and forgetting ------------------------------------------------------------------------------------

// The same saved entry: the same address and port, and both discovered or both added by hand.
const sameEntry = (a, b) => keyOf(a) === keyOf(b) && manualEntry(a) === manualEntry(b);
function storeSaved(entry) {
  saved = [...saved.filter((d) => !sameEntry(d, entry)), entry];
  write('ym.saved', saved);
  renderDevices();
}
function remember(item) {
  storeSaved({
    name: item.name,
    address: item.address,
    port: item.port,
    platform: PLATFORMS[item.platform] ? item.platform : '',
    fingerprint: probes.get(keyOf(item))?.fingerprint || '',
    manual: false,
  });
  notice(`Saved ${item.name}.`);
}
function forget(item) {
  saved = saved.filter((d) => !sameEntry(d, item));
  write('ym.saved', saved);
  renderDevices();
  notice(`Forgot ${item.name}.`);
}

// --- Who is online --------------------------------------------------------------------------------------------

// Every listed computer is checked every few seconds, so one that closes disappears quickly.
async function probeAll() {
  const keys = [...new Set([...discovered, ...saved].map(keyOf))].slice(0, 32);
  if (document.hidden || !keys.length) {
    renderDevices();
    return;
  }
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
      if (result.online) online.add(key);
    }
  } catch {}
  renderDevices();
}
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

// --- Adding a computer by address -----------------------------------------------------------------------------

function openAddDialog() {
  $('add-form').reset();
  $('add-error').hidden = true;
  $('add-dialog').showModal();
}
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
  notice(`Saved ${entry.name}. Tap it to connect.`);
}

/** Connects the list, its buttons, the Add computer dialog and discovery. Called once by start.js. */
function setUpDeviceList() {
  addEventListener('resize', renderDevices);
  $('show-all').onclick = () => {
    expanded = !expanded;
    renderDevices();
  };
  $('refresh').onclick = refreshList;
  $('add-form').addEventListener('submit', addComputer);
  $('add-cancel').onclick = () => $('add-dialog').close();
  api.onDiscovery(({ devices, error }) => {
    discovered = Array.isArray(devices) ? devices : [];
    discoveryError = error || '';
    renderDevices();
  });
}
