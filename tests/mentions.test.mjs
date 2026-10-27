import { test } from "node:test";
import assert from "node:assert/strict";
import { mentionSpans } from "../web/mentions.js";

const E = (name, extra = {}) => ({ name, aliases: [], ...extra });
const words = (text, ents) => mentionSpans(text, ents).map(([a, b, e]) => [text.slice(a, b), e.name]);

test("first mention of each entity, whole words, case-sensitive", () => {
  const ents = [E("Mohg"), E("Death")];
  assert.deepEqual(words("Mohgwyn's death. Mohg sought Death. Mohg again.", ents), [["Mohg", "Mohg"], ["Death", "Death"]]);
});

test("longer names win over the names they contain", () => {
  const ents = [E("Yharnam"), E("Old Yharnam")];
  assert.deepEqual(words("The fire of Old Yharnam spread to Yharnam.", ents),
                   [["Old Yharnam", "Old Yharnam"], ["Yharnam", "Yharnam"]]);
});

test("aliases, excluded phrases and broad entities", () => {
  const ents = [E("Willem", { aliases: ["Master Willem"] }), E("Torrent", { exclude: ["Crystal Torrent"] }),
                E("Nightmare", { broad: true })];
  assert.deepEqual(words("Master Willem rode Crystal Torrent, then Torrent, into the Nightmare.", ents),
                   [["Master Willem", "Willem"], ["Torrent", "Torrent"]]);
  assert.deepEqual(words("Vieux Yharnam brûle.", [E("Old Yharnam", { aliases: ["Vieux Yharnam"] })]),
                   [["Vieux Yharnam", "Old Yharnam"]]);       // lettres accentuées : mots entiers aussi
});
