// Questions sur le lore : choix des textes à donner au modèle, consigne, et lecture des citations [n].
// Sans DOM ni réseau, pour être testé seul (tests/rag.test.mjs).

export const PER_TURN = 15;     // textes ajoutés à chaque question
export const MAX_POOL = 60;     // textes gardés pour toute la conversation

// La requête de recherche : la question, plus la précédente pour les relances (« et sa fille ? »).
export function searchQuery(question, history) {
  const before = history.filter(m => m.role === "user").at(-1)?.content || "";
  return before ? `${question}\n${before}` : question;
}

// Ajoute à la réserve les meilleurs textes du classement qui n'y sont pas encore. Les textes gardent
// leur numéro d'une question à l'autre : un [3] cité plus tôt désigne toujours le même texte.
// ranked : [[indice, score]] ; hidden(i) : texte masqué (catégorie décochée, DLC caché).
export function growPool(pool, ranked, hidden, perTurn = PER_TURN, max = MAX_POOL) {
  const have = new Set(pool);
  const fresh = [];
  for (const [i] of ranked) {
    if (fresh.length >= perTurn || pool.length + fresh.length >= max) break;
    if (!have.has(i) && !hidden(i)) { fresh.push(i); have.add(i); }
  }
  return [...pool, ...fresh];
}

export function systemPrompt(gameTitle, pool, docs, cats) {
  const texts = pool.map((i, k) => {
    const d = docs[i];
    return `[${k + 1}] ${d.name} (${cats[d.cat]})\n${d.text}`;
  }).join("\n\n");
  return `You answer questions about the lore of ${gameTitle}, for someone exploring a map of the game's texts.

The numbered texts below come from the game itself: item descriptions, dialogue, notes. They were picked for this conversation. Base your answers on them and cite the texts you rely on by number in square brackets, like [3], right after the claim they support. When the texts don't settle a question, say so plainly instead of guessing, and don't invent names, events or quotes.

Answer in the language of the question. Keep it short: a few paragraphs of plain prose, no headings.

<texts>
${texts}
</texts>`;
}

// Numéros cités dans une réponse, dans l'ordre de première apparition, ramenés aux indices des textes.
export function citations(answer, pool) {
  const seen = [];
  for (const m of answer.matchAll(/\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g)) {
    for (const part of m[1].split(",")) {
      const [a, b = a] = part.split(/[–-]/).map(s => +s.trim());
      for (let n = a; n <= Math.min(b, a + 20); n++) {
        const i = pool[n - 1];
        if (i !== undefined && !seen.includes(i)) seen.push(i);
      }
    }
  }
  return seen;
}
