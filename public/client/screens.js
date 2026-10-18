'use strict';
// The Screen menu, when the computer has two or more screens: a map of the screens as the computer places them, and
// a list with their names and sizes. Choosing one asks the computer to share it instead; the picture switches
// without ending the session. The computer sends its screens on the control channel ('screens' messages, stream.js).

// The computer's screens, when it has two or more: the Screen menu switches which one it shares.
let screens = [];
let currentScreen = null;
let screenTimer = null;

/** Whether a screen from the computer has an id, a name and a valid position and size. */
const validScreen = (item) =>
  item &&
  typeof item.id === 'string' &&
  item.id.length <= 64 &&
  typeof item.name === 'string' &&
  ['x', 'y', 'w', 'h', 'width', 'height'].every((key) => Number.isFinite(item[key])) &&
  item.w > 0 &&
  item.h > 0;

/** Closes the menu. */
function closeScreens() {
  $('screens-menu').hidden = true;
  $('screens-button').setAttribute('aria-expanded', 'false');
}

/**
 * Draws the menu: the screens where the computer places them, in a box the menu's width, numbered as in the list.
 * The button shows only when the computer has two or more screens.
 */
function renderScreens() {
  $('screens-wrap').hidden = screens.length < 2;
  if (screens.length < 2) {
    closeScreens();
    return;
  }
  $('screens-count').textContent =
    `${screens.findIndex((item) => item.id === currentScreen) + 1 || 1} of ${screens.length}`;
  $('screens-title').textContent = `Screens on ${hostName}`;
  const MAP_WIDTH = 310,
    MAP_HEIGHT = 92;
  const left = Math.min(...screens.map((item) => item.x)),
    top = Math.min(...screens.map((item) => item.y));
  const right = Math.max(...screens.map((item) => item.x + item.w)),
    bottom = Math.max(...screens.map((item) => item.y + item.h));
  const scale = Math.min((MAP_WIDTH - 24) / (right - left), (MAP_HEIGHT - 20) / (bottom - top));
  const x0 = (MAP_WIDTH - (right - left) * scale) / 2,
    y0 = (MAP_HEIGHT - (bottom - top) * scale) / 2;
  $('screens-map').replaceChildren(
    ...screens.map((item, index) => {
      const box = document.createElement('button');
      box.type = 'button';
      box.tabIndex = -1;
      box.textContent = String(index + 1);
      Object.assign(box.style, {
        left: `${x0 + (item.x - left) * scale + 2}px`,
        top: `${y0 + (item.y - top) * scale + 2}px`,
        width: `${Math.max(14, item.w * scale - 4)}px`,
        height: `${Math.max(12, item.h * scale - 4)}px`,
      });
      box.setAttribute('aria-current', String(item.id === currentScreen));
      box.addEventListener('click', () => pickScreen(item));
      return box;
    }),
  );
  $('screens-rows').replaceChildren(
    ...screens.map((item, index) => {
      const row = document.createElement('button'),
        number = document.createElement('span'),
        name = document.createElement('span');
      const size = document.createElement('small'),
        tag = document.createElement('span');
      row.type = 'button';
      row.setAttribute('role', 'menuitemradio');
      row.setAttribute('aria-checked', String(item.id === currentScreen));
      number.className = 'n';
      number.textContent = String(index + 1);
      name.className = 'name';
      name.textContent = item.name;
      size.textContent = `${item.width} × ${item.height}`;
      name.append(size);
      tag.className = 'tag';
      tag.textContent = item.main ? 'Main' : '';
      row.append(number, name, tag);
      row.addEventListener('click', () => pickScreen(item));
      return row;
    }),
  );
}

/** Asks the computer to share another screen. If it hasn't switched within 8 seconds, it says so. */
function pickScreen(item) {
  closeScreens();
  if (item.id === currentScreen) return;
  if (!sendControl({ type: 'screen', id: item.id })) {
    showNotice('The control connection is not ready.', true);
    return;
  }
  $('screens-switching-text').textContent = `Switching to ${item.name}…`;
  $('screens-switching').hidden = false;
  clearTimeout(screenTimer);
  screenTimer = setTimeout(() => {
    $('screens-switching').hidden = true;
    showNotice('The computer didn’t switch screens. Try again.', true);
  }, 8000);
}

/** Opens the menu from its button, and closes it with a click elsewhere or Escape. Called once by start.js. */
function setUpScreens() {
  $('screens-button').addEventListener('click', (event) => {
    event.stopPropagation();
    const open = $('screens-menu').hidden;
    $('screens-menu').hidden = !open;
    $('screens-button').setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (event) => {
    if (!$('screens-wrap').contains(event.target)) closeScreens();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeScreens();
  });
}
