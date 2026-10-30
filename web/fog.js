// Le brouillard de l'ouverture (intro.js) : un voile sombre, de la couleur de la nuit (--fog-veil), et
// deux nappes grainées plus claires (--fog) qui dérivent lentement, posés par-dessus tout le ciel. Même
// grain que les nébuleuses (nebula.js) ; les teintes viennent de style.css (propres à chaque jeu), lues une fois.
import { grain, TEX } from "./nebula.js";

let texture = null, veil = null;

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// une nappe : le grain en alpha, la teinte en couleur
function fogTexture() {
  const css = getComputedStyle(document.body);
  const tint = rgb(css.getPropertyValue("--fog").trim() || "#77788a");
  veil = rgb(css.getPropertyValue("--fog-veil").trim() || "#0d1220");
  const cv = document.createElement("canvas");
  cv.width = cv.height = TEX;
  const g = cv.getContext("2d"), img = g.createImageData(TEX, TEX), noise = grain();
  for (let i = 0; i < TEX * TEX; i++) {
    img.data.set(tint, 4 * i);
    img.data[4 * i + 3] = 255 * smooth(0.2, 0.85, noise[i]);
  }
  g.putImageData(img, 0, 0);
  return cv;
}

// level : opacité du brouillard (0..1) ; now : l'horloge (ms), pour la dérive
export function drawFog(ctx, { width: W, height: H }, level, now) {
  if (level <= 0) return;
  texture ||= fogTexture();
  const side = 1.6 * Math.max(W, H), s = now / 1000;
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  // le voile cache le ciel dans le noir : l'ouverture part de la nuit, pas d'un écran gris
  ctx.globalAlpha = 0.92 * level;
  ctx.fillStyle = `rgb(${veil})`;
  ctx.fillRect(0, 0, W, H);
  // deux nappes discrètes, l'une vers la droite, l'autre vers la gauche ; assez grandes pour couvrir l'écran
  for (const [dir, scale, alpha] of [[1, 1, 0.3], [-1, 1.35, 0.2]]) {
    const size = side * scale, room = size - Math.max(W, H);
    const dx = room / 2 * Math.sin(s * 0.05 * dir), dy = room / 4 * Math.cos(s * 0.04);
    ctx.globalAlpha = alpha * level;
    ctx.drawImage(texture, (W - size) / 2 + dx, (H - size) / 2 + dy, size, size);
  }
  ctx.restore();
}
