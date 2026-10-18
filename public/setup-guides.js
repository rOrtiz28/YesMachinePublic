'use strict';
// Step-by-step setup help for each platform, shown in the page's #guide-dialog. The desktop app's
// main window (src/windows/host/settings.js) and the Android app's home screen (home/settings.js) both use
// it.
// SetupGuides.open(platform, context) opens the dialog on one platform's guide: 'darwin', 'win32',
// 'linux', 'android' or 'browser'. A row of tabs at the top switches to the other platforms. A
// sharing computer passes { address }, so the browser guide also shows its real address.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SetupGuides = api;
})(typeof self !== 'undefined' ? self : this, () => {
  // --- The guides ---

  // Each guide has its tab's label, a title, an intro and its steps. A step is [title, parts], or
  // [title, parts, 'address'] for the step that shows the sharing computer's address. Text parts
  // are plain strings, { key } for names shown on screen and { code } for commands to type.
  const GUIDES = {
    darwin: {
      tab: 'macOS',
      title: 'Share a Mac',
      intro:
        'macOS asks for two permissions before another device can see and control this Mac. You only do this once.',
      steps: [
        [
          'Allow screen recording',
          [
            'Open ',
            { key: 'System Settings → Privacy & Security → Screen & System Audio Recording' },
            '. If Yes Machine is in the list, turn it on. If it isn’t, click ',
            { key: '+' },
            ' under the list, open ',
            { key: 'Applications' },
            ', select ',
            { key: 'Yes Machine' },
            ' and click ',
            { key: 'Open' },
            ', then turn it on. On macOS 14 and earlier this section is called ',
            { key: 'Screen Recording' },
            '.',
          ],
        ],
        [
          'Allow control',
          [
            'In ',
            { key: 'Privacy & Security → Accessibility' },
            ', add and turn on Yes Machine the same way. This lets the other device use this Mac’s keyboard and mouse.',
          ],
        ],
        [
          'Reopen Yes Machine',
          [
            'When macOS asks, choose ',
            { key: 'Quit & Reopen' },
            '. If it doesn’t ask, quit Yes Machine with ',
            { key: '⌘Q' },
            ' and open it again from Applications.',
          ],
        ],
        [
          'Allow connections',
          [
            'If macOS asks whether Yes Machine may accept incoming network connections or find devices on your local network, choose ',
            { key: 'Allow' },
            '.',
          ],
        ],
        [
          'After an update',
          [
            'macOS can treat a new version as a different app. If sharing stops working after an update, select Yes Machine in each list, remove it with ',
            { key: '−' },
            ', and add it again with ',
            { key: '+' },
            '.',
          ],
        ],
      ],
    },
    win32: {
      tab: 'Windows',
      title: 'Share a Windows computer',
      intro:
        'Windows needs no special permission to share the screen, but its firewall has to let your other devices in.',
      steps: [
        [
          'Allow Yes Machine through the firewall',
          [
            'The first time you share, Windows Defender Firewall asks about Yes Machine. Allow it on ',
            { key: 'Private networks' },
            ' only.',
          ],
        ],
        [
          'Use a private network',
          [
            'Open ',
            { key: 'Settings → Network & internet → Wi-Fi' },
            ' (or Ethernet), select your network, and set ',
            { key: 'Network profile type' },
            ' to ',
            { key: 'Private' },
            '. On a public network, other devices can’t reach this computer.',
          ],
        ],
        [
          'Sign in with your Windows password',
          [
            'Other devices sign in with this computer’s user name and password. With a Microsoft account, use the account’s current password, not the PIN. If Windows turns the password down, open ',
            { key: 'Settings → Accounts → Sign-in options' },
            ' and turn off ',
            {
              key: 'For improved security, only allow Windows Hello sign-in for Microsoft accounts on this device',
            },
            '.',
          ],
        ],
        [
          'While another device has control',
          [
            'A device with a mouse shows this computer’s cursor with its own pointer, so the cursor disappears from this screen meanwhile. Move this computer’s mouse and it comes back at once.',
          ],
        ],
        [
          'Windows opened as administrator',
          [
            'Windows doesn’t let a normal app control windows that run as administrator. To control those too, right-click Yes Machine and choose ',
            { key: 'Run as administrator' },
            '.',
          ],
        ],
      ],
    },
    linux: {
      tab: 'Linux',
      title: 'Share a Linux computer',
      intro:
        'Yes Machine shares Linux desktops on Wayland, the default on Ubuntu and Fedora, and on X11 (Xorg).',
      steps: [
        [
          'Choose the screen to share',
          [
            'In a Wayland session, a ',
            { key: 'Share Screen' },
            ' dialog opens each time sharing starts. Choose your screen and click ',
            { key: 'Share' },
            '.',
          ],
        ],
        [
          'Allow remote control',
          [
            'The first time, a second dialog has a switch at the top that lets other devices control this computer. Turn it on and click ',
            { key: 'Share' },
            '. Yes Machine remembers it from then on. Without it, other devices can watch but not control.',
          ],
        ],
        [
          'Find it in the top bar',
          [
            'While Yes Machine runs, its icon in the top bar opens or quits it, and closing the window keeps it running. GNOME shows the icon with its AppIndicator extension, on by default in Ubuntu. Without it, open Yes Machine again to see its window.',
          ],
        ],
        [
          'Turn on system audio',
          [
            'To send this computer’s sound too, install the audio tools: ',
            { code: 'sudo apt install pulseaudio-utils' },
          ],
        ],
        [
          'Open the firewall, if you use one',
          [
            'With ufw, allow sharing and discovery: ',
            { code: 'sudo ufw allow 4777/tcp' },
            ' and ',
            { code: 'sudo ufw allow 5353/udp' },
          ],
        ],
        [
          'Sign in with your Linux password',
          [
            'Other devices sign in with the user name and password you use to log in to this computer.',
          ],
        ],
        [
          'Virtual machines',
          [
            'Set the virtual machine’s network adapter to ',
            { key: 'Bridged' },
            ' so it gets an address on your network. With NAT, other devices can’t reach it.',
          ],
        ],
      ],
    },
    android: {
      tab: 'Android',
      title: 'Connect from Android',
      intro: 'The Android app opens your computers. It doesn’t share the phone or tablet itself.',
      steps: [
        [
          'Join the same network',
          [
            'Connect the phone or tablet to the same network as the computer, over Wi-Fi or Ethernet. Guest networks often keep devices from seeing each other.',
          ],
        ],
        [
          'Find the computer',
          [
            'Computers that are sharing appear under ',
            { key: 'On your network' },
            ' within a few seconds. If one doesn’t, tap ',
            { key: 'Add computer' },
            ' and enter the address shown in Yes Machine on that computer.',
          ],
        ],
        [
          'Check its certificate',
          [
            'The first time, compare the fingerprint with ',
            { key: 'Verify this computer’s certificate' },
            ' on the computer, and continue only if they match.',
          ],
        ],
        [
          'Sign in',
          [
            'Use the computer’s user name and password. ',
            { key: 'Remember on this device' },
            ' keeps the password encrypted with Android’s secure storage.',
          ],
        ],
        [
          'If it says Another network',
          [
            'That computer has an address this device can’t reach, such as a virtual machine using NAT. Use a bridged network adapter, or connect both to the same network.',
          ],
        ],
      ],
    },
    browser: {
      tab: 'Browser',
      title: 'Connect from a browser',
      intro:
        'Any phone, tablet or computer with a current browser can open a computer that is sharing, with nothing to install.',
      steps: [
        [
          'Join the same network',
          [
            'Connect this device to the same network as the computer, over Wi-Fi or Ethernet. Guest networks often keep devices from seeing each other.',
          ],
        ],
        [
          'Open the computer’s address',
          [
            'In Yes Machine on the computer, open ',
            { key: 'Connect from a browser' },
            ' and type the address it shows into the browser, with ',
            { key: 'https://' },
            ' at the start and ',
            { key: ':4777' },
            ' at the end.',
          ],
          'address',
        ],
        [
          'Check its certificate',
          [
            'The browser warns that the connection isn’t private, because the computer made its own certificate. Open the certificate details and compare the SHA-256 fingerprint with ',
            { key: 'Verify this computer’s certificate' },
            ' in Yes Machine. Continue through the browser’s ',
            { key: 'Advanced' },
            ' option only if they match.',
          ],
        ],
        [
          'Sign in',
          [
            'Use the user name and password you log in to that computer with. Your browser can save them like any other password.',
          ],
        ],
        [
          'Control the computer',
          [
            'Click the desktop to control it. On a touch screen, drag to move and use two fingers to scroll. ',
            { key: 'Keyboard' },
            ', ',
            { key: 'Clipboard' },
            ' and ',
            { key: 'Files' },
            ' open beside the desktop.',
          ],
        ],
        [
          'If a Mac’s browser says the address is unreachable',
          [
            'macOS lets an app reach other devices on your network only with permission. Open ',
            { key: 'System Settings → Privacy & Security → Local Network' },
            ', turn on your browser, then quit it with ',
            { key: '⌘Q' },
            ' and open it again.',
          ],
        ],
      ],
    },
  };
  // The tabs, in order.
  const ORDER = ['darwin', 'win32', 'linux', 'android', 'browser'];

  // --- The dialog ---

  /**
   * Fills the dialog with one platform's guide (the Mac's for a platform it doesn't know), and with
   * the tabs, which show another platform's guide with the same context.
   */
  function render(platform, context = {}) {
    const $ = (id) => document.getElementById(id),
      guide = GUIDES[platform] || GUIDES.darwin;
    $('guide-title').textContent = guide.title;
    $('guide-intro').textContent = guide.intro;
    $('guide-tabs').replaceChildren(
      ...ORDER.map((key) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.setAttribute('role', 'tab');
        tab.textContent = GUIDES[key].tab;
        tab.setAttribute('aria-selected', String(GUIDES[key] === guide));
        tab.addEventListener('click', () => render(key, context));
        return tab;
      }),
    );
    // One list item per step: its title in bold, then its text, with names on screen and commands
    // in their own styles (.guide-key, .guide-code).
    $('guide-steps').replaceChildren(
      ...guide.steps.map(([title, written, extra]) => {
        // The address step ends with the sharing computer's own address, when there is one.
        const parts =
          extra === 'address' && context.address
            ? [...written, ' This computer’s address is ', { code: context.address }, '.']
            : written;
        const item = document.createElement('li'),
          heading = document.createElement('strong'),
          text = document.createElement('p');
        heading.textContent = title;
        for (const part of parts) {
          if (typeof part === 'string') {
            text.append(part);
            continue;
          }
          const span = document.createElement(part.code ? 'code' : 'span');
          span.className = part.code ? 'guide-code' : 'guide-key';
          span.textContent = part.code || part.key;
          text.append(span);
        }
        item.append(heading, text);
        return item;
      }),
    );
  }

  /**
   * Opens the guide dialog on a platform's guide. Does nothing on a page without the dialog.
   * @param platform 'darwin', 'win32', 'linux', 'android' or 'browser'.
   * @param context { address }: the sharing computer's address, for the browser guide.
   */
  function open(platform, context = {}) {
    const dialog = document.getElementById('guide-dialog');
    if (!dialog) return;
    render(platform, context);
    document.getElementById('guide-ok').onclick = () => dialog.close();
    if (!dialog.open) dialog.showModal();
  }

  return { GUIDES, open };
});
