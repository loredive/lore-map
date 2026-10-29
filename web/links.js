// Ce que plusieurs pages du panneau partagent : pastilles et liens vers les personnages et lieux,
// boutons des dialogues, extraits, surlignage, badge du DLC, groupe d'un texte. Ce n'est pas une page :
// les modules de pages l'importent sans s'importer entre eux, et ses liens ouvrent les pages par pages.js.
import { S, panel, esc, clusterById } from "./state.js";
import { openPage, currentPage } from "./pages.js";
import { mentionSpans } from "./mentions.js";

export const KIND_LABELS = { personnage: ["Character", "Characters"], lieu: ["Place", "Places"],
                      faction: ["Faction", "Factions"], notion: ["Concept", "Concepts"] };

// ------------------------------------------------------------------ extraits et surlignage
export function snippet(text, terms, len = 150) {
  const flat = text.replace(/\s+/g, " ");
  const low = flat.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  let at = -1;
  for (const t of terms) { at = low.indexOf(t); if (at >= 0) break; }
  if (at < 0) return flat.length > len ? flat.slice(0, len) + "…" : flat;
  const start = Math.max(0, flat.lastIndexOf(" ", Math.max(0, at - 50)));
  const s = flat.slice(start, start + len).trim();
  return (start > 0 ? "…" : "") + s + (start + len < flat.length ? "…" : "");
}
export function mark(html, terms) {
  if (!terms.length) return html;
  const re = new RegExp(`\\b(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\w*`, "gi");
  return html.replace(re, "<mark>$&</mark>");
}

// Ouvre un texte choisi dans une liste (groupe, résultats, entité, dialogue) : la page du texte garde
// la liste à côté (sa colonne), avec la page d'où elle vient pour y revenir.
export function openInList(i, items) {
  openPage("doc", { i, list: { from: currentPage(), items } });
}

// « The Old Hunters » à côté de la catégorie d'un texte ajouté par le DLC (game.json : ui.dlc_label)
export function dlcBadge(d) {
  return d.dlc ? `<span class="dlc-badge" title="Added with ${esc(S.ui.dlc_label || "the DLC")}">${esc(S.ui.dlc_label || "DLC")}</span>` : "";
}

// ------------------------------------------------------------------ personnages, lieux…
// count : le chiffre de la pastille (par défaut, le nombre de textes qui en parlent)
export function entityChips(list, count = e => e.docs.length) {
  return `<div class="chips">${list.map(e => `<button type="button" class="chip" data-e="${S.entities.indexOf(e)}">
    ${esc(e.label)} <span class="n">${count(e)}</span></button>`).join("")}</div>`;
}
// Le texte d'une fiche en HTML, la première mention de chaque entité devenue un lien vers sa fiche.
// mentions : les entités que prepare.py a trouvées dans ce texte ; terms : mots surlignés (recherche).
export function linkText(text, mentions, terms = []) {
  let html = "", at = 0;
  for (const [a, b, e] of mentionSpans(text, mentions)) {
    html += mark(esc(text.slice(at, a)), terms) +
      `<button type="button" class="ent" data-e="${S.entities.indexOf(e)}" title="${esc(e.label)} · ${e.docs.length} texts">${mark(esc(text.slice(a, b)), terms)}</button>`;
    at = b;
  }
  return html + mark(esc(text.slice(at)), terms);
}

export function bindEntityButtons(root = panel) {
  root.querySelectorAll("button[data-e]").forEach(b =>
    b.addEventListener("click", () => openPage("entity", { name: S.entities[+b.dataset.e].name })));
}

// ------------------------------------------------------------------ dialogues
// Les dialogues d'une entité : ceux dont l'interlocuteur porte son nom (« Ranni the Witch » pour Ranni)
export function speakersFor(e) {
  const names = [e.name, ...e.aliases];
  const word = n => new RegExp(`(^|[^\\w])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w]|$)`);
  return [...S.dialogues.keys()].filter(sp => names.some(n => word(n).test(sp)));
}

export function dialogueButtons(speakers, cls = "tdial") {
  return speakers.map(sp => `<button type="button" class="${cls}" data-sp="${esc(sp)}">Read the full dialogue of ${esc(sp)}
    (${S.dialogues.get(sp).length} passages)</button>`).join("");
}
// focusOn : le passage d'où l'on vient, mis en avant dans le dialogue
export function bindDialogueButtons(focusOn = -1, root = panel) {
  root.querySelectorAll("button[data-sp]").forEach(b =>
    b.addEventListener("click", () => openPage("dialogue", focusOn >= 0 ? { speaker: b.dataset.sp, focusOn } : { speaker: b.dataset.sp })));
}

// ------------------------------------------------------------------ groupe d'un texte
// Le groupe du texte, ou pour un texte hors groupe celui de la plupart de ses échos.
export function groupOf(d) {
  if (d.cluster >= 0) return { c: clusterById(d.cluster), near: false };
  const votes = new Map();
  for (const e of d.echoes) {
    const k = S.docs[e].cluster;
    if (k >= 0) votes.set(k, (votes.get(k) || 0) + 1);
  }
  const best = [...votes].sort((a, b) => b[1] - a[1])[0];
  return best ? { c: clusterById(best[0]), near: true } : null;
}
