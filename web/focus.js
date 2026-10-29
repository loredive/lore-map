// Le focus de la carte : ce que la page ouverte met en avant (un texte, un groupe, une entité, un
// chemin d'échos ou une visite guidée, un dialogue, des résultats de recherche). Les pages posent ses
// champs dans S et resetContext les efface ; c'est ici seulement qu'on en déduit ce qui s'éteint, ce qui
// reste dessiné et ce qu'il faut recadrer. Pur : reçoit l'état en argument (S), testable sous node.
//   selected  indice du texte ouvert, ou -1          hits     Map indice -> rang (la recherche)
//   cluster   le groupe ouvert                      entity   l'entité ouverte
//   lit       Set des textes allumés (entité, dialogue)
//   path      indices d'un chemin d'échos OU d'une visite guidée : les deux se dessinent en ligne
//             numérotée, la visite entoure en plus son étape (tourStep) ; pathSet : les mêmes, en Set

const selectedDoc = s => (s.selected >= 0 ? s.docs[s.selected] : null);

// Rien n'est mis en avant : la carte au repos (couleurs atténuées de loin, traits de tous les groupes)
export function isQuiet(s) {
  return !selectedDoc(s) && !s.hits && !s.lit && !s.cluster && !s.path;
}

// Une fonction texte -> s'éteint-il ? À construire une fois par image.
// Un chemin ou une recherche n'allument que leurs textes ; un texte ouvert, lui et ses échos ; sans texte
// ouvert, un groupe ses membres et une entité ou un dialogue ses textes.
export function dimmer(s) {
  const sel = selectedDoc(s), echoes = new Set(sel ? sel.echoes : []);
  return d => (s.path && !s.pathSet.has(d.i)) || (s.hits && !s.hits.has(d.i)) ||
    (sel && d.i !== sel.i && !echoes.has(d.i)) ||
    (!sel && s.cluster && d.cluster !== s.cluster.id) || (!sel && s.lit && !s.lit.has(d.i));
}

// Les contours des groupes : pas pendant une recherche ni le long d'un chemin ou d'une visite (leurs
// propres tracés suffisent)
export const showsHulls = s => !s.hits && !s.path;

// Les noms des groupes : seulement sans rien d'ouvert qui écrive les siens (une entité écrit son nom)
export const showsGroupNames = s => !s.hits && !selectedDoc(s) && !s.path && !s.entity;

// Opacité du nuage d'un groupe : plein s'il est le groupe ouvert ou survolé (on) ; sinon il s'efface
// d'autant plus que le focus est précis
export function cloudOpacity(s, on) {
  if (on) return 1;
  if (s.cluster) return 0.25;
  return s.hits || s.lit || s.path ? 0.4 : 0.72;
}

// Ce qu'il faut recadrer quand la carte change de vue : { doc } (un texte), { points, trim } (un chemin
// ou une visite entiers, un groupe ou une entité sans leurs écarts), ou null
export function focusStars(s) {
  if (s.selected >= 0) return { doc: s.docs[s.selected] };
  if (s.path) return { points: s.path.map(i => s.docs[i]), trim: 0 };
  if (s.cluster) return { points: s.docs.filter(d => d.cluster === s.cluster.id), trim: 0.1 };
  if (s.entity) return { points: s.entity.docs.map(i => s.docs[i]), trim: 0.1 };
  return null;
}
