'use strict';
// In-app viewer windows: how this computer opens another computer that is sharing its screen. The
// main process signs in to a host with that computer's account, then opens a sandboxed window
// without a preload that spends the one-time ticket. Its session accepts only the certificate the
// user approved in the host window.
//
// main.cjs creates the viewers with createViewers() and connects them to the host window's IPC
// channels (inspect, trust, sign-in, sign-in-saved, focus-viewer and the settings that list and
// forget approvals and sign-ins). Opening a computer goes in this order:
// 1. inspect(): a TLS handshake (network/probe.cjs) shows the computer's certificate fingerprint,
//    and whether it is the one approved before.
// 2. trust(): the person approves that certificate, kept in the trust store (network/trust.cjs).
// 3. signIn() or signInSaved(): the main process signs in (viewing/signin.cjs) and gets a one-time
//    ticket; the password can be remembered (viewing/credentials.cjs).
// 4. open(): the window loads the computer's own viewer page with the ticket, and the page spends
//    it on its session socket.
const crypto = require('node:crypto');
const { BrowserWindow, session } = require('electron');
const { probeHosts } = require('../network/probe.cjs');
const { createTrustStore, fingerprintOf, validTarget } = require('../network/trust.cjs');
const { createCredentialStore } = require('./credentials.cjs');
const { requestTicket } = require('./signin.cjs');

// What a viewer page may use; it is refused anything else.
const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'clipboard-read', 'clipboard-sanitized-write']);

/**
 * A new session for one viewer window: in memory only (its partition name has no "persist:"
 * prefix), accepting only a certificate the trust store `store` allows, and granting only
 * ALLOWED_PERMISSIONS.
 *
 * Every window gets a fresh in-memory session. The engine caches a refused certificate for the life
 * of a session, so a certificate approved after a refusal would otherwise keep failing.
 */
function viewerSession(store) {
  const viewer = session.fromPartition(`yes-machine-viewer-${crypto.randomUUID()}`);
  // 0 accepts the certificate, and -2 refuses it.
  viewer.setCertificateVerifyProc((request, callback) =>
    callback(store.allows(request.hostname, fingerprintOf(request.certificate.data)) ? 0 : -2),
  );
  viewer.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.has(permission)),
  );
  viewer.setPermissionCheckHandler((_contents, permission) => ALLOWED_PERMISSIONS.has(permission));
  return viewer;
}

/**
 * Creates the viewer windows' controls (returned at the end).
 *
 * The trust store can be shared, as with Android devices in general mode, so that both keep the
 * same approvals: main.cjs passes `store`; otherwise one is opened from `trustFile`.
 * `credentialFile` holds the remembered sign-ins, which `safeStorage` (Electron's) encrypts, and
 * `icon` is the windows' icon. backgroundColor gives the color a new window shows before its page
 * draws, night or day. onEnded hears { name, reason } when a window closes because its session
 * ended, and onConnected the keys of the computers with an open window whenever they change.
 */
function createViewers({
  trustFile,
  store = createTrustStore(trustFile),
  credentialFile,
  safeStorage,
  icon,
  backgroundColor = () => '#0d1115',
  onEnded = () => {},
  onConnected = () => {},
}) {
  const saved = createCredentialStore(credentialFile, safeStorage);
  // The fingerprints inspect() saw, and the open windows, by "address:port".
  const seen = new Map(),
    windows = new Map();

  // --- Checking and approving a computer ---

  /**
   * Checks the computer at `value` ({ address, port }). Resolves { online: false }, or { online:
   * true, fingerprint, trusted, changed, remembered }: trusted when its certificate is the approved
   * one, changed when a different one was approved, and remembered when a sign-in is saved for it.
   */
  async function inspect(value) {
    const target = validTarget(value);
    if (!target) throw Error('Enter a private IPv4 address and port.');
    const [result] = await probeHosts([target]);
    if (!result.online || !result.fingerprint) return { online: false };
    seen.set(target.key, result.fingerprint);
    const approved = store.get(target.key);
    return {
      online: true,
      fingerprint: result.fingerprint,
      trusted: approved === result.fingerprint,
      changed: !!approved && approved !== result.fingerprint,
      remembered: !!saved.get(target.key),
    };
  }

  /**
   * Approves the certificate inspect() last saw for that computer, and returns its fingerprint.
   * Only a fingerprint this process just observed can be approved, never one supplied by the page.
   * The page's name and system for the computer are kept with it, for Settings' list.
   */
  function trust(value) {
    const target = validTarget(value),
      fingerprint = target && seen.get(target.key);
    if (!fingerprint) throw Error('Check the computer again before trusting it.');
    store.set(target.key, fingerprint, { name: value.name, system: value.system });
    return fingerprint;
  }

  /** The checked target and its approved fingerprint; throws when the computer isn't approved. */
  function approved(value) {
    const target = validTarget(value),
      fingerprint = target && store.get(target.key);
    if (!fingerprint) throw Error('Verify this computer before connecting.');
    return { target, fingerprint };
  }

  // --- Signing in ---

  /**
   * Signs in with the user name and password the person typed, and opens a window titled after
   * `name`. With `remember` the sign-in is saved; without it, any saved one is forgotten. Resolves
   * { remembered }, which is false when it couldn't be saved (no encryption available).
   */
  async function signIn(value, { user, password, remember } = {}, name) {
    if (typeof user !== 'string' || typeof password !== 'string' || !user.trim() || !password)
      throw Error('Enter the user name and password of that computer.');
    const { target, fingerprint } = approved(value);
    const ticket = await requestTicket(target, fingerprint, user.trim(), password);
    const remembered = remember
      ? saved.set(target.key, { user: user.trim(), password }, name)
      : (saved.forget(target.key), false);
    open(target, name, ticket);
    return { remembered };
  }

  /**
   * Uses a remembered sign-in. A refused one is forgotten, so the user is asked again. Resolves
   * { connected: true } once the window opens, or { needsCredentials: true } when nothing is
   * saved; after a refusal, also with the saved user name and an error to show. Other failures
   * reject.
   */
  async function signInSaved(value, name) {
    const { target, fingerprint } = approved(value),
      credential = saved.get(target.key);
    if (!credential) return { needsCredentials: true };
    try {
      open(
        target,
        name,
        await requestTicket(target, fingerprint, credential.user, credential.password),
      );
      return { connected: true };
    } catch (error) {
      if (error.status === 401) {
        saved.forget(target.key);
        return {
          needsCredentials: true,
          user: credential.user,
          error: 'The saved password no longer works. Enter it again.',
        };
      }
      throw error;
    }
  }

  // --- The windows ---

  // Each computer has at most one viewer window; several computers can be open at once. These are
  // their "address:port" keys.
  const connected = () => [...windows.keys()];

  /**
   * Brings an open viewer window for this computer to the front, so double-clicking it doesn't sign
   * in again. Returns false when the computer has no open window.
   */
  function focus(value) {
    const target = validTarget(value),
      existing = target && windows.get(target.key);
    if (!existing || existing.isDestroyed()) return false;
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return true;
  }

  /**
   * Opens the viewer window for `target`, closing any it already has, titled after `name`, and
   * loads the computer's viewer page with `ticket`.
   */
  function open(target, name, ticket) {
    const existing = windows.get(target.key);
    if (existing && !existing.isDestroyed()) existing.close();
    const origin = `https://${target.key}`;
    const viewer = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 640,
      minHeight: 480,
      title: `${name} · Yes Machine`,
      backgroundColor: backgroundColor(),
      icon,
      autoHideMenuBar: true,
      webPreferences: {
        session: viewerSession(store),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    windows.set(target.key, viewer);
    onConnected(connected());
    // Closing takes a moment, so a replaced window's 'closed' comes after its successor is in the
    // map; only the current window removes its entry.
    viewer.on('closed', () => {
      if (windows.get(target.key) === viewer) {
        windows.delete(target.key);
        onConnected(connected());
      }
    });
    // The window keeps its own title, whatever the page calls itself.
    viewer.on('page-title-updated', (event) => event.preventDefault());
    // No new windows, and no navigating away from the computer's own pages.
    viewer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    viewer.webContents.on('will-navigate', (event, url) => {
      if (new URL(url).origin !== origin) event.preventDefault();
    });
    // The sandboxed page has no bridge, so it reports the end of its session through the URL
    // fragment: #ended-closed when the session closed normally, #ended-lost when it broke, and
    // #ended-replaced when another device took over.
    viewer.webContents.on('did-navigate-in-page', (_event, url) => {
      const reason = /#ended-(lost|closed|replaced)$/.exec(url)?.[1];
      if (!reason || viewer.isDestroyed()) return;
      viewer.close();
      onEnded({ name, reason });
    });
    // The ticket goes in the fragment, which is never sent to the server; the page reads it.
    viewer.loadURL(`${origin}/#ticket=${ticket}`);
  }

  return {
    inspect,
    trust,
    signIn,
    signInSaved,
    focus,
    connected,
    // Settings' lists: what is kept, and forgetting some of it by "address:port" key.
    trusted: () => store.list(),
    forgetTrusted: (keys) => store.forget(keys),
    credentials: () => ({ available: saved.available(), list: saved.list() }),
    forgetCredentials: (keys) => {
      for (const key of Array.isArray(keys) ? keys : []) saved.forget(key);
    },
  };
}

module.exports = { createViewers, viewerSession };
