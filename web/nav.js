// Historique de navigation du panneau : chaque fiche ouverte (texte, groupe, entité, index, aide,
// chemin, résultats) est une entrée de l'historique du navigateur. « Retour » dans le panneau et le
// bouton Retour du navigateur font la même chose ; revenir au premier état referme le panneau
// au lieu de quitter la page.
import { S } from "./state.js";

const stack = [];        // entrées {view, …} de cette visite, dans l'ordre de l'historique
let pos = -1;
let restoring = false;   // pendant qu'on rejoue une entrée : ne rien enregistrer
let popped = null;       // adresse rétablie par popstate (le hashchange qui suit n'est pas un lien collé)
let opener = null;       // ouvre une entrée ; fourni par panel.js (qui dépend de ce module)
let watcher = null;      // prévenu de chaque entrée ouverte (le parcours de lecture, trail-ui.js)

export function setOpener(f) { opener = f; }
export function onRecord(f) { watcher = f; }
// rouvre une entrée comme un nouveau pas (le parcours sous la recherche), pas comme un Retour
export function openEntry(e) { opener(e); }

function hashOf(e) {
  switch (e.view) {
    case "doc": return "#" + encodeURIComponent(S.docs[e.i].name);
    case "cluster": return "#group=" + encodeURIComponent(e.label);
    case "entity": return "#entity=" + encodeURIComponent(e.name);
    case "path": return "#path=" + encodeURIComponent(S.docs[e.a].name) + "&" + encodeURIComponent(S.docs[e.b].name);
    case "dialogue": return "#dialogue=" + encodeURIComponent(e.speaker);
    case "tour": return `#tour=${encodeURIComponent(e.id)}/${e.k + 1}`;
    default: return location.pathname + location.search;      // résultats, index, aide, rien
  }
}

// deux entrées « identiques » se remplacent au lieu de s'empiler : la recherche qui s'affine
// pendant la frappe, ou un groupe ré-affiché quand on masque une catégorie
function same(a, b) {
  return a && b && a.view === b.view && (a.view === "results" || JSON.stringify(a) === JSON.stringify(b));
}

export function record(entry) {
  if (restoring) return;
  popped = null;
  // la recherche en cours fait partie de l'état : revenir à une fiche ouverte avant elle l'efface
  if (entry.view !== "results") entry = { ...entry, q: S.query || "" };
  watcher?.(entry);
  if (pos >= 0 && same(stack[pos], entry)) {
    stack[pos] = entry;
    history.replaceState({ k: pos }, "", hashOf(entry));
    return;
  }
  stack.splice(pos + 1);
  stack.push(entry);
  pos = stack.length - 1;
  // la toute première entrée remplace celle du chargement : Retour depuis elle quitte la page
  (pos === 0 ? history.replaceState : history.pushState).call(history, { k: pos }, "", hashOf(entry));
}

export function current() { return pos >= 0 ? stack[pos] : null; }

export function goBack() { if (pos > 0) history.back(); }

export function backLabel() {
  if (pos <= 0) return null;
  const e = stack[pos - 1];
  switch (e.view) {
    case "doc": return `Back to “${S.docs[e.i].name}”`;
    case "cluster": return `Back to the group “${e.label}”`;
    case "entity": return `Back to “${S.entities.find(x => x.name === e.name)?.label || e.name}”`;
    case "results": return `Back to the results for “${e.q}”`;
    case "index": return "Back to characters and places";
    case "help": return "Back to help";
    case "path": return "Back to the path";
    case "dialogue": return `Back to the dialogue of ${e.speaker}`;
    case "trail": return "Back to your trail";
    case "tours": return "Back to the guided tours";
    case "chat": return "Back to the conversation";
    case "tour": return `Back to “${S.tours.find(t => t.id === e.id)?.title || e.id}”, step ${e.k + 1}`;
    default: return null;                       // avant : le panneau fermé, « Fermer » suffit
  }
}

// le hashchange qui suit un popstate n'est pas un lien collé : ne pas rouvrir la fiche une 2e fois.
// Le drapeau ne sert qu'une fois (sinon revenir plus tard à la même adresse serait ignoré).
export function poppedHere() {
  const hit = popped === location.href;
  popped = null;
  return hit;
}

addEventListener("popstate", e => {
  const k = e.state?.k;
  if (k === undefined || !stack[k]) return;    // entrée d'une visite précédente : hashchange s'en charge
  popped = location.href;
  pos = k;
  watcher?.(stack[k]);           // revenir à une fiche, c'est aussi la relire (avant : la caméra en dépend)
  restoring = true;
  try { opener(stack[k]); } finally { restoring = false; }
});
