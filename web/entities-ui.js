// Personnages, lieux, factions et notions : index, fiches et pastilles.
import { S, $, panel, esc, fold, resetContext, clusterById, docRow, focusPanel, isHidden, nameOf, textOf } from "./state.js";
import { draw, frameFrom } from "./render.js";
import { select, openCluster, snippet, mark, panelTop, bindPanelTop } from "./panel.js";
import { record } from "./nav.js";
import { speakersFor, dialogueButtons, bindDialogueButtons } from "./dialogue-ui.js";
import { mentionSpans } from "./mentions.js";

// ------------------------------------------------------------------ personnages, lieux…
export const KIND_LABELS = { personnage: ["Character", "Characters"], lieu: ["Place", "Places"],
                      faction: ["Faction", "Factions"], notion: ["Concept", "Concepts"] };

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

export function bindEntityButtons() {
  panel.querySelectorAll("button[data-e]").forEach(b =>
    b.addEventListener("click", () => openEntity(S.entities[+b.dataset.e])));
}

export function showIndex() {
  resetContext();
  S.selected = -1;
  panel.hidden = false;
  panel.dataset.view = "index";
  record({ view: "index" });
  panel.innerHTML = `${panelTop()}<article class="card">
    <h2>Characters and places</h2>
    <p class="hint">The number: how many texts mention it.</p>
    ${Object.entries(KIND_LABELS).map(([k, [, plural]]) => {
      const list = S.entities.filter(e => e.kind === k);
      return list.length ? `<h3>${plural}</h3>${entityChips(list)}` : "";
    }).join("")}
    <h3>Dialogues</h3>
    <p class="hint">Everything a character says, in order.</p>
    <div class="chips">${[...S.dialogues].filter(([, l]) => l.length > 1).sort((a, b) => b[1].length - a[1].length)
      .map(([sp, l]) => `<button type="button" class="chip" data-sp="${esc(sp)}">${esc(sp)} <span class="n">${l.length}</span></button>`).join("")}</div>
  </article>`;
  bindEntityButtons();
  bindDialogueButtons();
  bindPanelTop();
  panel.scrollTop = 0;
  focusPanel("Characters and places");
  draw();
}

export function openEntity(e, { fly = true, focus = true } = {}) {
  resetContext();
  S.entity = e;
  S.selected = -1;
  S.lit = new Set(e.docs);
  const docs = e.docs.map(i => S.docs[i]);
  const visible = docs.filter(d => !isHidden(d));
  // snippet() cherche dans le texte replié (minuscules, sans accents), mark() surligne les noms tels quels
  const names = [e.name, ...e.aliases], folded = names.map(fold);
  // les groupes où l'entité revient le plus : là où son histoire se raconte
  const counts = new Map();
  for (const d of docs) if (d.cluster >= 0) counts.set(d.cluster, (counts.get(d.cluster) || 0) + 1);
  const groups = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([id, n]) => [clusterById(id), n]).filter(([c]) => c);
  const byName = new Map(S.entities.map(x => [x.name, x]));
  const related = (e.related || []).map(([n, k]) => [byName.get(n), k]).filter(([r]) => r);
  const shared = new Map(related);
  panel.hidden = false;
  panel.dataset.view = "entity";
  record({ view: "entity", name: e.name });
  panel.innerHTML = `${panelTop()}<article class="card">
    <button type="button" class="to-index">All characters and places</button>
    <div class="cat">${KIND_LABELS[e.kind][0]}</div>
    <h2>${esc(e.label)}</h2>
    ${e.label !== e.name ? `<p class="jpname">${esc(e.name)} in the texts</p>` : ""}
    ${speakersFor(e).length ? `<div class="tools">${dialogueButtons(speakersFor(e))}</div>` : ""}
    <p class="count">${e.docs.length} texts mention it${visible.length < docs.length ? `, ${visible.length} of them shown` : ""}.</p>
    <p class="hint">On the map, the brightest stars talk about it most.</p>
    ${related.length ? `<h3>Linked to</h3>
    <p class="hint">Names that come up with it most (the number: texts in common).</p>
    ${entityChips(related.map(([r]) => r), r => shared.get(r))}` : ""}
    ${groups.length ? `<h3>Mostly in</h3><div class="chips">${groups.map(([c, n]) =>
      `<button type="button" class="chip" data-c="${c.id}">${esc(c.label)} <span class="n">${n}</span></button>`).join("")}</div>` : ""}
    <h3>The texts</h3>
    <p class="hint">Most relevant first.</p>
    <ol class="results">${visible.map(d => docRow(d, mark(esc(nameOf(d)), names), mark(esc(snippet(textOf(d), folded)), names))).join("")}</ol>
  </article>`;
  panel.querySelector(".to-index").addEventListener("click", showIndex);
  bindDialogueButtons();
  bindPanelTop();
  bindEntityButtons();
  panel.querySelectorAll("button[data-i]").forEach(b => b.addEventListener("click", () => select(+b.dataset.i)));
  panel.querySelectorAll("button[data-c]").forEach(b =>
    b.addEventListener("click", () => openCluster(clusterById(+b.dataset.c))));
  panel.scrollTop = 0;
  if (focus) focusPanel(`${e.label}: ${e.docs.length} texts mention it`);
  if (fly) frameFrom(docs);     // avec le texte d'où l'on vient, s'il y en a un
  draw();
}
$("#index").addEventListener("click", showIndex);

