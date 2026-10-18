'use strict';

// Tests the home screen's pixel-art house: Sarigüeya's walk between the night house and the day house
// (public/pixel-home.js), the daylight that sweeps across the house during the walk, and how the day house
// (public/pixel-day.js) shows sharing, connections and taps. All of it is the real drawing code, run in Node without
// a page or a canvas: the houses lay themselves out and render into a plain pixel array, and the tests advance the
// animation by calling tick() themselves.

const test = require('node:test');
const assert = require('node:assert/strict');
const { journey, back, frames, reach } = require('../../public/pixel-home.js');
const { DayHouse } = require('../../public/pixel-day.js');
const { House } = require('../../public/pixel-house.js');

/**
 * A day house and a night house laid out at the same size, as the home screen keeps them, so that her walk can be
 * planned from her place on the night roof to the day house.
 */
function houses() {
  const day = new DayHouse({}),
    night = new House({});
  day.layout({ width: 400, height: 260, roofTop: 44, streetTop: 214 });
  night.layout({
    width: day.g.w,
    height: day.g.h,
    roofTop: day.g.roofTop,
    streetTop: day.g.streetTop,
  });
  return { day, night };
}

test('Sarigüeya walks from her place on the night roof, by the air conditioner and the trash can, to the balustrade', () => {
  const { day, night } = houses(),
    g = day.g,
    steps = journey(g, night.g.catX);
  assert.deepEqual(steps[0], { pose: 'front', at: [night.g.catX + 9, g.roofTop], frames: 4 });
  const stops = steps.flatMap((step) => (step.jump ? [step.jump[1]] : []));
  assert.ok(
    stops.some(([x, y]) => x >= g.ac && x < g.ac + 15 && y === g.band - 6),
    'she lands on the air conditioner',
  );
  assert.ok(
    stops.some(([x, y]) => x >= g.ac + 2 && x < g.ac + 13 && y === g.streetTop - 13),
    'and on the trash can lid',
  );
  assert.deepEqual(stops.at(-1), [g.catX + 14, g.railTop], 'and last on the balustrade');
  const { list, lightStart, lightEnd } = frames(steps);
  assert.ok(
    lightStart > 0 && lightStart < lightEnd && lightEnd <= list.length,
    'the light crosses while she is on her way',
  );
  for (let i = 1; i < list.length; i++)
    assert.ok(
      Math.hypot(list[i].x - list[i - 1].x, list[i].y - list[i - 1].y) < 14,
      `no leap between frames ${i - 1} and ${i}`,
    );
  // The page shows one frame of the walk every 50 ms.
  const seconds = (list.length * 50) / 1000;
  assert.ok(seconds > 4 && seconds < 9, `about seven seconds, not ${seconds}`);
});

test('the way back is the same steps reversed, each one run backwards and facing the other way', () => {
  const { day, night } = houses(),
    steps = journey(day.g, night.g.catX),
    reversed = back(steps);
  assert.equal(reversed.length, steps.length);
  assert.deepEqual(reversed[0], { ...steps.at(-1), face: 1 });
  assert.deepEqual(reversed.at(-1), { ...steps[0], face: undefined });
  const walk = steps.find((step) => step.walk && step.light === 'end'),
    mirrored = reversed.find((step) => step.walk && step.walk[1][0] === walk.walk[0][0]);
  assert.deepEqual(mirrored.walk, [walk.walk[1], walk.walk[0]]);
  assert.equal(mirrored.light, 'start');
  const { list } = frames(reversed);
  assert.deepEqual([list.at(-1).x, list.at(-1).y], steps[0].at);
});

test('daylight reaches the top left first and the bottom right last', () => {
  for (const [x, y] of [
    [0, 0],
    [399, 259],
    [200, 130],
  ]) {
    const value = reach(x, y, 400, 260);
    assert.ok(value >= 0 && value <= 1);
  }
  assert.ok(reach(10, 10, 400, 260) < reach(200, 130, 400, 260));
  assert.ok(reach(200, 130, 400, 260) < reach(390, 250, 400, 260));
});

test('by day the garage and the gates follow sharing, and her mood follows the connection', () => {
  const { day } = houses(),
    // The garage door and the gates move a step per tick; 40 ticks is enough for them to finish moving.
    settle = () => {
      for (let i = 0; i < 40; i++) day.tick();
    };
  day.setState({ sharing: false, connected: true });
  settle();
  assert.equal(day.mood, 'connected');
  assert.equal(day.door, 0, 'connected without sharing keeps the garage closed');
  assert.equal(day.gate, 0, 'and the gates');
  day.setState({ sharing: true, connected: false });
  settle();
  assert.equal(day.mood, 'sharing');
  assert.equal(day.door, 1);
  assert.equal(day.gate, 1);
  day.setState({ sharing: false });
  settle();
  assert.equal(day.mood, 'sleep');
  assert.equal(day.door, 0);
  assert.equal(day.gate, 0);
});

test('a tap gives a heart and a few happy seconds, then she goes back to sleep', () => {
  const { day } = houses();
  day.pet();
  assert.equal(day.mood, 'connected');
  assert.equal(day.hearts.length, 1);
  for (let i = 0; i < 40; i++) day.tick();
  assert.equal(day.mood, 'sleep');
  assert.equal(day.hearts.length, 0);
  const out = new Uint8ClampedArray(day.g.w * day.g.h * 4);
  day.render(out, { cat: false });
  assert.ok(
    out.some((value) => value > 0),
    'the house draws without her too',
  );
});

test('in the Android app she sits up while a computer is ready to connect, without opening the garage', () => {
  const { day } = houses(),
    settle = () => {
      for (let i = 0; i < 40; i++) day.tick();
    };
  day.setState({ ready: true });
  settle();
  assert.equal(day.mood, 'sharing', 'she sits up, grooming');
  assert.equal(day.door, 0, 'the garage stays closed');
  assert.equal(day.gate, 0, 'and the gates');
  day.setState({ sharing: true });
  settle();
  assert.equal(day.door, 1);
  day.setState({ sharing: false, ready: false });
  settle();
  assert.equal(day.mood, 'sleep');
});
