// Habillage du ciel : lignes de constellation, taille des étoiles, halos additifs, nébuleuses des
// groupes, noms des grands groupes en capitales espacées, petits noms qui apparaissent en zoomant.
// Style c par défaut ; ?style=a (sans habillage) et ?style=b (sans halos ni nébuleuses) pour comparer.
// Les couleurs atténuées de loin (muted) ont été essayées puis écartées : les catégories doivent rester lisibles.
import { S, ctx, colorOf } from "./state.js";

const STYLES = {
  a: {},
  b: { lines: true, sizes: true, caps: true, fade: true },
  c: { lines: true, sizes: true, caps: true, fade: true, glow: true, nebula: true },
};
export const STYLE = STYLES[new URLSearchParams(location.search).get("style")] || STYLES.c;

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
    c.edges = S.views.map((_, k) => constellation(members.map(d => d.views[k])).map(([a, b]) => [members[a].i, members[b].i]));
    c.radius = S.views.map((_, k) => {
      const dist = members.map(d => Math.hypot(d.views[k][0] - c.views[k].x, d.views[k][1] - c.views[k].y)).sort((a, b) => a - b);
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
  const base = Math.min(0.32, 0.1 + 0.03 * S.cam.s);         // plus visibles en zoomant
  for (const c of S.clusters) {
    const on = S.cluster === c || S.hoverLabel === c;
    if ((S.cluster || sel || S.lit || S.hits || S.path) && !on) continue;   // un mode actif : seul le groupe concerné
    ctx.globalAlpha = on ? 0.5 : base;
    ctx.beginPath();
    for (const [a, b] of c.edges[S.view]) {
      const da = S.docs[a], db = S.docs[b];
      if (S.hidden.has(da.cat) || S.hidden.has(db.cat)) continue;
      const [x0, y0] = toScreen(da.x, da.y), [x1, y1] = toScreen(db.x, db.y);
      if ((x0 < 0 && x1 < 0) || (y0 < 0 && y1 < 0) || (x0 > S.W && x1 > S.W) || (y0 > S.H && y1 > S.H)) continue;
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    }
    ctx.stroke();
  }
  ctx.restore();
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
