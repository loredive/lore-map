// Recherche : BM25 (mots-clés) + similarité d'embeddings (sémantique), fusionnées par RRF.
// Fonctions pures, testables sous Node.

const STOP = new Set(("a an and are as at be by for from has have in into is it its of on or " +
  "that the their this to was were with which who whom thou thee thy le la les de des du un une " +
  "et est en au aux qui que quoi dans sur pour par ce ces son sa ses").split(" "));

export function tokenize(text) {
  return text.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // accents
    .replace(/[’']/g, "'")
    .split(/[^a-z0-9'-]+/)
    .map(t => t.replace(/^['-]+|['-]+$/g, "").replace(/'s$/, ""))
    .filter(t => t.length > 1 && !STOP.has(t));
}

export class BM25 {
  constructor(texts, { k1 = 1.2, b = 0.75 } = {}) {
    this.k1 = k1; this.b = b;
    this.docs = texts.map(t => {
      const tf = new Map();
      const toks = tokenize(t);
      for (const w of toks) tf.set(w, (tf.get(w) || 0) + 1);
      return { tf, len: toks.length };
    });
    this.N = this.docs.length;
    this.avgLen = this.docs.reduce((s, d) => s + d.len, 0) / Math.max(1, this.N);
    this.df = new Map();
    this.postings = new Map();
    this.docs.forEach((d, i) => {
      for (const w of d.tf.keys()) {
        this.df.set(w, (this.df.get(w) || 0) + 1);
        if (!this.postings.has(w)) this.postings.set(w, []);
        this.postings.get(w).push(i);
      }
    });
  }

  // Scores des documents contenant au moins un terme. Le dernier terme est
  // aussi traité comme préfixe, pour que la recherche réagisse pendant la frappe.
  search(query, { prefix = true } = {}) {
    const terms = tokenize(query);
    const scores = new Map();
    terms.forEach((q, qi) => {
      let words = this.postings.has(q) ? [q] : [];
      if (prefix && qi === terms.length - 1 && q.length >= 3) {
        for (const w of this.postings.keys()) if (w !== q && w.startsWith(q)) words.push(w);
      }
      for (const w of words) {
        const df = this.df.get(w);
        // un mot exact compte plein, un mot qui ne fait que commencer pareil compte moins
        const idf = Math.log(1 + (this.N - df + 0.5) / (df + 0.5)) * (w === q ? 1 : 0.35);
        for (const i of this.postings.get(w)) {
          const d = this.docs[i];
          const f = d.tf.get(w);
          const s = idf * f * (this.k1 + 1) / (f + this.k1 * (1 - this.b + this.b * d.len / this.avgLen));
          scores.set(i, (scores.get(i) || 0) + s);
        }
      }
    });
    return [...scores.entries()].sort((a, b) => b[1] - a[1]);
  }
}

// Produit scalaire entre une requête float (normalisée) et des vecteurs int8 (x127).
export function semanticScores(q, emb, dim) {
  const n = emb.length / dim;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const o = i * dim;
    for (let j = 0; j < dim; j++) s += q[j] * emb[o + j];
    out[i] = s / 127;
  }
  return out;
}

export function topK(scores, k) {
  const idx = Array.from(scores.keys());
  idx.sort((a, b) => scores[b] - scores[a]);
  return idx.slice(0, k).map(i => [i, scores[i]]);
}

// Reciprocal Rank Fusion : robuste quand les deux échelles de scores n'ont rien à voir.
// weights : poids de chaque liste (1 par défaut).
export function rrf(lists, k = 60, weights = lists.map(() => 1)) {
  const fused = new Map();
  lists.forEach((list, li) => {
    list.forEach(([i], rank) => fused.set(i, (fused.get(i) || 0) + weights[li] / (k + rank + 1)));
  });
  return [...fused.entries()].sort((a, b) => b[1] - a[1]);
}

// La recherche de la page, en une seule définition pour la page et pour l'évaluation (eval/).
export const POOL = 300;   // candidats gardés par chaque méthode avant la fusion

// Le nom compte double : un texte qui porte le mot cherché dans son nom passe devant.
export function corpusText(d) { return `${d.name} ${d.name} ${d.text}`; }

export function lexicalRanking(bm25, query) { return bm25.search(query).slice(0, POOL); }

export function semanticRanking(queryVec, emb, dim) { return topK(semanticScores(queryVec, emb, dim), POOL); }

// Les mots-clés comptent moitié moins que le sens : sur eval/queries.json (30 requêtes),
// poids égaux 80 % de réussite@10 et MRR 0,585 ; mots-clés à 0,5 : 83 % et 0,601.
export const LEXICAL_WEIGHT = 0.5;

export function hybridRanking(lexical, queryVec, emb, dim) {
  return rrf([lexical, semanticRanking(queryVec, emb, dim)], 60, [LEXICAL_WEIGHT, 1]);
}
