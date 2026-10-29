// Le brouillard de l'ouverture (intro.js) : un voile teinté et deux nappes grainées qui dérivent lentement,
// posés par-dessus tout le ciel. Même grain que les nébuleuses (nebula.js) ; la teinte vient de --fog
// (style.css, propre à chaque jeu), lue une fois.
import { grain, TEX } from "./nebula.js";

let texture = null, tint = null;

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// une nappe : le grain en alpha, la teinte en couleur
function fogTexture() {
  tint = rgb(getComputedStyle(document.body).getPropertyValue("--fog").trim() || "#77788a");
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
  ctx.globalAlpha = 0.82 * level;
  ctx.fillStyle = `rgb(${tint})`;
  ctx.fillRect(0, 0, W, H);
  // deux nappes, l'une vers la droite, l'autre vers la gauche ; assez grandes pour couvrir l'écran
  for (const [dir, scale, alpha] of [[1, 1, 0.9], [-1, 1.35, 0.6]]) {
    const size = side * scale, room = size - Math.max(W, H);
    const dx = room / 2 * Math.sin(s * 0.05 * dir), dy = room / 4 * Math.cos(s * 0.04);
    ctx.globalAlpha = alpha * level;
    ctx.drawImage(texture, (W - size) / 2 + dx, (H - size) / 2 + dy, size, size);
  }
  ctx.restore();
}
