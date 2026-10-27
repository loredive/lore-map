// Mentions d'entités dans un texte, pour en faire des liens. Mêmes règles que entities.py : nom ou
// alias en mots entiers, sensible à la casse, hors des expressions exclues (« Crystal Torrent »).
// Fonction pure, testable sous Node.

const WORD = "[\\p{L}\\p{N}_-]";
const quote = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// [[début, fin, entité]] triés : la première mention de chaque entité, les noms longs d'abord
// (« Old Yharnam » passe avant « Yharnam »), sans chevauchement ; les entités « broad » sont ignorées.
export function mentionSpans(text, entities) {
  const spans = [];
  const longest = entities.filter(e => !e.broad).sort((a, b) => b.name.length - a.name.length);
  for (const e of longest) {
    const names = [e.name, ...(e.aliases || [])].sort((a, b) => b.length - a.length).map(quote);
    const re = new RegExp(`(?<!${WORD})(?:${names.join("|")})(?!${WORD})`, "gu");
    const excluded = (e.exclude || []).flatMap(x => [...text.matchAll(new RegExp(quote(x), "g"))]
      .map(m => [m.index, m.index + x.length]));
    for (const m of text.matchAll(re)) {
      const [a, b] = [m.index, m.index + m[0].length];
      const overlaps = ([x, y]) => a < y && b > x;
      if (excluded.some(overlaps) || spans.some(overlaps)) continue;
      spans.push([a, b, e]);
      break;
    }
  }
  return spans.sort((p, q) => p[0] - q[0]);
}
