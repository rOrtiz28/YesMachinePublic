'use strict';
// The welcome screen's sign-in form: the user name and password of an account on the computer. The page posts them
// to the computer's /login, which answers with a one-time ticket for the session socket, and the session starts
// with it (session.js). The password isn't kept: it goes once, and the field is emptied when a session ends.

// Whether a sign-in is under way, so a second press of Connect does nothing.
let signingIn = false;

/** The eye beside the password shows what was typed. The password is hidden again when a session ends. */
function revealPassword(show) {
  const button = $('sign-in-reveal');
  $('sign-in-password').type = show ? 'text' : 'password';
  button.setAttribute('aria-pressed', String(show));
  button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  button.querySelector('.icon').dataset.icon = show ? 'eye-closed' : 'eye';
  PixelIcons.render(button);
}

/** Connects the password's eye and the form. Called once by start.js. */
function setUpSignIn() {
  $('sign-in-reveal').addEventListener('click', () => {
    revealPassword($('sign-in-reveal').getAttribute('aria-pressed') !== 'true');
    $('sign-in-password').focus();
  });
  // Signs in with the computer's own account. The computer answers with a one-time ticket for the session socket.
  $('pair-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (signingIn) return;
    const user = $('sign-in-user').value.trim();
    const password = $('sign-in-password').value;
    if (!user || !password) {
      showNotice('Enter the user name and password you use on that computer.', true);
      $(user ? 'sign-in-password' : 'sign-in-user').focus();
      return;
    }
    if (!canConnect()) return;
    signingIn = true;
    $('connect-button').disabled = true;
    $('connect-label').textContent = 'Signing in…';
    $('notice').hidden = true;
    try {
      let response;
      try {
        response = await fetch('/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user, password }),
          cache: 'no-store',
          credentials: 'omit',
        });
      } catch {
        throw new Error(
          'Could not reach the computer. Check that Yes Machine is sharing on it, then try again.',
        );
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !/^[0-9a-f]{64}$/.test(data.ticket || ''))
        throw new Error(data.error || 'Sign-in failed. Try again.');
      openSession({ type: 'ticket', ticket: data.ticket });
    } catch (error) {
      $('connect-button').disabled = false;
      $('connect-label').textContent = 'Connect';
      showNotice(error.message, true, true);
      $('sign-in-password').select();
    } finally {
      signingIn = false;
    }
  });
}
