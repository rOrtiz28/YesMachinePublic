'use strict';
// Connecting to another computer, or to an Android device in general mode, when its card is double-clicked.
//
// 1. Its certificate is checked. The first time, the user compares its fingerprint with the one the other device
//    shows, and approves it (confirmTrust); after that a changed certificate asks again.
// 2. For a computer, the user signs in with an account of that computer: with a password remembered in this
//    computer's keychain, or through the sign-in dialog (askCredentials).
// 3. The session opens in its own viewer window, which the main process manages (src/main/viewing/viewer.cjs for a
//    computer, src/main/android/windows.cjs for an Android device). When that window loses its connection it closes
//    itself, and the main window explains what happened (showEnded).

// Whether this computer has a keychain to remember passwords in (renderCredentials in settings.js finds out).
let credentialsAvailable = false;
// The timer that closes the "Disconnected" dialog.
let endedTimer = 0;

// --- Connecting -----------------------------------------------------------------------------------------------

/**
 * Connects to a computer: brings its viewer window to the front if one is already open; otherwise checks its
 * certificate (asking the user the first time) and signs in with that computer's account, with the remembered
 * password or through the sign-in dialog.
 */
async function connectTo(item) {
  const target = targetOf(item);
  try {
    if (await api.focusViewer(target)) return;
    const check = await api.inspect(target);
    if (!check.online) {
      notice(
        `${item.name} isn’t sharing right now. Start sharing on that computer and try again.`,
        true,
      );
      return;
    }
    if (!check.trusted) {
      if (!(await confirmTrust(item, check))) return;
      // A saved computer keeps the fingerprint just approved, so a later change shows on its card.
      saved = saved.map((entry) =>
        keyOf(entry) === keyOf(item) ? { ...entry, fingerprint: check.fingerprint } : entry,
      );
      write('ym.saved', saved);
      renderDevices();
      renderTrusted();
    }
    const quick = check.remembered
      ? await api.signInSaved(target, item.name)
      : { needsCredentials: true };
    if (quick.needsCredentials) await askCredentials(item, quick);
    renderCredentials();
  } catch (error) {
    notice(reason(error), true);
  }
}

/**
 * Connects to an Android device in general mode: checks its certificate, asking the user the first time as for a
 * computer, then opens its window, which waits for the person at the device to allow this computer.
 */
async function connectDevice(item) {
  try {
    if (!item.connected) {
      const check = await api.inspectAndroid(item.share);
      if (!check.trusted) {
        if (!(await confirmTrust(item, check, () => api.trustAndroid(item.share)))) return;
        renderTrusted();
      }
    }
    await api.openAndroid(item.share, 'network');
  } catch (error) {
    notice(reason(error), true);
  }
}

// --- Verifying a certificate ----------------------------------------------------------------------------------

/**
 * The dialog shown before the first connection to a computer, or to an Android device in general mode, and whenever
 * its certificate changed: it shows the certificate's fingerprint, to compare with the one the other device shows
 * itself. Connect stays disabled until the user ticks that they match. Resolves to true once the user approved and
 * `approve` (which trusts the certificate in the main process) succeeded.
 */
function confirmTrust(item, check, approve = () => api.trust(targetOf(item))) {
  const dialog = $('trust-dialog'),
    kind = item.share ? 'device' : 'computer';
  $('trust-title').textContent = check.changed
    ? `${item.name} has a new certificate`
    : `Verify ${item.name}`;
  $('trust-text').textContent =
    `${check.changed ? `This ${kind} now shows a different certificate. ` : 'Before the first connection, '}compare this fingerprint with the one in Yes Machine on that ${kind}, under “Verify this ${kind}’s certificate”.`;
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
          await approve();
        } catch (error) {
          notice(reason(error), true);
          ok = false;
        }
      resolve(ok);
    };
    $('trust-confirm').onclick = () => finish(true);
    $('trust-cancel').onclick = () => finish(false);
    dialog.onclose = () => finish(false);
  });
}

// --- Signing in -----------------------------------------------------------------------------------------------

/**
 * The sign-in dialog, for an account of the other computer. The user name last used for that computer is filled in
 * (ym.users). "Remember" keeps the password in this computer's keychain, and is disabled when there is none.
 * Resolves to true once signed in, false when the user cancels. `user` and `error` come from a remembered password
 * that didn't work.
 */
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
    let busy = false;
    const finish = (ok) => {
      form.onsubmit = $('login-cancel').onclick = dialog.onclose = null;
      if (dialog.open) dialog.close();
      resolve(ok);
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (busy) return;
      const name = $('login-user').value.trim(),
        password = $('login-password').value;
      if (!name || !password) {
        showLoginError('Enter the user name and password of that computer.');
        return;
      }
      busy = true;
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
      } catch (signInError) {
        showLoginError(reason(signInError));
        $('login-password').select();
      } finally {
        busy = false;
        $('login-submit').disabled = false;
        $('login-submit').textContent = 'Connect';
      }
    };
    $('login-cancel').onclick = () => finish(false);
    dialog.onclose = () => finish(false);
  });
}

function showLoginError(text) {
  $('login-error').textContent = text;
  $('login-error').hidden = !text;
}

/** The eye beside a password shows what was typed. The password is hidden again whenever the dialog opens. */
function revealPassword(button, show) {
  $(button.dataset.reveal).type = show ? 'text' : 'password';
  button.setAttribute('aria-pressed', String(show));
  button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  button.querySelector('.icon').dataset.icon = show ? 'eye-closed' : 'eye';
  PixelIcons.render(button);
}

// --- When a session ends --------------------------------------------------------------------------------------

/**
 * A viewer window that loses its connection closes itself, and this explains why on the main window: a short message
 * when the user disconnected, otherwise a dialog, which closes itself after 7 seconds.
 */
function showEnded({ name, reason: cause, android, general }) {
  probeAll();
  if (cause === 'closed') {
    notice(`Disconnected from ${name}.`);
    return;
  }
  const dialog = $('ended-dialog');
  $('ended-title').textContent = `Disconnected from ${name}`;
  $('ended-detail').textContent =
    cause === 'replaced'
      ? `Another device connected to ${name}, so this session ended.`
      : cause === 'general-mode'
        ? 'It switched to general mode in Yes Machine. Start sharing on it, then double-click it here to connect again.'
        : general
          ? 'The connection ended. Check that Yes Machine is still sharing on it, then double-click it to connect again.'
          : android
            ? 'The connection ended. Check its USB cable or Wi-Fi debugging, then double-click it to connect again.'
            : 'The connection ended. Check that Yes Machine is still open on that computer, then double-click it to connect again.';
  if (!dialog.open) dialog.showModal();
  clearTimeout(endedTimer);
  endedTimer = setTimeout(() => {
    if (dialog.open) dialog.close();
  }, 7000);
}

/** Connects the dialogs' buttons. Called once by start.js. */
function setUpConnecting() {
  document.querySelectorAll('.reveal').forEach((button) =>
    button.addEventListener('click', () => {
      revealPassword(button, button.getAttribute('aria-pressed') !== 'true');
      $(button.dataset.reveal).focus();
    }),
  );
  $('trust-check').onchange = () => {
    $('trust-confirm').disabled = !$('trust-check').checked;
  };
  $('ended-ok').onclick = () => $('ended-dialog').close();
}
