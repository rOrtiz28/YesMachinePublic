'use strict';
// Prototype only: stands in for the app's Java bridge (YesMachineHome), with three computers on the network and this
// device's state from the preview page. It tells the preview when the page changes its colors, as Java will color
// Android's bars then, and when a sign-in would open the viewer.
(() => {
  const params = new URLSearchParams(location.search);
  const state = {
    online: params.get('online') !== 'false',
    sharing: params.get('sharing') || 'off',
  };
  const computers = [
    {
      name: 'osiris-windows',
      address: '192.168.1.54',
      port: 4777,
      platform: 'win32',
      os: 'Windows 11',
    },
    {
      name: 'Alejandros-MacBook-Pro',
      address: '192.168.1.52',
      port: 4777,
      platform: 'darwin',
      os: 'macOS 27.0.1',
    },
    { name: 'osiris', address: '192.168.1.53', port: 4777, platform: 'linux', os: 'Ubuntu 24.04' },
  ];
  const control = () => ({
    mode: 'general',
    sharing: state.sharing,
    accessibility: true,
    name: 'Alejandro’s Tab A11+',
    system: 'Android 16',
    computer: 'Alejandros-MacBook-Pro',
    fingerprint: '4F:9A:1C:77:0B:E2:58:D1:36:A0:9C:44:7E:12:B5:C8',
    allowedComputers: 1,
  });
  const push = (kind, value) => window.__homeEvent?.({ kind, value });
  const pushAll = () => {
    push('discovery', { devices: state.online ? computers : [], error: '' });
    push('control', control());
  };
  const answers = {
    info: () => ({
      name: 'Alejandro’s Tab A11+',
      version: '0.1.0',
      network: { kind: 'wifi', address: '192.168.1.158', prefix: 24 },
    }),
    probe: ({ targets }) =>
      targets.map((target) => ({ ...target, online: state.online, fingerprint: 'AA' })),
    refresh: () => ({}),
    inspect: () => ({ online: true, trusted: true, remembered: false }),
    signIn: ({ name }) => {
      parent.postMessage({ viewer: name }, '*');
      return {};
    },
    trustedCount: () => ({ count: 2 }),
    credentialsInfo: () => ({ available: true, count: 1 }),
    control,
    setMode: () => control(),
    startSharing: () => {
      state.sharing = 'waiting';
      setTimeout(pushAll);
      return {};
    },
    stopSharing: () => {
      state.sharing = 'off';
      setTimeout(pushAll);
      return {};
    },
    disconnectComputer: () => {
      state.sharing = 'waiting';
      setTimeout(pushAll);
      return {};
    },
    setTheme: ({ mode }) => {
      parent.postMessage({ theme: mode }, '*');
      return {};
    },
  };
  window.YesMachineHome = {
    request(id, method, json) {
      const answer = answers[method];
      setTimeout(
        () =>
          window.__homeReply?.(
            id,
            !!answer,
            answer ? answer(JSON.parse(json || '{}')) : { error: 'Not in the prototype.' },
          ),
        20,
      );
    },
  };
  addEventListener('DOMContentLoaded', () => setTimeout(pushAll, 50));
  // The preview page's controls.
  addEventListener('message', ({ data }) => {
    if (!data || typeof data !== 'object') return;
    if ('online' in data) state.online = data.online;
    if ('sharing' in data) state.sharing = data.sharing;
    if ('online' in data || 'sharing' in data) pushAll();
    if (data.view) document.getElementById(`nav-${data.view}`)?.click();
    if (data.signIn) document.querySelector('.device.online .device-main')?.click();
    if (data.toggle) document.getElementById('theme-toggle')?.click();
    if (data.scroll) document.getElementById(data.scroll)?.scrollIntoView({ block: 'end' });
  });
})();
