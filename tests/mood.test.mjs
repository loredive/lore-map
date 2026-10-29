// L'humeur de la musique (web/mood.js) : le groupe au centre choisit la piste, un passage rapide ne la
// change pas, la lecture la baisse.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SETTLE_MS, READING_LEVEL, FADE_IN_S, CROSSFADE_S, DIM_S, MASTER, centerMood, createSettler, readingPage, targetLevel } from "../web/mood.js";

// deux groupes : A au centre (0, 0), B en (10, 0), chacun de rayon 1
const A = { id: 0, mood: "eerie", views: [{ x: 0, y: 0 }] };
const B = { id: 1, mood: "sacred", views: [{ x: 10, y: 0 }] };
const at = (x, y, over = {}) => centerMood({
  clusters: [A, B], k: 0, at: [x, y], radiusOf: () => 1, moodOf: c => c.mood,
  current: null, fallback: "calm", byCategory: false, ...over,
});

test("the values the design fixes", () => {
  assert.deepEqual([SETTLE_MS, READING_LEVEL, FADE_IN_S, CROSSFADE_S, DIM_S, MASTER], [1500, 0.25, 3.5, 4, 1.5, 0.35]);
});

test("the group at the centre sets the mood; empty sky keeps it; by category plays the default", () => {
  assert.equal(at(0.5, 0), "eerie");
  assert.equal(at(10, 0), "sacred");
  assert.equal(at(5, 0, { current: "sacred" }), "sacred");
  assert.equal(at(5, 0), "calm");
  assert.equal(at(0, 0, { byCategory: true }), "calm");
  assert.equal(at(10, 0, { byCategory: true, current: "sacred" }), "calm");
});

test("a new mood plays only once it has held for the settle time", () => {
  const settle = createSettler(1500);
  assert.equal(settle("eerie", 0), "eerie");
  assert.equal(settle("sacred", 100), "eerie");
  assert.equal(settle("sacred", 1500), "eerie");
  assert.equal(settle("sacred", 1600), "sacred");
});

test("a quick pan back and forth never switches the track", () => {
  const settle = createSettler(1500);
  assert.equal(settle("eerie", 0), "eerie");
  for (let now = 500, k = 0; now <= 6000; now += 500, k++)
    assert.equal(settle(k % 2 ? "eerie" : "sacred", now), "eerie", `at ${now}`);
});

test("only a text and a dialogue count as reading", () => {
  assert.equal(readingPage("doc"), true);
  assert.equal(readingPage("dialogue"), true);
  for (const name of ["cluster", "results", "tour", "tours", "entity", "path", "index", "help", "none", "", undefined])
    assert.equal(readingPage(name), false, String(name));
});

test("silent when off, before the first gesture or in a hidden tab; low while reading", () => {
  assert.equal(targetLevel({ on: false, started: true }), 0);
  assert.equal(targetLevel({ on: true, started: false }), 0);
  assert.equal(targetLevel({ on: true, started: true, hidden: true }), 0);
  assert.equal(targetLevel({ on: true, started: true, reading: true }), 0.25);
  assert.equal(targetLevel({ on: true, started: true }), 1);
});
