// Historique de navigation du panneau : chaque page ouverte (texte, groupe, entité, index, aide,
// chemin, résultats) est une entrée de l'historique du navigateur. « Retour » dans le panneau et le
// bouton Retour du navigateur font la même chose ; revenir au premier état referme le panneau
// au lieu de quitter la page.
// Ce module ne touche ni au DOM ni à l'état partagé : l'historique du navigateur et ce qu'il faut
// savoir des pages (adresse, règle de remplacement, page à rouvrir) lui sont donnés par pages.js.

const stack = [];        // entrées {view, …} de cette visite, dans l'ordre de l'historique
let pos = -1;
let restoring = false;   // pendant qu'on rejoue une entrée : ne rien enregistrer
let popped = null;       // adresse rétablie par popstate (le hashchange qui suit n'est pas un lien collé)
let browser = null;      // l'historique du navigateur : push, replace, back, href, plain, onPop
let pages = null;        // addressOf(e), replaces(a, b), query(), reopen(e) : fournis par pages.js
let watcher = null;      // prévenu de chaque entrée ouverte (le parcours de lecture, trail-ui.js)

export function startNav(b, p) {
  browser = b;
  pages = p;
  stack.length = 0;
  pos = -1;
  restoring = false;
  popped = null;
  b.onPop(restore);
}

export function onRecord(f) { watcher = f; }
// rouvre une entrée comme un nouveau pas (le parcours sous la recherche), pas comme un Retour
export function openEntry(e) { pages.reopen(e); }

export function record(entry) {
  if (restoring) return;
  popped = null;
  // la recherche en cours fait partie de l'état : revenir à une page ouverte avant elle l'efface
  // (les résultats portent déjà la leur)
  if (!("q" in entry)) entry = { ...entry, q: pages.query() || "" };
  watcher?.(entry);
  const url = pages.addressOf(entry) ?? browser.plain();
  if (pos >= 0 && pages.replaces(stack[pos], entry)) {
    stack[pos] = entry;
    browser.replace({ k: pos }, url);
    return;
  }
  stack.splice(pos + 1);
  stack.push(entry);
  pos = stack.length - 1;
  // la toute première entrée remplace celle du chargement : Retour depuis elle quitte la page
  (pos === 0 ? browser.replace : browser.push).call(browser, { k: pos }, url);
}

export function current() { return pos >= 0 ? stack[pos] : null; }
export function previous() { return pos > 0 ? stack[pos - 1] : null; }

export function goBack() { if (pos > 0) browser.back(); }

// le hashchange qui suit un popstate n'est pas un lien collé : ne pas rouvrir la page une 2e fois.
// Le drapeau ne sert qu'une fois (sinon revenir plus tard à la même adresse serait ignoré).
export function poppedHere() {
  const hit = popped === browser.href();
  popped = null;
  return hit;
}

// rejoue une entrée sans rien enregistrer (Retour, ou une page réaffichée par l'ancien code)
export function replay(e, open) {
  restoring = true;
  try { open(e); } finally { restoring = false; }
}

function restore(state) {
  const k = state?.k;
  if (k === undefined || !stack[k]) return;    // entrée d'une visite précédente : hashchange s'en charge
  popped = browser.href();
  pos = k;
  watcher?.(stack[k]);           // revenir à une page, c'est aussi la relire (avant : la caméra en dépend)
  replay(stack[k], pages.reopen);
}
