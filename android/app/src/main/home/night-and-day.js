'use strict';
// Night or day, as on the desktop: the house walks Sarigüeya over between them (pixel-home.js); the page's colors
// change halfway, and each window of the house when the light reaches it. Java colors Android's status and
// navigation bars to match, keeps the choice for the next start and opens the viewer in the same light.
let theme = read('ym.theme', 'night') === 'day' ? 'day' : 'night',
  pageTheme = null,
  houseLight = theme === 'day' ? 1 : 0;
// The house drawing (public/pixel-home.js). start.js mounts it.
let house = null;

/** Gives the page the colors of a mode, and tells Java, which colors Android's bars to match. */
function applyPageTheme(mode) {
  if (pageTheme === mode) return;
  pageTheme = mode;
  document.documentElement.dataset.theme = mode === 'day' ? 'light' : 'dark';
  api.setTheme(mode).catch(() => {});
}

/** The switch shows the mode it switches to: the moon by day, the sun at night. */
function renderThemeToggle() {
  const label = theme === 'day' ? 'Switch to night' : 'Switch to day';
  $('theme-toggle').setAttribute('aria-label', label);
  $('theme-toggle').title = label;
  $('theme-icon').dataset.icon = theme === 'day' ? 'moon' : 'sun';
  PixelIcons.render($('theme-toggle'));
}

// The switch walks her over while the house is on screen; on another page the mode just changes. The house sits
// below the This device card, so when part of it is out of view it scrolls in first, and then she sets off.
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
  // The house reports the light every frame of the walk, 0 or 1 while she's still on her way, so the switch waits for
  // the house to have finished changing.
  if (!house?.changing) $('theme-toggle').disabled = false;
}

/**
 * Turns each window of the house (each computer's card, the sky that holds the list's heading, and the "show all"
 * row) to day once the daylight has reached its middle. Outside the walk, all of them follow the light at once.
 */
function applyHouseLight() {
  const box = $('house').getBoundingClientRect(),
    changing = houseLight > 0 && houseLight < 1;
  for (const el of [$('house-sky'), $('house-more'), ...$('devices').children]) {
    const r = el.getBoundingClientRect(),
      reach =
        changing && box.width
          ? PixelHome.reach(
              r.left + r.width / 2 - box.left,
              r.top + r.height / 2 - box.top,
              box.width,
              box.height,
            )
          : 0.5;
    el.classList.toggle('day', houseLight > reach);
  }
}

/** Connects the night and day switch. Called once by start.js. */
function setUpThemeSwitch() {
  $('theme-toggle').addEventListener('click', toggleTheme);
}
