// La page d'accueil : une galaxie, une constellation par jeu. Ce module ne fait que les calculs —
// quel écran au démarrage, où va chaque constellation, le cadre où le vol se pose (le même que le
// premier cadre de la carte, camera.js) et le chemin du vol. Le dessin est dans galaxy-ui.js.
// Sans DOM : testé sous node.

export const FLIGHT_MS = 2200;
const LABEL = 40;     // place sous une constellation pour son nom et son nombre de textes
const GAP = 28;       // écart minimal entre deux constellations
const SIDE = 16;      // marge sur les côtés de l'écran

// La galaxie, ou la carte d'un jeu. ?game=… (ou l'ancien ?jeu=…) d'un jeu connu : sa carte. Sinon, un
// lien vers une page (#…) ouvre cette page sur le jeu par défaut : on est venu pour elle. Sinon, la galaxie.
export function chooseStart({ search, hash, games, fallback }) {
  const params = new URLSearchParams(search);
  const want = params.get("game") || params.get("jeu");
  if (games.includes(want)) return { screen: "map", game: want };
  if (hash && hash !== "#") return { screen: "map", game: fallback };
  return { screen: "galaxy" };
}

// Où va chaque constellation : dans l'ordre des sorties, en zigzag de gauche à droite sur un écran
// large, de haut en bas sur un écran étroit. Le rayon suit la racine du nombre de textes ; l'échelle
// est la plus grande qui ne fait rien se toucher ni déborder (nom compris).
// skies : [{ id, n, year }] ; view : { width, height, top } (top : bas du titre) -> [{ id, cx, cy, r }]
export function layoutGalaxy(skies, { width, height, top }) {
  const list = [...skies].sort((a, b) => a.year - b.year);
  const count = list.length, wide = width >= height, room = height - top - LABEL;
  const nMax = Math.max(...list.map(s => s.n));
  const zig = i => (count < 3 ? 0.5 : i % 2 ? 0.3 : 0.68);
  const places = list.map((s, i) => {
    const along = (i + 0.5) / count;
    return {
      id: s.id,
      cx: wide ? width * along : width * (count < 2 ? 0.5 : i % 2 ? 0.66 : 0.34),
      cy: top + room * (wide ? zig(i) : along),
      w: 0.5 + 0.5 * Math.sqrt(s.n / nMax),
    };
  });
  // la plus grande échelle permise par chaque contrainte
  let scale = 0.24 * Math.min(width, room);
  for (const p of places) {
    scale = Math.min(scale, (p.cx - SIDE) / p.w, (width - SIDE - p.cx) / p.w, (p.cy - top) / p.w, (top + room - p.cy) / p.w);
  }
  for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
    const a = places[i], b = places[j];
    scale = Math.min(scale, (Math.hypot(a.cx - b.cx, a.cy - b.cy) - GAP) / (a.w + b.w));
  }
  return places.map(({ id, cx, cy, w }) => ({ id, cx, cy, r: w * scale }));
}

// Le premier cadre de la carte (camera.js : startCamera puis setViewport) : un point (x, y) du monde est
// à l'écran en (cx + x·k, cy − y·k)
export function landingFrame({ width, height, top }) {
  return { cx: width / 2, cy: (top + height) / 2, k: Math.min(width, height - top) * 0.44 };
}

const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

// Le cadre au temps t (0..1) du vol : le centre glisse, le zoom grandit d'un rapport constant (vol régulier)
export function flightAt(t, from, to) {
  if (t <= 0) return { ...from };
  const e = ease(Math.min(1, t));
  return {
    cx: from.cx + (to.cx - from.cx) * e,
    cy: from.cy + (to.cy - from.cy) * e,
    k: from.k * (to.k / from.k) ** e,
  };
}
