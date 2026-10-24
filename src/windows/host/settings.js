'use strict';
// The Settings page: the permissions this computer needs to be shared and controlled, automatic sharing, the order
// of the Android windows' buttons, starting at login, the setup guides, and the lists of saved computers, remembered
// sign-ins and trusted certificates, where the user forgets one, several or all (public/forget-lists.js).
//
// Other parts of Settings live with what they change: the sound in sharing.js, the clipboard in clipboard.js.

// Android windows read this setting from the same storage (ym.recentsFirst) and follow a change at once.
let recentsFirst = read('ym.recentsFirst', false) === true;

// --- Permissions ----------------------------------------------------------------------------------------------

/**
 * Lists what this computer still needs to allow, each line with a button that opens the system's setting when
 * there is one, and a "?" that opens the step-by-step guide for this system. Below the list, a summary of what is
 * allowed. In a Wayland session, the desktop asks in its own dialog whether to allow remote control when sharing
 * starts.
 */
function renderPermissions(permissions) {
  const box = $('permissions');
  box.replaceChildren();
  const line = (text, label, action) => {
    const div = document.createElement('div');
    div.textContent = text;
    if (label) {
      const button = document.createElement('button');
      button.textContent = label;
      button.onclick = action;
      div.append(button);
    }
    const help = document.createElement('button');
    help.className = 'help';
    help.textContent = '?';
    help.title = 'How to set this up';
    help.setAttribute('aria-label', 'How to set this up');
    help.onclick = () => SetupGuides.open(info?.platform || api.platform);
    div.append(help);
    box.append(div);
  };
  if (permissions.screen !== 'granted' && permissions.screen !== 'system-managed')
    line('macOS needs Screen & System Audio Recording access.', 'Open settings', () =>
      api.screenSettings(),
    );
  if (!permissions.input)
    line('Allow Accessibility to use the remote keyboard and mouse.', 'Allow control', async () => {
      await api.accessibility();
      info = await api.info();
      renderPermissions(info.permissions);
    });
  if (!permissions.native && !permissions.wayland)
    line('Native input could not load. Screen viewing remains available.');
  if (permissions.wayland && permissions.remote === 'asking')
    line('Allow remote control in the dialog on this computer.');
  if (permissions.wayland && permissions.remote === 'denied')
    line('Remote control wasn’t allowed. Stop and start sharing to be asked again.');
  if (permissions.wayland && permissions.remote === 'unavailable')
    line(
      'This desktop doesn’t offer remote control to apps, so other devices can only watch. An Xorg session allows control.',
    );
  const parts = [];
  if (info?.platform === 'darwin')
    parts.push(
      `Screen recording ${permissions.screen === 'granted' ? 'allowed' : 'not allowed yet'}`,
    );
  parts.push(
    permissions.wayland
      ? {
          allowed: 'Remote control allowed',
          asking: 'Remote control waiting for approval',
          denied: 'Remote control not allowed',
          unavailable: 'Remote control unavailable on this desktop',
        }[permissions.remote] || 'Remote control is asked for when sharing starts'
      : !permissions.native
        ? 'Remote control unavailable on this computer'
        : permissions.input
          ? 'Remote control allowed'
          : 'Remote control not allowed yet',
  );
  $('permission-summary').textContent = `${parts.join(' · ')}.`;
}

// --- Saved computers, remembered sign-ins and trusted certificates ------------------------------------------

// The three lists (public/forget-lists.js), which setUpSettings makes.
let savedList = null,
  credentialsList = null,
  trustedList = null;
// The trusted certificates and remembered sign-ins as the main process last gave them, by "address:port".
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

/** The trusted certificates' list, as the main process keeps it (src/main/network/trust.cjs). */
async function renderTrusted() {
  try {
    trustedKept = await api.trustedList();
    showKept();
  } catch {}
}

/**
 * The remembered sign-ins' list, encrypted with this computer's keychain (src/main/viewing/credentials.cjs). Also
 * finds out whether there is a keychain at all; without one, passwords are never remembered.
 */
async function renderCredentials() {
  try {
    const { available, list } = await api.credentialsInfo();
    credentialsAvailable = available;
    credentialsKept = list;
    showKept();
  } catch {}
}

/** Forgets entries through the main process with `call`, then shows what is left; says why when it fails. */
async function forgetThrough(call, render, gone) {
  try {
    await call(gone.map((entry) => entry.id));
  } catch (error) {
    notice(reason(error), true);
    throw error;
  } finally {
    await render();
  }
}

/** Makes the three lists. start.js fills them as the page starts. */
function setUpLists() {
  savedList = ForgetLists.create($('saved-setting'), {
    kind: 'saved',
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
    summary: (n) =>
      !credentialsAvailable
        ? 'This computer has no secure keychain, so passwords are never remembered.'
        : n
          ? `${n} remembered ${n === 1 ? 'sign-in' : 'sign-ins'}, ` +
            'encrypted with this computer’s keychain.'
          : 'No remembered sign-ins yet.',
    notice,
    forget: (gone) => forgetThrough(api.forgetCredentials, renderCredentials, gone),
  });
  trustedList = ForgetLists.create($('trusted-setting'), {
    kind: 'trusted',
    notice,
    forget: (gone) => forgetThrough(api.forgetTrusted, renderTrusted, gone),
  });
}

// --- Switches -------------------------------------------------------------------------------------------------

/**
 * Automatic sharing. The main process calls window.autoShare() (start.js) once the page loads, and sharing starts on
 * its own unless this is off.
 */
function renderAutoShare() {
  $('setting-autoshare').setAttribute('aria-checked', String(autoShareWanted));
}

/** Whether the Android windows' navigation buttons go Recents, Home, Back instead of Back, Home, Recents. */
const renderRecentsFirst = () =>
  $('setting-recents-first').setAttribute('aria-checked', String(recentsFirst));

/**
 * Starting at login. The system's own login items are what this reads and changes (src/main/system/login-item.cjs).
 * An installed copy turns it on the first time it runs; after that it stays as the user leaves it.
 */
const renderLogin = (on) => $('setting-login').setAttribute('aria-checked', String(on === true));

/** Connects the page's switches and buttons. Called once by start.js. */
function setUpSettings() {
  $('setting-autoshare').onclick = () => {
    autoShareWanted = !autoShareWanted;
    write('ym.autoShare', autoShareWanted);
    renderAutoShare();
    renderShareControls();
  };
  $('setting-recents-first').onclick = () => {
    recentsFirst = !recentsFirst;
    write('ym.recentsFirst', recentsFirst);
    renderRecentsFirst();
  };
  $('setting-login').onclick = async () => {
    try {
      const on = await api.setLoginItem($('setting-login').getAttribute('aria-checked') !== 'true');
      renderLogin(on);
      notice(
        on
          ? 'Yes Machine will start in the background when you log in.'
          : 'Yes Machine won’t start when you log in.',
      );
    } catch (error) {
      notice(reason(error), true);
    }
  };
  // The setup guides (public/setup-guides.js), one for each system. A guide opened while sharing shows the address
  // to connect to.
  for (const button of document.querySelectorAll('[data-guide]'))
    button.onclick = () =>
      SetupGuides.open(button.dataset.guide, { address: media ? $('address').textContent : '' });
  setUpLists();
  // Permissions may have changed in the system's settings while the window was in the background.
  window.addEventListener('focus', async () => {
    info = await api.info();
    renderPermissions(info.permissions);
  });
}
