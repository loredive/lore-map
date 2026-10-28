// L'historique du navigateur, et rien d'autre : chaque page ouverte est une entrée. « Retour » dans
// le panneau et le bouton Retour du navigateur font la même chose ; revenir au premier état referme
// le panneau au lieu de quitter la page.
// Ce module ne touche ni au DOM ni à l'état partagé, et ne sait rien des sortes de pages : l'historique
// du navigateur et ce qu'il faut savoir d'une entrée (adresse, règle de remplacement, comment la
// rouvrir) lui sont donnés par pages.js.

const stack = [];        // entrées {page, …} de cette visite, dans l'ordre de l'historique
let pos = -1;
let restoring = false;   // pendant qu'on rejoue une entrée : ne rien enregistrer
let popped = null;       // adresse rétablie par popstate (le hashchange qui suit n'est pas un lien collé)
let browser = null;      // l'historique du navigateur : push, replace, back, href, plain, onPop
let pages = null;        // addressOf(e), replaces(a, b), query(), reopen(e) : fournis par pages.js
let watcher = null;      // prévenu de chaque entrée ouverte (pages.js, pour l'History)

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

// Retour : rouvre l'entrée sans rien enregistrer
function restore(state) {
  const k = state?.k;
  if (k === undefined || !stack[k]) return;    // entrée d'une visite précédente : hashchange s'en charge
  popped = browser.href();
  pos = k;
  watcher?.(stack[k]);           // revenir à une page, c'est aussi la relire (avant : la caméra en dépend)
  restoring = true;
  try { pages.reopen(stack[k]); } finally { restoring = false; }
}
