// La recherche dans la page : saisie, chargement du modèle, liste des résultats.
import { BM25, tokenize, corpusText, lexicalRanking, hybridRanking } from "./search.js";
import { S, panel, input, mode, esc, fold, resetContext, docRow, announce, MAX_HITS_ON_MAP, MAX_RESULTS } from "./state.js";
import { draw } from "./render.js";
import { select, snippet, mark, panelTop, bindPanelTop } from "./panel.js";
import { record, current, goBack } from "./nav.js";
import { bindEntityButtons } from "./entities-ui.js";

const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3";

export function buildIndex() { S.bm25 = new BM25(S.docs.map(corpusText)); }

let searchSeq = 0, debounce = 0;
// La liste « par sens » arrive quelques secondes après celle par mots-clés. Si on a déjà commencé à
// la lire (défilement, clic, touche), on ne la remplace pas sous les yeux : on propose de l'afficher.
let touched = false, pending = null;
for (const ev of ["wheel", "touchmove", "pointerdown", "keydown"]) {
  panel.addEventListener(ev, () => { if (panel.dataset.view === "results") touched = true; }, { passive: true });
}
input.addEventListener("input", () => { clearTimeout(debounce); debounce = setTimeout(runSearch, 180); });
// Entrée : la recherche part tout de suite et le focus passe au premier résultat
input.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  clearTimeout(debounce);
  runSearch();                       // la partie mots-clés est synchrone : la liste est déjà là
  panel.querySelector(".entity-link, .results button")?.focus();
});

export async function runSearch() {
  const q = input.value.trim();
  const seq = ++searchSeq;
  if (q.length < 2) {
    S.hits = null; S.results = [];
    // recherche effacée : on revient à ce qu'il y avait avant elle (une fiche, ou la carte seule)
    if (current()?.view === "results") goBack();
    mode.textContent = S.meta?.semantic ? "Recherche par mots-clés et par sens" : "Recherche par mots-clés";
    draw();
    return;
  }
  const lexical = lexicalRanking(S.bm25, q);
  touched = false; pending = null;
  applyResults(lexical, q);                       // réponse immédiate
  if (!S.meta.semantic) return;

  const qv = await embedQuery(q);
  if (!qv || seq !== searchSeq) return;
  const hybrid = hybridRanking(lexical, qv, S.emb, S.meta.dim);
  if (touched && panel.dataset.view === "results") {
    pending = hybrid;
    showRefineOffer();
  } else {
    applyResults(hybrid, q);
    panel.querySelector(".count")?.insertAdjacentHTML("beforeend", ' <span class="refined">Liste affinée par le sens.</span>');
  }
  mode.textContent = "Résultats par mots-clés et par sens";
}

function showRefineOffer() {
  if (panel.querySelector(".refine")) return;
  panel.querySelector(".count")?.insertAdjacentHTML("afterend",
    '<button type="button" class="refine">Résultats affinés par le sens : afficher</button>');
  const b = panel.querySelector(".refine");
  b?.addEventListener("click", () => {
    const ranked = pending;
    pending = null; touched = false;
    if (ranked) applyResults(ranked, S.query);
    panel.querySelector(".results button")?.focus();
  });
  announce("Des résultats affinés par le sens sont prêts");
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
  resetContext();   // un chemin en attente garde son départ (S.pathFrom)
  S.results = ranked.map(([i]) => i);
  S.hits = new Map(S.results.slice(0, MAX_HITS_ON_MAP).map((i, r) => [i, r]));
  S.query = q;
  // une recherche remplace la fiche ouverte, qui reste à un « Retour » (et revient si on efface)
  S.selected = -1;
  renderResults();
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
  // la liste est remplacée quand les résultats « par sens » arrivent : garder le focus sur le même texte
  const focused = panel.contains(document.activeElement) ? document.activeElement.dataset.i : undefined;
  panel.hidden = false;
  panel.dataset.view = "results";
  record({ view: "results", q: S.query });
  if (!shown.length) {
    panel.innerHTML = `${panelTop()}<p class="count">Aucun texte ne correspond. Essaie un nom propre (Marika, Ranni) ou un mot du jeu en anglais.</p>`;
    bindPanelTop();
    return;
  }
  const more = visible.length > shown.length ? `, les ${shown.length} premiers ci-dessous` : "";
  // une recherche qui nomme une entité connue mène à sa fiche
  const q = fold(S.query || "");
  const known = S.entities.find(e => [e.name, e.label, ...e.aliases].some(n => fold(n) === q));
  panel.innerHTML = `${panelTop()}${known ? `<button type="button" class="entity-link" data-e="${S.entities.indexOf(known)}">
      Fiche « ${esc(known.label)} » : ${known.docs.length} textes qui en parlent</button>` : ""}
    <p class="count">${visible.length} textes trouvés${more}. Les plus pertinents brillent sur la carte.</p>
    <ol class="results">${shown.map(i => {
      const d = S.docs[i];
      return docRow(d, mark(esc(d.name), terms), mark(esc(snippet(d.text, terms)), terms));
    }).join("")}</ol>`;
  panel.querySelectorAll("button[data-i]").forEach(b =>
    b.addEventListener("click", () => select(+b.dataset.i)));
  bindPanelTop();
  bindEntityButtons();
  panel.scrollTop = 0;
  if (focused !== undefined) (panel.querySelector(`button[data-i="${focused}"]`) || panel.querySelector(".results button"))?.focus();
  announce(`${visible.length} textes trouvés`);
}

