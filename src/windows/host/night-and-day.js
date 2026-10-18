'use strict';
// Night and day. The switch at the top of the window changes between them. On the home page the house walks
// Sarigüeya over from one to the other (public/pixel-home.js); the page's own colors change halfway through the walk,
// and each window of the house changes when the daylight reaches it. On another page the mode simply changes.
//
// The choice is saved as ym.theme. public/theme.js applies it before the page first draws, so a window opened by day
// doesn't flash the night colors first.
//
// The house also shows how things are going: its cat's mood follows whether this computer is sharing and whether
// anything is connected (syncMood).

// The chosen mode, 'night' or 'day'; the mode the page's colors show right now, which changes halfway through the
// walk; and how much daylight reaches the house, from 0 (night) to 1 (day).
let theme = read('ym.theme', 'night') === 'day' ? 'day' : 'night',
  pageTheme = null,
  houseLight = theme === 'day' ? 1 : 0;
// The house drawing (public/pixel-home.js). start.js mounts it.
let house = null;

/**
 * Gives the page the colors of a mode, and tells the main process, which gives every window's background and the
 * title bar's controls (on Windows and Linux) the same colors.
 */
function applyPageTheme(mode) {
  if (pageTheme === mode) return;
  pageTheme = mode;
  document.documentElement.dataset.theme = mode === 'day' ? 'light' : 'dark';
  api.setTheme?.(mode)?.catch?.(() => {});
}

/** The switch shows the mode it switches to: the moon by day, the sun at night. */
function renderThemeToggle() {
  const label = theme === 'day' ? 'Switch to night' : 'Switch to day';
  $('theme-toggle').setAttribute('aria-label', label);
  $('theme-toggle').title = label;
  $('theme-icon').dataset.icon = theme === 'day' ? 'moon' : 'sun';
  PixelIcons.render($('theme-toggle'));
}

/**
 * The switch. While the home page shows, she walks over to the other mode, and the switch stays disabled until she
 * arrives. The house sits below the cards, so when part of it is out of view it scrolls in first, and then she sets
 * off.
 */
function toggleTheme() {
  theme = theme === 'day' ? 'night' : 'day';
  write('ym.theme', theme);
  renderThemeToggle();
  const animate = !$('view-home').hidden;
  if (animate) $('theme-toggle').disabled = true;
  const go = () => {
    house.setMode(theme, { animate });
    if (!house.changing) $('theme-toggle').disabled = false;
  };
  if (animate && showHouse()) setTimeout(go, 500);
  else go();
}

/** Scrolls the whole house into view. Returns false when it was already in view, true when it had to scroll. */
function showHouse() {
  const box = $('house').getBoundingClientRect(),
    view = document.querySelector('main').getBoundingClientRect();
  if (box.top >= view.top - 1 && box.bottom <= view.bottom + 1) return false;
  $('house').scrollIntoView({
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: box.height > view.height ? 'start' : 'end',
  });
  return true;
}

/** Called by the house with its daylight, from 0 at night to 1 by day, while it changes and when it settles. */
function onHouseLight(light) {
  houseLight = light;
  applyHouseLight();
  applyPageTheme(light > 0.5 ? 'day' : 'night');
  // The house reports the light every frame of the walk, and reports 0 or 1 while she is still on her way, so the
  // switch is enabled again only once the house has finished changing.
  if (!house?.changing) $('theme-toggle').disabled = false;
}

/**
 * Turns each window of the house (each device card, the sky that holds the list's heading, and the "show all" row)
 * to day once the daylight has reached its middle. Outside the walk, all of them follow the light at once.
 */
function applyHouseLight() {
  const box = $('house').getBoundingClientRect(),
    changing = houseLight > 0 && houseLight < 1;
  for (const part of [$('house-sky'), $('house-more'), ...$('devices').children]) {
    const rect = part.getBoundingClientRect(),
      reach =
        changing && box.width
          ? PixelHome.reach(
              rect.left + rect.width / 2 - box.left,
              rect.top + rect.height / 2 - box.top,
              box.width,
              box.height,
            )
          : 0.5;
    part.classList.toggle('day', houseLight > reach);
  }
}

/** The cat's mood and the link drawing follow whether this computer is sharing and whether anything is connected. */
function syncMood() {
  house?.setState({ sharing: !!media, connected: connected || connectedKeys.size > 0 });
  $('link-art').classList.toggle('linked', connected);
  renderDevices();
}

/** Connects the night and day switch. Called once by start.js. */
function setUpThemeSwitch() {
  $('theme-toggle').addEventListener('click', toggleTheme);
}
