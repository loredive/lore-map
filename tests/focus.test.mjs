// Le focus de la carte (web/focus.js) : ce qui s'éteint, ce qui reste dessiné, ce qu'il faut recadrer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isQuiet, dimmer, showsHulls, showsHistory, showsGroupNames, cloudOpacity, focusStars } from "../web/focus.js";

// six textes : 0-2 dans le groupe 0, 3-5 dans le groupe 1 ; 0 a pour échos 1 et 4
const docs = [0, 1, 2, 3, 4, 5].map(i => ({ i, x: i, y: -i, cluster: i < 3 ? 0 : 1, echoes: i === 0 ? [1, 4] : [] }));
const group1 = { id: 1 };
const base = { docs, selected: -1, hits: null, cluster: null, entity: null, lit: null, path: null, pathSet: null };
const state = over => ({ ...base, ...over });
const dimmed = s => docs.filter(dimmer(s)).map(d => d.i);

test("a map with nothing open is quiet, anything open is not", () => {
  assert.equal(isQuiet(state()), true);
  for (const over of [{ selected: 0 }, { hits: new Map([[2, 0]]) }, { lit: new Set([1]) }, { cluster: group1 },
    { path: [0, 3], pathSet: new Set([0, 3]) }]) assert.equal(isQuiet(state(over)), false, JSON.stringify(Object.keys(over)));
  // une entité seule allume ses textes par lit, c'est lit qui compte
  assert.equal(isQuiet(state({ entity: { docs: [1] } })), true);
});

test("an open text keeps itself and its echoes lit, and wins over a group", () => {
  assert.deepEqual(dimmed(state({ selected: 0 })), [2, 3, 5]);
  assert.deepEqual(dimmed(state({ selected: 0, cluster: group1 })), [2, 3, 5]);
});

test("without an open text, a group or lit texts keep only theirs", () => {
  assert.deepEqual(dimmed(state({ cluster: group1 })), [0, 1, 2]);
  assert.deepEqual(dimmed(state({ lit: new Set([2, 5]) })), [0, 1, 3, 4]);
});

test("a path or search results keep only their texts, even with an open text", () => {
  assert.deepEqual(dimmed(state({ path: [0, 3], pathSet: new Set([0, 3]) })), [1, 2, 4, 5]);
  assert.deepEqual(dimmed(state({ hits: new Map([[1, 0], [5, 1]]) })), [0, 2, 3, 4]);
  assert.deepEqual(dimmed(state({ selected: 0, hits: new Map([[1, 0]]) })), [0, 2, 3, 4, 5]);
  assert.deepEqual(dimmed(state()), []);
});

test("hulls, History and group names step aside for what draws its own", () => {
  const hits = { hits: new Map([[1, 0]]) }, path = { path: [0], pathSet: new Set([0]) };
  for (const f of [showsHulls, showsHistory]) {
    assert.equal(f(state()), true);
    assert.equal(f(state(hits)), false);
    assert.equal(f(state(path)), false);
    assert.equal(f(state({ selected: 0 })), true);
  }
  assert.equal(showsGroupNames(state()), true);
  for (const over of [hits, path, { selected: 0 }, { entity: { docs: [] } }]) assert.equal(showsGroupNames(state(over)), false);
  assert.equal(showsGroupNames(state({ cluster: group1 })), true);
});

test("clouds fade more as the focus gets more precise", () => {
  assert.equal(cloudOpacity(state(), false), 0.72);
  assert.equal(cloudOpacity(state({ cluster: group1 }), false), 0.25);
  assert.equal(cloudOpacity(state({ lit: new Set([1]) }), false), 0.4);
  assert.equal(cloudOpacity(state({ cluster: group1 }), true), 1);
  assert.equal(cloudOpacity(state({ selected: 0 }), false), 0.72);   // un texte seul ne voile pas les nuages
});

test("a layout switch reframes the open text, path, group or entity", () => {
  assert.equal(focusStars(state()), null);
  assert.deepEqual(focusStars(state({ selected: 2, cluster: group1 })), { doc: docs[2] });
  assert.deepEqual(focusStars(state({ path: [4, 0], pathSet: new Set([4, 0]), cluster: group1 })), { points: [docs[4], docs[0]], trim: 0 });
  assert.deepEqual(focusStars(state({ cluster: group1 })), { points: docs.slice(3), trim: 0.1 });
  assert.deepEqual(focusStars(state({ entity: { docs: [5, 1] } })), { points: [docs[5], docs[1]], trim: 0.1 });
});
