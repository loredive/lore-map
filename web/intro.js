// L'ouverture dans le brouillard : au chargement, le ciel est couvert ; le brouillard se lève, les nébuleuses
// des groupes percent l'une après l'autre (les plus gros d'abord), puis leurs étoiles, puis les noms.
// Ce module ne fait que les calculs (quand elle se joue, à quel point chaque couche est apparue au temps t,
// t allant de 0 à 1) ; le dessin est dans render.js et fog.js. Sans DOM : testé sous node.
export const INTRO_MS = 7000;     // durée de l'ouverture complète
export const FADE_MS = 400;       // fondu simple, quand le système demande moins d'animations

const smooth = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
const ramp = (t, start, length) => smooth((t - start) / length);

// une page ouverte par l'adresse (lien collé) : on est venu pour elle, pas de brouillard
export function introMode({ opened, reducedMotion }) {
  if (opened) return "none";
  return reducedMotion ? "fade" : "full";
}

// opacité du brouillard : pleine au départ, levée à 70 % de l'ouverture
export const fogLevel = t => 1 - ramp(t, 0, 0.7);

// rank : rang du groupe (0 = le plus gros), count : nombre de groupes
export function introLevels(t, rank, count) {
  if (t >= 1) return { nebula: 1, stars: 1, names: 1 };
  const start = 0.1 + 0.5 * rank / Math.max(1, count - 1);
  return { nebula: ramp(t, start, 0.25), stars: ramp(t, start + 0.1, 0.25), names: ramp(t, 0.75, 0.2) };
}

// l'horloge de l'ouverture : progress(now) va de 0 à 1, et vaut 1 dès qu'on l'a passée
export function createIntro(now, duration = INTRO_MS) {
  let skipped = false;
  return {
    progress: at => skipped ? 1 : Math.max(0, Math.min(1, (at - now) / duration)),
    skip: () => { skipped = true; },
  };
}
