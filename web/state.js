// État partagé de la page, constantes et petits utilitaires communs aux modules.

// Jeu affiché : ?game=elden-ring ; sans paramètre (ou jeu inconnu), Bloodborne. Ses données sont
// dans data/<jeu>/, ses images dans img/<jeu>/, et data/<jeu>/game.json donne couleurs et exemples.
export const DEFAULT_GAME = "bloodborne";
export const dataPath = f => `data/${S.game}/${f}`;
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
  game: DEFAULT_GAME, games: [], colors: {}, ui: {},   // jeu affiché, jeux disponibles, game.json
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
  images: new Map(),     // nom du texte -> icône (ou portrait de l'interlocuteur), data/images.json
  visited: new Set(), trailDocs: [], cameFrom: -1, trailShown: false,   // parcours de lecture (history-ui.js)
  tours: [], tour: null, tourStep: -1,   // visites guidées (tours-ui.js) ; visite ouverte et son étape
  altLang: false,        // textes affichés dans la seconde langue du jeu (Bloodborne : le français officiel)
};

// Ce qu'on affiche d'un texte : son nom et son texte dans la langue choisie. Le nom anglais (d.name)
// reste l'identifiant partout ailleurs (liens, historique, visites, icônes).
export const nameOf = d => (S.altLang && d.altName) || d.name;
export const textOf = d => (S.altLang && d.alt) || d.text;
export const textLang = d => (S.altLang && d.alt ? S.ui.alt_lang : "en");
// de même pour un groupe : son titre et sa description ; le titre anglais (c.label) reste l'identifiant
export const groupName = c => (S.altLang && c.altLabel) || c.label;
export const groupDesc = c => (S.altLang && c.altDescription) || c.description;

// Icône d'un texte, ou portrait du PNJ pour un passage de dialogue ; "" sans image.
// Décorative (alt vide) : le nom est toujours écrit à côté.
export function portrait(d, cls, size) {
  const f = S.images.get(d.name);
  // portrait de PNJ (paysage) : recadré pour remplir le cadre ; icône d'objet : entière
  return f ? `<img class="${cls}${f.startsWith("pnj-") ? " face" : ""}" src="img/${S.game}/${f}.webp" alt="" width="${size}" height="${size}" loading="lazy" decoding="async">` : "";
}

export function colorOf(catIdx) { return S.colors[S.cats[catIdx]] || "#cccccc"; }

// texte masqué : sa catégorie est décochée dans la légende, ou il vient du DLC et le DLC est masqué
// les étoiles d'un groupe dans la vue k ; dans les rayons, celles de son plus gros bloc seulement
export function membersIn(c, k) {
  const b = c.views[k].block;
  return b ? b.map(i => S.docs[i]) : S.docs.filter(d => d.cluster === c.id);
}

export function isHidden(d) { return S.hidden.has(d.cat) || (S.hideDlc && d.dlc); }

export function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// minuscules sans accents : pour comparer une saisie à un nom
export function fold(s) { return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim(); }

// Ce qu'affiche le panneau (groupe, entité, chemin) : un seul à la fois.
export function resetContext() { S.cluster = S.entity = S.lit = S.path = S.pathSet = S.thread = S.tour = null; S.tourStep = -1; }

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

