'use strict';
// Connecting to a computer when its card is tapped.
//
// 1. Its certificate is checked. The first time, the person compares its fingerprint with the one the computer
//    shows, and approves it (confirmTrust); after that a changed certificate asks again.
// 2. The person signs in with an account of that computer: with a password remembered on this device, or through
//    the sign-in dialog (askCredentials).
// 3. Java gets a one-time ticket from the computer and opens the viewer with it. When the viewer's session ends,
//    the home screen explains what happened (showEnded).

// Whether a connection is under way, so a second tap does nothing; whether this device can keep passwords safely
// (renderCredentials in settings.js finds out); and the timer that closes the "Disconnected" dialog.
let busy = false;
let credentialsAvailable = false;
let endedTimer = 0;

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

/**
 * The dialog shown before the first connection to a computer, and whenever its certificate changed: it shows the
 * certificate's fingerprint, to compare with the one the computer shows itself. Resolves to true once the person
 * approved it and Java trusts it.
 */
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

/**
 * The sign-in dialog, for an account of the computer. The user name last used for it is filled in (ym.users).
 * Resolves to true once signed in, false when the person cancels.
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

/** The viewer's session ended: a short message when the person disconnected, otherwise a dialog for 7 seconds. */
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
