'use strict';
// Prototype only: Settings with lists in place of Forget all, for ?app=desktop (the computer's main window) or
// ?app=android (the Android app's home screen). Every row that forgets something opens into a list: saved computers,
// remembered sign-ins and trusted certificates, and on Android the always allowed computers. The lists work: a click
// or tap anywhere on a row's top opens it, then the checkboxes, Select all, and Forget, which asks for a second click
// or tap. The preview page around the frame can also put a list in a state by posting {list, state}, or switch the
// colors with {theme}. The computers are made up.

const app = new URLSearchParams(location.search).get('app') === 'android' ? 'android' : 'desktop';
const $ = (id) => document.getElementById(id);
const press = app === 'android' ? 'Tap' : 'Click';

// A pixel check and a dash for the checkboxes, on the 12×12 grid of public/pixel-icons.js, which would get them.
PixelIcons.ICONS.check = [
  '............',
  '............',
  '..........##',
  '.........##.',
  '........##..',
  '.##....##...',
  '..##..##....',
  '...####.....',
  '....##......',
  '............',
  '............',
  '............',
];
PixelIcons.ICONS.dash = [
  '............',
  '............',
  '............',
  '............',
  '............',
  '..########..',
  '..########..',
  '............',
  '............',
  '............',
  '............',
  '............',
];

// --- The computers -------------------------------------------------------------------------------------------

// Each list's entries as the app would keep them: the computer's name and system when it was saved, trusted or
// allowed, its address and port (allowed computers are kept by certificate, so they have none), the account of a
// remembered sign-in, and the date. Entries saved before dates were kept have none; a trusted certificate kept
// before names were has none either, and shows its address.
const MAC = { name: 'Studio Mac mini', system: 'macOS', address: '192.168.1.25:4777' },
  PC = { name: 'Office PC', system: 'Windows 11', address: '192.168.1.31:4777' },
  TAB = { name: 'Galaxy Tab', system: 'Android', address: '192.168.1.40:4778' },
  UBUNTU = { name: 'Ubuntu laptop', system: 'Ubuntu 24.04', address: '192.168.1.52:4777' },
  LAB = { name: 'Lab Mac', system: 'macOS', address: '192.168.1.60:4777' };
const desktop = app === 'desktop';
const ENTRIES = {
  saved: [
    { ...MAC, date: '2026-10-20' },
    { ...PC, date: '2026-10-17' },
    { ...UBUNTU, date: '2026-10-11' },
    { ...LAB, date: '' },
  ],
  credentials: [
    { ...MAC, account: 'alex', date: '2026-10-21' },
    { ...UBUNTU, account: 'sam', date: '' },
  ],
  trusted: [
    { ...MAC, date: '2026-10-21' },
    { ...PC, date: '2026-10-17' },
    ...(desktop ? [{ ...TAB, date: '2026-10-16' }] : []),
    { ...UBUNTU, date: '2026-10-11' },
    { name: '', system: '', address: LAB.address, date: '' },
  ],
  allowed: [
    { ...MAC, address: '', date: '2026-10-19' },
    { ...PC, address: '', date: '2026-10-17' },
    { ...UBUNTU, system: '', address: '', date: '' },
  ],
};

// What each list says: its title, its summary for n entries, the words before its date, and the notice after
// forgetting, which names the one computer or counts them.
const plural = (n, one, many) => (n === 1 ? one : many);
const LISTS = {
  allowed: {
    title: 'Allowed computers',
    summary: (n) =>
      n
        ? `${n} always allowed ${plural(n, 'computer', 'computers')}. Any other computer asks first.`
        : 'No computers are always allowed yet.',
    since: 'Allowed since',
    forgot: (gone) =>
      gone.length === 1
        ? `Forgot ${label(gone[0])}. It asks before taking control again.`
        : `Forgot ${gone.length} computers. They ask before taking control again.`,
  },
  saved: {
    title: 'Saved computers',
    summary: (n) =>
      n ? `${n} saved ${plural(n, 'computer', 'computers')}.` : 'No saved computers yet.',
    since: 'Saved',
    forgot: (gone) =>
      gone.length === 1 ? `Forgot ${label(gone[0])}.` : `Forgot ${gone.length} saved computers.`,
  },
  credentials: {
    title: 'Remembered sign-ins',
    summary: (n) =>
      n
        ? `${n} remembered ${plural(n, 'sign-in', 'sign-ins')}, encrypted with ` +
          (desktop ? 'this computer’s keychain.' : 'a key in this device’s Keystore.')
        : 'No remembered sign-ins yet.',
    since: 'Remembered since',
    forgot: (gone) =>
      gone.length === 1
        ? `Forgot the sign-in for ${label(gone[0])}. It asks for the password again.`
        : `Forgot ${gone.length} remembered sign-ins. They ask for the password again.`,
  },
  trusted: {
    title: 'Trusted certificates',
    summary: (n) =>
      n
        ? `${n} trusted ${plural(n, 'computer', 'computers')}. A changed certificate always asks again.`
        : 'No trusted computers yet.',
    since: 'Trusted',
    forgot: (gone) =>
      gone.length === 1
        ? `Forgot ${label(gone[0])}’s certificate. It asks to be verified again.`
        : `Forgot ${gone.length} trusted certificates. Those computers ask to be verified again.`,
  },
};
const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
// An entry's name, or its address when its name isn't known.
const label = (entry) => entry.name || entry.address;
// Newest first, those without a date last.
const newestFirst = (entries) =>
  [...entries].sort((a, b) => (b.date || '0').localeCompare(a.date || '0'));

// --- The rows ------------------------------------------------------------------------------------------------

/** A row and what it needs to redraw: its entries and which are checked. Its top opens and closes the list. */
function listRow(key) {
  const row = document.createElement('div');
  row.className = 'setting list-setting';
  row.innerHTML = `
    <div class="list-head">
      <div><h2></h2><p class="summary"></p></div>
      <button type="button" class="list-toggle" aria-expanded="false">
        <span class="label">Show list</span><span class="icon" data-icon="chevron-down"></span>
      </button>
    </div>
    <div class="list-body">
      <div class="trust-list">
        <div class="list-bar">
          <label class="select-all"><span class="check"><input type="checkbox" /><span data-icon="check">
            </span></span>Select all</label>
          <span class="count"></span>
          <button type="button" class="ghost forget" disabled>Forget</button>
        </div>
        <ul></ul>
      </div>
    </div>`;
  row.querySelector('h2').textContent = LISTS[key].title;
  const state = { key, row, entries: newestFirst(ENTRIES[key]), checked: new Set(), timer: 0 };
  // The whole top of the row opens and closes it; the toggle is the same thing for the keyboard.
  row.querySelector('.list-head').onclick = () => open(state, !row.classList.contains('open'));
  row.querySelector('.select-all input').onchange = (event) => {
    state.checked = new Set(event.target.checked ? state.entries : []);
    draw(state);
  };
  row.querySelector('.forget').onclick = () => forget(state);
  draw(state);
  return state;
}

/**
 * Opens or closes a row's list. Opening grows the row in four steps, and the computers then pop in one after
 * another, like new cards on the house.
 */
function open(state, opened) {
  const { row } = state;
  if (opened && !state.entries.length) return;
  row.classList.toggle('open', opened);
  const toggle = row.querySelector('.list-toggle');
  toggle.setAttribute('aria-expanded', String(opened));
  toggle.querySelector('.label').textContent = opened ? 'Hide list' : 'Show list';
  row.querySelector('.list-body').inert = !opened;
  if (opened)
    row.querySelectorAll('li').forEach((item, index) => {
      item.classList.remove('appear');
      void item.offsetWidth; // restarts the animation
      item.style.animationDelay = `${120 + index * 50}ms`;
      item.classList.add('appear');
    });
}

/** Redraws a row from its state: the summary, the entries and their checkboxes, Select all, the count and Forget. */
function draw(state) {
  const list = LISTS[state.key],
    total = state.entries.length,
    picked = state.checked.size;
  state.row.querySelector('.summary').textContent = list.summary(total);
  state.row.classList.toggle('empty', !total);
  if (!total) open(state, false);
  const items = state.entries.map((entry) => {
    const item = document.createElement('li');
    item.innerHTML = `<label class="entry"><span class="check"><input type="checkbox" /><span data-icon="check">
      </span></span><span class="entry-text"><span class="entry-name"></span><span class="entry-detail"></span>
      </span></label>`;
    const box = item.querySelector('input');
    item.querySelector('.entry-name').textContent = label(entry);
    const detail = item.querySelector('.entry-detail');
    detail.textContent = [
      entry.account && `as ${entry.account}`,
      entry.system,
      entry.name && entry.address,
    ]
      .filter(Boolean)
      .join(' · ');
    const date = document.createElement('span');
    date.textContent = entry.date
      ? `${list.since} ${DATE.format(new Date(`${entry.date}T12:00`))}`
      : 'Date not recorded';
    if (!entry.date) date.className = 'undated';
    detail.append(detail.textContent ? ' · ' : '', date);
    box.checked = state.checked.has(entry);
    item.querySelector('.entry').classList.toggle('selected', box.checked);
    box.onchange = () => {
      if (box.checked) state.checked.add(entry);
      else state.checked.delete(entry);
      draw(state);
    };
    return item;
  });
  state.row.querySelector('ul').replaceChildren(...items);
  const all = state.row.querySelector('.select-all input');
  all.checked = total > 0 && picked === total;
  all.indeterminate = picked > 0 && picked < total;
  all.nextElementSibling.dataset.icon = all.indeterminate ? 'dash' : 'check';
  state.row.querySelector('.count').textContent = picked ? `${picked} of ${total} selected` : '';
  const button = state.row.querySelector('.forget');
  clearTimeout(state.timer);
  state.timer = 0;
  button.classList.remove('confirm');
  button.disabled = !picked;
  button.textContent = !picked ? 'Forget' : picked === total ? 'Forget all' : `Forget ${picked}`;
  PixelIcons.render(state.row);
}

/** Forget: the first press asks again for four seconds; the second forgets what is checked and says so. */
function forget(state) {
  const button = state.row.querySelector('.forget'),
    picked = state.checked.size;
  if (!state.timer) {
    button.textContent = `${press} again to forget ${picked === state.entries.length ? 'all' : picked}`;
    button.classList.add('confirm');
    state.timer = setTimeout(() => draw(state), 4000);
    return;
  }
  const gone = state.entries.filter((entry) => state.checked.has(entry));
  state.entries = state.entries.filter((entry) => !state.checked.has(entry));
  state.checked.clear();
  draw(state);
  notice(LISTS[state.key].forgot(gone));
}

/** The app's toast at the bottom, for seven seconds. */
function notice(text) {
  $('message').textContent = text;
  clearTimeout(notice.timer);
  notice.timer = setTimeout(() => ($('message').textContent = ''), 7000);
}

// --- The page ------------------------------------------------------------------------------------------------

if (!desktop) {
  document.body.classList.add('android');
  const sheet = document.createElement('link');
  sheet.rel = 'stylesheet';
  sheet.href = '../../../android/app/src/main/home/home.css';
  document.querySelector('link[href="lists.css"]').before(sheet);
}
const rows = {};
for (const key of desktop
  ? ['saved', 'credentials', 'trusted']
  : ['allowed', 'saved', 'credentials', 'trusted'])
  $('settings').append((rows[key] = listRow(key)).row);
PixelIcons.render();

/**
 * Switches the colors ({theme: 'day' | 'night'}, as the app's sun and moon do), or puts a list in a state ({list,
 * state}): closed and open start again from the sample computers; some and all check two or every one; confirm also
 * presses Forget once; after forgets two; empty forgets them all.
 */
function show(data) {
  if (data?.theme === 'day') document.documentElement.dataset.theme = 'light';
  if (data?.theme === 'night') delete document.documentElement.dataset.theme;
  const state = rows[data?.list];
  if (!state) return;
  state.entries = data.state === 'empty' ? [] : newestFirst(ENTRIES[state.key]);
  state.checked = new Set(
    data.state === 'all'
      ? state.entries
      : ['some', 'confirm', 'after'].includes(data.state)
        ? state.entries.slice(1, 3)
        : [],
  );
  draw(state);
  open(state, data.state !== 'closed' && data.state !== 'empty');
  if (data.state === 'confirm') forget(state);
  if (data.state === 'after') {
    forget(state);
    forget(state);
  }
}
addEventListener('message', ({ data }) => show(data));
// The same from the address, as ?app=android&theme=day&list=allowed,saved&state=some, for pictures of each state.
const query = Object.fromEntries(new URLSearchParams(location.search));
show({ theme: query.theme });
for (const list of (query.list || '').split(',')) show({ list, state: query.state });
