// La page d'accueil (web/galaxy.js) : quel écran au démarrage, où va chaque constellation, et le vol.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseStart, layoutGalaxy, landingFrame, flightAt, FLIGHT_MS } from "../web/galaxy.js";
import { startCamera, setViewport, toScreen } from "../web/camera.js";

const GAMES = ["bloodborne", "dark-souls-1", "dark-souls-2", "dark-souls-3", "elden-ring"];
const start = (search, hash = "") => chooseStart({ search, hash, games: GAMES, fallback: "bloodborne" });

test("the galaxy shows only when the address names no known game and no page", () => {
  assert.deepEqual(start(""), { screen: "galaxy" });
  assert.deepEqual(start("?game=elden-ring"), { screen: "map", game: "elden-ring" });
  assert.deepEqual(start("?jeu=dark-souls-3"), { screen: "map", game: "dark-souls-3" });
  assert.deepEqual(start("?game=nope"), { screen: "galaxy" });
  assert.deepEqual(start("?game=nope", "#text=X"), { screen: "map", game: "bloodborne" });
  assert.deepEqual(start("", "#text=X"), { screen: "map", game: "bloodborne" });
  assert.deepEqual(start("", "#"), { screen: "galaxy" });
});

const SKIES = [
  { id: "bloodborne", n: 591, year: 2015 },
  { id: "dark-souls-1", n: 978, year: 2011 },
  { id: "dark-souls-2", n: 1514, year: 2014 },
  { id: "dark-souls-3", n: 1300, year: 2016 },
  { id: "elden-ring", n: 3049, year: 2022 },
];
const DESKTOP = { width: 1280, height: 800, top: 70 };
const PHONE = { width: 390, height: 844, top: 110 };

function checkLayout(skies, view) {
  const places = layoutGalaxy(skies, view);
  assert.equal(places.length, skies.length);
  for (const p of places) {
    assert.ok(p.r > 0, `${p.id} has a size`);
    assert.ok(p.cx - p.r >= 0 && p.cx + p.r <= view.width, `${p.id} fits across`);
    assert.ok(p.cy - p.r >= view.top && p.cy + p.r <= view.height, `${p.id} fits down`);
  }
  for (let i = 0; i < places.length; i++) for (let j = i + 1; j < places.length; j++) {
    const a = places[i], b = places[j];
    assert.ok(Math.hypot(a.cx - b.cx, a.cy - b.cy) >= a.r + b.r, `${a.id} overlaps ${b.id}`);
  }
  return places;
}

for (const [name, view] of [["desktop", DESKTOP], ["phone", PHONE]]) {
  test(`constellations on a ${name} come in release order, apart, inside, sized by their texts`, () => {
    const places = checkLayout(SKIES, view);
    assert.deepEqual(places.map(p => p.id), ["dark-souls-1", "dark-souls-2", "bloodborne", "dark-souls-3", "elden-ring"]);
    const r = Object.fromEntries(places.map(p => [p.id, p.r]));
    assert.equal(Math.max(...Object.values(r)), r["elden-ring"]);
    assert.equal(Math.min(...Object.values(r)), r.bloodborne);
  });
  test(`one or two constellations on a ${name} also fit`, () => {
    checkLayout(SKIES.slice(0, 1), view);
    checkLayout(SKIES.slice(0, 2), view);
  });
}

test("the flight lands exactly on the map's first frame (camera.js)", () => {
  for (const view of [DESKTOP, PHONE]) {
    startCamera({ onChange() {}, cancelFrame() {}, requestFrame() {}, now: () => 0 });
    setViewport(view);
    const f = landingFrame(view);
    for (const [x, y] of [[0, 0], [1, 0], [-0.5, 0.7]]) {
      const [sx, sy] = toScreen(x, y);
      assert.ok(Math.abs(sx - (f.cx + x * f.k)) < 1e-9 && Math.abs(sy - (f.cy - y * f.k)) < 1e-9, `${x},${y}`);
    }
  }
});

test("the flight starts on the constellation, ends on the map, and only zooms in", () => {
  assert.equal(FLIGHT_MS, 2200);
  const from = { cx: 100, cy: 600, k: 60 }, to = { cx: 640, cy: 435, k: 321 };
  assert.deepEqual(flightAt(0, from, to), from);
  const end = flightAt(1, from, to);
  for (const key of ["cx", "cy", "k"]) assert.ok(Math.abs(end[key] - to[key]) < 1e-9, key);
  let k = 0;
  for (let i = 0; i <= 10; i++) {
    const now = flightAt(i / 10, from, to).k;
    if (i) assert.ok(now > k, `step ${i}`);
    k = now;
  }
  const mid = flightAt(0.5, from, to);
  assert.ok(Math.abs(mid.cx - 370) < 1e-9 && Math.abs(mid.cy - 517.5) < 1e-9);
});
