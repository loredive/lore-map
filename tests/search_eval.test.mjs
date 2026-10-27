// La recherche ne doit pas régresser sous le seuil de games/<jeu>/eval/queries.json, pour chaque jeu
// qui a des requêtes d'évaluation et des données.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { evaluate } from "../eval/search_eval.mjs";

const games = readdirSync(new URL("../games/", import.meta.url)).filter(g =>
  existsSync(new URL(`../games/${g}/eval/queries.json`, import.meta.url)));

for (const game of games) {
  const ready = existsSync(new URL(`../games/${game}/eval/query_vectors.json`, import.meta.url))
    && existsSync(new URL(`../web/data/${game}/lore.json`, import.meta.url));
  test(`hybrid search stays above the eval threshold (${game})`,
       { skip: !ready && `lancer d'abord eval/embed_queries.py --game ${game}` }, () => {
    const { minHit, minMrr, summary } = evaluate(game);
    assert.ok(summary.tout["fusion"].hit >= minHit,
              `réussite ${(100 * summary.tout["fusion"].hit).toFixed(0)} % < seuil ${(100 * minHit).toFixed(0)} %`);
    // le classement aussi : la réussite@10 sature vite, le MRR bouge encore
    assert.ok(summary.tout["fusion"].mrr >= minMrr,
              `MRR ${summary.tout["fusion"].mrr.toFixed(3)} < seuil ${minMrr.toFixed(3)}`);
  });
}
