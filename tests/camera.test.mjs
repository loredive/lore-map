// La caméra, par son interface seulement : une partie visible factice, des crochets factices et une
// horloge factice (pas de DOM).
import { test } from "node:test";
import assert from "node:assert/strict";
import { startCamera, setViewport, camera, toScreen, toWorld, panBy, zoomAt, canZoom, flyTo, fitPoints, focusDoc, frameFrom, visibleBox, viewCenter } from "../web/camera.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const nearXY = (a, b, eps) => { near(a[0], b[0], eps); near(a[1], b[1], eps); };

// démarre la caméra avec des faux : area() donne la partie visible (null : tout l'écran sous la barre),
// tick(ms) avance l'horloge et joue l'image demandée, s'il y en a une
function start({ width = 1200, height = 800, top = 60, area = null, reducedMotion = false } = {}) {
  const log = [];
  let t = 1000, next = null, id = 0;
  const clock = {
    area,
    tick(ms = 16) {
      t += ms;
      const f = next; next = null;
      f?.(t);
    },
    flying: () => next !== null,
  };
  startCamera({
    visibleArea: () => clock.area,
    onChange: () => log.push("change"),
    onFrame: () => log.push("frame"),
    requestFrame: f => { next = f; return ++id; },
    cancelFrame: n => { if (n === id) next = null; },
    now: () => t,
    reducedMotion,
  });
  setViewport({ width, height, top });
  log.length = 0;
  return { log, clock };
}

// un vol jusqu'au bout
const land = clock => { for (let i = 0; i < 200 && clock.flying(); i++) clock.tick(); };

test("toScreen and toWorld undo each other, at several zooms and viewports", () => {
  for (const [width, height, top] of [[1200, 800, 60], [390, 844, 110], [1920, 1080, 0]]) {
    start({ width, height, top });
    for (const s of [0.6, 1, 3.7, 80]) {
      flyTo(0.3, -0.2, s, 0);
      for (const [x, y] of [[0, 0], [0.5, -0.4], [-1.2, 2]]) {
        nearXY(toWorld(...toScreen(x, y)), [x, y], 1e-9);
        nearXY(toScreen(...toWorld(x * 100, y * 100)), [x * 100, y * 100], 1e-6);
      }
    }
  }
});

test("the snapshot gives plain numbers, and the camera's centre sits mid-screen under the bar", () => {
  start({ width: 1000, height: 700, top: 100 });
  flyTo(0.2, 0.1, 2, 0);
  const c = camera();
  assert.deepEqual(c, { x: 0.2, y: 0.1, s: 2, k: 2 * 600 * 0.44, base: 600 * 0.44, width: 1000, height: 700, cy: 400, top: 100 });
  nearXY(toScreen(0.2, 0.1), [500, 400]);
  c.x = 5;                                         // une copie : la modifier ne bouge rien
  assert.equal(camera().x, 0.2);
});

test("zoomAt keeps the point under the cursor fixed and clamps to 0.6–80", () => {
  start();
  const p = toWorld(300, 200);
  zoomAt(300, 200, 2.5);
  nearXY(toScreen(...p), [300, 200]);
  assert.equal(camera().s, 2.5);
  zoomAt(300, 200, 1000);
  assert.equal(camera().s, 80);
  nearXY(toScreen(...p), [300, 200], 1e-4);
  zoomAt(900, 700, 1e-6);
  assert.equal(camera().s, 0.6);
});

test("canZoom agrees with the clamp", () => {
  start();
  flyTo(0, 0, 10, 0);
  assert.equal(canZoom(8), true);                 // 80 : la limite elle-même
  assert.equal(canZoom(8.01), false);
  assert.equal(canZoom(0.06), true);              // 0.6
  assert.equal(canZoom(0.05), false);
  for (const f of [2, 8, 9, 0.06, 0.05]) {
    flyTo(0, 0, 10, 0);
    const ok = canZoom(f);
    zoomAt(600, 400, f);
    assert.equal(camera().s === 10 * f, ok, `factor ${f}`);
  }
});

test("panBy moves a point on screen by exactly the pixels given", () => {
  start();
  for (const s of [0.7, 1, 12]) {
    flyTo(0.1, 0.2, s, 0);
    const before = toScreen(0.4, -0.3);
    panBy(80, -35);
    nearXY(toScreen(0.4, -0.3), [before[0] + 80, before[1] - 35]);
  }
});

test("every one-off move calls onChange", () => {
  const { log } = start();
  panBy(10, 0);
  zoomAt(10, 10, 1.3);
  flyTo(0, 0, 2, 0);
  setViewport({ width: 800, height: 600, top: 40 });
  frameFrom([{ x: 0, y: 0 }]);                    // déjà visible : rien ne bouge, on redessine
  assert.deepEqual(log, ["change", "change", "change", "change", "change"]);
});

test("visibleBox falls back to the screen under the bar; viewCenter is its centre", () => {
  const { clock } = start({ width: 1200, height: 800, top: 60 });
  assert.deepEqual(visibleBox(), { top: 60, right: 1200, bottom: 800 });
  assert.deepEqual(viewCenter(), [600, 430]);
  clock.area = { top: 60, right: 800, bottom: 800 };
  assert.deepEqual(viewCenter(), [400, 430]);
});

// les trois dispositions : panneau ouvert sur grand écran (à droite), sur téléphone (en bas), fermé
const LAYOUTS = {
  "desktop, panel open": { width: 1200, height: 800, top: 60, area: { top: 60, right: 780, bottom: 800 } },
  "phone, panel open": { width: 390, height: 844, top: 110, area: { top: 110, right: 390, bottom: 470 } },
  "panel closed": { width: 1200, height: 800, top: 60, area: { top: 60, right: 1200, bottom: 800 } },
};

for (const [name, layout] of Object.entries(LAYOUTS)) {
  test(`focusDoc puts the point at the centre of the visible area (${name})`, () => {
    const { clock } = start(layout);
    const { top, right, bottom } = layout.area;
    focusDoc({ x: 0.7, y: -0.4 }, 5);
    land(clock);
    assert.equal(camera().s, 5);
    nearXY(toScreen(0.7, -0.4), [right / 2, (top + bottom) / 2]);
  });
}

test("focusDoc keeps the zoom when s is omitted", () => {
  const { clock } = start(LAYOUTS["desktop, panel open"]);
  flyTo(0, 0, 3.3, 0);
  focusDoc({ x: 0.2, y: 0.2 });
  land(clock);
  near(camera().s, 3.3, 1e-12);
  nearXY(toScreen(0.2, 0.2), [390, 430]);
});

test("fitPoints puts every kept point on screen and respects trim and maxScale", () => {
  const { clock } = start(LAYOUTS["desktop, panel open"]);
  const { top, right, bottom } = LAYOUTS["desktop, panel open"].area;
  const onScreen = p => { const [x, y] = toScreen(p.x, p.y); return x >= 0 && x <= right && y >= top && y <= bottom; };
  const pts = Array.from({ length: 21 }, (_, i) => ({ x: -0.5 + i * 0.05, y: 0.3 - i * 0.02 }));
  const far = [{ x: 30, y: 30 }, { x: -30, y: -30 }];

  fitPoints(pts, 0);
  land(clock);
  assert.ok(pts.every(onScreen));

  // trim : les deux isolés, hors des quantiles, ne tirent pas le cadre (sinon il dézoomerait jusqu'à 0.8)
  fitPoints([...pts, ...far], 0.1);
  land(clock);
  assert.ok(camera().s > 1);
  const sorted = [...pts].sort((a, b) => a.x - b.x);
  assert.ok(sorted.slice(3, -3).every(onScreen));
  assert.ok(!far.some(onScreen));

  // maxScale : quelques étoiles serrées zoomeraient fort ; jamais plus que maxScale, ni que 12
  const tight = [{ x: 0, y: 0 }, { x: 0.001, y: 0.001 }];
  fitPoints(tight, 0, 4);
  land(clock);
  assert.equal(camera().s, 4);
  fitPoints(tight, 0);
  land(clock);
  assert.equal(camera().s, 12);
  fitPoints(far, 0);                              // très étalés : jamais moins de 0.8
  land(clock);
  assert.equal(camera().s, 0.8);
});

test("frameFrom doesn't move when every point is already visible", () => {
  const { log, clock } = start(LAYOUTS["desktop, panel open"]);
  flyTo(0, 0, 2, 0);
  log.length = 0;
  const pts = [toWorld(300, 300), toWorld(500, 600)].map(([x, y]) => ({ x, y }));
  frameFrom(pts);
  assert.equal(clock.flying(), false);
  assert.deepEqual(camera(), { ...camera(), x: 0, y: 0, s: 2 });
  assert.deepEqual(log, ["change"]);
});

test("frameFrom never zooms in otherwise, and brings the points into view", () => {
  const { clock } = start(LAYOUTS["desktop, panel open"]);
  const { top, right, bottom } = LAYOUTS["desktop, panel open"].area;
  flyTo(0, 0, 2, 0);
  const close = [toWorld(1000, 300), toWorld(1010, 310)].map(([x, y]) => ({ x, y }));   // sous le panneau
  frameFrom(close);
  land(clock);
  assert.equal(camera().s, 2);                    // serrées : fitPoints zoomerait, frameFrom non
  for (const p of close) {
    const [x, y] = toScreen(p.x, p.y);
    assert.ok(x > 0 && x < right && y > top && y < bottom);
  }
  frameFrom([{ x: -3, y: 0 }, { x: 3, y: 0 }]);   // trop loin l'un de l'autre : on recule
  land(clock);
  assert.ok(camera().s < 2);
});

test("a flight ends exactly on its target and calls onFrame on each frame", () => {
  const { log, clock } = start();
  flyTo(0.5, -0.25, 6.3, 160);
  assert.deepEqual(log, []);                      // rien avant la première image
  let frames = 0, s0 = camera().s;
  while (clock.flying()) {
    clock.tick(16);
    frames++;
    assert.equal(log.length, frames);
    assert.ok(camera().s >= s0);                  // zoom monotone
    s0 = camera().s;
  }
  assert.ok(log.every(e => e === "frame"));
  assert.equal(frames, 10);
  assert.deepEqual([camera().x, camera().y, camera().s], [0.5, -0.25, 6.3]);
});

test("a new flight cancels the one in progress", () => {
  const { clock } = start();
  flyTo(1, 1, 4, 300);
  clock.tick(); clock.tick();
  flyTo(-1, 0, 2, 300);
  land(clock);
  assert.deepEqual([camera().x, camera().y, camera().s], [-1, 0, 2]);
  flyTo(1, 1, 4, 300);
  clock.tick();
  flyTo(0, 0, 1, 0);                              // un saut annule aussi le vol en cours
  assert.equal(clock.flying(), false);
  clock.tick();
  assert.deepEqual([camera().x, camera().y, camera().s], [0, 0, 1]);
});

test("with reduced motion, or ms <= 0, the camera jumps straight to the target", () => {
  for (const [reducedMotion, ms] of [[true, 650], [false, 0], [false, -5]]) {
    const { log, clock } = start({ reducedMotion });
    flyTo(0.3, 0.4, 7, ms);
    assert.equal(clock.flying(), false);
    assert.deepEqual([camera().x, camera().y, camera().s], [0.3, 0.4, 7]);
    assert.deepEqual(log, ["change"]);
  }
});

test("the camera starts at the centre, at zoom 1, and a new start forgets the old position", () => {
  start();
  flyTo(0.1, 0.2, 3, 0);
  start();
  const { x, y, s } = camera();
  assert.deepEqual({ x, y, s }, { x: 0, y: 0, s: 1 });
});
