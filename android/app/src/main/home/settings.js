'use strict';
// The Settings page's lists: trusted certificates and remembered sign-ins, each with a Forget all button that asks
// for a second tap. Also the setup guides (public/setup-guides.js). The saved computers are in devices.js, and the
// mode and the always allowed computers in general-mode.js.

/** How many computers' certificates are trusted. */
async function renderTrusted() {
  try {
    const { count } = await api.trustedCount();
    $('trusted-summary').textContent = count
      ? `${count} trusted ${count === 1 ? 'computer' : 'computers'}. A changed certificate always asks again.`
      : 'No trusted computers yet.';
    $('forget-trusted').disabled = !count;
  } catch {}
}

/**
 * How many sign-ins are remembered, encrypted with a key kept in this device's secure storage. Also finds out
 * whether the device can keep passwords safely at all; without that, they are never remembered.
 */
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

/** Connects the guides and the Forget all buttons. Called once by start.js. */
function setUpSettings() {
  for (const button of document.querySelectorAll('[data-guide]'))
    button.onclick = () => SetupGuides.open(button.dataset.guide);
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
}
