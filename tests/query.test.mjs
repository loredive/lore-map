// node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuery } from "../web/search.js";

test("a plain query is left untouched", () => {
  const q = parseQuery("qui a assassiné Godwyn");
  assert.equal(q.text, "qui a assassiné Godwyn");
  assert.deepEqual([q.phrases, q.must, q.mustNot, q.cats], [[], [], [], []]);
  assert.equal(parseQuery("Demi-human Boc").text, "Demi-human Boc");   // un tiret dans un mot n'exclut rien
});

test("quotes, plus, minus and dans: become constraints", () => {
  const q = parseQuery('"Destined Death" Godwyn + Ranni -Malenia dans:armes');
  assert.deepEqual(q.phrases, ["destined death"]);
  assert.deepEqual(q.must, ["godwyn", "ranni"]);
  assert.deepEqual(q.mustNot, ["malenia"]);
  assert.deepEqual(q.cats, ["armes"]);
  assert.equal(q.text, "Destined Death");          // ce qui sert au classement : la phrase, sans les contraintes
});

test("a leading plus requires a single term", () => {
  const q = parseQuery("lune +Rennala");
  assert.deepEqual(q.must, ["rennala"]);
  assert.equal(q.text, "lune");
});

test("constraints use entity mentions for known names, words otherwise", async () => {
  const { satisfies, fold } = await import("../web/search.js");
  const texts = ["Black Knife. Assassins who murdered Godwyn the Golden.", "Ranni's ring. A cold oath.",
                 "Rennala's robe. Queen of the Full Moon."];
  const folded = texts.map(fold), cats = ["armes", "objets", "armures"];
  const entities = { godwyn: new Set([0]), ranni: new Set([1]) };      // textes qui mentionnent l'entité
  const run = q => texts.map((_, i) => i).filter(i => satisfies(i, folded[i], cats[i], parseQuery(q), t => entities[t] || null));
  assert.deepEqual(run("+Godwyn"), [0]);
  assert.deepEqual(run("-Ranni"), [0, 2]);
  assert.deepEqual(run('"full moon"'), [2]);
  assert.deepEqual(run("+queen dans:armures"), [2]);        // mot ordinaire, début de mot
  assert.deepEqual(run("+que"), [2]);                         // « que » prend « queen »…
  assert.deepEqual(run("dans:armes dans:objets"), [0, 1]);   // plusieurs catégories : l'une ou l'autre
});
