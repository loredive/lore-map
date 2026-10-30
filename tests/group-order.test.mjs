// L'ordre des textes dans la page d'un groupe (group-order.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupOrder } from "../web/group-order.js";

// d : un texte à une distance du cœur du groupe ; speaker et part comme lore.js les lit
const text = (name, dist) => ({ name, dist, speaker: null, part: null });
const said = (speaker, part, dist) => ({ name: `${speaker} — passage ${part}`, dist, speaker, part });
const order = docs => groupOrder(docs, d => d.dist);
const names = rows => rows.map(r => r.doc.name);

test("the texts closest to the core come first", () => {
  assert.deepEqual(names(order([text("Far", 3), text("Near", 1), text("Middle", 2)])), ["Near", "Middle", "Far"]);
});

test("a speaker's passages stay together, in the order the game speaks them", () => {
  const rows = order([said("Melina", 8, 1), text("Torrent", 2), said("Narrator", 1, 3),
                      said("Melina", 2, 4), said("Melina", 5, 5)]);
  assert.deepEqual(names(rows), ["Melina — passage 2", "Melina — passage 5", "Melina — passage 8",
                                 "Torrent", "Narrator — passage 1"]);
});

test("a speaker with several passages gets a heading on its first one", () => {
  const rows = order([said("Melina", 8, 1), said("Narrator", 1, 2), said("Melina", 2, 3)]);
  assert.deepEqual(rows.map(r => r.heading), [{ speaker: "Melina", n: 2 }, null, null]);
});
