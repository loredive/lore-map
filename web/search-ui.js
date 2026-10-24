// La recherche dans la page : saisie, chargement du modèle, liste des résultats.
import { BM25, tokenize, corpusText, lexicalRanking, hybridRanking } from "./search.js";
import { S, panel, input, mode, esc, fold, colorOf, MAX_HITS_ON_MAP, MAX_RESULTS } from "./state.js";
import { draw } from "./render.js";
import { select, snippet, mark } from "./panel.js";
import { bindEntityButtons } from "./entities-ui.js";

const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3";

export function buildIndex() { S.bm25 = new BM25(S.docs.map(corpusText)); }

let searchSeq = 0, debounce = 0;
input.addEventListener("input", () => { clearTimeout(debounce); debounce = setTimeout(runSearch, 180); });

export async function runSearch() {
  const q = input.value.trim();
  const seq = ++searchSeq;
  if (q.length < 2) {
    S.hits = null; S.results = [];
    if (S.selected < 0 && panel.dataset.view === "results") panel.hidden = true;
    mode.textContent = S.meta?.semantic ? "Recherche par mots-clés et par sens" : "Recherche par mots-clés";
    draw();
    return;
  }
  const lexical = lexicalRanking(S.bm25, q);
  applyResults(lexical, q);                       // réponse immédiate
  if (!S.meta.semantic) return;

  const qv = await embedQuery(q);
  if (!qv || seq !== searchSeq) return;
  applyResults(hybridRanking(lexical, qv, S.emb, S.meta.dim), q);
  mode.textContent = "Résultats par mots-clés et par sens";
}

// Vide la recherche et ignore une réponse « par sens » encore en route (elle écraserait ce qui
// s'affiche entre-temps, comme un chemin tout juste tracé).
export function resetSearch() {
  searchSeq++;
  clearTimeout(debounce);
  input.value = "";
  S.hits = null; S.results = []; S.query = "";
}

export function applyResults(ranked, q) {
  S.cluster = S.entity = S.lit = S.path = S.pathSet = null;   // un chemin en attente garde son départ
  S.results = ranked.map(([i]) => i);
  S.hits = new Map(S.results.slice(0, MAX_HITS_ON_MAP).map((i, r) => [i, r]));
  S.query = q;
  // en attendant l'arrivée d'un chemin, les résultats remplacent la fiche : c'est là qu'on la choisit
  if (S.pathFrom >= 0) S.selected = -1;
  if (S.selected < 0) renderResults();
  draw();
}

export async function embedQuery(q) {
  try {
    if (!S.extractor) {
      S.semanticState = "loading";
      mode.textContent = "Chargement du modèle de recherche par sens (une seule fois, ~120 Mo)…";
      const [{ pipeline }, buf] = await Promise.all([
        import(TRANSFORMERS_URL),
        fetch("data/emb.bin").then(r => r.arrayBuffer()),
      ]);
      S.emb = new Int8Array(buf);
      S.extractor = await pipeline("feature-extraction", S.meta.model);
      S.semanticState = "ready";
    }
    const out = await S.extractor(S.meta.queryPrefix + q, { pooling: "mean", normalize: true });
    return out.data;
  } catch (err) {
    console.warn(err);
    S.meta.semantic = false;
    mode.textContent = "Recherche par sens indisponible (modèle non chargé) : mots-clés seulement";
    return null;
  }
}

export function renderResults() {
  const visible = S.results.filter(i => !S.hidden.has(S.docs[i].cat));
  const shown = visible.slice(0, MAX_RESULTS);
  const terms = tokenize(S.query || "");
  panel.hidden = false;
  panel.dataset.view = "results";
  if (!shown.length) {
    panel.innerHTML = `<p class="count">Aucun texte ne correspond. Essaie un nom propre (Marika, Ranni) ou un mot du jeu en anglais.</p>`;
    return;
  }
  const more = visible.length > shown.length ? `, les ${shown.length} premiers ci-dessous` : "";
  // une recherche qui nomme une entité connue mène à sa fiche
  const q = fold(S.query || "");
  const known = S.entities.find(e => [e.name, e.label, ...e.aliases].some(n => fold(n) === q));
  panel.innerHTML = `${known ? `<button type="button" class="entity-link" data-e="${S.entities.indexOf(known)}">
      Fiche « ${esc(known.label)} » : ${known.docs.length} textes qui en parlent</button>` : ""}
    <p class="count">${visible.length} textes trouvés${more}. Les plus pertinents brillent sur la carte.</p>
    <ol class="results">${shown.map(i => {
      const d = S.docs[i];
      return `<li><button type="button" data-i="${i}">
        <span class="head"><span class="dot" style="--c:${colorOf(d.cat)}"></span><span class="name">${mark(esc(d.name), terms)}</span></span>
        <span class="snip">${mark(esc(snippet(d.text, terms)), terms)}</span></button></li>`;
    }).join("")}</ol>`;
  panel.querySelectorAll("button[data-i]").forEach(b =>
    b.addEventListener("click", () => select(+b.dataset.i)));
  bindEntityButtons();
  panel.scrollTop = 0;
}

