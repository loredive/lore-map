// Le dialogue complet d'un PNJ, passage après passage. Les passages sont dispersés sur la carte
// (ceux de Ranni dans plusieurs groupes) ; ici on les relit dans l'ordre, et la carte trace le fil
// qui les relie.
import { S, panel, esc, resetContext, focusPanel } from "./state.js";
import { draw, fitPoints } from "./render.js";
import { select, panelTop, bindPanelTop } from "./panel.js";
import { record } from "./nav.js";

const PASSAGE = /^(.*) — passage (\d+)$/;

export function buildDialogues() {
  S.dialogues = new Map();          // interlocuteur -> indices de ses passages, dans l'ordre
  for (const d of S.docs) {
    const m = PASSAGE.exec(d.name);
    if (!m) continue;
    d.speaker = m[1];
    d.part = +m[2];
    if (!S.dialogues.has(d.speaker)) S.dialogues.set(d.speaker, []);
    S.dialogues.get(d.speaker).push(d.i);
  }
  for (const list of S.dialogues.values()) list.sort((a, b) => S.docs[a].part - S.docs[b].part);
}

// Les dialogues d'une entité : ceux dont l'interlocuteur porte son nom (« Ranni the Witch » pour Ranni)
export function speakersFor(e) {
  const names = [e.name, ...e.aliases];
  const word = n => new RegExp(`(^|[^\\w])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w]|$)`);
  return [...S.dialogues.keys()].filter(sp => names.some(n => word(n).test(sp)));
}

export function dialogueButtons(speakers, cls = "tdial") {
  return speakers.map(sp => `<button type="button" class="${cls}" data-sp="${esc(sp)}">Lire tout le dialogue de ${esc(sp)}
    (${S.dialogues.get(sp).length} passages)</button>`).join("");
}
export function bindDialogueButtons(focusOn = -1) {
  panel.querySelectorAll("button[data-sp]").forEach(b =>
    b.addEventListener("click", () => openDialogue(b.dataset.sp, { focusOn })));
}

export function openDialogue(speaker, { focusOn = -1, fly = true } = {}) {
  const list = S.dialogues.get(speaker);
  if (!list) return;
  resetContext();
  S.selected = -1;
  S.lit = new Set(list);
  S.thread = list;                   // le fil du dialogue, tracé sur la carte
  panel.hidden = false;
  panel.dataset.view = "dialogue";
  record({ view: "dialogue", speaker });
  panel.innerHTML = `${panelTop()}<article class="card">
    <div class="cat">Dialogue</div>
    <h2>${esc(speaker)}</h2>
    <p class="count">${list.length} passages, dans l'ordre des répliques du jeu. Sur la carte, un fil les relie :
      on voit le dialogue passer d'un groupe à l'autre.</p>
    <ol class="script">${list.map(i => {
      const d = S.docs[i];
      return `<li id="p${i}"${i === focusOn ? ' class="here"' : ""}>
        <button type="button" class="pnum" data-i="${i}" aria-label="Passage ${d.part} : voir sa fiche et ses échos">${d.part}</button>
        <p class="text">${esc(d.text)}</p></li>`;
    }).join("")}</ol>
  </article>`;
  bindPanelTop();
  panel.querySelectorAll(".pnum").forEach(b => b.addEventListener("click", () => select(+b.dataset.i)));
  panel.scrollTop = 0;
  if (focusOn >= 0) panel.querySelector(`#p${focusOn}`)?.scrollIntoView({ block: "center" });
  focusPanel(`Dialogue de ${speaker} : ${list.length} passages`);
  if (fly) fitPoints(list.map(i => S.docs[i]), 0);
  draw();
}
