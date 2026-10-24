// Évaluation de la recherche de la page : pour chaque requête de queries.json, rang du premier
// texte attendu par mots-clés, par sens et après fusion, puis taux de réussite et MRR.
// Usage : node eval/search_eval.mjs   (après uv run python eval/embed_queries.py)
import { readFileSync } from "node:fs";
import { BM25, corpusText, lexicalRanking, semanticRanking, hybridRanking } from "../web/search.js";

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

const methods = { "mots-clés": [], "sens": [], "fusion": [] };
const rows = [];
for (const q of queries) {
  const qv = vectors[q.query];
  if (!qv) throw new Error(`pas d'embedding pour « ${q.query} » : relancer eval/embed_queries.py`);
  const lexical = lexicalRanking(bm25, q.query);
  const ranks = {
    "mots-clés": firstHit(lexical, q),
    "sens": firstHit(semanticRanking(qv, emb, meta.dim), q),
    "fusion": firstHit(hybridRanking(lexical, qv, emb, meta.dim), q),
  };
  for (const m in ranks) methods[m].push(ranks[m]);
  rows.push([q.query, ranks]);
}

const show = r => (r === null ? "—" : r <= k ? String(r) : `(${r})`).padStart(5);
console.log(`${"requête".padEnd(44)}${Object.keys(methods).map(m => m.padStart(11)).join("")}`);
for (const [query, ranks] of rows) {
  console.log(`${query.slice(0, 43).padEnd(44)}${Object.values(ranks).map(r => show(r).padStart(11)).join("")}`);
}
const summary = Object.fromEntries(Object.entries(methods).map(([m, rs]) => [m, {
  hit: rs.filter(r => r !== null && r <= k).length / rs.length,
  mrr: rs.reduce((s, r) => s + (r !== null && r <= k ? 1 / r : 0), 0) / rs.length,
}]));
console.log(`\nréussite@${k} : ` + Object.entries(summary).map(([m, s]) => `${m} ${(100 * s.hit).toFixed(0)} %`).join(" · "));
console.log(`MRR@${k}      : ` + Object.entries(summary).map(([m, s]) => `${m} ${s.mrr.toFixed(3)}`).join(" · "));
if (summary["fusion"].hit < minHit) {
  console.error(`\nÉCHEC : réussite de la fusion ${(100 * summary["fusion"].hit).toFixed(0)} % < seuil ${(100 * minHit).toFixed(0)} %`);
  process.exit(1);
}
