// Personnages, lieux, factions et notions : l'index et la fiche de chacun.
import { S, $, esc, fold, clusterById, docRow, isHidden, nameOf, textOf, groupName } from "./state.js";
import { registerPage, openPage } from "./pages.js";
import { KIND_LABELS, entityChips, bindEntityButtons, speakersFor, dialogueButtons, bindDialogueButtons, snippet, mark, openInList } from "./links.js";

registerPage({
  name: "index",
  backLabel: () => "Back to characters and places",
  render: () => ({
    announce: "Characters and places",
    html: `<article class="card">
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
  </article>`,
    bind: p => { bindEntityButtons(p); bindDialogueButtons(-1, p); },
  }),
});

const entityNamed = name => S.entities.find(x => x.name === name);

registerPage({
  name: "entity",
  address: {
    write: a => "#entity=" + encodeURIComponent(a.name),
    keys: ["entity", "entite"],          // #entite= : les liens d'avant le passage à l'anglais
    read: v => (entityNamed(v) ? { name: v } : null),
  },
  backLabel: a => `Back to “${entityNamed(a.name)?.label || a.name}”`,
  step: a => ({ kind: "entity", key: a.name }),
  fromStep: {
    kind: "entity", page: key => (entityNamed(key) ? { name: key } : null),
    label: key => entityNamed(key)?.label || key, kindLabel: key => KIND_LABELS[entityNamed(key).kind][0],
  },
  render: ({ name }) => {
    const e = entityNamed(name);
    S.entity = e;
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
    return {
      announce: `${e.label}: ${e.docs.length} texts mention it`,
      frame: docs,          // avec le texte d'où l'on vient, s'il y en a un
      html: `<article class="card">
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
      `<button type="button" class="chip" data-c="${c.id}">${esc(groupName(c))} <span class="n">${n}</span></button>`).join("")}</div>` : ""}
    <h3>The texts</h3>
    <p class="hint">Most relevant first.</p>
    <ol class="results">${visible.map(d => docRow(d, mark(esc(nameOf(d)), names), mark(esc(snippet(textOf(d), folded)), names))).join("")}</ol>
  </article>`,
      bind: p => {
        p.querySelector(".to-index").addEventListener("click", () => openPage("index"));
        bindDialogueButtons(-1, p);
        bindEntityButtons(p);
        p.querySelectorAll("button[data-i]").forEach(b => b.addEventListener("click", () => openInList(+b.dataset.i, visible.map(d => d.i))));
        p.querySelectorAll("button[data-c]").forEach(b => b.addEventListener("click", () => {
          const c = clusterById(+b.dataset.c);
          openPage("cluster", { id: c.id, label: c.label });
        }));
      },
    };
  },
});

$("#index").addEventListener("click", () => openPage("index"));
