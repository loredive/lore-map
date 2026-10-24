// La recherche ne doit pas régresser sous le seuil de eval/queries.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { evaluate } from "../eval/search_eval.mjs";

const ready = existsSync(new URL("../eval/query_vectors.json", import.meta.url));

test("hybrid search stays above the eval threshold", { skip: !ready && "lancer d'abord eval/embed_queries.py" }, () => {
  const { minHit, summary } = evaluate();
  assert.ok(summary.tout["fusion"].hit >= minHit,
            `réussite ${(100 * summary.tout["fusion"].hit).toFixed(0)} % < seuil ${(100 * minHit).toFixed(0)} %`);
});
