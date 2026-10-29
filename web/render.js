// Rendu du ciel sur le canvas : grille de sélection, étoiles, noms des groupes, caméra.
import { S, $, canvas, ctx, panel, listColumn, tip, GRACE, MIN_COHESION, reducedMotion, isPhone, colorOf, isHidden, membersIn } from "./state.js";
import { startCamera, setViewport, camera, toScreen, toWorld, viewCenter } from "./camera.js";
import { STYLE, starWeight, drawNebulae, drawConstellations, drawThread, drawEntity, labelStyle, muteColor } from "./sky.js";
import { drawClouds } from "./nebula.js";
import { isQuiet, dimmer, showsHulls, showsGroupNames } from "./focus.js";
import { createIntro, introLevels, fogLevel } from "./intro.js";
import { drawFog } from "./fog.js";

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
      if (isHidden(d)) continue;
      if (S.hits && !S.hits.has(k)) continue;
      const dd = (d.x - wx) ** 2 + (d.y - wy) ** 2;
      if (dd < bd) { bd = dd; best = k; }
    }
  }
  return best;
}

// Toutes les étoiles visibles à moins de px pixels de l'écran (sx, sy), les plus proches d'abord :
// [[indice, distance en pixels]]
export function starsNear(sx, sy, px) {
  if (S.morphing) return [];
  const { k } = camera(), wr = px / k;
  const [wx, wy] = toWorld(sx, sy);
  const r = Math.ceil(wr / CELL), cx = Math.floor(wx / CELL), cy = Math.floor(wy / CELL);
  const out = [];
  for (let i = cx - r; i <= cx + r; i++) for (let j = cy - r; j <= cy + r; j++) {
    for (const n of S.grid.get(cellKey(i, j)) || []) {
      const d = S.docs[n];
      if (isHidden(d) || (S.hits && !S.hits.has(n))) continue;
      const dist = Math.hypot(d.x - wx, d.y - wy) * k;
      if (dist <= px) out.push([n, dist]);
    }
  }
  return out.sort((a, b) => a[1] - b[1]);
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
      const pts = membersIn(c, k).map(d => d.views[k]);
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
  S.spritesMuted = S.cats.map((c, i) => sprite(muteColor(colorOf(i))));
  S.sprites.grace = sprite(GRACE);
  // Poussière d'étoiles fixe en arrière-plan, pour la profondeur
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  S.dust = Array.from({ length: 260 }, () => [rnd(), rnd(), 0.3 + rnd() * 0.9, 0.05 + rnd() * 0.18]);
}

export function resize() {
  S.dpr = Math.min(devicePixelRatio || 1, 2);
  // la barre du haut couvre le haut du ciel : la carte se centre et se dimensionne sur ce qui reste visible
  const top = $(".topbar")?.getBoundingClientRect().bottom || 0;
  document.documentElement.style.setProperty("--bar-h", `${top}px`);
  setViewport({ width: innerWidth, height: innerHeight, top });   // redessine (groupé)
  const cam = camera();
  canvas.width = cam.width * S.dpr; canvas.height = cam.height * S.dpr;
}

let frame = 0;
export function draw() {
  if (!frame) frame = requestAnimationFrame(() => { frame = 0; render(); });
}

// ------------------------------------------------------------------ ouverture dans le brouillard
// intro.js dit à quel point chaque couche est apparue ; ici, on multiplie les opacités par groupe
// (nuage, étoiles, nom) et on pose le brouillard par-dessus. Le rang d'un groupe : sa place dans
// S.clusters (les plus gros d'abord).
let intro = null, rankOf = new Map();
const CLEAR = { nebula: 1, stars: 1, names: 1 };
export function startIntro() {
  rankOf = new Map(S.clusters.map((c, j) => [c.id, j]));
  intro = createIntro(performance.now());
  draw();
}
export function skipIntro() { if (intro) { intro.skip(); draw(); } }
export const introActive = () => !!intro;

// Une seule copie de la caméra par image : tout ce qui dépend du zoom ou de la taille de l'écran
// la lit, et sky.js / nebula.js la reçoivent avec toScreen.
export function render() {
  const cam = camera(), { width: W, height: H } = cam, { dpr } = S;
  const now = performance.now(), t = intro ? intro.progress(now) : 1;
  if (t >= 1) intro = null;
  // pendant l'ouverture : les niveaux de chaque groupe, et ceux d'un texte sans groupe (le brouillard seul)
  const levels = intro ? new Map(S.clusters.map(c => [c.id, introLevels(t, rankOf.get(c.id), S.clusters.length)])) : null;
  const bare = 1 - fogLevel(t);
  const reveal = id => (levels ? levels.get(id) ?? { nebula: bare, stars: bare, names: bare } : CLEAR);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = "#c9d3ee";
  // poussière : fixe (styles a à c) ou en parallaxe (style d), les grains les plus gros (les plus
  // « proches ») glissant plus vite quand on se déplace
  const drift = STYLE.parallax ? cam.base * 0.35 : 0;
  for (const [u, v, r, a] of S.dust) {
    ctx.globalAlpha = a;
    const f = drift * r * r;
    const x = ((u * W - cam.x * f) % W + W) % W, y = ((v * H + cam.y * f) % H + H) % H;
    ctx.fillRect(x, y, r, r);
  }

  const r = Math.min(2.2 * Math.sqrt(cam.s), 9);   // rayon visuel d'une étoile
  const R = r * 3.2;                                   // halo
  const pad = R + 2;
  const sel = S.selected >= 0 ? S.docs[S.selected] : null;
  const dims = dimmer(S);

  // 0. nébuleuses (style c), contours des groupes, lignes de constellation (styles b et c)
  if (STYLE.nebula && !S.morphing) drawNebulae(cam, toScreen);
  if (STYLE.clouds && !S.morphing) drawClouds(cam, toScreen, MIN_COHESION, c => reveal(c.id).nebula);
  else if (showsHulls(S) && !S.morphing) drawHulls(sel);
  if (STYLE.lines && !S.morphing) drawConstellations(cam, toScreen);

  // 1. toutes les étoiles visibles ; de loin et sans rien d'ouvert, couleurs atténuées (style c)
  const sprites = STYLE.muted && isQuiet(S) && cam.s < 2.5 ? S.spritesMuted : S.sprites;
  // halos additifs (style c) : les amas denses s'illuminent au lieu de se brouiller
  if (STYLE.glow) ctx.globalCompositeOperation = "lighter";
  // en additif, l'éclat suit la densité à l'écran : sur un petit écran vu de loin, les halos se
  // superposent tant qu'ils brûleraient en blanc
  const density = Math.min(1, (cam.base / 380) * Math.sqrt(cam.s));
  const [on, off] = STYLE.glow ? [Math.max(0.16, 0.55 * density), 0.06] : [0.9, 0.13];
  for (const d of S.docs) {
    if (isHidden(d)) continue;
    const [sx, sy] = toScreen(d.x, d.y);
    if (sx < -pad || sy < -pad || sx > W + pad || sy > H + pad) continue;
    const rr = (STYLE.sizes ? R * starWeight(d.i) : R) * (STYLE.glow ? 0.6 + 0.4 * density : 1);   // « carrefours » du sens plus gros
    ctx.globalAlpha = (dims(d) ? off : on) * reveal(d.cluster).stars;
    ctx.drawImage(sprites[d.cat], sx - rr, sy - rr, 2 * rr, 2 * rr);
  }
  ctx.globalCompositeOperation = "source-over";

  // 2. résultats de recherche : étoiles dorées, plus vives pour les premiers rangs
  if (S.hits && !sel) {
    for (const [i, rank] of S.hits) {
      const d = S.docs[i];
      if (isHidden(d)) continue;
      const [sx, sy] = toScreen(d.x, d.y);
      const k = rank < 10 ? 1.9 : rank < 40 ? 1.45 : 1.15;
      ctx.globalAlpha = rank < 40 ? 1 : 0.75;
      ctx.drawImage(S.sprites.grace, sx - R * k, sy - R * k, 2 * R * k, 2 * R * k);
    }
  }

  // 2 bis. textes d'une entité ouverte : les plus pertinents en gros, et son nom sur la carte (sky.js) ;
  // passages d'un dialogue : étoiles dorées
  if (S.entity && !sel) drawEntity(toScreen, R);
  else if (S.lit && !sel) {
    ctx.globalAlpha = 0.95;
    for (const i of S.lit) {
      const d = S.docs[i];
      if (isHidden(d)) continue;
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
    // visite guidée : l'étape en cours entourée
    if (S.tourStep >= 0 && pts[S.tourStep]) {
      const [x, y] = pts[S.tourStep];
      ctx.globalAlpha = 1; ctx.lineWidth = 2; ctx.strokeStyle = GRACE;
      ctx.beginPath(); ctx.arc(x, y, R * 2.4 + 6, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  // 2 quater. fil du dialogue ouvert (début et fin marqués)
  if (S.thread && !sel) drawThread(toScreen, R);

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
  if (S.view === S.shelves?.k && !S.morphing) drawShelfHeaders(cam);
  if (showsGroupNames(S) && !S.morphing) drawClusterLabels(cam, reveal);   // une entité ouverte écrit son propre nom

  // 4 bis. au clavier : un viseur au centre de la partie visible de la carte
  if (S.kbd) {
    const [cx, cy] = viewCenter();
    ctx.save();
    ctx.strokeStyle = GRACE; ctx.globalAlpha = 0.7; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, 30, 0, Math.PI * 2); ctx.stroke();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.beginPath(); ctx.moveTo(cx + dx * 36, cy + dy * 36); ctx.lineTo(cx + dx * 44, cy + dy * 44); ctx.stroke();
    }
    ctx.restore();
  }

  // 5. étoile survolée
  if (S.hover >= 0) {
    const d = S.docs[S.hover];
    const [sx, sy] = toScreen(d.x, d.y);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#fffaf0";
    ctx.beginPath(); ctx.arc(sx, sy, r + 5, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 6. le brouillard de l'ouverture, par-dessus tout ; l'image suivante est demandée tant qu'il dure
  if (intro) { drawFog(ctx, cam, fogLevel(t), now); draw(); }
}

// vue rayons : le nom de chaque colonne (sa catégorie) et son nombre de textes, au-dessus d'elle
function drawShelfHeaders({ k }) {
  const { columns, cell } = S.shelves;
  const size = Math.max(11, Math.min(18, cell * k * 2.2));
  const font = px => `600 ${px}px "Cormorant Garamond", Georgia, serif`;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(14,19,34,.8)";
  // une même mise en page pour toutes les colonnes, pour que les en-têtes restent alignés :
  // « Nom · n » sur une ligne si toutes les colonnes le permettent ; sinon le nombre passe en
  // dernière ligne partout, et un nom trop long se replie entre ses mots, vers le haut (les
  // dernières lignes des noms restent au même niveau) ; on ne rapetisse que si un mot seul ne tient pas
  const width = l => ctx.measureText(l).width;
  const wrap = (name, room) => name.split(" ").reduce((ls, w) => {
    const last = ls[ls.length - 1];
    if (last && width(`${last} ${w}`) <= room) ls[ls.length - 1] = `${last} ${w}`; else ls.push(w);
    return ls;
  }, []);
  let px = Math.round(size);
  ctx.font = font(px);
  let lines = columns.map(col => [`${S.cats[col.cat]} · ${col.n}`]);
  if (!columns.every((col, j) => width(lines[j][0]) <= col.width * k)) {
    const ratio = Math.min(1, ...columns.map(col =>
      col.width * k / Math.max(...S.cats[col.cat].split(" ").map(width))));
    if (ratio < 1) { px = Math.max(9, Math.floor(px * ratio)); ctx.font = font(px); }
    const names = columns.map(col => wrap(S.cats[col.cat], col.width * k));
    const depth = Math.max(...names.map(n => n.length));
    lines = columns.map((col, j) => [...Array(depth - names[j].length).fill(""), ...names[j], String(col.n)]);
  }
  const rows = lines[0].length;
  columns.forEach((col, c) => {
    const [sx, sy] = toScreen(col.x, col.top);
    ctx.globalAlpha = S.hidden.has(col.cat) ? 0.35 : 0.95;
    ctx.fillStyle = colorOf(col.cat);
    lines[c].forEach((l, j) => {
      if (!l) return;
      const y = sy - 6 - (rows - 1 - j) * px * 1.05;
      ctx.strokeText(l, sx, y);
      ctx.fillText(l, sx, y);
    });
  });
  ctx.restore();
}

function drawClusterLabels(cam, reveal) {
  const { width: W, height: H } = cam;
  // le titre, la recherche et la légende comptent comme déjà occupés : pas de nom dessous
  const placed = [".topbar", ".under-bar", ".credit"].map(s => {
    const r = $(s).getBoundingClientRect();
    return [r.left, r.top, r.right, r.bottom];
  });
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const c of S.clusters) {
    if (c.views[S.view].cohesion < MIN_COHESION) continue;
    const size = Math.max(12, Math.min(25, 9 + Math.sqrt(c.n) * 0.95)) * Math.min(1.25, 0.85 + cam.s * 0.08);
    const [sx, sy] = toScreen(c.x, c.y);
    if (sx < -100 || sy < -30 || sx > W + 100 || sy > H + 30) continue;
    const st = labelStyle(c, size, r => r * cam.s * cam.base), shown = reveal(c.id).names;
    if (st.alpha < 0.05) continue;                // trop petit à ce zoom : il apparaîtra en zoomant
    if (shown < 0.05) continue;                   // pas encore sorti du brouillard : ni dessiné, ni cliquable
    let fs = size;
    ctx.font = st.font;
    ctx.letterSpacing = st.spacing;
    let w = ctx.measureText(st.text).width;
    if (w + 16 > W) {                       // plus large que l'écran (mobile) : en plus petit
      const px = parseFloat(st.font.match(/([\d.]+)px/)[1]);   // la taille réelle (capitales : 78 %)
      fs = fs * (W - 16) / w;
      ctx.font = st.font.replace(/[\d.]+px/, `${Math.floor(px * (W - 16) / w)}px`);
      w = ctx.measureText(st.text).width;
    }
    // un nom qui déborderait de l'écran est rentré vers l'intérieur plutôt que coupé
    const lx = Math.min(Math.max(sx, w / 2 + 8), W - w / 2 - 8);
    const box = [lx - w / 2 - 6, sy - fs * 0.6 - 3, lx + w / 2 + 6, sy + fs * 0.6 + 3];
    if (placed.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
    placed.push(box);
    S.labelBoxes.push([...box, c]);
    const on = S.cluster === c || S.hoverLabel === c;
    ctx.globalAlpha = (on ? 1 : 0.85 * st.alpha) * shown;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(14,19,34,.8)";
    ctx.strokeText(st.text, lx, sy);
    ctx.fillStyle = on ? GRACE : "#c3cde6";
    ctx.fillText(st.text, lx, sy);
  }
  ctx.letterSpacing = "0px";
}

// ------------------------------------------------------------------ caméra
// La caméra (camera.js) tient son état ; un vol redessine à chaque image tout de suite (render), un
// déplacement ponctuel par draw.
startCamera({
  visibleArea, onChange: draw, onFrame: render,
  requestFrame: f => requestAnimationFrame(f), cancelFrame: n => cancelAnimationFrame(n),
  now: () => performance.now(), reducedMotion,
});

export function setHover(i) {
  if (i === S.hover) return;
  S.hover = i;
  if (i < 0) tip.hidden = true;
  canvas.classList.toggle("pointing", i >= 0);
  draw();
}

// Partie visible de la carte : sous la barre du haut, à gauche du panneau ouvert et de la liste à côté
// (grand écran) ou au-dessus de lui (téléphone, où il monte du bas)
function visibleArea() {
  const phone = isPhone(), open = !panel.hidden, { width, height, top } = camera();
  const col = listColumn.hidden ? null : listColumn.getBoundingClientRect();   // sans largeur : cachée par style.css
  return {
    top,
    right: open && !phone ? Math.min(panel.getBoundingClientRect().left, col?.width ? col.left : width) : width,
    bottom: open && phone ? panel.getBoundingClientRect().top : height,
  };
}
