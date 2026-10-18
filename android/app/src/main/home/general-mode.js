'use strict';
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

/** A bold piece of text, for names inside a sentence. */
function bold(text) {
  const node = element('b');
  node.textContent = text;
  return node;
}

/**
 * Shows general mode's state, as Java pushes it: the house, the This device card on Home, the mode and its
 * instructions in Settings, and the question for a computer that asks to connect.
 */
function renderControl(state) {
  if (!state) return;
  control = state;
  const mode = state.mode === 'advanced' ? 'advanced' : 'general',
    general = mode === 'general';
  const sharing = general && state.sharing !== 'off',
    connected = general && state.sharing === 'connected';
  // The house: by day the garage and the gates open while this device shares, and she wags her tail while a computer
  // controls it, in general mode or in advanced mode, where Java hears of the computer from advanced mode's server.
  const advanced = !general && !!state.advancedConnected;
  house?.setState({ sharing: sharing || advanced, connected: connected || advanced });
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

/** The answer to the computer asking, from the dialog: allow it (and always, when the box is ticked) or not. */
function answerComputer(allow) {
  const id = openRequest;
  openRequest = '';
  if ($('allow-dialog').open) $('allow-dialog').close();
  if (id)
    api.answer(id, allow, allow && $('allow-always').checked).catch((e) => notice(e.message, true));
}

/** Switches between general and advanced mode. */
async function chooseMode(mode) {
  try {
    renderControl(await api.setMode(mode));
  } catch (e) {
    notice(e.message, true);
  }
}

/** Connects the mode switch, the This device card's buttons and the question's dialog. Called once by start.js. */
function setUpGeneralMode() {
  api.onControl(renderControl);
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
}
