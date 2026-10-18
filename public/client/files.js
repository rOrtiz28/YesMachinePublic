'use strict';
// Files between this device and the computer.
//  - Sending: a file goes over the session socket in pieces of 48 KB, as base64 in JSON messages (file-start, then
//    file-chunk, then file-end, and the computer answers file-ready and file-done). One file at a time, up to 10 GB,
//    waiting whenever the socket has more than 512 KB to send.
//  - Receiving: the computer offers a file (download-offer) at a one-time address. Save downloads it straight from
//    there, so the browser keeps it on disk as it comes, however large, and the computer reports how far it got.

// The answers a file being sent waits for, as { resolve, reject, timer }: the computer's file-ready, then file-done.
// An error from the computer while sending, whether a file is being sent, and the file being received.
let fileReady = null;
let fileDone = null;
let uploadError = null;
let uploadActive = false;
let download = null;
// Files can be dropped on the drop zone or on the desktop. Dropping anywhere else must not open the file in the page.
const dropTargets = [$('file-drop'), desktop];

// --- Sending --------------------------------------------------------------------------------------------------

/** Gives up waiting for the computer's file-ready, with this message. */
function rejectFileReady(message) {
  if (!fileReady) return;
  const current = fileReady;
  fileReady = null;
  clearTimeout(current.timer);
  current.reject(new Error(message));
}

/** Gives up waiting for the computer's file-done, with this message. */
function rejectFileDone(message) {
  if (!fileDone) return;
  const current = fileDone;
  fileDone = null;
  clearTimeout(current.timer);
  current.reject(new Error(message));
}

/**
 * A file name as it may be shown and saved: without its folders and control characters, at most 180 characters,
 * and never empty, "." or "..".
 */
function safeFilename(name) {
  const result =
    typeof name === 'string'
      ? name
          .split(/[\\/]/)
          .pop()
          .replace(/[\u0000-\u001f\u007f]/g, '')
          .slice(0, 180)
      : '';
  return result && result !== '.' && result !== '..' ? result : 'download';
}

/** Bytes as base64, in pieces of 8 KB, so a large piece doesn't overflow the call stack. */
function toBase64(bytes) {
  let text = '';
  for (let start = 0; start < bytes.length; start += 8192)
    text += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(text);
}

/** Waits `ms` milliseconds, or rejects as soon as the transfer is canceled. */
function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('The transfer was cancelled.'));
      return;
    }
    const aborted = () => {
      clearTimeout(timer);
      reject(new Error('The transfer was cancelled.'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', aborted);
      resolve();
    }, ms);
    signal.addEventListener('abort', aborted, { once: true });
  });
}

/** Waits while the socket has more than 512 KB to send; fails after 20 seconds, or when the session ends. */
async function waitForSocket(signal) {
  const started = Date.now();
  while (socket && socket.readyState === WebSocket.OPEN && socket.bufferedAmount > 512 * 1024) {
    if (uploadError) throw new Error(uploadError);
    if (Date.now() - started > 20000)
      throw new Error('File transfer stalled. Reconnect and try again.');
    await pause(30, signal);
  }
  if (signal.aborted || !socket || socket.readyState !== WebSocket.OPEN)
    throw new Error('The connection closed during the transfer.');
  if (uploadError) throw new Error(uploadError);
}

/** Sends a file to the computer, with its progress in the Files panel. */
async function sendFile(file) {
  if (!file) return;
  if (!paired || !aborter) {
    showNotice('Connect to a computer before sending files.', true);
    $('file-input').value = '';
    return;
  }
  if (uploadActive) {
    showNotice('Wait for the current file to finish.');
    return;
  }
  if (file.size > MAX_FILE) {
    showNotice('Choose a file of 10 GB or less.', true);
    $('file-input').value = '';
    return;
  }
  uploadActive = true;
  uploadError = null;
  $('file-input').disabled = true;
  $('file-progress').hidden = false;
  $('file-progress').value = 0;
  $('file-status').textContent = `Preparing ${file.name}…`;
  const thisGeneration = generation;
  const signal = aborter.signal;
  try {
    const id = await new Promise((resolve, reject) => {
      fileReady = {
        resolve,
        reject,
        timer: setTimeout(
          () => rejectFileReady('The host did not accept the file in time.'),
          20000,
        ),
      };
      try {
        wsSend({ type: 'file-start', name: safeFilename(file.name), size: file.size });
      } catch (error) {
        rejectFileReady(error.message);
      }
    });
    for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
      await waitForSocket(signal);
      const bytes = new Uint8Array(await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer());
      if (signal.aborted || thisGeneration !== generation)
        throw new Error('The transfer was cancelled.');
      wsSend({ type: 'file-chunk', id, data: toBase64(bytes) });
      const progress = Math.min(100, Math.round(((offset + bytes.length) / file.size) * 100));
      $('file-progress').value = progress;
      $('file-status').textContent = `Sending ${file.name} · ${progress}%`;
    }
    await waitForSocket(signal);
    $('file-status').textContent = `Waiting for the host to confirm ${file.name}…`;
    await new Promise((resolve, reject) => {
      fileDone = {
        resolve,
        reject,
        timer: setTimeout(
          () =>
            rejectFileDone(
              'The host did not confirm the file. Check the host before trying again.',
            ),
          20000,
        ),
      };
      try {
        wsSend({ type: 'file-end', id });
      } catch (error) {
        rejectFileDone(error.message);
      }
    });
  } catch (error) {
    if (thisGeneration === generation) {
      $('file-status').textContent = 'File transfer did not finish.';
      $('file-progress').hidden = true;
      showNotice(error.message || 'The file could not be sent.', true, true);
    }
  } finally {
    if (thisGeneration === generation) {
      uploadActive = false;
      uploadError = null;
      $('file-input').disabled = false;
      $('file-input').value = '';
    }
  }
}

// --- Receiving ------------------------------------------------------------------------------------------------

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// A file from the host arrives as an offer: Save takes it from the host's one-time address, so the browser keeps it
// on disk as it comes, however large, and the host says how far it got.
function receiveDownload(message) {
  if (message.type === 'download-offer') {
    if (
      download ||
      typeof message.id !== 'string' ||
      message.id.length > 128 ||
      !Number.isSafeInteger(message.size) ||
      message.size < 0 ||
      message.size > MAX_FILE ||
      typeof message.path !== 'string' ||
      !/^\/download\/[0-9a-f]{48}$/.test(message.path)
    ) {
      showNotice(
        'The incoming file was rejected because its size or transfer details are invalid.',
        true,
      );
      return;
    }
    const row = document.createElement('div');
    const label = document.createElement('span');
    const detail = document.createElement('small');
    const link = document.createElement('a');
    download = {
      id: message.id,
      name: safeFilename(message.name),
      size: message.size,
      detail,
      link,
    };
    row.className = 'download';
    label.textContent = download.name;
    detail.textContent = `${formatSize(download.size)} · ready`;
    label.append(detail);
    link.className = 'ghost';
    link.href = message.path;
    link.download = download.name;
    link.textContent = 'Save';
    link.setAttribute('aria-label', `Save ${download.name}`);
    // The address works once, so the link goes quiet after the first click.
    link.addEventListener(
      'click',
      () =>
        setTimeout(() => {
          link.removeAttribute('href');
          link.textContent = 'Saving…';
        }),
      { once: true },
    );
    row.append(label, link);
    $('downloads').append(row);
    if ($('downloads').children.length > 4) $('downloads').firstElementChild.remove();
    $('file-status').textContent = `${download.name} is ready. Choose Save to receive it.`;
    $('file-progress').hidden = true;
    showNotice(
      `${hostName || 'The host'} is sending ${download.name} (${formatSize(download.size)}). Choose Save in Files to receive it.`,
    );
  } else if (message.type === 'download-progress' && download && message.id === download.id) {
    if (
      !Number.isSafeInteger(message.received) ||
      message.received < 0 ||
      message.received > download.size
    )
      return;
    const percent = download.size ? Math.floor((message.received / download.size) * 100) : 100;
    $('file-progress').hidden = false;
    $('file-progress').value = percent;
    $('file-status').textContent = `Receiving ${download.name} · ${percent}%`;
    download.detail.textContent = `${formatSize(download.size)} · ${percent}%`;
  } else if (message.type === 'download-end' && download && message.id === download.id) {
    download.detail.textContent = `Received · ${formatSize(download.size)}`;
    download.link.removeAttribute('href');
    download.link.textContent = 'Saved';
    $('file-status').textContent = `${download.name} received.`;
    $('file-progress').hidden = true;
    showNotice(`${download.name} received.`);
    download = null;
  } else if (message.type === 'download-error' && download && message.id === download.id) {
    download.detail.textContent = 'Didn’t arrive';
    download.link.remove();
    download = null;
    $('file-progress').hidden = true;
    $('file-status').textContent = 'The incoming file did not finish.';
    showNotice(
      typeof message.message === 'string'
        ? message.message
        : 'The host could not finish sending the file.',
      true,
      true,
    );
  }
}

/** Connects the file input and dropping files on the drop zone or the desktop. Called once by start.js. */
function setUpFiles() {
  $('file-input').addEventListener('change', () => sendFile($('file-input').files[0]));
  for (const type of ['dragover', 'drop'])
    document.addEventListener(type, (event) => event.preventDefault());
  for (const target of dropTargets) {
    target.addEventListener('dragover', (event) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.dataTransfer.dropEffect = 'copy';
      $('file-drop').classList.add('over');
    });
    target.addEventListener('dragleave', () => $('file-drop').classList.remove('over'));
    target.addEventListener('drop', (event) => {
      $('file-drop').classList.remove('over');
      const file = event.dataTransfer?.files[0];
      if (!file) return;
      showPanel('files', false);
      sendFile(file);
    });
  }
}
