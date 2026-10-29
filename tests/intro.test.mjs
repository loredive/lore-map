// L'ouverture dans le brouillard (web/intro.js) : quand elle se joue, et l'ordre où les groupes apparaissent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { INTRO_MS, FADE_MS, introMode, fogLevel, introLevels, createIntro } from "../web/intro.js";

test("the intro plays on a plain load, fades with reduced motion, and never on a linked page", () => {
  assert.equal(INTRO_MS, 7000);
  assert.equal(FADE_MS, 400);
  assert.equal(introMode({ opened: true, reducedMotion: false }), "none");
  assert.equal(introMode({ opened: true, reducedMotion: true }), "none");
  assert.equal(introMode({ opened: false, reducedMotion: true }), "fade");
  assert.equal(introMode({ opened: false, reducedMotion: false }), "full");
});

test("the fog thins from full to nothing by 70% of the intro", () => {
  assert.equal(fogLevel(0), 1);
  assert.equal(fogLevel(0.7), 0);
  assert.equal(fogLevel(1), 0);
  const steps = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7].map(fogLevel);
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i] < steps[i - 1], `step ${i}`);
});

test("big groups surface first, stars after their cloud, names last", () => {
  assert.deepEqual(introLevels(0, 0, 10), { nebula: 0, stars: 0, names: 0 });
  assert.deepEqual(introLevels(1, 9, 10), { nebula: 1, stars: 1, names: 1 });
  assert.ok(introLevels(0.3, 0, 10).nebula > introLevels(0.3, 9, 10).nebula);
  for (const t of [0.1, 0.2, 0.3, 0.5, 0.7, 0.9]) for (let r = 0; r < 10; r++) {
    const l = introLevels(t, r, 10);
    assert.ok(l.stars <= l.nebula, `t=${t} rank=${r}`);
  }
  assert.equal(introLevels(0.74, 0, 10).names, 0);
  assert.equal(introLevels(0.95, 0, 10).names, 1);
  assert.equal(introLevels(0.35, 0, 1).nebula, 1);
});

test("the intro clock runs over its duration and a skip ends it at once", () => {
  const intro = createIntro(1000);
  assert.equal(intro.progress(1000), 0);
  assert.equal(intro.progress(1000 + 3500), 0.5);
  assert.equal(intro.progress(1000 + 99999), 1);
  const skipped = createIntro(1000);
  skipped.skip();
  assert.equal(skipped.progress(1001), 1);
});
