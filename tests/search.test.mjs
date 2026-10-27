// node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { BM25, corpusText, rrf, tokenize } from "../web/search.js";

test("tokenize drops accents, stop words and possessives", () => {
  assert.deepEqual(tokenize("La Reine de la Pleine Lune, Rennala's"), ["reine", "pleine", "lune", "rennala"]);
});

test("rrf weights let one ranking outweigh the other", () => {
  const a = [[1], [2]], b = [[2], [1]];
  assert.equal(rrf([a, b], 60, [1, 1]).length, 2);
  assert.equal(rrf([a, b], 60, [0.5, 1])[0][0], 2);   // la liste b, plus lourde, l'emporte
  assert.equal(rrf([a, b], 60, [1, 0.5])[0][0], 1);
});

test("bm25 ranks a document naming the term above one that does not", () => {
  const bm = new BM25(["Godwyn the Golden was slain", "A sword of iron"]);
  assert.deepEqual(bm.search("godwyn").map(([i]) => i), [0]);
});

test("corpusText adds the second language only when a text has one", () => {
  assert.equal(corpusText({ name: "Rivers of Blood", text: "Weapon of Okina." }), "Rivers of Blood Rivers of Blood Weapon of Okina.");
  assert.equal(corpusText({ name: "Couperet-scie", text: "Une arme.", alt: "A weapon.", altName: "Saw Cleaver" }),
               "Couperet-scie Couperet-scie Une arme. Saw Cleaver Saw Cleaver A weapon.");
});
