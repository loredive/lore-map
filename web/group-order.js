// L'ordre des textes dans la page d'un groupe : ceux du cœur d'abord, mais les passages d'un même
// interlocuteur restent ensemble, dans l'ordre où le jeu les dit, à la place du plus proche du cœur.
// Pur : ni DOM ni S.

// docs : les textes du groupe (speaker et part comme lore.js les lit) ; dist : leur distance au cœur.
// Renvoie [{ doc, heading }] : heading ({ speaker, n }) sur le premier passage d'un interlocuteur
// qui en a plusieurs ici, sinon null.
export function groupOrder(docs, dist) {
  const near = [...docs].sort((a, b) => dist(a) - dist(b));
  const said = new Map();          // interlocuteur -> ses passages dans le groupe, dans l'ordre
  for (const d of near) {
    if (d.speaker === null) continue;
    if (!said.has(d.speaker)) said.set(d.speaker, []);
    said.get(d.speaker).push(d);
  }
  for (const list of said.values()) list.sort((a, b) => a.part - b.part);
  const rows = [];
  for (const d of near) {
    if (d.speaker === null) { rows.push({ doc: d, heading: null }); continue; }
    const list = said.get(d.speaker);
    if (!list) continue;                     // déjà placés avec le plus proche du cœur
    said.delete(d.speaker);
    list.forEach((p, k) => rows.push({ doc: p, heading: k === 0 && list.length > 1 ? { speaker: d.speaker, n: list.length } : null }));
  }
  return rows;
}
