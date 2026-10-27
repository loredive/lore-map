// La recherche dans la page : saisie, chargement du modèle, liste des résultats.
import { BM25, tokenize, corpusText, lexicalRanking, hybridRanking, semanticScores, rrf, RRF_K, LEXICAL_WEIGHT, POOL,
         parseQuery, hasConstraints, satisfies } from "./search.js";
import { S, panel, input, mode, esc, fold, resetContext, docRow, announce, dataPath, MAX_HITS_ON_MAP, MAX_RESULTS, isHidden } from "./state.js";
import { draw } from "./render.js";
import { select, snippet, mark, panelTop, bindPanelTop } from "./panel.js";
import { record, current, goBack } from "./nav.js";
import { bindEntityButtons } from "./entities-ui.js";

const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";   // version exacte : ce code tourne là où est la clé du visiteur

export function buildIndex() {
  S.bm25 = new BM25(S.docs.map(corpusText));
  // pour la recherche précise : nom + texte repliés (minuscules, sans accents), catégories repliées
  S.folded = S.docs.map(d => fold(`${d.name} ${d.text}` + (d.alt ? ` ${d.altName} ${d.alt}` : "")));
  S.catFolded = S.cats.map(fold);
}

// Un terme exigé ou exclu qui nomme une entité connue désigne les textes qui la mentionnent.
function termDocs(t) {
  const e = S.entities.find(x => [x.name, x.label, ...x.aliases].some(n => fold(n) === t));
  return e ? (e.docSet ||= new Set(e.docs)) : null;
}
function entityFor(t) { return S.entities.find(x => [x.name, x.label, ...x.aliases].some(n => fold(n) === t)); }

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
    mode.textContent = "";
    draw();
    return;
  }
  const parsed = parseQuery(q);
  S.parsed = parsed;
  touched = false; pending = null;
  if (hasConstraints(parsed)) { await constrainedSearch(parsed, q, seq); return; }
  const lexical = lexicalRanking(S.bm25, q);
  applyResults(lexical, q);                       // réponse immédiate
  if (!S.meta.semantic) return;

  const qv = await embedQuery(q);
  if (!qv || seq !== searchSeq) return;
  const hybrid = hybridRanking(lexical, qv, S.emb, S.meta.dim);
  offerOrApply(hybrid, q);
}

// Recherche précise : les contraintes filtrent tous les textes ; le texte libre (s'il y en a) classe
// ceux qui restent, par mots-clés puis par sens ; sinon, ordre de pertinence du premier nom exigé.
async function constrainedSearch(parsed, q, seq) {
  const ok = S.docs.map(d => satisfies(d.i, S.folded[d.i], S.catFolded[d.cat], parsed, termDocs));
  const kept = S.docs.filter(d => ok[d.i]).map(d => d.i);
  // sans texte libre : par pertinence pour le premier nom exigé (sinon dans l'ordre des textes)
  const lead = parsed.must.map(entityFor).find(Boolean);
  const byConstraints = [...new Set(lead ? [...lead.docs.filter(i => ok[i]), ...kept] : kept)].map(i => [i, 1]);
  if (!parsed.text) { applyResults(byConstraints, q); return; }
  // le texte libre garde son rôle habituel : textes qui en ont les mots, puis les meilleurs par le sens
  // (sinon « Godwyn -Ranni » rendrait tous les textes sans Ranni)
  const lexical = S.bm25.search(parsed.text).filter(([i]) => ok[i]).slice(0, POOL);
  // aucun mot-clé trouvé (« lune » n'est pas dans les textes anglais) : en attendant le classement par
  // le sens, montrer les textes qui satisfont les conditions plutôt que « aucun texte »
  applyResults(lexical.length || !S.meta.semantic ? lexical : byConstraints, q);
  if (!S.meta.semantic) return;
  const qv = await embedQuery(parsed.text);
  if (!qv || seq !== searchSeq) return;
  const sem = semanticScores(qv, S.emb, S.meta.dim);
  const semantic = kept.map(i => [i, sem[i]]).sort((a, b) => b[1] - a[1]).slice(0, POOL);
  offerOrApply(rrf([lexical, semantic], RRF_K, [LEXICAL_WEIGHT, 1]), q);
}

function offerOrApply(hybrid, q) {
  mode.textContent = "Results by keyword and meaning";
  // une fiche, un dialogue ou un chemin ouverts entre-temps restent affichés : « Retour aux résultats »
  // relance la recherche, affinée d'emblée puisque le modèle est chargé
  if (panel.hidden || panel.dataset.view !== "results") return;
  if (touched) {
    pending = hybrid;
    showRefineOffer();
  } else {
    applyResults(hybrid, q);
    panel.querySelector(".count")?.insertAdjacentHTML("beforeend", ' <span class="refined">List refined by meaning.</span>');
  }
}

function showRefineOffer() {
  if (panel.querySelector(".refine")) return;
  panel.querySelector(".count")?.insertAdjacentHTML("afterend",
    '<button type="button" class="refine">Results refined by meaning: show them</button>');
  const b = panel.querySelector(".refine");
  b?.addEventListener("click", () => {
    const ranked = pending;
    pending = null; touched = false;
    if (ranked) applyResults(ranked, S.query);
    panel.querySelector(".results button")?.focus();
  });
  announce("Results refined by meaning are ready");
}

// « Textes qui contiennent …, mentionnent …, sans …, dans … » : ce que la requête a compris
function understood(p) {
  if (!p.phrases?.length && !p.must?.length && !p.mustNot?.length && !p.cats?.length) return "";
  const name = t => esc(entityFor(t)?.label || t);
  const cat = c => esc(S.cats.find((_, k) => S.catFolded[k].startsWith(c)) || c);
  const verbs = [
    p.phrases.length && `contain ${p.phrases.map(x => `“${esc(x)}”`).join(" and ")}`,
    p.must.length && `mention ${p.must.map(name).join(" and ")}`,
  ].filter(Boolean);
  const free = p.text && fold(p.text) !== p.phrases.join(" ") ? p.text.replace(/"/g, "") : "";
  return `<p class="understood">Texts${verbs.length ? ` that ${verbs.join(" and ")}` : ""}${
    p.mustNot.length ? `${verbs.length ? "," : ""} without ${p.mustNot.map(name).join(" or ")}` : ""}${
    p.cats.length ? `, among ${p.cats.map(cat).join(" or ")}` : ""}${free ? `, closest to “${esc(free)}”` : ""}.</p>`;
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
      mode.textContent = "Loading the meaning-search model (only once, ~120 MB)…";
      const [{ pipeline }, buf] = await Promise.all([
        import(TRANSFORMERS_URL),
        fetch(dataPath("emb.bin")).then(r => r.arrayBuffer()),
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
    mode.textContent = "Meaning search unavailable (model not loaded): keywords only";
    return null;
  }
}

// exemples de recherche précise, propres au jeu (game.json : ui.precise)
function preciseTip() {
  const x = S.ui.precise || {};
  return `Precise search: <code>"${esc(x.phrase)}"</code> for an exact phrase, <code>${esc(x.both)}</code> to require
    both, <code>${esc(x.exclude)}</code> to exclude, <code>${esc(x.category)}</code> for a category.`;
}

export function renderResults() {
  const visible = S.results.filter(i => !isHidden(S.docs[i]));
  const shown = visible.slice(0, MAX_RESULTS);
  const p = S.parsed || { text: S.query || "", must: [], phrases: [] };
  const terms = tokenize([p.text, ...p.must, ...p.phrases].join(" "));
  // la liste est remplacée quand les résultats « par sens » arrivent : garder le focus sur le même texte
  const focused = panel.contains(document.activeElement) ? document.activeElement.dataset.i : undefined;
  panel.hidden = false;
  panel.dataset.view = "results";
  record({ view: "results", q: S.query });
  if (!shown.length) {
    panel.innerHTML = `${panelTop()}${understood(p)}<p class="count">No text matches. ${hasConstraints(p)
      ? "No text meets all these conditions together: drop one?"
      : `Try a proper name (${esc(S.ui.empty_hint || "")}) or a word from the game.`}</p>`;
    bindPanelTop();
    return;
  }
  const more = visible.length > shown.length ? `, the first ${shown.length} below` : "";
  // une recherche qui nomme une entité connue mène à sa fiche
  const q = fold(S.query || "");
  const known = S.entities.find(e => [e.name, e.label, ...e.aliases].some(n => fold(n) === q));
  panel.innerHTML = `${panelTop()}${understood(p)}${known ? `<button type="button" class="entity-link" data-e="${S.entities.indexOf(known)}">
      All about “${esc(known.label)}”: ${known.docs.length} texts mention it</button>` : ""}
    <p class="count">${visible.length} texts found${more}. The most relevant glow on the map.</p>
    <ol class="results">${shown.map(i => {
      const d = S.docs[i];
      return docRow(d, mark(esc(d.name), terms), mark(esc(snippet(d.text, terms)), terms));
    }).join("")}</ol>
    <p class="hint search-tip">${preciseTip()}</p>`;
  panel.querySelectorAll("button[data-i]").forEach(b =>
    b.addEventListener("click", () => select(+b.dataset.i)));
  bindPanelTop();
  bindEntityButtons();
  panel.scrollTop = 0;
  if (focused !== undefined) (panel.querySelector(`button[data-i="${focused}"]`) || panel.querySelector(".results button"))?.focus();
  announce(`${visible.length} texts found`);
}

