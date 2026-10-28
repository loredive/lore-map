// Les pages du panneau : chaque sorte de page (texte, groupe, aide…) s'enregistre ici une fois, et
// c'est ici seulement qu'on ouvre, réaffiche, ferme une page ou revient en arrière.
// Ce module ne touche ni au DOM ni à l'état partagé au chargement : le panneau, le dessin, le
// cadrage, la remise à zéro du focus et l'historique du navigateur lui sont donnés au démarrage
// (startPages), ce qui permet de le tester sous node.
//
// Une sorte de page déclare (seuls name et render sont obligatoires) :
//   name              "help", "doc", "cluster"… (la valeur de view dans l'historique, data-view du panneau)
//   address           { write(args) -> "#…" | null, keys: ["group", "groupe"], read(value, raw) -> args | null }
//                     write absent ou null : pas d'adresse propre. keys : les clés lues (#group=…), anciennes
//                     clés françaises comprises (lues, jamais écrites) ; sans keys, read reçoit l'adresse
//                     entière et n'est essayé qu'en dernier (un nom de texte).
//   backLabel(args)   « Back to … » quand cette page est la précédente
//   step(args)        le pas d'History qu'elle ajoute, {kind, key}, ou null
//   fromStep          { kind, page(key) -> args | null } : les pas de cette sorte rouvrent cette page
//   replacesPrevious  true : une nouvelle entrée remplace la précédente de la même sorte (les résultats) ;
//                     sinon seule une entrée identique se remplace
//   keepsFocus        true : garde le focus de la carte (le texte) ; sinon on repart d'un focus neuf
//   panel             false : la page « panneau fermé »
//   render(args)      allume ce qu'il faut sur la carte et rend { html, bind(panel), announce, frame }
//                     (frame : les étoiles à cadrer, ou une fonction qui cadre elle-même)
import { startNav, record, current, previous, goBack as navBack, replay } from "./nav.js";

const kinds = new Map();
let deps = null;

export function registerPage(kind) { kinds.set(kind.name, kind); }

// deps : panel, browser (adaptateur de l'historique du navigateur), query() (la recherche en cours),
// resetFocus(), top(backLabel) -> HTML de l'en-tête, bindTop(), focus(message), frame(stars), draw(),
// onReopen(entry) (avant de rouvrir une entrée), et fallback : l'ancien code des pages pas encore
// enregistrées (address(e), backLabel(e), replaces(a, b), reopen(e), readAddress(hash), close()).
export function startPages(d) {
  deps = { fallback: {}, ...d };
  startNav(d.browser, { addressOf, replaces, query: () => deps.query(), reopen });
}

const argsOf = ({ view, ...args }) => args;     // q : la recherche en cours, que nav.js ajoute

function addressOf(e) {
  const kind = kinds.get(e.view);
  return kind ? kind.address?.write?.(argsOf(e)) ?? null : deps.fallback.address?.(e) ?? null;
}

function replaces(a, b) {
  if (a.view !== b.view) return false;
  const kind = kinds.get(b.view);
  if (kind ? kind.replacesPrevious : deps.fallback.replaces?.(a, b)) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

// La séquence d'ouverture, écrite une seule fois.
function show(name, args, { rerender = false, fly = true } = {}) {
  const kind = kinds.get(name), { panel } = deps;
  if (!kind.keepsFocus) deps.resetFocus();
  const page = kind.render(args) || {};
  panel.hidden = kind.panel === false;
  panel.dataset.view = kind.panel === false ? "" : name;
  if (!rerender) record({ view: name, ...args });
  if (kind.panel !== false) {
    panel.innerHTML = deps.top(backLabel()) + page.html;
    deps.bindTop();
    panel.scrollTop = 0;
    page.bind?.(panel);                 // après : bind peut faire défiler jusqu'à un passage
    if (!rerender) deps.focus(page.announce);
    if (!rerender && fly && page.frame) typeof page.frame === "function" ? page.frame() : deps.frame(page.frame);
  }
  deps.draw();
}

// Ouvre une page : openPage("help"), openPage("cluster", { id, label }, { fly: false }).
// Une sorte pas encore enregistrée passe par l'ancien code.
export function openPage(name, args = {}, opts = {}) {
  if (kinds.has(name)) show(name, args, opts);
  else deps.fallback.reopen?.({ view: name, ...args });
}

// Réaffiche la page ouverte telle quelle (langue, catégories masquées).
export function rerenderPage() {
  const e = current();
  if (!e) return;
  if (kinds.has(e.view)) show(e.view, argsOf(e), { rerender: true });
  else replay(e, deps.fallback.reopen);
}

export function closePage() {
  if (kinds.has("none")) show("none", {});
  else deps.fallback.close?.();
}

// Rouvre une entrée de l'historique : Retour, ou un pas d'History repris comme un nouveau pas.
export function reopen(e) {
  deps.onReopen?.(e);
  if (kinds.has(e.view)) show(e.view, argsOf(e));
  else deps.fallback.reopen?.(e);
}

export function currentPage() { return current(); }
export function goBack() { navBack(); }

export function backLabel() {
  const e = previous();
  if (!e) return null;
  const kind = kinds.get(e.view);
  return (kind ? kind.backLabel?.(argsOf(e)) : deps.fallback.backLabel?.(e)) ?? null;
}

// Ouvre la page d'une adresse (#group=…, un nom de texte…) ; false si elle n'en désigne aucune.
export function openFromAddress(hash) {
  const name = decodeURIComponent(hash.slice(1));
  if (!name) return false;
  for (const kind of kinds.values()) {
    const key = kind.address?.keys?.find(k => name.startsWith(k + "="));
    if (key === undefined) continue;
    const args = kind.address.read(name.slice(key.length + 1), hash.slice(hash.indexOf("=") + 1));
    if (args) show(kind.name, args);
    return true;
  }
  if (deps.fallback.readAddress?.(hash)) return true;
  for (const kind of kinds.values()) {
    if (!kind.address?.read || kind.address.keys) continue;
    const args = kind.address.read(name, hash.slice(1));
    if (args) { show(kind.name, args); return true; }
  }
  return false;
}

// History : le pas qu'ajoute une entrée, et l'entrée que rouvre un pas (null : pas de page enregistrée).
export function stepOf(e) { return kinds.get(e.view)?.step?.(argsOf(e)) ?? null; }
export function pageOfStep(s) {
  for (const kind of kinds.values()) {
    if (kind.fromStep?.kind !== s.kind) continue;
    const args = kind.fromStep.page(s.key);
    return args ? { view: kind.name, ...args } : null;
  }
  return null;
}
