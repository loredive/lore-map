import { test } from "node:test";
import assert from "node:assert/strict";
import { echoGraph, echoPath } from "../web/graph.js";

// 0 -> 1 -> 2 -> 3 en chaîne ; 4 isolé ; 5 cite 3 (lien à sens unique, suivi dans les deux sens)
const echoes = [[1], [2], [3], [], [], [3]];

test("finds the shortest chain of echoes, following links both ways", () => {
  const adj = echoGraph(echoes);
  assert.deepEqual(echoPath(adj, 0, 3), [0, 1, 2, 3]);
  assert.deepEqual(echoPath(adj, 3, 0), [3, 2, 1, 0]);
  assert.deepEqual(echoPath(adj, 0, 5), [0, 1, 2, 3, 5]);
});

test("returns null when texts are not connected, and a single step for the same text", () => {
  const adj = echoGraph(echoes);
  assert.equal(echoPath(adj, 0, 4), null);
  assert.deepEqual(echoPath(adj, 2, 2), [2]);
});
