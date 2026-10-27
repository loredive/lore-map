// Vue « rayons » : une colonne par catégorie, et dans chaque colonne un bloc par groupe (les plus
// gros en haut), les textes rangés par nom. Rien n'y est appris : chaque position se lit.
// Le passage d'une projection aux rayons montre comment un même sujet se répartit entre catégories.

export const SHELVES = "Shelves";
const MIN_BLOCK = 3;          // en dessous, les textes d'un groupe vont au bloc « divers » de la colonne
const BLOCK_GAP = 1;          // lignes vides entre deux blocs
const COL_GAP = 2.5;          // cellules entre deux colonnes
const BOX = [2.3, 1.75];      // étendue visée dans le monde (largeur, hauteur), centrée sur 0
const HEADROOM = 3.5;         // cellules dont tout descend, pour laisser la place aux en-têtes de colonnes

// docs : [{ cat, cluster, name }] ; nCats : nombre de catégories.
// Renvoie { pos: [[x, y]] par texte, clusters: Map(id -> { x, y, cohesion, block }),
//           columns: [{ cat, n, x, top }] } ; y vers le haut, comme le reste de la carte.
export function shelves(docs, nCats) {
  const cols = [];
  for (let cat = 0; cat < nCats; cat++) {
    const ids = docs.map((d, i) => i).filter(i => docs[i].cat === cat);
    if (ids.length) cols.push({ cat, ids });
  }
  cols.sort((a, b) => b.ids.length - a.ids.length || a.cat - b.cat);
  const byName = (a, b) => docs[a].name.localeCompare(docs[b].name) || a - b;
  for (const col of cols) {
    const groups = new Map();
    for (const i of col.ids) {
      if (!groups.has(docs[i].cluster)) groups.set(docs[i].cluster, []);
      groups.get(docs[i].cluster).push(i);
    }
    col.blocks = [];
    const rest = [];
    for (const [cluster, ids] of groups) {
      if (ids.length >= MIN_BLOCK) col.blocks.push({ cluster, ids: ids.sort(byName) });
      else rest.push(...ids);
    }
    col.blocks.sort((a, b) => b.ids.length - a.ids.length || a.cluster - b.cluster);
    // divers : les voisins d'un même groupe restent côte à côte
    rest.sort((a, b) => docs[a].cluster - docs[b].cluster || byName(a, b));
    if (rest.length) col.blocks.push({ cluster: null, ids: rest });
  }

  // largeur d'une colonne ∝ √n : la plus grosse reste lisible, la plus petite ne disparaît pas ;
  // le coefficient est choisi pour que l'ensemble ait à peu près la forme du cadre visé
  const shape = a => {
    const widths = cols.map(c => Math.max(5, Math.round(Math.sqrt(c.ids.length) * a)));
    const heights = cols.map((c, k) => c.blocks.reduce((h, b) => h + Math.ceil(b.ids.length / widths[k]), 0)
                                       + BLOCK_GAP * (c.blocks.length - 1));
    const W = widths.reduce((s, w) => s + w, 0) + COL_GAP * (cols.length - 1);
    return { a, widths, W, H: Math.max(1, ...heights) };
  };
  let best = null;
  for (let a = 0.4; a <= 4; a += 0.05) {
    const s = shape(a), miss = Math.abs(Math.log(s.W / s.H / (BOX[0] / BOX[1])));
    if (!best || miss < best.miss) best = { ...s, miss };
  }
  const { widths, W, H } = best;
  const cell = Math.min(BOX[0] / W, BOX[1] / H);
  const left = -W * cell / 2, top = (H / 2 - HEADROOM) * cell;

  const pos = docs.map(() => [0, 0]);
  const blocks = new Map();       // groupe -> son plus gros bloc
  const columns = [];
  let x0 = left;
  cols.forEach((col, k) => {
    const w = widths[k];
    let row = 0;
    for (const b of col.blocks) {
      b.ids.forEach((i, j) => {
        pos[i] = [x0 + (j % w + 0.5) * cell, top - (row + Math.floor(j / w) + 0.5) * cell];
      });
      const rows = Math.ceil(b.ids.length / w);
      if (b.cluster !== null && b.ids.length > (blocks.get(b.cluster)?.ids.length || 0)) {
        const used = Math.min(w, b.ids.length);
        blocks.set(b.cluster, { ids: b.ids, x: x0 + used * cell / 2, y: top - (row + rows / 2) * cell });
      }
      row += rows + BLOCK_GAP;
    }
    columns.push({ cat: col.cat, n: col.ids.length, x: x0 + w * cell / 2, top, width: (w + COL_GAP * 0.8) * cell });
    x0 += (w + COL_GAP) * cell;
  });

  const size = new Map();
  for (const d of docs) size.set(d.cluster, (size.get(d.cluster) || 0) + 1);
  const clusters = new Map();
  for (const [id, n] of size) {
    const b = blocks.get(id);
    // cohésion : la part du groupe dans son plus gros bloc ; un groupe éparpillé entre les
    // catégories ne porte pas de nom dans cette vue (MIN_COHESION)
    clusters.set(id, b ? { x: b.x, y: b.y, cohesion: b.ids.length / n, block: b.ids }
                       : { x: 0, y: 0, cohesion: 0, block: [] });
  }
  return { pos, clusters, columns, cell };
}
