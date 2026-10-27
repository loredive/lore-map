import { test } from "node:test";
import assert from "node:assert/strict";
import { push, previousDoc, docKeys, recentDocs, serialize, parse } from "../web/trail.js";

const doc = key => ({ kind: "doc", key }), ent = key => ({ kind: "entity", key });

test("the same step twice in a row is kept once, and the trail is capped", () => {
  let t = [];
  for (const s of [doc("A"), doc("A"), ent("Ludwig"), doc("A")]) t = push(t, s);
  assert.deepEqual(t, [doc("A"), ent("Ludwig"), doc("A")]);
  assert.deepEqual(push([doc("A"), doc("B")], doc("C"), 2), [doc("B"), doc("C")]);
});

test("previous text is the last text before the current step", () => {
  assert.equal(previousDoc([doc("A")]), null);
  assert.equal(previousDoc([doc("A"), ent("Ludwig")]), "A");          // un nom ouvert depuis A
  assert.equal(previousDoc([doc("A"), ent("Ludwig"), doc("B")]), "A");
});

test("texts read and the recent thread", () => {
  const t = [doc("A"), ent("X"), doc("B"), doc("A"), doc("C")];
  assert.deepEqual([...docKeys(t)], ["A", "B", "C"]);
  assert.deepEqual(recentDocs(t), ["A", "B", "A", "C"]);
  assert.deepEqual(recentDocs(t, 2), ["A", "C"]);
});

test("saved trails round-trip, and bad data gives an empty trail", () => {
  assert.deepEqual(parse(serialize([doc("A"), ent("B")], false)), { steps: [doc("A"), ent("B")], shown: false });
  assert.deepEqual(parse("not json"), { steps: [], shown: true });
  assert.deepEqual(parse(JSON.stringify({ v: 1, steps: [doc("A"), { kind: "?", key: "x" }, { kind: "doc" }] })),
                   { steps: [doc("A")], shown: true });
});
