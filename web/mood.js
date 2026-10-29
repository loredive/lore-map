// L'humeur de la musique : chaque groupe porte une humeur (data/<jeu>/music.json), et le groupe au centre de
// l'écran choisit la piste. Un changement n'est retenu qu'après un temps de pose (un survol rapide ne fait
// pas sauter la piste) ; la lecture d'un texte baisse le volume. Ce module ne fait que décider ; music.js
// joue. Sans DOM : testé sous node.
export const SETTLE_MS = 1500;      // temps de pose avant de changer de piste
export const READING_LEVEL = 0.25;  // volume pendant la lecture d'un texte (part du volume normal)
export const FADE_IN_S = 3.5;       // montée au premier geste
export const CROSSFADE_S = 4;       // fondu enchaîné d'une piste à l'autre
export const DIM_S = 1.5;           // baisse et remontée autour de la lecture
export const MASTER = 0.35;         // volume général : un fond, pas le sujet

// L'humeur au point at (monde, vue k) : celle du groupe le plus proche s'il couvre ce point (1,5 rayon),
// sinon (ciel vide) celle qui joue déjà. Rangés par catégorie, les groupes ne disent rien : l'humeur par défaut.
export function centerMood({ clusters, k, at: [x, y], radiusOf, moodOf, current, fallback, byCategory }) {
  if (byCategory) return fallback;
  let best = null, bestD = Infinity;
  for (const c of clusters) {
    const d = Math.hypot(c.views[k].x - x, c.views[k].y - y);
    if (d < bestD) { best = c; bestD = d; }
  }
  if (best && bestD <= 1.5 * radiusOf(best)) return moodOf(best);
  return current ?? fallback;
}

// settle(mood, now) : l'humeur retenue ; une nouvelle humeur l'emporte quand elle a tenu ms sans interruption
export function createSettler(ms = SETTLE_MS) {
  let settled = null, pending = null, since = 0;
  return (mood, now) => {
    if (settled === null || mood === settled) { settled = mood; pending = null; return settled; }
    if (mood !== pending) { pending = mood; since = now; }
    if (now - since >= ms) { settled = pending; pending = null; }
    return settled;
  };
}

// les pages qu'on lit : un texte, un dialogue
export const readingPage = name => name === "doc" || name === "dialogue";

// part du volume général visée
export function targetLevel({ on, started, reading, hidden }) {
  if (!on || !started || hidden) return 0;
  return reading ? READING_LEVEL : 1;
}
