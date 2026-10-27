// Le dialogue complet d'un PNJ, passage après passage. Les passages sont dispersés sur la carte
// (ceux de Ranni dans plusieurs groupes) ; ici on les relit dans l'ordre, et la carte trace le fil
// qui les relie.
import { S, panel, esc, resetContext, focusPanel, portrait, textOf, textLang } from "./state.js";
import { draw, frameFrom } from "./render.js";
import { select, panelTop, bindPanelTop } from "./panel.js";
import { record } from "./nav.js";
import { linkText, bindEntityButtons } from "./entities-ui.js";

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
  return speakers.map(sp => `<button type="button" class="${cls}" data-sp="${esc(sp)}">Read the full dialogue of ${esc(sp)}
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
  const face = portrait(S.docs[list[0]], "portrait", 96);
  panel.innerHTML = `${panelTop()}<article class="card">
    <div class="card-head${face ? " has-img" : ""}">${face}<div>
    <div class="cat">Dialogue</div>
    <h2>${esc(speaker)}</h2>
    </div></div>
    <p class="count">${list.length} passages, in the order the game speaks them. On the map, a thread links them:
      you can watch the dialogue move from one group to another.</p>
    <ol class="script">${list.map(i => {
      const d = S.docs[i];
      return `<li id="p${i}"${i === focusOn ? ' class="here"' : ""}>
        <button type="button" class="pnum" data-i="${i}" aria-label="Passage ${d.part}: see its details and echoes">${d.part}</button>
        <p class="text" lang="${textLang(d)}">${linkText(textOf(d), S.docEntities[i])}</p></li>`;
    }).join("")}</ol>
  </article>`;
  bindPanelTop();
  panel.querySelectorAll(".pnum").forEach(b => b.addEventListener("click", () => select(+b.dataset.i)));
  bindEntityButtons();
  panel.scrollTop = 0;
  if (focusOn >= 0) panel.querySelector(`#p${focusOn}`)?.scrollIntoView({ block: "center" });
  focusPanel(`Dialogue of ${speaker}: ${list.length} passages`);
  if (fly) frameFrom(list.map(i => S.docs[i]));
  draw();
}
