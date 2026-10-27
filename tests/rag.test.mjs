// node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { searchQuery, growPool, systemPrompt, citations } from "../web/rag.js";
import { readChunk } from "../web/llm.js";

const docs = [
  { name: "Laurence's Skull", cat: 0, text: "Skull of Laurence, first vicar." },
  { name: "Willem — passage 1", cat: 1, text: "Fear the old blood." },
  { name: "Blood Vial", cat: 0, text: "Restores HP." },
];
const cats = ["Items", "Dialogue"];

test("a follow-up question is searched together with the previous one", () => {
  const history = [{ role: "user", content: "Who was Laurence?" }, { role: "assistant", content: "The first vicar [1]." }];
  assert.equal(searchQuery("And Willem?", history), "And Willem?\nWho was Laurence?");
  assert.equal(searchQuery("Who was Laurence?", []), "Who was Laurence?");
});

test("the pool keeps its numbering, skips hidden texts and respects its limits", () => {
  const ranked = [[2, 9], [0, 8], [1, 7]];
  let pool = growPool([], ranked, i => i === 2, 2, 10);
  assert.deepEqual(pool, [0, 1]);                       // texte 2 masqué
  pool = growPool(pool, [[1, 5], [2, 4]], () => false, 2, 10);
  assert.deepEqual(pool, [0, 1, 2]);                    // 1 déjà là, garde sa place
  assert.deepEqual(growPool([0, 1], [[2, 1]], () => false, 5, 2), [0, 1]);   // réserve pleine
});

test("the system prompt numbers each text with its name and category", () => {
  const s = systemPrompt("Bloodborne", [1, 0], docs, cats);
  assert.match(s, /lore of Bloodborne/);
  assert.match(s, /\[1\] Willem — passage 1 \(Dialogue\)\nFear the old blood\./);
  assert.match(s, /\[2\] Laurence's Skull \(Items\)/);
});

test("citations are read in order, with lists and ranges, ignoring unknown numbers", () => {
  const pool = [10, 11, 12, 13];
  assert.deepEqual(citations("He was vicar [2]. See [1, 3] and [2-4]; not [9].", pool), [11, 10, 12, 13]);
  assert.deepEqual(citations("No sources.", pool), []);
});

test("OpenAI-style stream lines are read, and the end and noise are skipped", () => {
  assert.deepEqual(readChunk('data: {"model":"m","choices":[{"delta":{"content":"Hel"}}]}'), { text: "Hel", model: "m" });
  assert.deepEqual(readChunk('data: {"choices":[{"delta":{}}]}'), { text: "", model: undefined });
  assert.equal(readChunk("data: [DONE]"), null);
  assert.equal(readChunk(": OPENROUTER PROCESSING"), null);
  assert.equal(readChunk(""), null);
  assert.deepEqual(readChunk('data: {"error":{"message":"bad model"}}'), { error: "bad model" });
});
