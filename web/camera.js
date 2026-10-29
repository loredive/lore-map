// La caméra : quelle partie de la carte est à l'écran, et à quel zoom. Son état (x, y, s et la fenêtre :
// largeur, hauteur, hauteur de la barre du haut) et tous les calculs dessus vivent ici : passage
// monde ↔ écran, déplacement, zoom, vols et cadrage. Les limites de zoom ne sont écrites qu'ici.
// Ce module ne touche ni au DOM ni à l'état partagé : la partie visible de la carte, le dessin et
// l'horloge lui sont donnés au démarrage (startCamera), la fenêtre à chaque redimensionnement
// (setViewport), ce qui permet de le tester sous node.
const ZOOM = [0.6, 80];      // zoom à la main (molette, pincement, + et -, toucher)
const FRAME = [0.8, 12];     // zoom d'un cadrage
const MARGIN = 24;           // frameFrom : un point à moins de MARGIN pixels du bord n'est pas « vu »

const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));

let cam = { x: 0, y: 0, s: 1 };
let width = 0, height = 0, top = 0, cy = 0, base = 1;
let deps = {};
let anim = 0;

// deps : visibleArea() -> { top, right, bottom } (la partie de l'écran où la carte se voit),
// onChange() (redessine, groupé), onFrame() (redessine tout de suite, à chaque image d'un vol),
// requestFrame / cancelFrame, now(), reducedMotion. La caméra repart du centre, au zoom 1.
export function startCamera(d) {
  deps.cancelFrame?.(anim);
  anim = 0;
  deps = d;
  cam = { x: 0, y: 0, s: 1 };
}

// la fenêtre : appelée à chaque redimensionnement. La barre du haut couvre le haut du ciel : la carte
// se centre et se dimensionne sur ce qui reste visible.
export function setViewport(v) {
  ({ width, height, top } = v);
  cy = (top + height) / 2;
  base = Math.min(width, height - top) * 0.44;
  deps.onChange?.();
}

// Une copie en nombres simples ; k : pixels par unité du monde
export function camera() {
  return { x: cam.x, y: cam.y, s: cam.s, k: cam.s * base, base, width, height, cy, top };
}

export const toScreen = (x, y) => [
  width / 2 + (x - cam.x) * cam.s * base,
  cy - (y - cam.y) * cam.s * base,
];
export const toWorld = (sx, sy) => [
  cam.x + (sx - width / 2) / (cam.s * base),
  cam.y - (sy - cy) / (cam.s * base),
];

// Déplace la carte de (dx, dy) pixels à l'écran (glisser, flèches)
export function panBy(dx, dy) {
  const k = cam.s * base;
  cam.x -= dx / k; cam.y += dy / k;
  deps.onChange?.();
}

// Zoome de factor autour du point d'écran (sx, sy), qui reste sous le curseur
export function zoomAt(sx, sy, factor) {
  const [wx, wy] = toWorld(sx, sy);
  cam.s = clamp(cam.s * factor, ZOOM);
  const [nx, ny] = toWorld(sx, sy);
  cam.x += wx - nx; cam.y += wy - ny;
  deps.onChange?.();
}
// zoomAt(…, factor) irait-il jusqu'au bout sans buter sur une limite ?
export function canZoom(factor) {
  const s = cam.s * factor;
  return s >= ZOOM[0] && s <= ZOOM[1];
}

// Vol vers (x, y) au zoom s en ms millisecondes ; un nouveau vol remplace celui en cours.
// Mouvement réduit, ou ms <= 0 : on y est tout de suite.
export function flyTo(x, y, s, ms = 650) {
  deps.cancelFrame(anim);
  anim = 0;
  if (deps.reducedMotion || !(ms > 0)) { Object.assign(cam, { x, y, s }); deps.onChange(); return; }
  const from = { ...cam }, t0 = deps.now();
  const ease = t => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  const step = now => {
    const t = Math.min(1, (now - t0) / ms), e = ease(t);
    if (t < 1) {
      cam.x = from.x + (x - from.x) * e;
      cam.y = from.y + (y - from.y) * e;
      cam.s = Math.exp(Math.log(from.s) + (Math.log(s) - Math.log(from.s)) * e);
    } else Object.assign(cam, { x, y, s });   // pile sur la cible, sans l'arrondi de exp(log(s))
    deps.onFrame();                    // tout de suite : le vol ne doit pas traîner d'une image
    anim = t < 1 ? deps.requestFrame(step) : 0;
  };
  anim = deps.requestFrame(step);
}

// Partie visible de la carte : sous la barre du haut, à gauche du panneau ouvert (grand écran) ou
// au-dessus de lui (téléphone, où il monte du bas) ; c'est deps.visibleArea qui le mesure.
export function visibleBox() {
  const a = deps.visibleArea?.() ?? {};
  return { top: a.top ?? top, right: a.right ?? width, bottom: a.bottom ?? height };
}
export function viewCenter() {
  const { top: t, right, bottom } = visibleBox();
  return [right / 2, (t + bottom) / 2];
}

// Amène un point au centre de la partie visible, au zoom s (absent : le zoom actuel)
export function focusDoc(d, s = cam.s) {
  const [vx, vy] = viewCenter(), k = s * base;
  flyTo(d.x + (width / 2 - vx) / k, d.y - (cy - vy) / k, s);
}

// Cadre des étoiles : centre et étendue entre les quantiles trim et 1 - trim (trim = 0 pour tout
// garder, comme les étapes d'un chemin) ; maxScale : zoom maximal.
export function fitPoints(points, trim = 0.1, maxScale = FRAME[1]) {
  if (!points.length) return;
  const q = (a, t) => a[Math.min(a.length - 1, Math.floor((a.length - 1) * t))];
  const xs = points.map(p => p.x).sort((a, b) => a - b), ys = points.map(p => p.y).sort((a, b) => a - b);
  const [x0, x1, y0, y1] = [q(xs, trim), q(xs, 1 - trim), q(ys, trim), q(ys, 1 - trim)];
  const r = Math.max(x1 - x0, y1 - y0) / 2 || 0.1;
  focusDoc({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, clamp(Math.min(maxScale, 0.8 / r), FRAME));
}

// Cadre des étoiles sans jamais zoomer : on garde le contexte. Rien ne bouge si tout est déjà
// visible ; sinon la caméra se déplace, et recule s'il le faut. (L'appelant ajoute aux points le
// texte d'où l'on vient.)
export function frameFrom(points) {
  if (!points.length) return;
  const { right, top: t, bottom } = visibleBox();
  const seen = p => {
    const [x, y] = toScreen(p.x, p.y);
    return x > MARGIN && x < right - MARGIN && y > t + MARGIN && y < bottom - MARGIN;
  };
  if (points.every(seen)) { deps.onChange(); return; }
  fitPoints(points, 0, cam.s);
}
