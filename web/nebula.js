// Nébuleuses des groupes (style d) : au lieu d'un contour, chaque groupe est un nuage de gaz qui
// épouse la forme réelle de ses étoiles (concave là où le groupe l'est), teinté par sa catégorie
// dominante, grainé par un bruit fixe. Calculé une fois par groupe et par vue dans une petite
// image hors écran, puis simplement posé à l'écran à chaque image : le déplacement reste fluide.
import { S, ctx, isHidden, membersIn } from "./state.js";
import { cloudOpacity } from "./focus.js";

export const TEX = 192;            // px, côté le plus long de l'image d'un groupe
const SPREAD = 0.85;        // rayon du souffle d'une étoile, en part du rayon du groupe
const MAX_ALPHA = 0.42;     // opacité au cœur du nuage : du gaz, pas un aplat
const BLUR = 0.06;          // flou avant le grain, en part de la taille de l'image
let noise = null;           // bruit fractal partagé (TEX × TEX), valeurs 0..1

// bruit de valeur à quelques octaves, graine fixe : le même grain à chaque visite
function fractalNoise(n) {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const out = new Float32Array(n * n);
  for (const [cells, weight] of [[4, 0.5], [8, 0.27], [16, 0.15], [32, 0.08]]) {
    const g = Array.from({ length: (cells + 1) ** 2 }, rnd);
    const at = (x, y) => g[(y % (cells + 1)) * (cells + 1) + (x % (cells + 1))];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const fx = (x / n) * cells, fy = (y / n) * cells, x0 = fx | 0, y0 = fy | 0;
      const tx = fx - x0, ty = fy - y0, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const bot = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      out[y * n + x] += weight * (top + (bot - top) * sy);
    }
  }
  return out;
}

const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

// l'image d'un groupe dans une vue : densité des étoiles -> nuage teinté et grainé
function cloud(c, k, members) {
  const r = c.radius[k] * SPREAD;
  const xs = members.map(d => d.views[k][0]), ys = members.map(d => d.views[k][1]);
  const x0 = Math.min(...xs) - 2.2 * r, x1 = Math.max(...xs) + 2.2 * r;
  const y0 = Math.min(...ys) - 2.2 * r, y1 = Math.max(...ys) + 2.2 * r;
  const scale = TEX / Math.max(x1 - x0, y1 - y0);
  const w = Math.max(8, Math.ceil((x1 - x0) * scale)), h = Math.max(8, Math.ceil((y1 - y0) * scale));
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  // densité : un souffle large et doux par étoile (décroissance proche d'une gaussienne), puis flouté
  const dens = document.createElement("canvas");
  dens.width = w; dens.height = h;
  const dg = dens.getContext("2d");
  dg.globalCompositeOperation = "lighter";
  const pr = r * scale, weight = Math.min(0.35, 2.4 / Math.sqrt(members.length));   // un grand groupe ne sature pas
  for (const d of members) {
    const px = (d.views[k][0] - x0) * scale, py = (y1 - d.views[k][1]) * scale;   // y vers le haut dans le monde
    const grad = dg.createRadialGradient(px, py, 0, px, py, pr);
    // profil gaussien (exp(-(2.6 t)²)) : il s'éteint sans cassure, aucun cercle ne se dessine
    for (let t = 0; t <= 1.0001; t += 0.125) grad.addColorStop(Math.min(1, t), `rgba(255,255,255,${weight * Math.exp(-((2.6 * t) ** 2))})`);
    dg.fillStyle = grad;
    dg.fillRect(px - pr, py - pr, 2 * pr, 2 * pr);
  }
  const g = cv.getContext("2d", { willReadFrequently: true });
  g.filter = `blur(${Math.max(2, Math.round(BLUR * Math.max(w, h)))}px)`;
  g.drawImage(dens, 0, 0);
  g.filter = "none";
  const img = g.getImageData(0, 0, w, h), px = img.data;
  const [tr, tg, tb] = rgb(c.tint);
  // fondu près du cadre : le flou ne déborde pas de l'image, sans quoi ses bords se verraient
  const edge = 0.12 * Math.min(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const frame = smooth(0, edge, Math.min(x, y, w - 1 - x, h - 1 - y));
    const i = 4 * (y * w + x), v = px[i + 3] / 255;          // la densité est dans l'alpha (blanc partout)
    const n = noise[(y % TEX) * TEX + (x % TEX)];
    // opacité qui croît avec la densité, sans seuil ni palier (un palier dessine un bord) :
    // le gaz s'amincit vers l'extérieur ; le bruit, contrasté, le creuse en volutes
    const a = Math.min(1, 4 * v) ** 1.25 * smooth(0.15, 1, n) * frame * MAX_ALPHA;
    px[i] = tr; px[i + 1] = tg; px[i + 2] = tb;
    px[i + 3] = 255 * a;
  }
  g.putImageData(img, 0, 0);
  return { cv, x0, y1, wWorld: w / scale, hWorld: h / scale };
}

// les images sont refaites quand on masque une catégorie (ses étoiles quittent le nuage)
let cache = new Map(), cacheKey = "";
function clouds(k) {
  const key = [...S.hidden].sort().join(",") + (S.hideDlc ? "|dlc" : "");
  if (key !== cacheKey) { cache = new Map(); cacheKey = key; }
  if (!cache.has(k)) {
    noise ||= fractalNoise(TEX);
    const list = [];
    for (const c of S.clusters) {
      const members = membersIn(c, k).filter(d => !isHidden(d));
      if (members.length >= 3) list.push([c, cloud(c, k, members)]);
    }
    cache.set(k, list);
  }
  return cache.get(k);
}

// le bruit partagé, aussi pour le brouillard de l'ouverture (fog.js)
export const grain = () => (noise ||= fractalNoise(TEX));

// nombre de nuages prêts pour la vue affichée (le test de la page vérifie qu'ils ne manquent pas)
export const cloudCount = () => (cache.get(S.view) || []).length;

// à l'écran : le groupe ouvert ou survolé s'allume, les autres s'effacent quand un groupe est ouvert.
// cam : la copie de la caméra prise pour l'image par render.js ; toScreen : monde -> écran ;
// fade(c) : part du nuage déjà apparue pendant l'ouverture (intro.js), 1 ensuite
export function drawClouds({ s, width: W, height: H }, toScreen, minCohesion, fade = () => 1) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const focus = S.cluster || S.hoverLabel;
  // de près, on lit les étoiles : le gaz s'efface (sinon un brouillard gris envahit l'écran)
  const near = 1 / (1 + (s / 3) ** 2);
  for (const [c, t] of clouds(S.view)) {
    if (c.views[S.view].cohesion < minCohesion) continue;
    const [sx, sy] = toScreen(t.x0, t.y1), [ex, ey] = toScreen(t.x0 + t.wWorld, t.y1 - t.hWorld);
    if (ex < 0 || ey < 0 || sx > W || sy > H) continue;
    const on = focus === c, f = fade(c);
    if (f <= 0) continue;
    ctx.globalAlpha = near * cloudOpacity(S, on) * f;
    ctx.drawImage(t.cv, sx, sy, ex - sx, ey - sy);
    if (on) { ctx.globalAlpha = 0.35 * near * f; ctx.drawImage(t.cv, sx, sy, ex - sx, ey - sy); }   // un souffle de plus
  }
  ctx.restore();
}
