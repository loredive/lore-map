import { test } from "node:test";
import assert from "node:assert/strict";
import { shelves } from "../web/shelves.js";

// 2 catégories : la 1 (8 textes : 5 du groupe 0, 3 du groupe 1) et la 0 (4 textes, groupes 1 et 2 mêlés)
const docs = [
  ...["e", "a", "d", "b", "c"].map(name => ({ cat: 1, cluster: 0, name })),
  ...["x", "y", "z"].map(name => ({ cat: 1, cluster: 1, name })),
  { cat: 0, cluster: 1, name: "p" }, { cat: 0, cluster: 1, name: "q" },
  { cat: 0, cluster: 2, name: "r" }, { cat: 0, cluster: 2, name: "s" },
];

test("the largest category is the first column, and every text has its own cell", () => {
  const { pos, columns } = shelves(docs, 2);
  assert.deepEqual(columns.map(c => [c.cat, c.n]), [[1, 8], [0, 4]]);
  assert.ok(columns[0].x < columns[1].x);
  assert.equal(new Set(pos.map(p => p.join())).size, docs.length);
  for (const [x, y] of pos) assert.ok(Math.abs(x) <= 1.2 && Math.abs(y) <= 0.9);
});

test("texts are read by name inside a block, the biggest block on top", () => {
  const { pos } = shelves(docs, 2);
  const order = [0, 1, 2, 3, 4].sort((i, j) => pos[j][1] - pos[i][1] || pos[i][0] - pos[j][0]);
  assert.deepEqual(order.map(i => docs[i].name), ["a", "b", "c", "d", "e"]);
  assert.ok(Math.min(...[0, 1, 2, 3, 4].map(i => pos[i][1])) > Math.max(...[5, 6, 7].map(i => pos[i][1])));
});

test("a group's label sits on its largest block, cohesion is its share there", () => {
  const { clusters } = shelves(docs, 2);
  assert.equal(clusters.get(0).cohesion, 1);
  assert.deepEqual(clusters.get(1).block, [5, 6, 7]);
  assert.equal(clusters.get(1).cohesion, 3 / 5);
  // groupe 2 : deux textes seulement, partis au bloc divers ; pas de nom dans cette vue
  assert.equal(clusters.get(2).cohesion, 0);
});
