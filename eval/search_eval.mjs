// Évaluation de la recherche de la page : pour chaque requête de queries.json, rang du premier
// texte attendu par mots-clés, par sens et après fusion, puis taux de réussite et MRR par lot.
// Usage : node eval/search_eval.mjs   (après uv run python eval/embed_queries.py)
// Aussi lancée par node --test (tests/search_eval.test.mjs).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BM25, corpusText, lexicalRanking, semanticRanking, hybridRanking } from "../web/search.js";

const METHODS = ["mots-clés", "sens", "fusion"];

export function evaluate() {
  const root = new URL("..", import.meta.url);
  const read = p => readFileSync(new URL(p, root));
  const lore = JSON.parse(read("web/data/lore.json"));
  const meta = JSON.parse(read("web/data/meta.json"));
  const { k, queries, min_hit_rate: minHit = 0 } = JSON.parse(read("eval/queries.json"));
  const vectors = JSON.parse(read("eval/query_vectors.json"));
  const buf = read("web/data/emb.bin");
  const emb = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);

  const nameAt = lore.fields.indexOf("name"), textAt = lore.fields.indexOf("text");
  const docs = lore.docs.map(r => ({ name: r[nameAt], text: r[textAt] }));
  const bm25 = new BM25(docs.map(corpusText));

  // rang (1 = premier) du premier texte attendu, ou null s'il n'est pas dans la liste
  function firstHit(ranking, q) {
    const ok = n => q.expect.includes(n) || q.expect_prefix.some(p => n.startsWith(p));
    const r = ranking.findIndex(([i]) => ok(docs[i].name));
    return r < 0 ? null : r + 1;
  }

  const rows = queries.map(q => {
    const qv = vectors[q.query];
    if (!qv) throw new Error(`pas d'embedding pour « ${q.query} » : relancer eval/embed_queries.py`);
    const lexical = lexicalRanking(bm25, q.query);
    return { query: q.query, split: q.split || "dev", ranks: {
      "mots-clés": firstHit(lexical, q),
      "sens": firstHit(semanticRanking(qv, emb, meta.dim), q),
      "fusion": firstHit(hybridRanking(lexical, qv, emb, meta.dim), q),
    } };
  });
  const score = list => Object.fromEntries(METHODS.map(m => {
    const rs = list.map(r => r.ranks[m]);
    return [m, { hit: rs.filter(r => r !== null && r <= k).length / rs.length,
                 mrr: rs.reduce((s, r) => s + (r !== null && r <= k ? 1 / r : 0), 0) / rs.length }];
  }));
  const splits = [...new Set(rows.map(r => r.split))];
  const summary = { tout: score(rows), ...Object.fromEntries(splits.map(s => [s, score(rows.filter(r => r.split === s))])) };
  return { k, minHit, rows, summary };
}

function report({ k, minHit, rows, summary }) {
  const show = r => (r === null ? "—" : r <= k ? String(r) : `(${r})`);
  console.log(`${"requête".padEnd(50)}${"lot".padEnd(6)}${METHODS.map(m => m.padStart(11)).join("")}`);
  for (const { query, split, ranks } of rows) {
    console.log(`${query.slice(0, 49).padEnd(50)}${split.padEnd(6)}${METHODS.map(m => show(ranks[m]).padStart(11)).join("")}`);
  }
  for (const [name, s] of Object.entries(summary)) {
    console.log(`\n${name} — réussite@${k} : ` + METHODS.map(m => `${m} ${(100 * s[m].hit).toFixed(0)} %`).join(" · ") +
                `\n${" ".repeat(name.length)}   MRR@${k}      : ` + METHODS.map(m => `${m} ${s[m].mrr.toFixed(3)}`).join(" · "));
  }
  if (summary.tout["fusion"].hit < minHit) {
    console.error(`\nÉCHEC : réussite de la fusion ${(100 * summary.tout["fusion"].hit).toFixed(0)} % < seuil ${(100 * minHit).toFixed(0)} %`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) report(evaluate());
