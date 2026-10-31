// Pourquoi deux textes voisins d'un chemin d'échos sont reliés : les personnages et lieux qu'ils
// citent tous deux, les mots rares qu'ils partagent, et le rang de l'un parmi les échos de l'autre.
// Fonction pure, testable sous Node.
import { tokenize } from "./search.js";

export const MAX_TERMS = 3;
export const MAX_SHARE = 0.05;   // un mot présent dans plus de 5 % des textes n'explique rien

// docEntities : les entités de chaque texte ; docTerms : les mots de chaque texte (Set ou clés d'une
// Map) ; df : Map mot → nombre de textes ; N : nombre de textes ; echoes : les échos de chaque texte
export function linkReason(a, b, { docEntities, docTerms, df, N, echoes }) {
  const inB = new Set(docEntities[b]);
  const entities = docEntities[a].filter(e => !e.broad && inB.has(e));
  const named = new Set(entities.flatMap(e => [e.name, ...(e.aliases || [])].flatMap(tokenize)));
  const termsB = new Set(docTerms[b].keys());
  const terms = [...docTerms[a].keys()]
    .filter(t => termsB.has(t) && !named.has(t) && (df.get(t) || 0) <= MAX_SHARE * N)
    .sort((x, y) => df.get(x) - df.get(y) || x.localeCompare(y))
    .slice(0, MAX_TERMS);
  const ab = echoes[a].indexOf(b), ba = echoes[b].indexOf(a);
  const rank = ab >= 0 && ba >= 0 ? Math.min(ab, ba) + 1 : Math.max(ab, ba) + 1 || null;
  return { entities, terms, rank };
}
