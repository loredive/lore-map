// Le dialogue complet d'un PNJ, passage après passage. Les passages sont dispersés sur la carte
// (ceux de Ranni dans plusieurs groupes) ; ici on les relit dans l'ordre, et la carte trace le fil
// qui les relie.
import { S, esc, portrait, textOf, textLang } from "./state.js";
import { registerPage, openPage } from "./pages.js";
import { linkText, bindEntityButtons } from "./links.js";

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

// focusOn : le passage d'où l'on vient (ouvert depuis un texte), mis en avant et centré
registerPage({
  name: "dialogue",
  address: {
    write: a => "#dialogue=" + encodeURIComponent(a.speaker),
    keys: ["dialogue"],
    read: v => (S.dialogues.has(v) ? { speaker: v } : null),
  },
  backLabel: a => `Back to the dialogue of ${a.speaker}`,
  step: a => ({ kind: "dialogue", key: a.speaker }),
  fromStep: { kind: "dialogue", page: key => (S.dialogues.has(key) ? { speaker: key } : null) },
  render: ({ speaker, focusOn = -1 }) => {
    const list = S.dialogues.get(speaker);
    S.lit = new Set(list);
    S.thread = list;                   // le fil du dialogue, tracé sur la carte
    const face = portrait(S.docs[list[0]], "portrait", 96);
    return {
      announce: `Dialogue of ${speaker}: ${list.length} passages`,
      frame: list.map(i => S.docs[i]),
      html: `<article class="card">
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
  </article>`,
      bind: p => {
        p.querySelectorAll(".pnum").forEach(b => b.addEventListener("click", () => openPage("doc", { i: +b.dataset.i })));
        bindEntityButtons(p);
        if (focusOn >= 0) p.querySelector(`#p${focusOn}`)?.scrollIntoView({ block: "center" });
      },
    };
  },
});
