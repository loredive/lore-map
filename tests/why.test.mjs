import { test } from "node:test";
import assert from "node:assert/strict";
import { linkReason } from "../web/why.js";

const moon = { name: "Moon Presence", aliases: ["Paleblood"] };
const dream = { name: "Hunter's Dream" };
const erdtree = { name: "Erdtree", broad: true };

// 100 textes : les mots « blood » (dans 30 textes) et « hunter » (10) sont trop fréquents
const N = 100;
const df = new Map([["blood", 30], ["hunter", 10], ["moon", 2], ["presence", 2], ["paleblood", 3],
                    ["nightmare", 4], ["lumenwood", 1], ["chalice", 5], ["cord", 3]]);
const docTerms = [
  new Set(["blood", "hunter", "moon", "presence", "nightmare", "lumenwood", "chalice", "cord"]),
  new Set(["blood", "hunter", "moon", "presence", "nightmare", "lumenwood", "chalice", "cord"]),
  new Set(["blood"]),
];
const docEntities = [[moon, dream, erdtree], [erdtree, moon], [erdtree]];
const echoes = [[2, 1], [0], []];
const ctx = { docEntities, docTerms, df, N, echoes };

test("shares the named entities, but not the ones found everywhere", () => {
  assert.deepEqual(linkReason(0, 1, ctx).entities, [moon]);
});

test("keeps the rarest shared words, without the words of a shared name", () => {
  // moon / presence : déjà dans « Moon Presence » ; blood, hunter : trop fréquents
  assert.deepEqual(linkReason(0, 1, ctx).terms, ["lumenwood", "cord", "nightmare"]);
});

test("gives the echo rank in either direction, the closer one when both", () => {
  assert.equal(linkReason(0, 1, ctx).rank, 1);   // 0 a 1 en 2e, 1 a 0 en 1er
  assert.equal(linkReason(2, 0, ctx).rank, 1);   // seulement dans l'autre sens
  assert.equal(linkReason(1, 2, ctx).rank, null);
});

test("explains nothing when two texts share only common words", () => {
  const r = linkReason(0, 2, ctx);
  assert.deepEqual(r.entities, []);
  assert.deepEqual(r.terms, []);
});
