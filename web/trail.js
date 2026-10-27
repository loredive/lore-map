// Le parcours de lecture : les étapes ouvertes l'une après l'autre (textes, entités, groupes,
// dialogues). Une étape garde un nom (texte, entité, titre du groupe, interlocuteur), pas un indice,
// pour qu'un parcours enregistré survive à une reconstruction des données. Fonctions pures,
// testables sous Node.

export const KINDS = ["doc", "entity", "cluster", "dialogue"];
export const MAX_STEPS = 200;

const same = (a, b) => a && b && a.kind === b.kind && a.key === b.key;

// Un nouveau parcours avec l'étape ajoutée ; la même étape deux fois de suite (une catégorie
// masquée réaffiche la fiche) n'en fait qu'une ; les plus anciennes tombent au-delà de max.
export function push(trail, step, max = MAX_STEPS) {
  if (same(trail[trail.length - 1], step)) return trail;
  return [...trail, step].slice(-max);
}

// Le texte lu juste avant l'étape en cours : d'où l'on vient (null s'il n'y en a pas).
export function previousDoc(trail) {
  for (let k = trail.length - 2; k >= 0; k--) if (trail[k].kind === "doc") return trail[k].key;
  return null;
}

// Les noms des textes lus, sans doublon.
export function docKeys(trail) {
  return new Set(trail.filter(s => s.kind === "doc").map(s => s.key));
}

// Les derniers textes du parcours, dans l'ordre : le fil tracé sur la carte.
export function recentDocs(trail, n = 12) {
  const out = [];
  for (let k = trail.length - 1; k >= 0 && out.length < n; k--) {
    const s = trail[k];
    if (s.kind === "doc" && s.key !== out[0]) out.unshift(s.key);
  }
  return out;
}

// Enregistrement : { steps, shown } ; un JSON illisible ou d'un autre format donne un parcours vide.
// shown : le pointillé sur la carte, masqué par défaut ; en v1 il était montré sans qu'on l'ait choisi,
// on garde donc les pas d'un enregistrement v1 mais pas son shown.
export function serialize(steps, shown = false) { return JSON.stringify({ v: 2, steps, shown }); }
export function parse(raw) {
  try {
    const o = JSON.parse(raw);
    if (!o || (o.v !== 1 && o.v !== 2) || !Array.isArray(o.steps)) throw new Error("format");
    const steps = o.steps.filter(s => s && KINDS.includes(s.kind) && typeof s.key === "string").slice(-MAX_STEPS);
    return { steps, shown: o.v === 2 && o.shown === true };
  } catch {
    return { steps: [], shown: false };
  }
}
