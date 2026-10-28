// Le panneau de droite : en-tête commun, liens (#…), et ce que partagent les pages de textes.
import { S, $, panel, esc, clusterById } from "./state.js";
import { draw, focusDoc } from "./render.js";
import { openEntity, showIndex } from "./entities-ui.js";
import { poppedHere } from "./nav.js";
import { registerPage, backLabel, goBack, closePage, openFromAddress, openPage } from "./pages.js";
import { openDialogue } from "./dialogue-ui.js";
import { showTours, openTour } from "./tours-ui.js";

// Mode lecture : le panneau s'élargit (environ la moitié de l'écran) ; retenu d'une visite à l'autre.
const READING_KEY = "lore-map:reading";
try { document.body.classList.toggle("reading", localStorage.getItem(READING_KEY) === "1"); } catch { /* stockage bloqué */ }

function toggleReading(btn) {
  const on = document.body.classList.toggle("reading");
  try { localStorage.setItem(READING_KEY, on ? "1" : "0"); } catch { /* stockage bloqué */ }
  btn.setAttribute("aria-pressed", String(on));
  btn.textContent = on ? "Narrow" : "Widen";
  // la carte visible a changé de largeur : y recentrer le texte ouvert
  if (S.selected >= 0) focusDoc(S.docs[S.selected], S.cam.s);
  else draw();
}

// En-tête commun du panneau : « Retour à … » (l'entrée précédente de l'historique), « Agrandir » et « Fermer ».
export function panelTop(back = backLabel()) {
  const on = document.body.classList.contains("reading");
  return `<div class="panel-top">${back ? `<button type="button" class="back">${esc(back)}</button>` : "<span></span>"}
    <span class="actions"><button type="button" class="widen" aria-pressed="${on}" title="Widen the panel for reading">${on ? "Narrow" : "Widen"}</button>
    <button type="button" class="close" aria-label="Close the panel">Close</button></span></div>`;
}
export function bindPanelTop() {
  panel.querySelector(".panel-top .back")?.addEventListener("click", goBack);
  panel.querySelector(".panel-top .widen").addEventListener("click", ev => toggleReading(ev.currentTarget));
  panel.querySelector(".panel-top .close").addEventListener("click", closePage);
}

export function snippet(text, terms, len = 150) {
  const flat = text.replace(/\s+/g, " ");
  const low = flat.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  let at = -1;
  for (const t of terms) { at = low.indexOf(t); if (at >= 0) break; }
  if (at < 0) return flat.length > len ? flat.slice(0, len) + "…" : flat;
  const start = Math.max(0, flat.lastIndexOf(" ", Math.max(0, at - 50)));
  const s = flat.slice(start, start + len).trim();
  return (start > 0 ? "…" : "") + s + (start + len < flat.length ? "…" : "");
}
export function mark(html, terms) {
  if (!terms.length) return html;
  const re = new RegExp(`\\b(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\w*`, "gi");
  return html.replace(re, "<mark>$&</mark>");
}


// ------------------------------------------------------------------ textes et groupes
// « The Old Hunters » à côté de la catégorie d'un texte ajouté par le DLC (game.json : ui.dlc_label)
export function dlcBadge(d) {
  return d.dlc ? `<span class="dlc-badge" title="Added with ${esc(S.ui.dlc_label || "the DLC")}">${esc(S.ui.dlc_label || "DLC")}</span>` : "";
}

// Ouvre la page d'un texte (text-ui.js) ; si un chemin attend son second texte, ouvre plutôt le chemin.
export function select(i, opts) {
  if (S.pathFrom >= 0 && i !== S.pathFrom) openPage("path", { a: S.pathFrom, b: i });
  else openPage("doc", { i }, opts);
}

// Ouvre la page d'un groupe (group-ui.js).
export function openCluster(c) { openPage("cluster", { id: c.id, label: c.label }); }

// Le panneau fermé est une page : fermer est une étape, Retour rouvre ce qu'on vient de fermer.
registerPage({ name: "none", panel: false, render: () => { cancelPath(); return {}; } });
export const closePanel = closePage;


// ------------------------------------------------------------------ pages pas encore enregistrées
// L'ancien code des pages que pages.js ne connaît pas encore : il s'en sert en dernier recours.
// Chaque sorte de page qui s'enregistre auprès de pages.js disparaît de ces aiguillages.

// adresse d'une entrée de l'historique ; null : pas d'adresse propre (résultats, index, rien)
function address(e) {
  switch (e.view) {
    case "entity": return "#entity=" + encodeURIComponent(e.name);
    case "dialogue": return "#dialogue=" + encodeURIComponent(e.speaker);
    case "tour": return `#tour=${encodeURIComponent(e.id)}/${e.k + 1}`;
    default: return null;
  }
}

function oldBackLabel(e) {
  switch (e.view) {
    case "entity": return `Back to “${S.entities.find(x => x.name === e.name)?.label || e.name}”`;
    case "index": return "Back to characters and places";
    case "dialogue": return `Back to the dialogue of ${e.speaker}`;
    case "tours": return "Back to the guided tours";
    case "tour": return `Back to “${S.tours.find(t => t.id === e.id)?.title || e.id}”, step ${e.k + 1}`;
    default: return null;                       // avant : le panneau fermé, « Fermer » suffit
  }
}

// ouvre la page d'une adresse ; false si aucune ancienne sorte de page ne la reconnaît
function readAddress(hash) {
  const name = decodeURIComponent(hash.slice(1));
  if (!name) return false;
  // liens anglais (#entity=…) et anciens liens français (#entite=…), toujours reconnus
  const arg = (...keys) => { const k = keys.find(p => name.startsWith(p + "=")); return k === undefined ? null : name.slice(k.length + 1); };
  const entity = arg("entity", "entite");
  if (name.startsWith("tour=")) {                 // #tour=paleblood/3
    const [id, k] = name.slice(5).split("/");
    openTour(id, (+k || 1) - 1);
    return true;
  }
  if (name.startsWith("dialogue=")) {
    openDialogue(name.slice(9));
    return true;
  }
  if (entity !== null) {
    const e = S.entities.find(x => x.name === entity);
    if (e) openEntity(e);
    return true;
  }
  return false;
}

// lien collé dans la barre d'adresse sans recharger la page (replaceState ne déclenche pas l'événement)
addEventListener("hashchange", () => { if (S.docs.length && !poppedHere()) openFromAddress(location.hash); });

// Rouvre une entrée de l'historique (bouton Retour, « Retour à … »)
function reopen(e) {
  if (e.view === "entity") { const x = S.entities.find(y => y.name === e.name); if (x) openEntity(x); }
  else if (e.view === "index") showIndex();
  else if (e.view === "dialogue") openDialogue(e.speaker);
  else if (e.view === "tours") showTours();
  else if (e.view === "tour") openTour(e.id, e.k);
}

export const oldPages = { address, backLabel: oldBackLabel, reopen, readAddress };


// ------------------------------------------------------------------ groupe d'un texte
// Le groupe du texte, ou pour un texte hors groupe celui de la plupart de ses échos.
export function groupOf(d) {
  if (d.cluster >= 0) return { c: clusterById(d.cluster), near: false };
  const votes = new Map();
  for (const e of d.echoes) {
    const k = S.docs[e].cluster;
    if (k >= 0) votes.set(k, (votes.get(k) || 0) + 1);
  }
  const best = [...votes].sort((a, b) => b[1] - a[1])[0];
  return best ? { c: clusterById(best[0]), near: true } : null;
}

// ------------------------------------------------------------------ chemin d'échos
// Commencé depuis un texte : le texte suivant choisi ouvre le chemin (select, path-ui.js).
const pathbar = $("#pathbar");
export function startPath(i) {
  S.pathFrom = i;
  pathbar.querySelector(".from").textContent = S.docs[i].name;
  pathbar.hidden = false;
}
export function cancelPath() {
  S.pathFrom = -1;
  pathbar.hidden = true;
}
$("#pathbar .cancel").addEventListener("click", () => { cancelPath(); draw(); });
