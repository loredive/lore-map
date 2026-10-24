// La recherche dans la page : saisie, chargement du modèle, liste des résultats.
import { BM25, tokenize, corpusText, lexicalRanking, hybridRanking, semanticScores, rrf, RRF_K, LEXICAL_WEIGHT, POOL,
         parseQuery, hasConstraints, satisfies } from "./search.js";
import { S, panel, input, mode, esc, fold, resetContext, docRow, announce, MAX_HITS_ON_MAP, MAX_RESULTS } from "./state.js";
import { draw } from "./render.js";
import { select, snippet, mark, panelTop, bindPanelTop } from "./panel.js";
import { record, current, goBack } from "./nav.js";
import { bindEntityButtons } from "./entities-ui.js";

const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3";

export function buildIndex() {
  S.bm25 = new BM25(S.docs.map(corpusText));
  // pour la recherche précise : nom + texte repliés (minuscules, sans accents), catégories repliées
  S.folded = S.docs.map(d => fold(`${d.name} ${d.text}`));
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
    mode.textContent = S.meta?.semantic ? "Recherche par mots-clés et par sens" : "Recherche par mots-clés";
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

// « Textes qui contiennent …, mentionnent …, sans …, dans … » : ce que la requête a compris
function understood(p) {
  if (!p.phrases?.length && !p.must?.length && !p.mustNot?.length && !p.cats?.length) return "";
  const name = t => esc(entityFor(t)?.label || t);
  const cat = c => esc(S.cats.find((_, k) => S.catFolded[k].startsWith(c)) || c);
  const verbs = [
    p.phrases.length && `contiennent ${p.phrases.map(x => `« ${esc(x)} »`).join(" et ")}`,
    p.must.length && `mentionnent ${p.must.map(name).join(" et ")}`,
  ].filter(Boolean);
  const free = p.text && fold(p.text) !== p.phrases.join(" ") ? p.text.replace(/"/g, "") : "";
  return `<p class="understood">Textes${verbs.length ? ` qui ${verbs.join(" et ")}` : ""}${
    p.mustNot.length ? `${verbs.length ? "," : ""} sans ${p.mustNot.map(name).join(" ni ")}` : ""}${
    p.cats.length ? `, parmi ${p.cats.map(cat).join(" ou ")}` : ""}${free ? `, au plus près de « ${esc(free)} »` : ""}.</p>`;
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
  const p = S.parsed || { text: S.query || "", must: [], phrases: [] };
  const terms = tokenize([p.text, ...p.must, ...p.phrases].join(" "));
  // la liste est remplacée quand les résultats « par sens » arrivent : garder le focus sur le même texte
  const focused = panel.contains(document.activeElement) ? document.activeElement.dataset.i : undefined;
  panel.hidden = false;
  panel.dataset.view = "results";
  record({ view: "results", q: S.query });
  if (!shown.length) {
    panel.innerHTML = `${panelTop()}${understood(p)}<p class="count">Aucun texte ne correspond. ${hasConstraints(p)
      ? "Ces conditions ne se rencontrent ensemble dans aucun texte : en retirer une ?"
      : "Essaie un nom propre (Marika, Ranni) ou un mot du jeu en anglais."}</p>`;
    bindPanelTop();
    return;
  }
  const more = visible.length > shown.length ? `, les ${shown.length} premiers ci-dessous` : "";
  // une recherche qui nomme une entité connue mène à sa fiche
  const q = fold(S.query || "");
  const known = S.entities.find(e => [e.name, e.label, ...e.aliases].some(n => fold(n) === q));
  panel.innerHTML = `${panelTop()}${understood(p)}${known ? `<button type="button" class="entity-link" data-e="${S.entities.indexOf(known)}">
      Fiche « ${esc(known.label)} » : ${known.docs.length} textes qui en parlent</button>` : ""}
    <p class="count">${visible.length} textes trouvés${more}. Les plus pertinents brillent sur la carte.</p>
    <ol class="results">${shown.map(i => {
      const d = S.docs[i];
      return docRow(d, mark(esc(d.name), terms), mark(esc(snippet(d.text, terms)), terms));
    }).join("")}</ol>
    <p class="hint search-tip">Recherche précise : « "Destined Death" » pour une expression exacte,
      « Ranni + Blaidd » pour exiger les deux, « -Malenia » pour exclure, « dans:armes » pour une catégorie.</p>`;
  panel.querySelectorAll("button[data-i]").forEach(b =>
    b.addEventListener("click", () => select(+b.dataset.i)));
  bindPanelTop();
  bindEntityButtons();
  panel.scrollTop = 0;
  if (focused !== undefined) (panel.querySelector(`button[data-i="${focused}"]`) || panel.querySelector(".results button"))?.focus();
  announce(`${visible.length} textes trouvés`);
}

