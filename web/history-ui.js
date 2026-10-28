// L'History : les pages ouvertes, enregistrées par jeu dans le navigateur, montrées sur la carte
// (sky.js : drawTrail, les textes déjà lus) et en entier dans la page « History » (bouton de la barre).
// Les sortes de pages déclarent le pas qu'elles ajoutent (texte, entité, groupe, dialogue ; une étape
// de visite compte comme son texte), la page que rouvre un pas et son nom ; pages.js nous signale chaque pas.
import { S, $, panel, esc, colorOf, textOf } from "./state.js";
import { draw } from "./render.js";
import { registerPage, openPage, rerenderPage, onStep, openStep, pageOfStep, describeStep } from "./pages.js";
import { snippet } from "./links.js";
import { push, previousDoc, docKeys, recentDocs, serialize, parse } from "./trail.js";

const UNDO_MS = 10000;           // « Undo » reste proposé après « Clear »
const storeKey = () => `lore-map:trail:${S.game}`;   // clé d'avant le nom History : la garder
let steps = [], docIndex = new Map();
let cleared = null, undoTimer = 0;   // History effacée, récupérable quelques secondes

const labelOf = s => describeStep(s).label;

export function initHistory() {
  docIndex = new Map(S.docs.map(d => [d.name, d.i]));
  let saved = parse(null);
  try { saved = parse(localStorage.getItem(storeKey())); } catch { /* stockage bloqué */ }
  steps = saved.steps.filter(s => pageOfStep(s));   // un texte renommé depuis la dernière visite disparaît
  S.trailShown = saved.shown;
  onStep(s => {
    if (s) { steps = push(steps, s); cleared = null; }
    update(!!s);
    // une page qui n'est pas un pas (recherche, aide, panneau fermé) : plus de « d'où l'on vient »
    if (!s) S.cameFrom = -1;
  });
  update(false);
  S.cameFrom = -1;                         // nouvelle visite : on ne vient de nulle part
}

// recalcule ce que dessine la carte, enregistre, et refait la bande sous la recherche
function update(save = true) {
  const prev = previousDoc(steps);
  S.cameFrom = prev !== null && docIndex.has(prev) ? docIndex.get(prev) : -1;
  S.visited = new Set([...docKeys(steps)].map(k => docIndex.get(k)));
  S.trailDocs = recentDocs(steps).map(k => docIndex.get(k));
  if (save) {
    try { localStorage.setItem(storeKey(), serialize(steps, S.trailShown)); } catch { /* stockage bloqué */ }
  }
}

// Effacer tout de suite, et proposer « Undo » quelques secondes (pas de confirm() du navigateur)
function clearHistory() {
  cleared = { steps, at: Date.now() };
  steps = [];
  S.cameFrom = -1;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { cleared = null; if (panel.dataset.page === "history") rerenderPage(); }, UNDO_MS);
  update();
  if (panel.dataset.page === "history") rerenderPage();
  panel.querySelector(".tundo")?.focus();
  draw();
}
function undoClear() {
  if (!cleared) return;
  steps = cleared.steps;
  cleared = null;
  clearTimeout(undoTimer);
  update();
  if (panel.dataset.page === "history") rerenderPage();
  draw();
}

// La page History : tout ce qu'on a ouvert, du plus récent au plus ancien.
registerPage({
  name: "history",
  backLabel: () => "Back to your history",
  render: historyPage,
});

function historyPage() {
  const rows = steps.map((s, k) => [s, k]).reverse().map(([s, k]) => {
    const d = s.kind === "doc" ? S.docs[docIndex.get(s.key)] : null;
    return `<li><button type="button" data-k="${k}">
      <span class="head">${d ? `<span class="dot" style="--c:${colorOf(d.cat)}"></span>` : `<span class="kind">${esc(describeStep(s).kind)}</span>`}<span class="name">${esc(labelOf(s))}</span></span>
      ${d ? `<span class="snip">${esc(snippet(textOf(d), [], 110))}</span>` : ""}</button></li>`;
  }).join("");
  const last = steps.at(-1);
  const html = `<article class="card">
    <h2>History</h2>
    <p class="count">${S.visited.size} of ${S.docs.length} texts read, in ${steps.length} ${steps.length === 1 ? "step" : "steps"}.</p>
    ${last ? `<button type="button" class="entity-link tcontinue">Continue where you left off: ${esc(labelOf(last))}</button>` : ""}
    <div class="tools">
      <button type="button" class="tshow" aria-pressed="${S.trailShown}">Show the path through the last texts read</button>
      ${steps.length ? '<button type="button" class="tclear danger">Clear the history</button>' : cleared ? '<button type="button" class="tundo">Undo clear</button>' : ""}
    </div>
    <p class="hint">Newest first. On the map, a ring marks every text already read, and the text you came from is
      named. Kept in this browser, one history per game.</p>
    ${steps.length ? `<ol class="results trail-list">${rows}</ol>` : '<p class="text">Nothing read yet: open a star to start.</p>'}
  </article>`;
  return { html, announce: `History: ${steps.length} steps`, bind: panel => bindHistory(panel, last) };
}

function bindHistory(panel, last) {
  panel.querySelectorAll(".trail-list button[data-k]").forEach(b =>
    b.addEventListener("click", () => openStep(steps[+b.dataset.k])));
  panel.querySelector(".tcontinue")?.addEventListener("click", () => openStep(last));
  panel.querySelector(".tshow").addEventListener("click", ev => {
    S.trailShown = !S.trailShown;
    ev.currentTarget.setAttribute("aria-pressed", String(S.trailShown));
    update();
    draw();
  });
  panel.querySelector(".tclear")?.addEventListener("click", clearHistory);
  panel.querySelector(".tundo")?.addEventListener("click", undoClear);
}

$("#history").addEventListener("click", () => openPage("history"));
