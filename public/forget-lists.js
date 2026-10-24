'use strict';
// Settings' lists of what can be forgotten: saved computers, remembered sign-ins and trusted
// certificates, and in the Android app the computers that are always allowed. The desktop app's
// main window (src/windows/host/settings.js) and the Android app's home screen (home/settings.js
// and home/general-mode.js) both use it.
//
// Each list lives in a Settings row (.list-setting) whose top (.list-head) holds its title and a
// summary (.list-summary). ForgetLists.create(row, options) adds Show list and the list below,
// which a click or tap anywhere on the row's top opens and closes. The list has a row per entry
// with a checkbox, its name, and a line with its account, system, address and date; above them,
// Select all, how many are checked, and Forget, which asks for a second click or tap before it
// forgets what is checked and says so. The page passes the entries with show(), again whenever
// they change. The four kinds of list, and their words, are in KINDS.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ForgetLists = api;
})(typeof self !== 'undefined' ? self : this, () => {
  const DATE = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  // A checkbox: the real input, invisible on top of a square that shows the pixel check.
  const CHECK =
    '<span class="pixel-check"><input type="checkbox" /><span data-icon="check"></span></span>';

  // --- Text ---

  /** The entries, newest first. Those without a date (kept before dates were) come last. */
  function newestFirst(entries) {
    return [...entries].sort((a, b) => (b.since || 0) - (a.since || 0));
  }

  /**
   * The line under an entry's name: "as" its account, its system, and its address when its name
   * is shown instead of the address, then `since` and the date, or "Date not recorded". Returns
   * { text, date }, where date is the last part.
   */
  function detailOf(entry, since) {
    const parts = [
      entry.account && `as ${entry.account}`,
      entry.system,
      entry.name && entry.address,
    ].filter(Boolean);
    const date = entry.since
      ? `${since} ${DATE.format(new Date(entry.since))}`
      : 'Date not recorded';
    return { text: parts.join(' · '), date };
  }

  /** What Forget says with `picked` of `total` checked. */
  function forgetLabel(picked, total) {
    return !picked ? 'Forget' : picked === total ? 'Forget all' : `Forget ${picked}`;
  }

  const plural = (n, one, many) => (n === 1 ? one : many);
  // The name an entry goes by in a notice.
  const nameOf = (entry) => entry.name || entry.address;

  // Each kind of list: the row's summary for n entries, the words before an entry's date, and the
  // notice once some are forgotten, which names the one or counts them.
  const KINDS = {
    saved: {
      summary: (n) =>
        n ? `${n} saved ${plural(n, 'computer', 'computers')}.` : 'No saved computers yet.',
      since: 'Saved',
      forgot: (gone) =>
        gone.length === 1 ? `Forgot ${nameOf(gone[0])}.` : `Forgot ${gone.length} saved computers.`,
    },
    credentials: {
      summary: (n) =>
        n ? `${n} remembered ${plural(n, 'sign-in', 'sign-ins')}.` : 'No remembered sign-ins yet.',
      since: 'Remembered since',
      forgot: (gone) =>
        gone.length === 1
          ? `Forgot the sign-in for ${nameOf(gone[0])}. It asks for the password again.`
          : `Forgot ${gone.length} remembered sign-ins. They ask for the password again.`,
    },
    trusted: {
      summary: (n) =>
        n
          ? `${n} trusted ${plural(n, 'computer', 'computers')}. ` +
            'A changed certificate always asks again.'
          : 'No trusted computers yet.',
      since: 'Trusted',
      forgot: (gone) =>
        gone.length === 1
          ? `Forgot ${nameOf(gone[0])}’s certificate. It asks to be verified again.`
          : `Forgot ${gone.length} trusted certificates. Those computers ask to be verified again.`,
    },
    allowed: {
      summary: (n) =>
        n
          ? `${n} always allowed ${plural(n, 'computer', 'computers')}. ` +
            'Any other computer asks first.'
          : 'No computers are always allowed yet.',
      since: 'Allowed since',
      forgot: (gone) =>
        gone.length === 1
          ? `Forgot ${nameOf(gone[0])}. It asks before taking control again.`
          : `Forgot ${gone.length} computers. They ask before taking control again.`,
    },
  };

  // --- Sharp icons ---

  /**
   * Sizes the lists' 12×12 icons, the checks and Show list's arrow, as near as it can to the size
   * the page's style sheet asks for in --list-icon-wanted (12px unless it says otherwise), while
   * each of their pixels covers a whole number of the screen's: drawn at 12px on a 1.5× screen,
   * such as many Android tablets', some pixels would be wider than others. It sets --list-icon on
   * the page, and again whenever the screen's scale changes.
   */
  function fitIcons() {
    const ratio = window.devicePixelRatio || 1,
      style = getComputedStyle(document.documentElement),
      wanted = parseFloat(style.getPropertyValue('--list-icon-wanted')) || 12;
    const size = (12 * Math.max(1, Math.round((wanted * ratio) / 12))) / ratio;
    document.documentElement.style.setProperty('--list-icon', `${size}px`);
    matchMedia(`(resolution: ${ratio}dppx)`).addEventListener('change', fitIcons, { once: true });
  }
  if (typeof window !== 'undefined' && typeof matchMedia === 'function') fitIcons();

  // --- A list ---

  /**
   * Adds Show list and the list to a Settings row. Options:
   * - kind: 'saved', 'credentials', 'trusted' or 'allowed' (KINDS).
   * - summary(n): the row's summary for n entries, in place of the kind's.
   * - press: 'Click' or 'Tap', for "Click again to forget".
   * - forget(entries): forgets those entries for good, and may return a promise. The page then
   *   passes the remaining ones to show(). A failure leaves the list as it was, and the page says
   *   why.
   * - notice(text): the page's notice, for what was forgotten.
   *
   * Returns { show(entries) }. Each entry is { id, name, address, system, account, since }: id
   * tells it apart in the list, name or else address heads it, and since is the time it was kept,
   * in milliseconds, or 0 when it isn't known.
   */
  function create(row, { kind, summary = KINDS[kind].summary, press = 'Click', forget, notice }) {
    const { since } = KINDS[kind];
    const head = row.querySelector('.list-head');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'list-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML =
      '<span class="label">Show list</span><span class="icon" data-icon="chevron-down"></span>';
    head.append(toggle);
    const body = document.createElement('div');
    body.className = 'list-body';
    body.inert = true;
    body.innerHTML = `
      <div class="forget-list">
        <div class="list-bar">
          <label class="select-all">${CHECK}Select all</label>
          <span class="list-count"></span>
          <button type="button" class="ghost list-forget" disabled>Forget</button>
        </div>
        <ul></ul>
      </div>`;
    row.append(body);
    const all = body.querySelector('.select-all input'),
      count = body.querySelector('.list-count'),
      button = body.querySelector('.list-forget'),
      list = body.querySelector('ul');

    // The entries shown, the ids of the checked ones, what show() was last given, and the timer
    // while Forget asks again.
    let entries = [],
      checked = new Set(),
      signature = '',
      asking = 0;

    /** Opens or closes the list. Opening grows the row in steps, and the entries pop in as it ends. */
    function open(opened) {
      if (opened && !entries.length) return;
      row.classList.toggle('open', opened);
      toggle.setAttribute('aria-expanded', String(opened));
      toggle.querySelector('.label').textContent = opened ? 'Hide list' : 'Show list';
      body.inert = !opened;
      if (opened)
        list.querySelectorAll('li').forEach((item) => {
          item.classList.remove('appear');
          void item.offsetWidth; // so that the animation starts again
          item.classList.add('appear');
        });
    }

    /** One entry's row: its checkbox, its name, and its line of details. */
    function entryItem(entry) {
      const item = document.createElement('li');
      item.innerHTML =
        `<label class="entry">${CHECK}<span class="entry-text">` +
        '<span class="entry-name"></span><span class="entry-detail"></span></span></label>';
      item.querySelector('.entry-name').textContent = entry.name || entry.address;
      const detail = detailOf(entry, since),
        line = item.querySelector('.entry-detail'),
        date = document.createElement('span');
      date.textContent = detail.date;
      if (!entry.since) date.className = 'undated';
      line.append(detail.text, detail.text ? ' · ' : '', date);
      const box = item.querySelector('input');
      box.checked = checked.has(entry.id);
      item.querySelector('.entry').classList.toggle('selected', box.checked);
      box.onchange = () => {
        if (box.checked) checked.add(entry.id);
        else checked.delete(entry.id);
        draw();
      };
      return item;
    }

    /** Redraws the summary, the entries, Select all, the count and Forget, which stops asking. */
    function draw() {
      const total = entries.length,
        picked = checked.size;
      head.querySelector('.list-summary').textContent = summary(total);
      row.classList.toggle('empty', !total);
      list.replaceChildren(...entries.map(entryItem));
      all.checked = total > 0 && picked === total;
      all.indeterminate = picked > 0 && picked < total;
      all.nextElementSibling.dataset.icon = all.indeterminate ? 'dash' : 'check';
      count.textContent = picked ? `${picked} of ${total} selected` : '';
      clearTimeout(asking);
      asking = 0;
      button.classList.remove('confirm');
      button.disabled = !picked;
      button.textContent = forgetLabel(picked, total);
      if (typeof PixelIcons !== 'undefined') PixelIcons.render(row);
      if (!total) open(false);
    }

    /** Forget: the first press asks again for four seconds, the second forgets what is checked. */
    async function forgetChecked() {
      const picked = checked.size;
      if (!asking) {
        const how = picked === entries.length ? 'all' : picked;
        button.textContent = `${press} again to forget ${how}`;
        button.classList.add('confirm');
        asking = setTimeout(draw, 4000);
        return;
      }
      clearTimeout(asking);
      asking = 0;
      const gone = entries.filter((entry) => checked.has(entry.id));
      button.disabled = true;
      try {
        await forget(gone);
        for (const entry of gone) checked.delete(entry.id);
        notice(KINDS[kind].forgot(gone));
      } finally {
        draw();
      }
    }

    // The whole top of the row opens and closes the list; Show list is the same for the keyboard.
    head.onclick = () => open(!row.classList.contains('open'));
    all.onchange = () => {
      checked = new Set(all.checked ? entries.map((entry) => entry.id) : []);
      draw();
    };
    button.onclick = () => forgetChecked().catch(() => {});

    /** Shows these entries. Checked ones still there stay checked; an open list stays open. */
    function show(next) {
      const nextSignature = JSON.stringify(next);
      if (nextSignature === signature) return;
      signature = nextSignature;
      entries = newestFirst(next);
      const ids = new Set(entries.map((entry) => entry.id));
      checked = new Set([...checked].filter((id) => ids.has(id)));
      draw();
    }

    draw();
    return { show };
  }

  return { create, KINDS, newestFirst, detailOf, forgetLabel };
});
