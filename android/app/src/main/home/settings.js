'use strict';
// The Settings page's lists of saved computers, remembered sign-ins and trusted certificates, where the person forgets
// one, several or all (public/forget-lists.js), and the setup guides (public/setup-guides.js). The mode and the list
// of computers that are always allowed are in general-mode.js.

// The three lists, which setUpSettings makes.
let savedList = null,
  credentialsList = null,
  trustedList = null;
// The trusted certificates and remembered sign-ins as Java last gave them, by "address:port".
let trustedKept = [],
  credentialsKept = [];

// A saved entry's id in its list: its address and port, and whether it was added by hand, as sameEntry tells them
// apart.
const savedId = (entry) => `${keyOf(entry)} ${manualEntry(entry) ? 'added' : 'found'}`;

/** The name of the computer at "address:port", from the saved and discovered ones, or '' when it isn't known. */
function nameAt(key) {
  const same = (entry) => keyOf(entry) === key;
  return saved.find(same)?.name || discovered.find(same)?.name || '';
}

/**
 * The trusted certificates and remembered sign-ins, as last read. One kept without a name takes the name of the
 * computer at that address, which is shown again as the saved and discovered computers change.
 */
function showKept() {
  trustedList?.show(
    trustedKept.map(({ key, name, system, since }) => ({
      id: key,
      name: name || nameAt(key),
      address: key,
      system,
      since,
    })),
  );
  credentialsList?.show(
    credentialsKept.map(({ key, user, name, since }) => ({
      id: key,
      name: name || nameAt(key),
      address: key,
      account: user,
      since,
    })),
  );
}

/** The saved computers' list, and the names in the other two. devices.js calls it whenever the computers change. */
function renderSavedList() {
  savedList?.show(
    saved.map((entry) => ({
      id: savedId(entry),
      name: entry.name,
      address: keyOf(entry),
      system: PLATFORMS[entry.platform] || '',
      since: entry.since || 0,
    })),
  );
  showKept();
}

/** The trusted certificates' list, as Java keeps it. */
async function renderTrusted() {
  try {
    trustedKept = (await api.trustedList()).list;
    showKept();
  } catch {}
}

/**
 * The remembered sign-ins' list, encrypted with a key kept in this device's secure storage. Also finds out whether
 * the device can keep passwords safely at all; without that, they are never remembered.
 */
async function renderCredentials() {
  try {
    const { available, list } = await api.credentialsInfo();
    credentialsAvailable = available;
    credentialsKept = list;
    showKept();
  } catch {}
}

/** Forgets entries through Java with `call`, then shows what is left; says why when it fails. */
async function forgetThrough(call, render, gone) {
  try {
    await call(gone.map((entry) => entry.id));
  } catch (error) {
    notice(error.message, true);
    throw error;
  } finally {
    await render();
  }
}

/** Connects the guides and makes the three lists, which start.js fills. Called once by start.js. */
function setUpSettings() {
  for (const button of document.querySelectorAll('[data-guide]'))
    button.onclick = () => SetupGuides.open(button.dataset.guide);
  savedList = ForgetLists.create($('saved-setting'), {
    kind: 'saved',
    press: 'Tap',
    notice,
    forget: (gone) => {
      const ids = new Set(gone.map((entry) => entry.id));
      saved = saved.filter((entry) => !ids.has(savedId(entry)));
      write('ym.saved', saved);
      renderDevices();
    },
  });
  credentialsList = ForgetLists.create($('credentials-setting'), {
    kind: 'credentials',
    press: 'Tap',
    summary: (n) =>
      !credentialsAvailable
        ? 'This device can’t store passwords securely, so they are never remembered.'
        : n
          ? `${n} remembered ${n === 1 ? 'sign-in' : 'sign-ins'}, ` +
            'encrypted with a key kept in this device’s secure storage.'
          : 'No remembered sign-ins yet.',
    notice,
    forget: (gone) => forgetThrough(api.forgetCredentials, renderCredentials, gone),
  });
  trustedList = ForgetLists.create($('trusted-setting'), {
    kind: 'trusted',
    press: 'Tap',
    notice,
    forget: (gone) => forgetThrough(api.forgetTrusted, renderTrusted, gone),
  });
}
