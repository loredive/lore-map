// Les pages du panneau : chaque sorte de page (texte, groupe, aide…) s'enregistre ici une fois, et
// c'est ici seulement qu'on ouvre, réaffiche, ferme une page ou revient en arrière.
// Ce module ne touche ni au DOM ni à l'état partagé au chargement : le panneau, le dessin, le
// cadrage, la remise à zéro du focus et l'historique du navigateur lui sont donnés au démarrage
// (startPages), ce qui permet de le tester sous node.
//
// Une sorte de page déclare (seuls name et render sont obligatoires) :
//   name              "help", "doc", "cluster"… (la valeur de page dans l'historique, data-page du panneau)
//   address           { write(args) -> "#…" | null, keys: ["group", "groupe"], read(value, raw) -> args | null }
//                     write absent ou null : pas d'adresse propre. keys : les clés lues (#group=…), anciennes
//                     clés françaises comprises (lues, jamais écrites) ; sans keys, read reçoit l'adresse
//                     entière et n'est essayé qu'en dernier (un nom de texte).
//   backLabel(args)   « Back to … » quand cette page est la précédente
//   step(args)        le pas d'History qu'elle ajoute, {kind, key}, ou null
//   fromStep          { kind, page(key) -> args | null, label(key), kindLabel(key) } : les pas de cette sorte
//                     rouvrent cette page ; label et kindLabel les nomment dans la page History
//   replacesPrevious  true : une nouvelle entrée remplace la précédente de la même sorte (les résultats) ;
//                     sinon seule une entrée identique se remplace
//   keepsFocus        true : garde le focus de la carte (le texte) ; sinon on repart d'un focus neuf
//   clearsSearch      true : l'ouvrir vide la recherche (le chemin : elle a servi à choisir l'arrivée)
//   divert(args)      { page, …args } : ouvrir plutôt cette page-là (un texte choisi quand un chemin
//                     attend son arrivée ouvre le chemin) ; null : rien à détourner
//   onOpen(args)      ce qu'elle fait en s'ouvrant, hors de la carte et du panneau (annuler un chemin en
//                     attente) ; pas refait quand on la réaffiche
//   panel             false : la page « panneau fermé »
//   render(args, { from })  allume ce qu'il faut sur la carte et rend { html, bind(panel), announce, frame, side } ;
//                     frame : les étoiles à cadrer (deps.frame), ou une fonction qui cadre elle-même (le chemin) ;
//                     side : { html, bind(column) }, la colonne à gauche du panneau (la liste d'où vient un
//                     texte), cachée sans elle ; from : l'entrée d'où l'on vient (la page quittée, Retour compris), ou null
import { startNav, record, current, previous, goBack as navBack, onRecord } from "./nav.js";

const kinds = new Map();
let deps = null;

export function registerPage(kind) { kinds.set(kind.name, kind); }

// deps : panel, side (la colonne à gauche du panneau, facultative), browser (adaptateur de l'historique du navigateur), query() (la recherche en cours),
// clearSearch(), resetFocus(), top(backLabel) -> HTML de l'en-tête, bindTop(), focus(message),
// frame(stars), draw(), onReopen(entry) (avant de rouvrir une entrée).
export function startPages(d) {
  deps = d;
  startNav(d.browser, { addressOf, replaces, query: () => deps.query(), reopen });
}

const argsOf = ({ page, ...args }) => args;     // q : la recherche en cours, que nav.js ajoute

function addressOf(e) { return kinds.get(e.page)?.address?.write?.(argsOf(e)) ?? null; }

function replaces(a, b) {
  if (a.page !== b.page) return false;
  if (kinds.get(b.page)?.replacesPrevious) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

// La séquence d'ouverture, écrite une seule fois. e : une entrée {page, …args} ; from : l'entrée quittée.
function show(e, { rerender = false, fly = true, from = current() } = {}) {
  const name = e.page, args = argsOf(e);
  const kind = kinds.get(name), { panel, side } = deps;
  if (!kind) return;
  const inSide = side?.contains(side.ownerDocument.activeElement);    // un texte choisi dans la colonne
  if (!kind.keepsFocus) deps.resetFocus();
  if (!rerender && kind.clearsSearch) deps.clearSearch?.();
  if (!rerender) kind.onOpen?.(args);
  const page = kind.render(args, { from }) || {};
  panel.hidden = kind.panel === false;
  panel.dataset.page = kind.panel === false ? "" : name;
  if (!rerender) record({ page: name, ...args });
  if (side) showSide(side, kind.panel !== false && page.side);    // avant le cadrage : elle cache une part de la carte
  if (kind.panel !== false) {
    const scroll = rerender ? panel.scrollTop : 0;    // réaffichée : on reste où on lisait
    panel.innerHTML = deps.top(backLabel()) + page.html;
    deps.bindTop();
    panel.scrollTop = 0;
    page.bind?.(panel);                 // après : bind peut faire défiler jusqu'à un passage
    if (rerender) panel.scrollTop = scroll;
    if (!rerender) deps.focus(page.announce);
    if (inSide) side.querySelector("[aria-current]")?.focus({ preventScroll: true });   // on continue d'y choisir
    if (!rerender && fly && page.frame) typeof page.frame === "function" ? page.frame() : deps.frame(page.frame);
  }
  deps.draw();
}

// La colonne garde son défilement d'un texte à l'autre (et le focus quand on y a choisi le texte, plus haut).
function showSide(side, content) {
  const was = side.hidden ? 0 : side.scrollTop;
  side.hidden = !content;
  if (!content) { side.innerHTML = ""; return; }
  side.innerHTML = content.html;
  side.scrollTop = was;
  content.bind?.(side);
}

// Ouvre une page : openPage("help"), openPage("cluster", { id, label }, { fly: false }).
export function openPage(name, args = {}, opts = {}) {
  const to = kinds.get(name)?.divert?.(args);
  if (to) show(to);
  else show({ page: name, ...args }, opts);
}

// Réaffiche la page ouverte telle quelle (langue, catégories masquées).
export function rerenderPage() {
  const e = current();
  if (e) show(e, { rerender: true });
}

export function closePage() { show({ page: "none" }); }

// Rouvre une entrée de l'historique : Retour (nav.js n'enregistre alors rien), ou un pas d'History
// repris comme un nouveau pas.
export function reopen(e, from = current()) {
  deps.onReopen?.(e);
  show(e, { from });
}

export function currentPage() { return current(); }
export function goBack() { navBack(); }

export function backLabel() { return labelOf(previous()); }
// « Back to … » pour une entrée quelconque (la page d'une liste, dans la colonne)
export function labelOf(e) { return (e && kinds.get(e.page)?.backLabel?.(argsOf(e))) ?? null; }

// Ouvre la page d'une adresse (#group=…, un nom de texte…) ; false si elle n'en désigne aucune.
export function openFromAddress(hash) {
  const name = decodeURIComponent(hash.slice(1));
  if (!name) return false;
  for (const kind of kinds.values()) {
    const key = kind.address?.keys?.find(k => name.startsWith(k + "="));
    if (key === undefined) continue;
    const args = kind.address.read(name.slice(key.length + 1), hash.slice(hash.indexOf("=") + 1));
    if (!args) return false;                     // #group=Nope : une clé connue, mais rien à ouvrir
    show({ page: kind.name, ...args });
    return true;
  }
  for (const kind of kinds.values()) {
    if (!kind.address?.read || kind.address.keys) continue;
    const args = kind.address.read(name, hash.slice(1));
    if (args) { show({ page: kind.name, ...args }); return true; }
  }
  return false;
}

// Au chargement : la page de l'adresse, ou sinon le premier état, la carte seule (panneau fermé),
// pour que Retour depuis la page suivante y revienne.
export function openFirstPage(hash) {
  if (!openFromAddress(hash) && !current()) record({ page: "none" });
}

// History : le pas qu'ajoute une entrée, et l'entrée que rouvre un pas (null : pas de page enregistrée).
export function stepOf(e) { return kinds.get(e.page)?.step?.(argsOf(e)) ?? null; }
const kindOfStep = s => [...kinds.values()].find(k => k.fromStep?.kind === s.kind);
export function pageOfStep(s) {
  const kind = kindOfStep(s);
  const args = kind?.fromStep.page(s.key);
  return args ? { page: kind.name, ...args } : null;
}
// Le nom d'un pas et sa sorte (« Dialogue », « Group of texts »…), donnés par la page qu'il rouvre.
export function describeStep(s) {
  const from = kindOfStep(s)?.fromStep;
  return from ? { label: from.label(s.key), kind: from.kindLabel(s.key) } : null;
}
// Le nom et la sorte d'une entrée, comme pour son pas d'History ; null pour une page sans pas (les résultats)
export function describeEntry(e) {
  const s = stepOf(e);
  return s ? describeStep(s) : null;
}
// Prévient f du pas d'History de chaque page ouverte, Retour compris (null : une page qui n'en ajoute pas).
export function onStep(f) { onRecord(e => f(stepOf(e))); }
// Rouvre la page d'un pas d'History (« Continue where you left off ») ; rien si elle n'existe plus.
export function openStep(s) {
  const e = pageOfStep(s);
  if (e) reopen(e);
}
