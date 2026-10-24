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
  echoAdj: null,         // graphe des échos, construit au premier chemin
  bm25: null, emb: null, extractor: null, semanticState: "off",
  grid: null, sprites: {}, dust: [],
};

export function colorOf(catIdx) { return CAT_COLORS[S.cats[catIdx]] || "#cccccc"; }

export function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// minuscules sans accents : pour comparer une saisie à un nom
export function fold(s) { return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim(); }

export function clearHash() { history.replaceState(null, "", location.pathname + location.search); }
