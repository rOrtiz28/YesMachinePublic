'use strict';
// The Settings page: the permissions this computer needs to be shared and controlled, automatic sharing, the order
// of the Android windows' buttons, starting at login, the setup guides, and the saved computers, trusted
// certificates and remembered sign-ins, each with a "Forget all" button that asks for a second click.
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

// --- Trusted certificates and remembered sign-ins -------------------------------------------------------------

/** How many computers' certificates are trusted (src/main/network/trust.cjs). */
async function renderTrusted() {
  try {
    const count = await api.trustedCount();
    $('trusted-summary').textContent = count
      ? `${count} trusted ${count === 1 ? 'computer' : 'computers'}. A changed certificate always asks again.`
      : 'No trusted computers yet.';
    $('forget-trusted').disabled = !count;
  } catch {}
}

/**
 * How many sign-ins are remembered, encrypted with this computer's keychain (src/main/viewing/credentials.cjs).
 * Also finds out whether there is a keychain at all; without one, passwords are never remembered.
 */
async function renderCredentials() {
  try {
    const { available, count } = await api.credentialsInfo();
    credentialsAvailable = available;
    $('credentials-summary').textContent = !available
      ? 'This computer has no secure keychain, so passwords are never remembered.'
      : count
        ? `${count} remembered ${count === 1 ? 'sign-in' : 'sign-ins'}, encrypted with this computer’s keychain.`
        : 'No remembered sign-ins yet.';
    $('forget-credentials').disabled = !count;
  } catch {}
}

/** Makes a destructive button ask for a second click within four seconds before it runs `action`. */
function twoStep(button, action) {
  let timer = 0;
  const originalText = button.textContent;
  button.onclick = () => {
    if (!timer) {
      button.textContent = 'Click again to forget';
      timer = setTimeout(() => {
        timer = 0;
        button.textContent = originalText;
      }, 4000);
      return;
    }
    clearTimeout(timer);
    timer = 0;
    button.textContent = originalText;
    action();
  };
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
  // Permissions may have changed in the system's settings while the window was in the background.
  window.addEventListener('focus', async () => {
    info = await api.info();
    renderPermissions(info.permissions);
  });
}
