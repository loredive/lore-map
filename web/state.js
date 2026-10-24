// État partagé de la page, constantes et petits utilitaires communs aux modules.

export const CAT_COLORS = {
  "Objets": "#d9c48e",
  "Armes": "#cf8e66",
  "Armures": "#9db8a3",
  "Talismans": "#c7a3d1",
  "Cendres de guerre": "#7fc0cc",
  "Compétences": "#e3dcc0",
  "Écrans de chargement": "#8394c4",
  "Dialogues": "#a7b6d6",
};
export const GRACE = "#f0dc9f";
export const MAX_HITS_ON_MAP = 150;
export const MAX_RESULTS = 40;
export const MIN_COHESION = 0.6;   // en dessous, un groupe est trop éparpillé dans cette vue pour y porter un nom
export const MORPH_MS = 1100;
export const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

export const $ = s => document.querySelector(s);
export const canvas = $("#sky"), ctx = canvas.getContext("2d");
export const panel = $("#panel"), tip = $("#tip"), status = $("#status"), input = $("#q"), mode = $("#mode");

export const S = {
  docs: [], cats: [], clusters: [], meta: null,
  cam: { x: 0, y: 0, s: 1 },
  W: 0, H: 0, dpr: 1, base: 1,
  hover: -1, selected: -1,
  kbd: false,            // la carte a le focus clavier : viseur au centre
  views: [], view: 0, morphing: false,   // projections disponibles, vue affichée, transition en cours
  cluster: null,         // groupe ouvert dans le panneau
  entities: [], docEntities: [],   // personnages, lieux… et, par texte, ceux qu'il mentionne
  entity: null,          // entité ouverte dans le panneau (exclusif avec cluster)
  lit: null,             // Set des textes de l'entité ouverte, dorés sur la carte
  hoverLabel: null,      // groupe dont le nom est survolé
  labelBoxes: [],        // [x0, y0, x1, y1, cluster] des noms de groupes dessinés
  hits: null,            // Map index -> rang, résultats affichés sur la carte
  results: [],           // liste ordonnée d'indices
  hidden: new Set(),     // catégories masquées
  pathFrom: -1,          // texte de départ d'un chemin en attente de son arrivée
  path: null, pathSet: null,   // chemin d'échos affiché (indices) et le même en Set
  echoAdj: null,
  dialogues: new Map(), thread: null,   // passages de chaque PNJ ; fil du dialogue ouvert         // graphe des échos, construit au premier chemin
  bm25: null, emb: null, extractor: null, semanticState: "off",
  grid: null, sprites: {}, dust: [],
};

export function colorOf(catIdx) { return CAT_COLORS[S.cats[catIdx]] || "#cccccc"; }

export function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// minuscules sans accents : pour comparer une saisie à un nom
export function fold(s) { return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim(); }

// Ce qu'affiche le panneau (groupe, entité, chemin) : un seul à la fois.
export function resetContext() { S.cluster = S.entity = S.lit = S.path = S.pathSet = S.thread = null; }

export function clusterById(id) { return S.clusters.find(c => c.id === id); }

// Une ligne de liste de textes (résultats, groupe, entité, chemin) : nom et extrait déjà en HTML.
export function docRow(d, nameHtml, snipHtml, lead = "") {
  return `<li><button type="button" data-i="${d.i}">
    <span class="head">${lead}<span class="dot" style="--c:${colorOf(d.cat)}"></span><span class="name">${nameHtml}</span></span>
    <span class="snip">${snipHtml}</span></button></li>`;
}

// Accessibilité : le titre de ce qui vient de s'ouvrir reçoit le focus, et un court message
// est lu par les lecteurs d'écran (le panneau entier n'est plus une région « live »).
export function announce(msg) {
  const a = $("#announce");
  a.textContent = "";
  requestAnimationFrame(() => { a.textContent = msg; });
}
export function focusPanel(msg) {
  const h = panel.querySelector("h2");
  if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  if (msg) announce(msg);
}

