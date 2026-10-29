import { shelves, SHELVES } from "./shelves.js";

// ------------------------------------------------------------------ lore.json
// Le format de data/<jeu>/lore.json, décodé à un seul endroit (écrit par lore_format.py).
// Chaque texte est une ligne positionnelle décrite par `fields` ; alt, altName et dlc n'y sont
// que si un texte s'en sert, entities peut manquer. Pur : ni DOM ni S, rien n'est modifié dans json.

const REQUIRED = ["fields", "views", "categories", "clusters", "docs"];
const FIELDS = ["name", "cat", "text", "jp", "jpName", "xy", "cluster", "echoes"];

const missing = name => new Error(`lore.json: missing required field "${name}"`);

// Renvoie { categories, views, clusters, docs, entities, docEntities, shelves } :
// docs : { i, name, cat, text, jp, jpName, alt, altName, dlc, views: [[x, y]] par vue, x, y, cluster, echoes,
//          echoedBy } ; clusters (les plus gros d'abord) : ceux du fichier, x / y de la première vue ;
// entities (les plus citées d'abord) ; docEntities : les entités de chaque texte ;
// la vue « rayons » (SHELVES) ajoutée en dernier à views et aux views de chaque texte et groupe,
// shelves : { k (son indice), columns, cell }. Un champ obligatoire absent : une Error qui le nomme.
export function decodeLore(json) {
  for (const k of REQUIRED) if (json?.[k] === undefined) throw missing(k);
  const F = Object.fromEntries(json.fields.map((f, i) => [f, i]));
  for (const f of FIELDS) if (F[f] === undefined) throw missing(f);
  json.clusters.forEach((c, j) => { if (!c.views) throw missing(`clusters[${j}].views`); });

  const categories = json.categories;
  // chaque texte a une position par vue ([x1, y1, x2, y2…]) ; la première est la carte principale
  const docs = json.docs.map((r, i) => {
    const xy = r[F.xy];
    const views = json.views.map((_, k) => [xy[2 * k], xy[2 * k + 1]]);
    return { i, name: r[F.name], cat: r[F.cat], text: r[F.text], jp: r[F.jp], jpName: r[F.jpName],
             alt: F.alt !== undefined ? r[F.alt] : "", altName: F.altName !== undefined ? r[F.altName] : "",
             dlc: F.dlc !== undefined && !!r[F.dlc],
             views, x: views[0][0], y: views[0][1], cluster: r[F.cluster], echoes: r[F.echoes], echoedBy: 0 };
  });
  // combien d'autres textes comptent chacun parmi leurs échos (le poids d'une étoile, sky.js)
  for (const d of docs) for (const e of d.echoes) docs[e].echoedBy++;
  const clusters = json.clusters.map(c => ({ ...c, views: [...c.views], x: c.views[0].x, y: c.views[0].y }))
    .sort((a, b) => b.n - a.n);

  // la vue rayons (shelves.js) se calcule ici, à partir des catégories et des groupes
  const L = shelves(docs, categories.length);
  const views = [...json.views, SHELVES];
  docs.forEach((d, i) => d.views.push(L.pos[i]));
  for (const c of clusters) c.views.push(L.clusters.get(c.id));

  const entities = [...(json.entities || [])].sort((a, b) => b.docs.length - a.docs.length);
  const docEntities = docs.map(() => []);
  entities.forEach(e => e.docs.forEach(i => docEntities[i].push(e)));
  return { categories, views, clusters, docs, entities, docEntities,
           shelves: { k: views.length - 1, columns: L.columns, cell: L.cell } };
}
