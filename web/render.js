// Rendu du ciel sur le canvas : grille de sélection, étoiles, noms des groupes, caméra.
import { S, $, canvas, ctx, panel, tip, GRACE, MIN_COHESION, reducedMotion, colorOf } from "./state.js";

// Grille spatiale pour retrouver vite l'étoile sous le curseur
const CELL = 0.02;
function cellKey(cx, cy) { return cx * 100003 + cy; }
export function buildGrid() {
  S.grid = new Map();
  for (const d of S.docs) {
    const k = cellKey(Math.floor(d.x / CELL), Math.floor(d.y / CELL));
    if (!S.grid.has(k)) S.grid.set(k, []);
    S.grid.get(k).push(d.i);
  }
}
export function nearest(wx, wy, wr) {
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

// ------------------------------------------------------------------ contours des groupes
// Comme les frontières des constellations sur les atlas anciens : l'enveloppe convexe des
// 90 % de textes les plus centraux du groupe (les isolés tireraient le contour), arrondie.
function convexHull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = list => {
    const h = [];
    for (const q of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop();
      h.push(q);
    }
    return h.slice(0, -1);
  };
  return [...half(p), ...half([...p].reverse())];
}
// Trace autour d'un polygone convexe (coordonnées écran) une bande de rayon pad : côtés repoussés
// vers l'extérieur et arcs autour des sommets. Contrairement à un lissage par coupe des coins,
// la forme contient toujours tous les points.
function roundedBuffer(poly, pad) {
  let area = 0;
  poly.forEach(([x0, y0], i) => { const [x1, y1] = poly[(i + 1) % poly.length]; area += x0 * y1 - x1 * y0; });
  const sign = area > 0 ? 1 : -1;                     // sens de parcours à l'écran (y vers le bas)
  const normal = (a, b) => {                          // normale extérieure du côté a -> b
    const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1;
    return [sign * dy / n, -sign * dx / n];
  };
  ctx.beginPath();
  poly.forEach((v, i) => {
    const prev = poly[(i - 1 + poly.length) % poly.length], next = poly[(i + 1) % poly.length];
    const n1 = normal(prev, v), n2 = normal(v, next);
    ctx.arc(v[0], v[1], pad, Math.atan2(n1[1], n1[0]), Math.atan2(n2[1], n2[0]), sign < 0);
  });
  ctx.closePath();
}
export function computeHulls() {
  for (const c of S.clusters) {
    c.hulls = S.views.map((_, k) => {
      const pts = S.docs.filter(d => d.cluster === c.id).map(d => d.views[k]);
      const cx = c.views[k].x, cy = c.views[k].y;   // médiane du groupe : les plus centraux d'abord
      pts.sort((a, b) => ((a[0] - cx) ** 2 + (a[1] - cy) ** 2) - ((b[0] - cx) ** 2 + (b[1] - cy) ** 2));
      // vue d'ensemble : le cœur du groupe ; groupe ouvert : tous ses textes, aucun hors du trait
      const core = convexHull(pts.slice(0, Math.max(3, Math.ceil(pts.length * 0.9))));
      return { core, full: convexHull(pts) };
    });
  }
}
function drawHulls(sel) {
  ctx.save();
  ctx.lineJoin = "round";
  for (const c of S.clusters) {
    const h = c.hulls?.[S.view];
    const on = S.cluster === c || S.hoverLabel === c;
    const hull = on ? h?.full : h?.core;
    if (!hull || hull.length < 3 || c.views[S.view].cohesion < MIN_COHESION) continue;
    if (sel && !on) continue;
    // marge de quelques pixels autour des étoiles, quel que soit le zoom
    roundedBuffer(hull.map(([x, y]) => toScreen(x, y)), 12);
    ctx.setLineDash(on ? [2, 4] : [1.5, 3.5]);
    ctx.lineWidth = on ? 1.2 : 1;
    ctx.strokeStyle = on ? GRACE : "#a7b6d6";
    ctx.globalAlpha = on ? 0.65 : 0.3;
    ctx.stroke();
  }
  ctx.restore();
}

// ------------------------------------------------------------------ rendu
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
export function buildSprites() {
  S.cats.forEach((c, i) => { S.sprites[i] = sprite(colorOf(i)); });
  S.sprites.grace = sprite(GRACE);
  // Poussière d'étoiles fixe en arrière-plan, pour la profondeur
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  S.dust = Array.from({ length: 260 }, () => [rnd(), rnd(), 0.3 + rnd() * 0.9, 0.05 + rnd() * 0.18]);
}

export function resize() {
  S.dpr = Math.min(devicePixelRatio || 1, 2);
  S.W = innerWidth; S.H = innerHeight;
  canvas.width = S.W * S.dpr; canvas.height = S.H * S.dpr;
  S.base = Math.min(S.W, S.H) * 0.44;
  draw();
}

export const toScreen = (x, y) => [
  S.W / 2 + (x - S.cam.x) * S.cam.s * S.base,
  S.H / 2 - (y - S.cam.y) * S.cam.s * S.base,
];
export const toWorld = (sx, sy) => [
  S.cam.x + (sx - S.W / 2) / (S.cam.s * S.base),
  S.cam.y - (sy - S.H / 2) / (S.cam.s * S.base),
];

let frame = 0;
export function draw() {
  if (!frame) frame = requestAnimationFrame(() => { frame = 0; render(); });
}

export function render() {
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

  // 0. contours des groupes (le groupe ouvert seulement quand un texte est choisi)
  if (!S.hits && !S.morphing && !S.path) drawHulls(sel);

  // 1. toutes les étoiles visibles
  for (const d of S.docs) {
    if (S.hidden.has(d.cat)) continue;
    const [sx, sy] = toScreen(d.x, d.y);
    if (sx < -pad || sy < -pad || sx > W + pad || sy > H + pad) continue;
    const dim = (S.path && !S.pathSet.has(d.i)) || (S.hits && !S.hits.has(d.i)) || (sel && d.i !== sel.i && !echoSet.has(d.i)) ||
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

  // 2 ter. chemin d'échos entre deux textes : une constellation tracée, étape par étape
  if (S.path) {
    const pts = S.path.map(i => toScreen(S.docs[i].x, S.docs[i].y));
    ctx.save();
    ctx.strokeStyle = GRACE; ctx.lineWidth = 1.4; ctx.globalAlpha = 0.85;
    ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    ctx.font = `italic 600 13px "Cormorant Garamond", Georgia, serif`;
    ctx.textAlign = "left"; ctx.textBaseline = "bottom";
    pts.forEach(([x, y], k) => {
      ctx.globalAlpha = 1;
      const big = k === 0 || k === pts.length - 1 ? 2.1 : 1.5;
      ctx.drawImage(S.sprites.grace, x - R * big, y - R * big, 2 * R * big, 2 * R * big);
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(14,19,34,.85)"; ctx.strokeText(String(k + 1), x + R * 0.9, y - R * 0.6);
      ctx.fillStyle = GRACE; ctx.fillText(String(k + 1), x + R * 0.9, y - R * 0.6);
    });
    ctx.restore();
  }

  // 3. constellation : le texte choisi relié à ses échos
  if (sel && !S.path) {
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
  if (!S.hits && !sel && !S.morphing && !S.path) drawClusterLabels();

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
    let fs = size;
    ctx.font = `italic 600 ${fs}px "Cormorant Garamond", Georgia, serif`;
    let w = ctx.measureText(c.label).width;
    if (w + 16 > S.W) {                       // plus large que l'écran (mobile) : en plus petit
      fs = size * (S.W - 16) / w;
      ctx.font = `italic 600 ${fs}px "Cormorant Garamond", Georgia, serif`;
      w = ctx.measureText(c.label).width;
    }
    // un nom qui déborderait de l'écran est rentré vers l'intérieur plutôt que coupé
    const lx = Math.min(Math.max(sx, w / 2 + 8), S.W - w / 2 - 8);
    const box = [lx - w / 2 - 6, sy - fs * 0.6 - 3, lx + w / 2 + 6, sy + fs * 0.6 + 3];
    if (placed.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
    placed.push(box);
    S.labelBoxes.push([...box, c]);
    const on = S.cluster === c || S.hoverLabel === c;
    ctx.globalAlpha = on ? 1 : 0.85;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(14,19,34,.8)";
    ctx.strokeText(c.label, lx, sy);
    ctx.fillStyle = on ? GRACE : "#c3cde6";
    ctx.fillText(c.label, lx, sy);
  }
}

// ------------------------------------------------------------------ caméra
let anim = 0;
export function flyTo(x, y, s, ms = 650) {
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
export function zoomAt(sx, sy, factor) {
  const [wx, wy] = toWorld(sx, sy);
  S.cam.s = Math.max(0.6, Math.min(80, S.cam.s * factor));
  const [nx, ny] = toWorld(sx, sy);
  S.cam.x += wx - nx; S.cam.y += wy - ny;
  draw();
}
// Cadre la vue sur des étoiles : centre et étendue entre les quantiles trim et 1 - trim
// (trim = 0 pour tout garder, comme les étapes d'un chemin).
export function fitPoints(points, trim = 0.1) {
  if (!points.length) return;
  const q = (a, t) => a[Math.min(a.length - 1, Math.floor((a.length - 1) * t))];
  const xs = points.map(p => p.x).sort((a, b) => a - b), ys = points.map(p => p.y).sort((a, b) => a - b);
  const [x0, x1, y0, y1] = [q(xs, trim), q(xs, 1 - trim), q(ys, trim), q(ys, 1 - trim)];
  const r = Math.max(x1 - x0, y1 - y0) / 2 || 0.1;
  focusDoc({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, Math.max(0.8, Math.min(12, 0.8 / r)));
}

export function setHover(i) {
  if (i === S.hover) return;
  S.hover = i;
  if (i < 0) tip.hidden = true;
  canvas.classList.toggle("pointing", i >= 0);
  draw();
}

// Centre la vue sur un point en tenant compte du panneau ouvert à droite
export function focusDoc(d, s) {
  const offset = panel.hidden || innerWidth <= 760 ? 0 : 210 / (s * S.base);
  const yOff = innerWidth <= 760 ? -innerHeight * 0.22 / (s * S.base) : 0;
  flyTo(d.x + offset, d.y + yOff, s);
}

