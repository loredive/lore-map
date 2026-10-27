// Habillage du ciel : lignes de constellation, taille des étoiles, halos additifs, nébuleuses des
// groupes, noms des grands groupes en capitales espacées, petits noms qui apparaissent en zoomant.
// Style d par défaut ; ?style=a (sans habillage), ?style=b (sans halos ni nébuleuses) et ?style=c
// (contours en pointillé, nébuleuses rondes, constellations partout) pour comparer.
// Style d : nuages de gaz épousant les groupes (nebula.js) au lieu des contours, constellations
// seulement pour le groupe survolé ou ouvert, poussière en parallaxe, ciel propre à chaque jeu.
// Les couleurs atténuées de loin (muted) ont été essayées puis écartées : les catégories doivent rester lisibles.
import { S, ctx, colorOf, isHidden, membersIn } from "./state.js";

const STYLES = {
  a: {},
  b: { lines: true, sizes: true, caps: true, fade: true },
  c: { lines: true, sizes: true, caps: true, fade: true, glow: true, nebula: true },
  d: { lines: true, sizes: true, caps: true, fade: true, glow: true, clouds: true, parallax: true },
};
export const STYLE = STYLES[new URLSearchParams(location.search).get("style")] || STYLES.d;
document.body.classList.toggle("sky-d", !!STYLE.clouds);     // atmosphère CSS du style d (style.css)

// ------------------------------------------------------------------ préparation (au chargement)
// Arbre couvrant minimal de chaque groupe (Prim, O(n²) : 284 textes au plus) ; les arêtes bien plus
// longues que les autres du même groupe sont retirées, elles traverseraient le ciel.
function constellation(pts) {
  const n = pts.length, inTree = new Uint8Array(n), best = new Float64Array(n).fill(Infinity), from = new Int32Array(n).fill(-1);
  const edges = [];
  best[0] = 0;
  for (let step = 0; step < n; step++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!inTree[i] && (u < 0 || best[i] < best[u])) u = i;
    inTree[u] = 1;
    if (from[u] >= 0) edges.push([from[u], u, best[u]]);
    for (let v = 0; v < n; v++) {
      if (inTree[v]) continue;
      const d = Math.hypot(pts[u][0] - pts[v][0], pts[u][1] - pts[v][1]);
      if (d < best[v]) { best[v] = d; from[v] = u; }
    }
  }
  const sorted = edges.map(e => e[2]).sort((a, b) => a - b);
  const limit = 3 * (sorted[Math.floor(sorted.length / 2)] || 0);
  return edges.filter(e => e[2] <= limit).map(([a, b]) => [a, b]);
}

export function prepareSky() {
  // poids d'une étoile : combien d'autres textes la comptent parmi leurs échos (un « carrefour » du sens)
  const indeg = new Float64Array(S.docs.length);
  for (const d of S.docs) for (const e of d.echoes) indeg[e]++;
  const ref = [...indeg].sort((a, b) => a - b)[Math.floor(indeg.length * 0.95)] || 1;
  for (const d of S.docs) d.w = 0.72 + 0.68 * Math.min(1, indeg[d.i] / ref);

  for (const c of S.clusters) {
    const members = S.docs.filter(d => d.cluster === c.id);
    c.edges = S.views.map((_, k) => {
      const m = membersIn(c, k);
      return constellation(m.map(d => d.views[k])).map(([a, b]) => [m[a].i, m[b].i]);
    });
    c.radius = S.views.map((_, k) => {
      const dist = membersIn(c, k).map(d => Math.hypot(d.views[k][0] - c.views[k].x, d.views[k][1] - c.views[k].y)).sort((a, b) => a - b);
      return dist[Math.floor(dist.length * 0.8)] || 0.02;
    });
    // teinte de la nébuleuse : la catégorie la plus représentée du groupe
    const counts = new Map();
    for (const d of members) counts.set(d.cat, (counts.get(d.cat) || 0) + 1);
    c.tint = colorOf([...counts].sort((a, b) => b[1] - a[1])[0][0]);
  }
}

// couleur atténuée (vers le bleu-lune) pour la vue d'ensemble
export function muteColor(hex, t = 0.55) {
  const a = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)), b = [0xa7, 0xb6, 0xd6];
  return "#" + a.map((x, i) => Math.round(x + (b[i] - x) * t).toString(16).padStart(2, "0")).join("");
}

// ------------------------------------------------------------------ dessin
export function drawNebulae(toScreen) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const k = S.cam.s * S.base;
  for (const c of S.clusters) {
    if (c.views[S.view].cohesion < 0.6) continue;
    const [sx, sy] = toScreen(c.x, c.y);
    const r = Math.max(30, c.radius[S.view] * k * 1.6);
    if (sx < -r || sy < -r || sx > S.W + r || sy > S.H + r) continue;
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
    const on = S.cluster === c;
    g.addColorStop(0, c.tint + (on ? "2e" : "16"));
    g.addColorStop(1, c.tint + "00");
    ctx.fillStyle = g;
    ctx.fillRect(sx - r, sy - r, 2 * r, 2 * r);
  }
  ctx.restore();
}

export function drawConstellations(toScreen, sel) {
  ctx.save();
  ctx.strokeStyle = "#a7b6d6";
  ctx.lineWidth = 0.7;
  // plus visibles en zoomant ; avec les nuages (style d), seulement pour le groupe survolé ou ouvert
  const base = STYLE.clouds ? 0 : Math.min(0.32, 0.1 + 0.03 * S.cam.s);
  for (const c of S.clusters) {
    const on = S.cluster === c || S.hoverLabel === c;
    if ((S.cluster || sel || S.lit || S.hits || S.path) && !on) continue;   // un mode actif : seul le groupe concerné
    if (!on && !base) continue;
    ctx.globalAlpha = on ? 0.5 : base;
    ctx.beginPath();
    for (const [a, b] of c.edges[S.view]) {
      const da = S.docs[a], db = S.docs[b];
      if (isHidden(da) || isHidden(db)) continue;
      const [x0, y0] = toScreen(da.x, da.y), [x1, y1] = toScreen(db.x, db.y);
      if ((x0 < 0 && x1 < 0) || (y0 < 0 && y1 < 0) || (x0 > S.W && x1 > S.W) || (y0 > S.H && y1 > S.H)) continue;
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// Le fil d'un dialogue : ses passages reliés dans l'ordre, en pointillé doré
export function drawThread(toScreen, R) {
  const pts = S.thread.map(i => toScreen(S.docs[i].x, S.docs[i].y));
  ctx.save();
  ctx.strokeStyle = "#f0dc9f"; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.1; ctx.setLineDash([2, 5]);
  ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
  ctx.setLineDash([]); ctx.globalAlpha = 0.9; ctx.fillStyle = "#f0dc9f";
  for (const [x, y] of [pts[0], pts[pts.length - 1]]) { ctx.beginPath(); ctx.arc(x, y, Math.max(2.5, R * 0.35), 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

// Parcours de lecture (trail-ui.js) : un anneau léger autour des textes déjà lus, les derniers
// textes reliés en pointillé (les plus anciens s'effacent), et le texte d'où l'on vient, nommé.
export function drawTrail(toScreen, R) {
  ctx.save();
  ctx.strokeStyle = "#f0dc9f"; ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.55;
  for (const i of S.visited) {
    const d = S.docs[i];
    if (isHidden(d)) continue;
    const [x, y] = toScreen(d.x, d.y);
    if (x < -R || y < -R || x > S.W + R || y > S.H + R) continue;
    ctx.beginPath(); ctx.arc(x, y, R * 0.9 + 3, 0, Math.PI * 2); ctx.stroke();
  }
  const pts = S.trailDocs.map(i => toScreen(S.docs[i].x, S.docs[i].y));
  ctx.setLineDash([4, 6]); ctx.lineWidth = 2;
  for (let k = 1; k < pts.length; k++) {
    ctx.globalAlpha = 0.25 + 0.65 * k / (pts.length - 1);
    ctx.beginPath(); ctx.moveTo(...pts[k - 1]); ctx.lineTo(...pts[k]); ctx.stroke();
  }
  ctx.setLineDash([]);
  if (S.cameFrom >= 0 && S.cameFrom !== S.selected) {
    const d = S.docs[S.cameFrom];
    const [x, y] = toScreen(d.x, d.y);
    ctx.globalAlpha = 1; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, R * 1.3 + 5, 0, Math.PI * 2); ctx.stroke();
    ctx.font = `italic 600 17px "Cormorant Garamond", Georgia, serif`;
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    const label = `from ${d.name}`, lx = x + R * 1.3 + 11;
    ctx.lineWidth = 4; ctx.strokeStyle = "rgba(14,19,34,.85)"; ctx.strokeText(label, lx, y);
    ctx.fillStyle = "#f0dc9f"; ctx.fillText(label, lx, y);
  }
  ctx.restore();
}

// Fiche d'une entité ouverte : ses textes en or, les plus pertinents (en tête de e.docs, rangés par
// prepare.py) gros et vifs, les autres petits et pâles ; son nom écrit là où elle revient le plus
// (son groupe principal), relié en pointillé au texte d'où l'on vient.
const ENTITY_TOP = 10;
export function drawEntity(toScreen, R) {
  const e = S.entity;
  const docs = e.docs.map(i => S.docs[i]).filter(d => !isHidden(d));
  if (!docs.length) return;
  ctx.save();
  docs.forEach((d, rank) => {
    const [x, y] = toScreen(d.x, d.y);
    const k = rank < ENTITY_TOP ? 2 : 0.9;
    ctx.globalAlpha = rank < ENTITY_TOP ? 1 : 0.32;
    ctx.drawImage(S.sprites.grace, x - R * k, y - R * k, 2 * R * k, 2 * R * k);
  });
  const [ax, a0] = toScreen(...entityAnchor(docs));
  let ay = a0;
  if (S.cameFrom >= 0 && S.cameFrom !== S.selected) {
    const d = S.docs[S.cameFrom];
    const [x, y] = toScreen(d.x, d.y);
    // le nom tomberait sur « from … » (le texte d'où l'on vient est dans le groupe principal) :
    // il monte au-dessus, relié à sa place par un trait
    if (Math.abs(y - ay) < 56 && ax > x - 140 && ax < x + 260) ay = y - 62;
    ctx.strokeStyle = "#f0dc9f"; ctx.globalAlpha = 0.8; ctx.lineWidth = 2; ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ax, ay); ctx.stroke();
    ctx.setLineDash([]);
  }
  const name = e.label, count = `${e.docs.length} ${e.docs.length === 1 ? "text" : "texts"}`;
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.globalAlpha = 1;
  ctx.font = `italic 600 22px "Cormorant Garamond", Georgia, serif`;
  ctx.lineWidth = 5; ctx.strokeStyle = "rgba(14,19,34,.9)"; ctx.strokeText(name, ax, ay - 14);
  ctx.fillStyle = "#f0dc9f"; ctx.fillText(name, ax, ay - 14);
  ctx.font = `italic 500 14px "Cormorant Garamond", Georgia, serif`;
  ctx.lineWidth = 4; ctx.strokeText(count, ax, ay + 4);
  ctx.fillStyle = "#e7e0ce"; ctx.fillText(count, ax, ay + 4);
  ctx.restore();
}

// Où écrire le nom d'une entité : au milieu (médiane) de ses textes dans le groupe où elle revient
// le plus ; sans groupe, au milieu de ses textes les plus pertinents. docs : rangés, visibles.
export function entityAnchor(docs) {
  const counts = new Map();
  for (const d of docs) if (d.cluster >= 0) counts.set(d.cluster, (counts.get(d.cluster) || 0) + 1);
  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  const pts = best ? docs.filter(d => d.cluster === best[0]) : docs.slice(0, ENTITY_TOP);
  const med = a => { const s = [...a].sort((p, q) => p - q); return s[Math.floor((s.length - 1) / 2)]; };
  return [med(pts.map(d => d.x)), med(pts.map(d => d.y))];
}

// Style d'un nom de groupe : grands groupes en capitales espacées (convention des atlas) ;
// opacité croissante avec la taille du groupe à l'écran, pour que les petits apparaissent en zoomant.
export function labelStyle(c, size, toScreenRadius) {
  const big = STYLE.caps && c.n >= 60;
  const text = big ? c.label.toLocaleUpperCase("fr") : c.label;
  const font = big ? `600 ${Math.round(size * 0.78)}px "Cormorant Garamond", Georgia, serif`
                   : `italic 600 ${size}px "Cormorant Garamond", Georgia, serif`;
  // les grands groupes restent toujours affichés ; un petit n'apparaît qu'une fois assez étendu à
  // l'écran. Pas de demi-teinte : un nom à moitié transparent sur les étoiles se lit mal.
  const alpha = STYLE.fade && !big && toScreenRadius(c.radius[S.view]) < 24 ? 0 : 1;
  return { text, font, spacing: big ? "0.14em" : "0px", alpha };
}
