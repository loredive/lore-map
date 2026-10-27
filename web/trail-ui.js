// L'historique de lecture : enregistré par jeu dans le navigateur, montré sur la carte (sky.js :
// drawTrail, les textes déjà lus) et en entier dans le panneau « History » (bouton de la barre).
// Chaque fiche ouverte (texte, entité, groupe, dialogue) est un pas ; nav.js nous les signale.
import { S, $, panel, esc, colorOf, resetContext, focusPanel } from "./state.js";
import { draw } from "./render.js";
import { panelTop, bindPanelTop, snippet } from "./panel.js";
import { record, onRecord, openEntry } from "./nav.js";
import { KIND_LABELS } from "./entities-ui.js";
import { push, previousDoc, docKeys, recentDocs, serialize, parse } from "./trail.js";

const UNDO_MS = 10000;           // « Undo » reste proposé après « Clear »
const storeKey = () => `lore-map:trail:${S.game}`;
let steps = [], docIndex = new Map();
let cleared = null, undoTimer = 0;   // parcours effacé, récupérable quelques secondes

const entityOf = name => S.entities.find(e => e.name === name);
const clusterOf = label => S.clusters.find(c => c.label === label);

function exists(s) {
  return s.kind === "doc" ? docIndex.has(s.key) : s.kind === "entity" ? !!entityOf(s.key)
    : s.kind === "cluster" ? !!clusterOf(s.key) : S.dialogues.has(s.key);
}

// entrée de l'historique (nav.js) -> pas du parcours, ou null pour une page qui n'en est pas un
function stepOf(e) {
  switch (e.view) {
    case "doc": case "tour": return { kind: "doc", key: S.docs[e.i].name };   // une étape de visite : un texte lu
    case "entity": return { kind: "entity", key: e.name };
    case "cluster": return { kind: "cluster", key: e.label };
    case "dialogue": return { kind: "dialogue", key: e.speaker };
    default: return null;
  }
}
function entryOf(s) {
  switch (s.kind) {
    case "doc": return { view: "doc", i: docIndex.get(s.key) };
    case "entity": return { view: "entity", name: s.key };
    case "cluster": { const c = clusterOf(s.key); return { view: "cluster", id: c.id, label: c.label }; }
    default: return { view: "dialogue", speaker: s.key };
  }
}
function labelOf(s) {
  return s.kind === "entity" ? entityOf(s.key)?.label || s.key : s.kind === "dialogue" ? `Dialogue: ${s.key}` : s.key;
}
function kindOf(s) {
  return s.kind === "doc" ? S.cats[S.docs[docIndex.get(s.key)].cat] : s.kind === "entity"
    ? KIND_LABELS[entityOf(s.key).kind][0] : s.kind === "cluster" ? "Group of texts" : "Dialogue";
}

export function initTrail() {
  docIndex = new Map(S.docs.map(d => [d.name, d.i]));
  let saved = parse(null);
  try { saved = parse(localStorage.getItem(storeKey())); } catch { /* stockage bloqué */ }
  steps = saved.steps.filter(exists);      // un texte renommé depuis la dernière visite disparaît
  S.trailShown = saved.shown;
  onRecord(e => {
    const s = stepOf(e);
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
function clearTrail() {
  cleared = { steps, at: Date.now() };
  steps = [];
  S.cameFrom = -1;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { cleared = null; if (panel.dataset.view === "trail") showTrail(); }, UNDO_MS);
  update();
  if (panel.dataset.view === "trail") showTrail();
  panel.querySelector(".tundo")?.focus();
  draw();
}
function undoClear() {
  if (!cleared) return;
  steps = cleared.steps;
  cleared = null;
  clearTimeout(undoTimer);
  update();
  if (panel.dataset.view === "trail") showTrail();
  draw();
}

export function showTrail() {
  resetContext();
  S.selected = -1;
  panel.hidden = false;
  panel.dataset.view = "trail";
  record({ view: "trail" });
  const rows = steps.map((s, k) => [s, k]).reverse().map(([s, k]) => {
    const d = s.kind === "doc" ? S.docs[docIndex.get(s.key)] : null;
    return `<li><button type="button" data-k="${k}">
      <span class="head">${d ? `<span class="dot" style="--c:${colorOf(d.cat)}"></span>` : `<span class="kind">${esc(kindOf(s))}</span>`}<span class="name">${esc(labelOf(s))}</span></span>
      ${d ? `<span class="snip">${esc(snippet(d.text, [], 110))}</span>` : ""}</button></li>`;
  }).join("");
  const last = steps.at(-1);
  panel.innerHTML = `${panelTop()}<article class="card">
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
  bindPanelTop();
  panel.querySelectorAll(".trail-list button[data-k]").forEach(b =>
    b.addEventListener("click", () => openEntry(entryOf(steps[+b.dataset.k]))));
  panel.querySelector(".tcontinue")?.addEventListener("click", () => openEntry(entryOf(last)));
  panel.querySelector(".tshow").addEventListener("click", ev => {
    S.trailShown = !S.trailShown;
    ev.currentTarget.setAttribute("aria-pressed", String(S.trailShown));
    update();
    draw();
  });
  panel.querySelector(".tclear")?.addEventListener("click", clearTrail);
  panel.querySelector(".tundo")?.addEventListener("click", undoClear);
  panel.scrollTop = 0;
  focusPanel(`History: ${steps.length} steps`);
  draw();
}

$("#history").addEventListener("click", showTrail);
