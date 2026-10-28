// Le panneau de droite : en-tête commun, liens (#…), et ce que partagent les pages de textes.
import { S, $, panel, esc, clusterById } from "./state.js";
import { draw, focusDoc } from "./render.js";
import { poppedHere } from "./nav.js";
import { registerPage, backLabel, goBack, closePage, openFromAddress, openPage } from "./pages.js";

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

export { snippet, mark, dlcBadge } from "./links.js";     // pour search-ui, trail-ui, tip


// ------------------------------------------------------------------ textes et groupes
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


// ------------------------------------------------------------------ adresses
// lien collé dans la barre d'adresse sans recharger la page (replaceState ne déclenche pas l'événement)
addEventListener("hashchange", () => { if (S.docs.length && !poppedHere()) openFromAddress(location.hash); });

// L'ancien code des pages que pages.js ne connaissait pas encore : toutes les sortes de pages
// sont désormais enregistrées, il ne reste que ce dernier recours vide (à retirer, ticket 07).
export const oldPages = { address: () => null, backLabel: () => null, reopen() {}, readAddress: () => false };


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
