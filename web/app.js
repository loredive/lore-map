import { BM25, tokenize, corpusText, lexicalRanking, hybridRanking } from "./search.js";

const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3";
const CAT_COLORS = {
  "Objets": "#d9c48e",
  "Armes": "#cf8e66",
  "Armures": "#9db8a3",
  "Talismans": "#c7a3d1",
  "Cendres de guerre": "#7fc0cc",
  "Compétences": "#e3dcc0",
  "Écrans de chargement": "#8394c4",
  "Dialogues": "#a7b6d6",
};
const GRACE = "#f0dc9f";
const MAX_HITS_ON_MAP = 150;
const MAX_RESULTS = 40;
const MIN_COHESION = 0.6;   // en dessous, un groupe est trop éparpillé dans cette vue pour y porter un nom
const MORPH_MS = 1100;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const $ = s => document.querySelector(s);
const canvas = $("#sky"), ctx = canvas.getContext("2d");
const panel = $("#panel"), tip = $("#tip"), status = $("#status"), input = $("#q"), mode = $("#mode");

const S = {
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
  bm25: null, emb: null, extractor: null, semanticState: "off",
  grid: null, sprites: {}, dust: [],
};

// ------------------------------------------------------------------ données
async function load() {
  let lore, meta;
  try {
    [lore, meta] = await Promise.all([
      fetch("data/lore.json").then(r => { if (!r.ok) throw r; return r.json(); }),
      fetch("data/meta.json").then(r => { if (!r.ok) throw r; return r.json(); }),
    ]);
  } catch {
    status.innerHTML = "Impossible de lire <code>data/lore.json</code>. Lance <code>python prepare.py</code>, " +
      "puis ouvre la page via un serveur local : <code>python -m http.server -d web</code>.";
    return;
  }
  const F = Object.fromEntries(lore.fields.map((f, i) => [f, i]));
  S.cats = lore.categories;
  S.clusters = lore.clusters.sort((a, b) => b.n - a.n);
  S.meta = meta;
  // chaque texte a une position par vue ([x1, y1, x2, y2…]) ; la première est la carte principale
  S.views = lore.views || ["Carte"];
  S.docs = lore.docs.map((r, i) => {
    const xy = F.xy !== undefined ? r[F.xy] : [r[F.x], r[F.y]];
    const views = S.views.map((_, k) => [xy[2 * k], xy[2 * k + 1]]);
    return { i, name: r[F.name], cat: r[F.cat], text: r[F.text], jp: r[F.jp], jpName: r[F.jpName],
             views, x: views[0][0], y: views[0][1], cluster: r[F.cluster], echoes: r[F.echoes] };
  });
  for (const c of S.clusters) {
    c.views = c.views || [{ x: c.x, y: c.y, cohesion: 1 }];
    Object.assign(c, { x: c.views[0].x, y: c.views[0].y });
  }
  S.entities = (lore.entities || []).sort((a, b) => b.docs.length - a.docs.length);
  S.docEntities = S.docs.map(() => []);
  S.entities.forEach(e => e.docs.forEach(i => S.docEntities[i].push(e)));
  S.bm25 = new BM25(S.docs.map(corpusText));
  buildGrid();
  buildSprites();
  buildLegend();
  buildViewSwitch();
  status.textContent = "";
  mode.textContent = meta.semantic ? "Recherche par mots-clés et par sens" : "Recherche par mots-clés";
  resize();
  openFromHash();
}

// Grille spatiale pour retrouver vite l'étoile sous le curseur
const CELL = 0.02;
function cellKey(cx, cy) { return cx * 100003 + cy; }
function buildGrid() {
  S.grid = new Map();
  for (const d of S.docs) {
    const k = cellKey(Math.floor(d.x / CELL), Math.floor(d.y / CELL));
    if (!S.grid.has(k)) S.grid.set(k, []);
    S.grid.get(k).push(d.i);
  }
}
function nearest(wx, wy, wr) {
  if (S.morphing) return -1;               // la grille ne suit pas les étoiles en mouvement
  let best = -1, bd = wr * wr;
  const r = Math.ceil(wr / CELL);
  const cx = Math.floor(wx / CELL), cy = Math.floor(wy / CELL);
  for (let i = cx - r; i <= cx + r; i++) for (let j = cy - r; j <= cy + r; j++) {
    const cell = S.grid.get(cellKey(i, j));
    if (!cell) continue;
    for (const k of cell) {
      const d = S.docs[k];
      if (S.hidden.has(d.cat)) continue;
      if (S.hits && !S.hits.has(k)) continue;
      const dd = (d.x - wx) ** 2 + (d.y - wy) ** 2;
      if (dd < bd) { bd = dd; best = k; }
    }
  }
  return best;
}

// ------------------------------------------------------------------ rendu
function colorOf(catIdx) { return CAT_COLORS[S.cats[catIdx]] || "#cccccc"; }

function sprite(color) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "#fffaf0");
  grad.addColorStop(0.12, color);
  grad.addColorStop(0.3, color + "55");
  grad.addColorStop(1, color + "00");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return c;
}
function buildSprites() {
  S.cats.forEach((c, i) => { S.sprites[i] = sprite(colorOf(i)); });
  S.sprites.grace = sprite(GRACE);
  // Poussière d'étoiles fixe en arrière-plan, pour la profondeur
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  S.dust = Array.from({ length: 260 }, () => [rnd(), rnd(), 0.3 + rnd() * 0.9, 0.05 + rnd() * 0.18]);
}

function resize() {
  S.dpr = Math.min(devicePixelRatio || 1, 2);
  S.W = innerWidth; S.H = innerHeight;
  canvas.width = S.W * S.dpr; canvas.height = S.H * S.dpr;
  S.base = Math.min(S.W, S.H) * 0.44;
  draw();
}

const toScreen = (x, y) => [
  S.W / 2 + (x - S.cam.x) * S.cam.s * S.base,
  S.H / 2 - (y - S.cam.y) * S.cam.s * S.base,
];
const toWorld = (sx, sy) => [
  S.cam.x + (sx - S.W / 2) / (S.cam.s * S.base),
  S.cam.y - (sy - S.H / 2) / (S.cam.s * S.base),
];

let frame = 0;
function draw() {
  if (!frame) frame = requestAnimationFrame(() => { frame = 0; render(); });
}

function render() {
  const { W, H, dpr } = S;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = "#c9d3ee";
  for (const [u, v, r, a] of S.dust) {
    ctx.globalAlpha = a;
    ctx.fillRect(u * W, v * H, r, r);
  }

  const r = Math.min(2.2 * Math.sqrt(S.cam.s), 9);   // rayon visuel d'une étoile
  const R = r * 3.2;                                   // halo
  const pad = R + 2;
  const sel = S.selected >= 0 ? S.docs[S.selected] : null;
  const echoSet = new Set(sel ? sel.echoes : []);

  // 1. toutes les étoiles visibles
  for (const d of S.docs) {
    if (S.hidden.has(d.cat)) continue;
    const [sx, sy] = toScreen(d.x, d.y);
    if (sx < -pad || sy < -pad || sx > W + pad || sy > H + pad) continue;
    const dim = (S.hits && !S.hits.has(d.i)) || (sel && d.i !== sel.i && !echoSet.has(d.i)) ||
      (!sel && S.cluster && d.cluster !== S.cluster.id) || (!sel && S.lit && !S.lit.has(d.i));
    ctx.globalAlpha = dim ? 0.13 : 0.9;
    ctx.drawImage(S.sprites[d.cat], sx - R, sy - R, 2 * R, 2 * R);
  }

  // 2. résultats de recherche : étoiles dorées, plus vives pour les premiers rangs
  if (S.hits && !sel) {
    for (const [i, rank] of S.hits) {
      const d = S.docs[i];
      if (S.hidden.has(d.cat)) continue;
      const [sx, sy] = toScreen(d.x, d.y);
      const k = rank < 10 ? 1.9 : rank < 40 ? 1.45 : 1.15;
      ctx.globalAlpha = rank < 40 ? 1 : 0.75;
      ctx.drawImage(S.sprites.grace, sx - R * k, sy - R * k, 2 * R * k, 2 * R * k);
    }
  }

  // 2 bis. textes d'une entité ouverte : étoiles dorées
  if (S.lit && !sel) {
    ctx.globalAlpha = 0.95;
    for (const i of S.lit) {
      const d = S.docs[i];
      if (S.hidden.has(d.cat)) continue;
      const [sx, sy] = toScreen(d.x, d.y);
      ctx.drawImage(S.sprites.grace, sx - R * 1.5, sy - R * 1.5, 3 * R, 3 * R);
    }
  }

  // 3. constellation : le texte choisi relié à ses échos
  if (sel) {
    const [x0, y0] = toScreen(sel.x, sel.y);
    ctx.strokeStyle = GRACE;
    ctx.lineWidth = 1;
    sel.echoes.forEach((e, k) => {
      const d = S.docs[e];
      const [x1, y1] = toScreen(d.x, d.y);
      ctx.globalAlpha = 0.65 - k * 0.05;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.drawImage(S.sprites[d.cat], x1 - R * 1.4, y1 - R * 1.4, 2.8 * R, 2.8 * R);
    });
    ctx.globalAlpha = 1;
    ctx.drawImage(S.sprites.grace, x0 - R * 2.2, y0 - R * 2.2, 4.4 * R, 4.4 * R);
    ctx.beginPath(); ctx.arc(x0, y0, R * 1.5 + 4, 0, Math.PI * 2);
    ctx.globalAlpha = 0.8; ctx.stroke();
  }

  // 4. noms des constellations (clusters), les plus grandes d'abord, sans chevauchement
  S.labelBoxes = [];
  if (!S.hits && !sel && !S.morphing) drawClusterLabels();

  // 5. étoile survolée
  if (S.hover >= 0) {
    const d = S.docs[S.hover];
    const [sx, sy] = toScreen(d.x, d.y);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#fffaf0";
    ctx.beginPath(); ctx.arc(sx, sy, r + 5, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawClusterLabels() {
  // le titre, la recherche et la légende comptent comme déjà occupés : pas de nom dessous
  const placed = [".masthead", ".seek", "#legend"].map(s => {
    const r = $(s).getBoundingClientRect();
    return [r.left, r.top, r.right, r.bottom];
  });
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const c of S.clusters) {
    if (c.views[S.view].cohesion < MIN_COHESION) continue;
    const size = Math.max(12, Math.min(25, 9 + Math.sqrt(c.n) * 0.95)) * Math.min(1.25, 0.85 + S.cam.s * 0.08);
    const [sx, sy] = toScreen(c.x, c.y);
    if (sx < -100 || sy < -30 || sx > S.W + 100 || sy > S.H + 30) continue;
    ctx.font = `italic 600 ${size}px "Cormorant Garamond", Georgia, serif`;
    const w = ctx.measureText(c.label).width;
    const box = [sx - w / 2 - 6, sy - size * 0.6 - 3, sx + w / 2 + 6, sy + size * 0.6 + 3];
    if (placed.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
    placed.push(box);
    S.labelBoxes.push([...box, c]);
    const on = S.cluster === c || S.hoverLabel === c;
    ctx.globalAlpha = on ? 1 : 0.85;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(14,19,34,.8)";
    ctx.strokeText(c.label, sx, sy);
    ctx.fillStyle = on ? GRACE : "#c3cde6";
    ctx.fillText(c.label, sx, sy);
  }
}

// ------------------------------------------------------------------ caméra
let anim = 0;
function flyTo(x, y, s, ms = 650) {
  cancelAnimationFrame(anim);
  if (reducedMotion) { Object.assign(S.cam, { x, y, s }); draw(); return; }
  const from = { ...S.cam }, t0 = performance.now();
  const ease = t => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  const step = now => {
    const t = Math.min(1, (now - t0) / ms), e = ease(t);
    S.cam.x = from.x + (x - from.x) * e;
    S.cam.y = from.y + (y - from.y) * e;
    S.cam.s = Math.exp(Math.log(from.s) + (Math.log(s) - Math.log(from.s)) * e);
    render();
    if (t < 1) anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}
function zoomAt(sx, sy, factor) {
  const [wx, wy] = toWorld(sx, sy);
  S.cam.s = Math.max(0.6, Math.min(80, S.cam.s * factor));
  const [nx, ny] = toWorld(sx, sy);
  S.cam.x += wx - nx; S.cam.y += wy - ny;
  draw();
}
// Centre la vue sur un point en tenant compte du panneau ouvert à droite
function focusDoc(d, s) {
  const offset = panel.hidden || innerWidth <= 760 ? 0 : 210 / (s * S.base);
  const yOff = innerWidth <= 760 ? -innerHeight * 0.22 / (s * S.base) : 0;
  flyTo(d.x + offset, d.y + yOff, s);
}

// ------------------------------------------------------------------ interactions
const pointers = new Map();
let drag = null, pinch = null;

canvas.addEventListener("pointerdown", e => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, moved: 0 };
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) };
    drag = null;
  }
});
canvas.addEventListener("pointermove", e => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / pinch.d);
    pinch.d = d;
    return;
  }
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.moved > 3) {
      canvas.classList.add("dragging");
      S.cam.x -= dx / (S.cam.s * S.base);
      S.cam.y += dy / (S.cam.s * S.base);
      drag.x = e.clientX; drag.y = e.clientY;
      setHover(-1);
      draw();
      return;
    }
  }
  if (e.pointerType === "mouse") updateHover(e.clientX, e.clientY);
});
canvas.addEventListener("pointerup", e => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  canvas.classList.remove("dragging");
  if (drag && drag.moved <= 3) {
    // une étoile tout près du curseur passe avant le nom de groupe dessiné par-dessus
    const near = pick(e.clientX, e.clientY, 5);
    const label = near < 0 ? labelAt(e.clientX, e.clientY) : null;
    const i = near >= 0 ? near : label ? -1 : pick(e.clientX, e.clientY, e.pointerType === "mouse" ? 12 : 22);
    if (i >= 0) select(i);
    else if (label) openCluster(label);
    else if (S.selected >= 0) deselect();
    else if (!panel.hidden && panel.dataset.view !== "results") closePanel();
  }
  drag = null;
});
canvas.addEventListener("pointercancel", e => { pointers.delete(e.pointerId); drag = pinch = null; });
canvas.addEventListener("pointerleave", () => { S.hoverLabel = null; setHover(-1); });
canvas.addEventListener("wheel", e => {
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015)));
}, { passive: false });
canvas.addEventListener("dblclick", e => zoomAt(e.clientX, e.clientY, 2.2));
addEventListener("resize", resize);

addEventListener("keydown", e => {
  const typing = document.activeElement === input;
  if (e.key === "/" && !typing) { e.preventDefault(); input.focus(); input.select(); return; }
  if (e.key === "Escape") {
    if (S.selected >= 0) deselect();
    else if (!panel.hidden && panel.dataset.view !== "results") closePanel();
    else if (input.value) { input.value = ""; runSearch(); }
    return;
  }
  if (typing || document.activeElement?.closest("#panel")) return;
  const step = 80 / (S.cam.s * S.base);
  const keys = {
    "+": () => zoomAt(S.W / 2, S.H / 2, 1.3), "=": () => zoomAt(S.W / 2, S.H / 2, 1.3),
    "-": () => zoomAt(S.W / 2, S.H / 2, 1 / 1.3),
    ArrowLeft: () => { S.cam.x -= step; draw(); }, ArrowRight: () => { S.cam.x += step; draw(); },
    ArrowUp: () => { S.cam.y += step; draw(); }, ArrowDown: () => { S.cam.y -= step; draw(); },
    "0": () => flyTo(0, 0, 1),
  };
  if (keys[e.key]) { e.preventDefault(); keys[e.key](); }
});

function pick(sx, sy, px) {
  const [wx, wy] = toWorld(sx, sy);
  return nearest(wx, wy, px / (S.cam.s * S.base));
}
function labelAt(sx, sy) {
  const b = S.labelBoxes.find(([x0, y0, x1, y1]) => sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1);
  return b ? b[4] : null;
}
function updateHover(sx, sy) {
  const near = pick(sx, sy, 5);
  const label = near < 0 ? labelAt(sx, sy) : null;
  if (label !== S.hoverLabel) { S.hoverLabel = label; draw(); }
  const i = near >= 0 || label ? near : pick(sx, sy, 12);
  setHover(i);
  canvas.classList.toggle("pointing", i >= 0 || !!label);
  if (i >= 0) {
    const d = S.docs[i];
    tip.innerHTML = `<span class="name">${esc(d.name)}</span><span class="sub">${esc(S.cats[d.cat])}</span>`;
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.min(sx + 16, S.W - tw - 8) + "px";
    tip.style.top = Math.min(sy + 14, S.H - th - 8) + "px";
  }
}
function setHover(i) {
  if (i === S.hover) return;
  S.hover = i;
  if (i < 0) tip.hidden = true;
  canvas.classList.toggle("pointing", i >= 0);
  draw();
}

// ------------------------------------------------------------------ légende
function buildLegend() {
  const counts = new Map();
  for (const d of S.docs) counts.set(d.cat, (counts.get(d.cat) || 0) + 1);
  const nav = $("#legend");
  S.cats.forEach((c, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-pressed", "true");
    b.innerHTML = `<span class="dot" style="--c:${colorOf(i)}"></span><span class="label">${esc(c)}</span> <span class="n">${counts.get(i) || 0}</span>`;
    b.title = c;
    b.addEventListener("click", () => {
      const on = S.hidden.has(i);
      on ? S.hidden.delete(i) : S.hidden.add(i);
      b.setAttribute("aria-pressed", String(on));
      if (S.results.length && S.selected < 0) renderResults();
      else if (S.cluster && S.selected < 0) openCluster(S.cluster, { fly: false });
      else if (S.entity && S.selected < 0) openEntity(S.entity, { fly: false });
      draw();
    });
    nav.append(b);
  });
}

// ------------------------------------------------------------------ vues (projections)
// Les mêmes textes et les mêmes groupes, aplatis autrement : passer d'une vue à l'autre
// fait glisser les étoiles, ce qui montre que seules les proximités ont un sens.
function buildViewSwitch() {
  const box = $("#views");
  if (S.views.length < 2) return;
  box.hidden = false;
  box.innerHTML = `<span class="label">Projection</span>${S.views.map((v, k) =>
    `<button type="button" data-v="${k}" aria-pressed="${k === S.view}">${esc(v)}</button>`).join("")}`;
  box.querySelectorAll("button").forEach(b => b.addEventListener("click", () => setView(+b.dataset.v)));
}

let morph = 0;
function setView(k) {
  if (k === S.view) return;
  S.view = k;
  $("#views").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.v === k)));
  const from = S.docs.map(d => [d.x, d.y]), cfrom = S.clusters.map(c => [c.x, c.y]);
  const place = e => {
    S.docs.forEach((d, i) => {
      d.x = from[i][0] + (d.views[k][0] - from[i][0]) * e;
      d.y = from[i][1] + (d.views[k][1] - from[i][1]) * e;
    });
    S.clusters.forEach((c, i) => {
      c.x = cfrom[i][0] + (c.views[k].x - cfrom[i][0]) * e;
      c.y = cfrom[i][1] + (c.views[k].y - cfrom[i][1]) * e;
    });
  };
  const done = () => { S.morphing = false; buildGrid(); draw(); };
  cancelAnimationFrame(morph);
  setHover(-1);
  if (reducedMotion) { place(1); done(); return; }
  S.morphing = true;
  const t0 = performance.now();
  const ease = t => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  const step = now => {
    const t = Math.min(1, (now - t0) / MORPH_MS);
    place(ease(t));
    render();
    if (t < 1) morph = requestAnimationFrame(step); else done();
  };
  morph = requestAnimationFrame(step);
}

// ------------------------------------------------------------------ recherche
let searchSeq = 0, debounce = 0;
input.addEventListener("input", () => { clearTimeout(debounce); debounce = setTimeout(runSearch, 180); });

async function runSearch() {
  const q = input.value.trim();
  const seq = ++searchSeq;
  if (q.length < 2) {
    S.hits = null; S.results = [];
    if (S.selected < 0 && panel.dataset.view === "results") panel.hidden = true;
    mode.textContent = S.meta?.semantic ? "Recherche par mots-clés et par sens" : "Recherche par mots-clés";
    draw();
    return;
  }
  const lexical = lexicalRanking(S.bm25, q);
  applyResults(lexical, q);                       // réponse immédiate
  if (!S.meta.semantic) return;

  const qv = await embedQuery(q);
  if (!qv || seq !== searchSeq) return;
  applyResults(hybridRanking(lexical, qv, S.emb, S.meta.dim), q);
  mode.textContent = "Résultats par mots-clés et par sens";
}

function applyResults(ranked, q) {
  S.cluster = S.entity = S.lit = null;
  S.results = ranked.map(([i]) => i);
  S.hits = new Map(S.results.slice(0, MAX_HITS_ON_MAP).map((i, r) => [i, r]));
  S.query = q;
  if (S.selected < 0) renderResults();
  draw();
}

async function embedQuery(q) {
  try {
    if (!S.extractor) {
      S.semanticState = "loading";
      mode.textContent = "Chargement du modèle de recherche par sens (une seule fois, ~120 Mo)…";
      const [{ pipeline }, buf] = await Promise.all([
        import(TRANSFORMERS_URL),
        fetch("data/emb.bin").then(r => r.arrayBuffer()),
      ]);
      S.emb = new Int8Array(buf);
      S.extractor = await pipeline("feature-extraction", S.meta.model);
      S.semanticState = "ready";
    }
    const out = await S.extractor(S.meta.queryPrefix + q, { pooling: "mean", normalize: true });
    return out.data;
  } catch (err) {
    console.warn(err);
    S.meta.semantic = false;
    mode.textContent = "Recherche par sens indisponible (modèle non chargé) : mots-clés seulement";
    return null;
  }
}

function renderResults() {
  const visible = S.results.filter(i => !S.hidden.has(S.docs[i].cat));
  const shown = visible.slice(0, MAX_RESULTS);
  const terms = tokenize(S.query || "");
  panel.hidden = false;
  panel.dataset.view = "results";
  if (!shown.length) {
    panel.innerHTML = `<p class="count">Aucun texte ne correspond. Essaie un nom propre (Marika, Ranni) ou un mot du jeu en anglais.</p>`;
    return;
  }
  const more = visible.length > shown.length ? `, les ${shown.length} premiers ci-dessous` : "";
  // une recherche qui nomme une entité connue mène à sa fiche
  const q = fold(S.query || "");
  const known = S.entities.find(e => [e.name, e.label, ...e.aliases].some(n => fold(n) === q));
  panel.innerHTML = `${known ? `<button type="button" class="entity-link" data-e="${S.entities.indexOf(known)}">
      Fiche « ${esc(known.label)} » : ${known.docs.length} textes qui en parlent</button>` : ""}
    <p class="count">${visible.length} textes trouvés${more}. Les plus pertinents brillent sur la carte.</p>
    <ol class="results">${shown.map(i => {
      const d = S.docs[i];
      return `<li><button type="button" data-i="${i}">
        <span class="head"><span class="dot" style="--c:${colorOf(d.cat)}"></span><span class="name">${mark(esc(d.name), terms)}</span></span>
        <span class="snip">${mark(esc(snippet(d.text, terms)), terms)}</span></button></li>`;
    }).join("")}</ol>`;
  panel.querySelectorAll("button[data-i]").forEach(b =>
    b.addEventListener("click", () => select(+b.dataset.i)));
  bindEntityButtons();
  panel.scrollTop = 0;
}

function fold(s) { return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim(); }

function snippet(text, terms, len = 150) {
  const flat = text.replace(/\s+/g, " ");
  const low = flat.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  let at = -1;
  for (const t of terms) { at = low.indexOf(t); if (at >= 0) break; }
  if (at < 0) return flat.length > len ? flat.slice(0, len) + "…" : flat;
  const start = Math.max(0, flat.lastIndexOf(" ", Math.max(0, at - 50)));
  const s = flat.slice(start, start + len).trim();
  return (start > 0 ? "…" : "") + s + (start + len < flat.length ? "…" : "");
}
function mark(html, terms) {
  if (!terms.length) return html;
  const re = new RegExp(`\\b(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\w*`, "gi");
  return html.replace(re, "<mark>$&</mark>");
}

// ------------------------------------------------------------------ fiche d'un texte
function select(i, { fly = true } = {}) {
  S.selected = i;
  const d = S.docs[i];
  const terms = tokenize(S.query || "");
  panel.hidden = false;
  panel.dataset.view = "doc";
  const back = S.results.length ? "Retour aux résultats"
    : S.cluster ? `Retour au groupe « ${S.cluster.label} »`
    : S.entity ? `Retour à « ${S.entity.label} »` : "";
  const mentions = S.docEntities[i];
  panel.innerHTML = `<article class="card">
    ${back ? `<button type="button" class="back">${esc(back)}</button>` : ""}
    <div class="cat"><span class="dot" style="--c:${colorOf(d.cat)}"></span>${esc(S.cats[d.cat])}</div>
    <h2>${esc(d.name)}</h2>
    ${d.jpName ? `<p class="jpname" lang="ja">${esc(d.jpName)}</p>` : ""}
    <p class="text">${mark(esc(d.text), terms)}</p>
    <div class="jp" lang="ja" hidden>${esc(d.jp)}</div>
    <div class="tools">
      ${d.jp ? `<button type="button" class="tjp" aria-expanded="false">Voir le texte japonais</button>` : ""}
      <button type="button" class="tlink">Copier le lien vers ce texte</button>
    </div>
    ${mentions.length ? `<h3>Mentionne</h3>
    <p class="hint">Personnages, lieux et notions cités : chacun ouvre les autres textes qui en parlent.</p>
    ${entityChips(mentions)}` : ""}
    <h3>Échos</h3>
    <p class="hint">Les textes les plus proches par le sens, reliés à celui-ci sur la carte.</p>
    <ol class="echoes">${d.echoes.map(e => {
      const x = S.docs[e];
      return `<li><button type="button" data-i="${e}"><span class="head"><span class="dot" style="--c:${colorOf(x.cat)}"></span><span class="name">${esc(x.name)}</span></span><small>${esc(S.cats[x.cat])}</small></button></li>`;
    }).join("")}</ol>
  </article>`;
  panel.querySelector(".back")?.addEventListener("click", deselect);
  panel.querySelector(".tjp")?.addEventListener("click", ev => {
    const jp = panel.querySelector(".jp"), open = jp.hidden;
    jp.hidden = !open;
    ev.target.setAttribute("aria-expanded", String(open));
    ev.target.textContent = open ? "Masquer le texte japonais" : "Voir le texte japonais";
  });
  panel.querySelector(".tlink").addEventListener("click", ev => {
    navigator.clipboard?.writeText(location.href).then(() => { ev.target.textContent = "Lien copié"; });
  });
  panel.querySelectorAll(".echoes button").forEach(b => b.addEventListener("click", () => select(+b.dataset.i)));
  bindEntityButtons();
  panel.scrollTop = 0;
  history.replaceState(null, "", "#" + encodeURIComponent(d.name));
  if (fly) focusDoc(d, Math.max(S.cam.s, 4));
  draw();
}

function deselect() {
  S.selected = -1;
  history.replaceState(null, "", location.pathname + location.search);
  if (S.results.length) renderResults();
  else if (S.cluster) openCluster(S.cluster, { fly: false });
  else if (S.entity) openEntity(S.entity, { fly: false });
  else panel.hidden = true;
  draw();
}

// ------------------------------------------------------------------ fiche d'un groupe
function openCluster(c, { fly = true } = {}) {
  S.cluster = c;
  S.entity = S.lit = null;
  S.selected = -1;
  const members = S.docs.filter(d => d.cluster === c.id);
  // les textes du cœur du groupe d'abord
  const dist = d => (d.x - c.x) ** 2 + (d.y - c.y) ** 2;
  members.sort((a, b) => dist(a) - dist(b));
  const visible = members.filter(d => !S.hidden.has(d.cat));
  const keywords = c.keywords && c.keywords !== c.label
    ? `<p class="keywords"><span>Mots clés</span> ${esc(c.keywords)}</p>` : "";
  panel.hidden = false;
  panel.dataset.view = "cluster";
  panel.innerHTML = `<article class="card">
    <div class="cat">Groupe de textes</div>
    <h2>${esc(c.label)}</h2>
    ${c.description ? `<p class="text">${esc(c.description)}</p>` : ""}
    <p class="count">${c.n} textes${visible.length < members.length ? `, dont ${visible.length} dans les catégories affichées` : ""}.</p>
    ${keywords}
    <ol class="results">${visible.map(d => `<li><button type="button" data-i="${d.i}">
        <span class="head"><span class="dot" style="--c:${colorOf(d.cat)}"></span><span class="name">${esc(d.name)}</span></span>
        <span class="snip">${esc(snippet(d.text, []))}</span></button></li>`).join("")}</ol>
  </article>`;
  panel.querySelectorAll("button[data-i]").forEach(b =>
    b.addEventListener("click", () => select(+b.dataset.i)));
  panel.scrollTop = 0;
  history.replaceState(null, "", location.pathname + location.search);
  if (fly) {
    // zoom pour que la plupart des étoiles du groupe tiennent à l'écran
    const r = Math.sqrt(dist(members[Math.floor(members.length * 0.9)] || c)) || 0.1;
    focusDoc(c, Math.max(1, Math.min(12, 0.8 / r)));
  }
  draw();
}

function closePanel() {
  S.cluster = S.entity = S.lit = null;
  panel.hidden = true;
  panel.dataset.view = "";
  history.replaceState(null, "", location.pathname + location.search);
  draw();
}

// ------------------------------------------------------------------ personnages, lieux…
const KIND_LABELS = { personnage: ["Personnage", "Personnages"], lieu: ["Lieu", "Lieux"],
                      faction: ["Faction", "Factions"], notion: ["Notion", "Notions"] };

function entityChips(list) {
  return `<div class="chips">${list.map(e => `<button type="button" class="chip" data-e="${S.entities.indexOf(e)}">
    ${esc(e.label)} <span class="n">${e.docs.length}</span></button>`).join("")}</div>`;
}
function bindEntityButtons() {
  panel.querySelectorAll("button[data-e]").forEach(b =>
    b.addEventListener("click", () => openEntity(S.entities[+b.dataset.e])));
}

function showIndex() {
  S.cluster = S.entity = S.lit = null;
  S.selected = -1;
  panel.hidden = false;
  panel.dataset.view = "index";
  panel.innerHTML = `<article class="card">
    <h2>Personnages et lieux</h2>
    <p class="hint">Le chiffre indique combien de textes en parlent. Chacun ouvre ces textes et les fait briller sur la carte.</p>
    ${Object.entries(KIND_LABELS).map(([k, [, plural]]) => {
      const list = S.entities.filter(e => e.kind === k);
      return list.length ? `<h3>${plural}</h3>${entityChips(list)}` : "";
    }).join("")}
  </article>`;
  bindEntityButtons();
  panel.scrollTop = 0;
  history.replaceState(null, "", location.pathname + location.search);
  draw();
}

function openEntity(e, { fly = true } = {}) {
  S.entity = e;
  S.cluster = null;
  S.selected = -1;
  S.lit = new Set(e.docs);
  const docs = e.docs.map(i => S.docs[i]);
  const visible = docs.filter(d => !S.hidden.has(d.cat));
  // snippet() cherche dans le texte replié (minuscules, sans accents), mark() surligne les noms tels quels
  const names = [e.name, ...e.aliases], folded = names.map(fold);
  // les groupes où l'entité revient le plus : là où son histoire se raconte
  const counts = new Map();
  for (const d of docs) if (d.cluster >= 0) counts.set(d.cluster, (counts.get(d.cluster) || 0) + 1);
  const groups = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([id, n]) => [S.clusters.find(c => c.id === id), n]).filter(([c]) => c);
  panel.hidden = false;
  panel.dataset.view = "entity";
  panel.innerHTML = `<article class="card">
    <button type="button" class="back">Tous les personnages et lieux</button>
    <div class="cat">${KIND_LABELS[e.kind][0]}</div>
    <h2>${esc(e.label)}</h2>
    ${e.label !== e.name ? `<p class="jpname">${esc(e.name)} dans les textes</p>` : ""}
    <p class="count">${e.docs.length} textes en parlent${visible.length < docs.length ? `, dont ${visible.length} dans les catégories affichées` : ""}. Ils brillent sur la carte.</p>
    ${groups.length ? `<h3>Surtout dans</h3><div class="chips">${groups.map(([c, n]) =>
      `<button type="button" class="chip" data-c="${c.id}">${esc(c.label)} <span class="n">${n}</span></button>`).join("")}</div>` : ""}
    <h3>Les textes</h3>
    <ol class="results">${visible.map(d => `<li><button type="button" data-i="${d.i}">
        <span class="head"><span class="dot" style="--c:${colorOf(d.cat)}"></span><span class="name">${mark(esc(d.name), names)}</span></span>
        <span class="snip">${mark(esc(snippet(d.text, folded)), names)}</span></button></li>`).join("")}</ol>
  </article>`;
  panel.querySelector(".back").addEventListener("click", showIndex);
  panel.querySelectorAll("button[data-i]").forEach(b => b.addEventListener("click", () => select(+b.dataset.i)));
  panel.querySelectorAll("button[data-c]").forEach(b =>
    b.addEventListener("click", () => openCluster(S.clusters.find(c => c.id === +b.dataset.c))));
  panel.scrollTop = 0;
  history.replaceState(null, "", "#entite=" + encodeURIComponent(e.name));
  if (fly && docs.length) {
    const xs = docs.map(d => d.x).sort((a, b) => a - b), ys = docs.map(d => d.y).sort((a, b) => a - b);
    const at = (a, q) => a[Math.min(a.length - 1, Math.floor(a.length * q))];
    const center = { x: at(xs, 0.5), y: at(ys, 0.5) };
    const r = Math.max(at(xs, 0.9) - at(xs, 0.1), at(ys, 0.9) - at(ys, 0.1)) / 2 || 0.1;
    focusDoc(center, Math.max(0.8, Math.min(12, 0.8 / r)));
  }
  draw();
}
$("#index").addEventListener("click", showIndex);

function showHelp() {
  S.cluster = S.entity = S.lit = null;
  if (S.selected >= 0) { S.selected = -1; history.replaceState(null, "", location.pathname + location.search); }
  panel.hidden = false;
  panel.dataset.view = "help";
  panel.innerHTML = `<article class="card">
    <h2>Comment lire cette carte</h2>
    <ul class="help">
      <li>Chaque point est un texte du jeu : objet, arme, armure, dialogue…</li>
      <li>Les textes proches parlent des mêmes choses ; les éloignés, d'autres sujets.</li>
      <li>Les noms écrits sur la carte désignent des groupes de textes voisins.</li>
      <li>Cliquer un point pour le lire, ou un nom pour parcourir son groupe.</li>
    </ul>
  </article>`;
  panel.scrollTop = 0;
  draw();
}
$("#help").addEventListener("click", showHelp);

function openFromHash() {
  const name = decodeURIComponent(location.hash.slice(1));
  if (!name) return;
  if (name.startsWith("entite=")) {
    const e = S.entities.find(x => x.name === name.slice(7));
    if (e) openEntity(e);
    return;
  }
  const d = S.docs.find(x => x.name === name);
  if (d) select(d.i);
}

// lien collé dans la barre d'adresse sans recharger la page (replaceState ne déclenche pas l'événement)
addEventListener("hashchange", () => { if (S.docs.length) openFromHash(); });

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

load();
