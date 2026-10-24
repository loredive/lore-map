// Graphe des échos : chaque texte relié à ses voisins par le sens, dans les deux sens.
// Fonctions pures, testables sous Node.

export function echoGraph(echoes) {
  const adj = echoes.map(list => new Set(list));
  echoes.forEach((list, i) => list.forEach(j => adj[j].add(i)));
  return adj;
}

// Plus court chemin (en nombre d'échos) de from à to, ou null s'ils ne sont pas reliés.
export function echoPath(adj, from, to) {
  if (from === to) return [from];
  const prev = new Map([[from, -1]]);
  let frontier = [from];
  while (frontier.length) {
    const next = [];
    for (const i of frontier) {
      for (const j of adj[i]) {
        if (prev.has(j)) continue;
        prev.set(j, i);
        if (j === to) {
          const path = [to];
          for (let k = i; k !== -1; k = prev.get(k)) path.push(k);
          return path.reverse();
        }
        next.push(j);
      }
    }
    frontier = next;
  }
  return null;
}
