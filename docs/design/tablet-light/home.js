'use strict';
// The Android home screen: the desktop app's network list (src/windows/host/host.js) on a touch screen. Java does the
// network work through YesMachineHome: discovery, certificate checks, sign-in and the remembered passwords.
// Replies come back through window.__homeReply and pushed updates through window.__homeEvent.
const native = window.YesMachineHome;
const waiting = new Map();
let nextCall = 1;
window.__homeReply = (id, ok, value) => {
  const call = waiting.get(id);
  if (!call) return;
  waiting.delete(id);
  if (ok) call.resolve(value);
  else
    call.reject(
      Object.assign(Error(value?.error || 'Something went wrong. Try again.'), {
        status: value?.status,
      }),
    );
};
const call = (method, args = {}) =>
  new Promise((resolve, reject) => {
    const id = String(nextCall++);
    waiting.set(id, { resolve, reject });
    native.request(id, method, JSON.stringify(args));
  });
const handlers = { discovery: [], event: [], control: [] };
window.__homeEvent = (event) => {
  for (const handler of handlers[event?.kind] || []) handler(event.value);
};
const api = {
  info: () => call('info'),
  probe: (targets) => call('probe', { targets }),
  refreshDiscovery: () => call('refresh'),
  inspect: (target) => call('inspect', target),
  trust: (target) => call('trust', target),
  signIn: (target, credential, name) => call('signIn', { ...target, ...credential, name }),
  signInSaved: (target, name) => call('signInSaved', { ...target, name }),
  trustedCount: () => call('trustedCount'),
  forgetTrusted: () => call('forgetTrusted'),
  credentialsInfo: () => call('credentialsInfo'),
  forgetCredentials: () => call('forgetCredentials'),
  control: () => call('control'),
  setMode: (mode) => call('setMode', { mode }),
  openAccessibility: () => call('openAccessibility'),
  openDeveloperOptions: () => call('openDeveloperOptions'),
  startSharing: () => call('startSharing'),
  stopSharing: () => call('stopSharing'),
  disconnectComputer: () => call('disconnectComputer'),
  answer: (id, allow, always) => call('answer', { id, allow, always }),
  forgetComputers: () => call('forgetComputers'),
  setTheme: (mode) => call('setTheme', { mode }),
  onDiscovery: (handler) => handlers.discovery.push(handler),
  onEvent: (handler) => handlers.event.push(handler),
  onControl: (handler) => handlers.control.push(handler),
};

const $ = (id) => document.getElementById(id);
const PLATFORMS = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };
let info = null,
  house = null,
  catReady = false,
  expanded = false,
  credentialsAvailable = false,
  noticeTimer = 0,
  endedTimer = 0,
  busy = false;
let discovered = [],
  discoveryError = '',
  probes = new Map(),
  misses = new Map(),
  online = new Set(),
  appeared = new Set(),
  lastDevices = '';
let saved = read('ym.saved', []).filter(validSaved);
// Night or day, as on the desktop: the house walks Sarigüeya over between them (pixel-home.js); the page's colors
// change halfway, and each window of the house when the light reaches it. Java colors Android's status and
// navigation bars to match, keeps the choice for the next start and opens the viewer in the same light.
let theme = read('ym.theme', 'night') === 'day' ? 'day' : 'night',
  pageTheme = null,
  houseLight = theme === 'day' ? 1 : 0;
function applyPageTheme(mode) {
  if (pageTheme === mode) return;
  pageTheme = mode;
  document.documentElement.dataset.theme = mode === 'day' ? 'light' : 'dark';
  api.setTheme(mode).catch(() => {});
}
applyPageTheme(theme);
function renderThemeToggle() {
  const label = theme === 'day' ? 'Switch to night' : 'Switch to day';
  $('theme-toggle').setAttribute('aria-label', label);
  $('theme-toggle').title = label;
  $('theme-icon').dataset.icon = theme === 'day' ? 'moon' : 'sun';
  PixelIcons.render($('theme-toggle'));
}
function applyHouseLight() {
  const box = $('house').getBoundingClientRect(),
    changing = houseLight > 0 && houseLight < 1;
  for (const el of [$('house-sky'), $('house-more'), ...$('devices').children]) {
    const r = el.getBoundingClientRect(),
      reach =
        changing && box.width
          ? PixelHome.reach(
              r.left + r.width / 2 - box.left,
              r.top + r.height / 2 - box.top,
              box.width,
              box.height,
            )
          : 0.5;
    el.classList.toggle('day', houseLight > reach);
  }
}
function onHouseLight(light) {
  houseLight = light;
  applyHouseLight();
  applyPageTheme(light > 0.5 ? 'day' : 'night');
  if (light === 0 || light === 1) $('theme-toggle').disabled = false;
}
// The switch walks her over while the house is on screen; on another page the mode just changes. The house sits
// below the This device card, so when part of it is out of view it scrolls in first, and then she sets off.
function toggleTheme() {
  theme = theme === 'day' ? 'night' : 'day';
  write('ym.theme', theme);
  renderThemeToggle();
  const animate = !$('view-home').hidden;
  if (animate) $('theme-toggle').disabled = true;
  const go = () => {
    house.setMode(theme, { animate });
    if (!house.changing) $('theme-toggle').disabled = false;
  };
  if (animate && showHouse()) setTimeout(go, 500);
  else go();
}
function showHouse() {
  const box = $('house').getBoundingClientRect(),
    view = document.querySelector('main').getBoundingClientRect();
  if (box.top >= view.top - 1 && box.bottom <= view.bottom + 1) return false;
  $('house').scrollIntoView({
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: box.height > view.height ? 'start' : 'end',
  });
  return true;
}

function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
function octets(value) {
  const parts = String(value).split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
    ? parts.map(Number)
    : null;
}
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
function networkLabel() {
  const n = info?.network && octets(info.network.address);
  if (!n) return 'this network';
  const bits = info.network.prefix | 0;
  return bits === 24 ? `${n[0]}.${n[1]}.${n[2]}.x` : `${info.network.address}/${bits}`;
}
function notice(text, error = false) {
  clearTimeout(noticeTimer);
  $('message').textContent = text || '';
  $('message').classList.toggle('error', error);
  if (text)
    noticeTimer = setTimeout(
      () => {
        $('message').textContent = '';
      },
      error ? 12000 : 7000,
    );
}
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

const manualEntry = (d) => d.manual === true || (d.manual === undefined && !d.platform);
// A discovered computer that answered before and then misses two probes in a row has closed, even if its
// announcement lingers. One that never answered and sits on another network stays listed, so tapping it can
// explain why it can't be reached.
function present(d) {
  const key = keyOf(d);
  if ((misses.get(key) || 0) < 2) return true;
  return !online.has(key) && !onThisNetwork(d.address);
}
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
function showInfo(title, text) {
  $('info-title').textContent = title;
  $('info-text').textContent = text;
  if (!$('info-dialog').open) $('info-dialog').showModal();
}
// Tap: check the certificate (asking the first time), then sign in with that computer's account, either with
// the remembered password or through the sign-in dialog. Java opens the viewer once it has a ticket.
async function connectTo(item) {
  if (busy) return;
  busy = true;
  house?.look();
  const target = targetOf(item);
  try {
    notice(`Checking ${item.name}…`);
    const check = await api.inspect(target);
    notice('');
    if (!check.online) {
      if (!onThisNetwork(item.address))
        showInfo(
          `Can’t reach ${item.name} from here`,
          `${item.name} is at ${item.address}, outside this device’s network (${networkLabel()}). If it’s a virtual machine, set its network adapter to bridged so it gets an address on your Wi-Fi. Otherwise, connect both devices to the same network.`,
        );
      else
        notice(
          `${item.name} isn’t sharing right now. Start sharing on that computer and try again.`,
          true,
        );
      return;
    }
    if (!check.trusted) {
      if (!(await confirmTrust(item, check))) return;
      saved = saved.map((d) =>
        keyOf(d) === keyOf(item) ? { ...d, fingerprint: check.fingerprint } : d,
      );
      write('ym.saved', saved);
      renderDevices();
      renderTrusted();
    }
    if (check.remembered) notice(`Signing in to ${item.name}…`);
    const quick = check.remembered
      ? await api.signInSaved(target, item.name)
      : { needsCredentials: true };
    if (quick.needsCredentials) await askCredentials(item, quick);
    renderCredentials();
  } catch (e) {
    notice(e.message, true);
  } finally {
    busy = false;
  }
}
function showEnded({ name, reason }) {
  probeAll();
  if (reason === 'closed') {
    notice(`Disconnected from ${name}.`);
    return;
  }
  const dialog = $('ended-dialog');
  $('ended-title').textContent = `Disconnected from ${name}`;
  $('ended-detail').textContent =
    reason === 'replaced'
      ? `Another device connected to ${name}, so this session ended.`
      : 'The connection ended. Check that Yes Machine is still open on that computer, then tap it to connect again.';
  if (!dialog.open) dialog.showModal();
  clearTimeout(endedTimer);
  endedTimer = setTimeout(() => {
    if (dialog.open) dialog.close();
  }, 7000);
}
function showLoginError(text) {
  $('login-error').textContent = text;
  $('login-error').hidden = !text;
}
// The eye beside a password shows what was typed; the password is hidden again whenever the dialog opens.
function revealPassword(button, show) {
  $(button.dataset.reveal).type = show ? 'text' : 'password';
  button.setAttribute('aria-pressed', String(show));
  button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  button.querySelector('.icon').dataset.icon = show ? 'eye-closed' : 'eye';
  PixelIcons.render(button);
}
document.querySelectorAll('.reveal').forEach((button) =>
  button.addEventListener('click', () => {
    revealPassword(button, button.getAttribute('aria-pressed') !== 'true');
    $(button.dataset.reveal).focus();
  }),
);
function askCredentials(item, { user, error } = {}) {
  const dialog = $('login-dialog'),
    form = $('login-form');
  form.reset();
  revealPassword($('login-reveal'), false);
  $('login-title').textContent = `Sign in to ${item.name}`;
  $('login-user').value = user || read('ym.users', {})[keyOf(item)] || '';
  $('login-remember').disabled = !credentialsAvailable;
  $('login-remember-note').hidden = credentialsAvailable;
  showLoginError(error || '');
  dialog.showModal();
  ($('login-user').value ? $('login-password') : $('login-user')).focus();
  return new Promise((resolve) => {
    let working = false;
    const finish = (ok) => {
      form.onsubmit = $('login-cancel').onclick = dialog.onclose = null;
      if (dialog.open) dialog.close();
      resolve(ok);
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (working) return;
      const name = $('login-user').value.trim(),
        password = $('login-password').value;
      if (!name || !password) {
        showLoginError('Enter the user name and password of that computer.');
        return;
      }
      working = true;
      $('login-submit').disabled = true;
      $('login-submit').textContent = 'Connecting…';
      showLoginError('');
      try {
        await api.signIn(
          targetOf(item),
          { user: name, password, remember: $('login-remember').checked },
          item.name,
        );
        write('ym.users', { ...read('ym.users', {}), [keyOf(item)]: name });
        finish(true);
      } catch (e) {
        showLoginError(e.message);
        $('login-password').select();
      } finally {
        working = false;
        $('login-submit').disabled = false;
        $('login-submit').textContent = 'Connect';
      }
    };
    $('login-cancel').onclick = () => finish(false);
    dialog.onclose = () => finish(false);
  });
}
function confirmTrust(item, check) {
  const dialog = $('trust-dialog');
  $('trust-title').textContent = check.changed
    ? `${item.name} has a new certificate`
    : `Verify ${item.name}`;
  $('trust-text').textContent =
    `${check.changed ? 'This computer now shows a different certificate. ' : 'Before the first connection, '}compare this fingerprint with the one in Yes Machine on that computer, under “Verify this computer’s certificate”.`;
  $('trust-host').textContent = `${item.name} · ${keyOf(item)}`;
  $('trust-fingerprint').textContent = check.fingerprint;
  $('trust-check').checked = false;
  $('trust-confirm').disabled = true;
  dialog.showModal();
  return new Promise((resolve) => {
    let done = false;
    const finish = async (ok) => {
      if (done) return;
      done = true;
      $('trust-confirm').onclick = $('trust-cancel').onclick = dialog.onclose = null;
      if (dialog.open) dialog.close();
      if (ok)
        try {
          await api.trust(targetOf(item));
        } catch (e) {
          notice(e.message, true);
          ok = false;
        }
      resolve(ok);
    };
    $('trust-confirm').onclick = () => finish(true);
    $('trust-cancel').onclick = () => finish(false);
    dialog.onclose = () => finish(false);
  });
}
async function renderTrusted() {
  try {
    const { count } = await api.trustedCount();
    $('trusted-summary').textContent = count
      ? `${count} trusted ${count === 1 ? 'computer' : 'computers'}. A changed certificate always asks again.`
      : 'No trusted computers yet.';
    $('forget-trusted').disabled = !count;
  } catch {}
}
async function renderCredentials() {
  try {
    const { available, count } = await api.credentialsInfo();
    credentialsAvailable = available;
    $('credentials-summary').textContent = !available
      ? 'This device can’t store passwords securely, so they are never remembered.'
      : count
        ? `${count} remembered ${count === 1 ? 'sign-in' : 'sign-ins'}, encrypted with a key kept in this device’s secure storage.`
        : 'No remembered sign-ins yet.';
    $('forget-credentials').disabled = !count;
  } catch {}
}
// Destructive buttons ask for a second tap within four seconds.
function twoStep(button, action) {
  let timer = 0;
  const text = button.textContent;
  button.onclick = () => {
    if (!timer) {
      button.textContent = 'Tap again to forget';
      timer = setTimeout(() => {
        timer = 0;
        button.textContent = text;
      }, 4000);
      return;
    }
    clearTimeout(timer);
    timer = 0;
    button.textContent = text;
    action();
  };
}
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
// The rooftop cat page shows the original night scene. It is drawn only while the page is open, at the
// largest whole scale that fits.
let catScene = null;
function showCatScene(on) {
  if (on && !catScene) {
    catScene = PixelScene.mount($('cat-art'), { mood: 'awake', scale: 3 });
    new ResizeObserver(() =>
      catScene.setScale(
        Math.max(1, Math.min(4, Math.floor(($('cat-scene').clientWidth - 24) / PixelScene.W))),
      ),
    ).observe($('cat-scene'));
  }
  if (catScene) on ? catScene.resume() : catScene.pause();
}
function showView(name) {
  for (const view of ['home', 'cat', 'settings']) {
    $(`view-${view}`).hidden = view !== name;
    if (view === name) $(`nav-${view}`).setAttribute('aria-current', 'page');
    else $(`nav-${view}`).removeAttribute('aria-current');
  }
  showCatScene(name === 'cat');
}
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
async function loadInfo() {
  try {
    info = await api.info();
    $('version').textContent = `v${info.version}`;
    $('about-version').textContent = info.version;
    renderNetworkPill();
    lastDevices = '';
    renderDevices();
  } catch (e) {
    notice(e.message, true);
  }
}

// General mode: this device shares its screen with a computer on the network, which touches and types through
// Accessibility. Java pushes the state whenever it changes: the mode, Accessibility, sharing, and a computer waiting
// for an answer, which the person gives here or in the notification. Closing the question without an answer denies it.
const SUMMARIES = {
  general: 'Works over Wi-Fi with Android’s own permissions. Nothing else to set up.',
  advanced: 'The fastest, through Android’s developer options, by cable or Wi-Fi.',
};
let control = null,
  instructions = false,
  shownRequest = '',
  openRequest = '';
function bold(text) {
  const node = element('b');
  node.textContent = text;
  return node;
}
function renderControl(state) {
  if (!state) return;
  control = state;
  const mode = state.mode === 'advanced' ? 'advanced' : 'general',
    general = mode === 'general';
  const sharing = general && state.sharing !== 'off',
    connected = general && state.sharing === 'connected';
  // The house: by day the garage and the gates open while this device shares, and she wags her tail while a computer
  // controls it.
  house?.setState({ sharing, connected });
  // Home: the This device card.
  $('tablet-device').textContent = [state.name, state.system].filter(Boolean).join(' · ');
  $('tablet-status').textContent = !general
    ? 'Advanced mode'
    : connected
      ? 'Connected'
      : sharing
        ? 'Sharing'
        : 'Not sharing';
  $('tablet-status').className = `pill${sharing || !general ? ' live' : ''}`;
  $('tablet-text').replaceChildren(
    ...(!general
      ? [
          'A computer controls this device through Android’s developer options, by USB cable or Wi-Fi. Nothing runs in this app.',
        ]
      : connected
        ? [bold(state.computer), ' is controlling this device.']
        : sharing
          ? [
              'Waiting for a computer. In Yes Machine on a computer on this Wi-Fi, double-click ',
              bold(state.name),
              '. This device will ask you before it lets it in.',
            ]
          : [
              'Let a computer on this Wi-Fi see and use this device. You decide which computer when it asks.',
            ]),
  );
  $('tablet-permission').hidden = !general || state.accessibility;
  $('tablet-share').hidden = !general || sharing;
  $('tablet-actions').hidden = !sharing;
  $('tablet-disconnect').hidden = !connected;
  $('tablet-verify').hidden = !sharing || !state.fingerprint;
  $('tablet-fingerprint').textContent = state.fingerprint || '';
  $('tablet-instructions').hidden = general;
  $('tablet-card').hidden = false;
  // Settings: the mode, its instructions while they're open, and the computers that are always allowed.
  for (const name of ['general', 'advanced']) {
    $(`mode-${name}`).setAttribute('aria-checked', String(name === mode));
    $(`mode-${name}-more`).hidden = !instructions || name !== mode;
  }
  $('mode-summary').textContent = SUMMARIES[mode];
  $('mode-toggle').setAttribute('aria-expanded', String(instructions));
  $('mode-toggle-label').textContent = instructions ? 'Show less' : 'See instructions';
  $('mode-toggle-icon').dataset.icon = instructions ? 'chevron-up' : 'chevron-right';
  $('accessibility-state').classList.toggle('ok', !!state.accessibility);
  $('accessibility-text').textContent = state.accessibility
    ? 'Yes Machine is allowed in Accessibility.'
    : 'Yes Machine isn’t allowed in Accessibility yet.';
  const allowed = state.allowedComputers | 0;
  $('allowed-summary').textContent = allowed
    ? `${allowed} always allowed ${allowed === 1 ? 'computer' : 'computers'}. Any other computer asks first.`
    : 'No computers are always allowed yet.';
  $('forget-allowed').disabled = !allowed;
  PixelIcons.render($('tablet-card'));
  PixelIcons.render($('control-setting'));
  // The question for a computer that wants to control this device, once per request.
  const asking = general ? state.asking : null,
    dialog = $('allow-dialog');
  if (asking && asking.id !== shownRequest) {
    shownRequest = openRequest = asking.id;
    $('allow-name').textContent = asking.name;
    $('allow-detail').textContent = [asking.system, asking.address].filter(Boolean).join(' · ');
    $('allow-text').textContent =
      'It wants to control this device: it will see your screen and can touch and type here until you stop sharing.';
    $('allow-always').checked = true;
    if (!dialog.open) dialog.showModal();
  } else if (!asking && openRequest) {
    openRequest = '';
    if (dialog.open) dialog.close();
  }
}
function answerComputer(allow) {
  const id = openRequest;
  openRequest = '';
  if ($('allow-dialog').open) $('allow-dialog').close();
  if (id)
    api.answer(id, allow, allow && $('allow-always').checked).catch((e) => notice(e.message, true));
}
async function chooseMode(mode) {
  try {
    renderControl(await api.setMode(mode));
  } catch (e) {
    notice(e.message, true);
  }
}

// Android's back button: close an open dialog, or go from Settings back home. Returns false to let the app close.
window.__homeBack = () => {
  const open = [...document.querySelectorAll('dialog')].find((dialog) => dialog.open);
  if (open) {
    open.close();
    return true;
  }
  if ($('view-home').hidden) {
    showView('home');
    return true;
  }
  return false;
};
api.onDiscovery(({ devices, error }) => {
  discovered = Array.isArray(devices) ? devices : [];
  discoveryError = error || '';
  renderDevices();
});
api.onControl(renderControl);
api.onEvent((event) => {
  if (event.type === 'viewer-ended') showEnded(event);
  if (event.type === 'resumed') {
    loadInfo().then(probeAll);
    renderCredentials();
    renderTrusted();
  }
});
PixelIcons.render();
renderThemeToggle();
house = PixelHome.mount($('house-art'), {
  container: $('house'),
  mode: theme,
  ready: catReady,
  onLight: onHouseLight,
  measure: () => ({
    width: $('house').clientWidth,
    height: $('house').clientHeight,
    roofTop: $('house-sky').offsetHeight,
    streetTop: $('house-street').offsetTop,
  }),
});
$('theme-toggle').addEventListener('click', toggleTheme);
addEventListener('resize', renderDevices);
$('show-all').onclick = () => {
  expanded = !expanded;
  renderDevices();
};
$('nav-home').onclick = () => showView('home');
$('nav-settings').onclick = () => showView('settings');
$('nav-cat').onclick = () => showView('cat');
for (const button of document.querySelectorAll('[data-guide]'))
  button.onclick = () => SetupGuides.open(button.dataset.guide);
$('add-form').addEventListener('submit', addComputer);
$('add-cancel').onclick = () => $('add-dialog').close();
$('trust-check').onchange = () => {
  $('trust-confirm').disabled = !$('trust-check').checked;
};
$('ended-ok').onclick = () => $('ended-dialog').close();
$('info-ok').onclick = () => $('info-dialog').close();
$('refresh').onclick = refreshList;
twoStep($('forget-all'), () => {
  saved = [];
  probes.clear();
  write('ym.saved', saved);
  renderDevices();
  notice('Saved computers removed.');
});
twoStep($('forget-trusted'), async () => {
  await api.forgetTrusted();
  renderTrusted();
  notice('Trusted certificates removed. Each computer asks to be verified again.');
});
twoStep($('forget-credentials'), async () => {
  await api.forgetCredentials();
  renderCredentials();
  notice('Remembered sign-ins removed.');
});
twoStep($('forget-allowed'), async () => {
  renderControl(await api.forgetComputers());
  notice('Allowed computers removed. Each one asks again before it connects.');
});
$('mode-general').onclick = () => {
  if (control?.mode === 'advanced') chooseMode('general');
};
$('mode-advanced').onclick = () => {
  if (control && control.mode !== 'advanced') $('advanced-dialog').showModal();
};
$('advanced-cancel').onclick = () => $('advanced-dialog').close();
$('advanced-confirm').onclick = () => {
  $('advanced-dialog').close();
  chooseMode('advanced');
};
$('mode-toggle').onclick = () => {
  instructions = !instructions;
  renderControl(control);
};
$('open-accessibility').onclick = $('tablet-allow').onclick = () => api.openAccessibility();
$('open-developer').onclick = () => api.openDeveloperOptions();
$('tablet-share').onclick = () => api.startSharing().catch((e) => notice(e.message, true));
$('tablet-stop').onclick = () => api.stopSharing();
$('tablet-disconnect').onclick = () => api.disconnectComputer();
$('tablet-instructions').onclick = () => {
  instructions = true;
  renderControl(control);
  showView('settings');
  $('control-setting').scrollIntoView({ block: 'start' });
};
$('allow-yes').onclick = () => answerComputer(true);
$('allow-deny').onclick = () => answerComputer(false);
$('allow-dialog').onclose = () => answerComputer(false);
renderDevices();
renderTrusted();
renderCredentials();
api
  .control()
  .then(renderControl)
  .catch(() => {});
loadInfo().then(probeAll);
setInterval(() => {
  probeAll();
  followNetwork();
}, 5000);
