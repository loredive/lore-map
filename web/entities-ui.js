// Personnages, lieux, factions et notions : index, fiches et pastilles.
import { S, $, panel, esc, fold, resetContext, clusterById, docRow, focusPanel } from "./state.js";
import { draw, fitPoints } from "./render.js";
import { select, openCluster, snippet, mark, panelTop, bindPanelTop } from "./panel.js";
import { record } from "./nav.js";
import { speakersFor, dialogueButtons, bindDialogueButtons } from "./dialogue-ui.js";

// ------------------------------------------------------------------ personnages, lieux…
const KIND_LABELS = { personnage: ["Personnage", "Personnages"], lieu: ["Lieu", "Lieux"],
                      faction: ["Faction", "Factions"], notion: ["Notion", "Notions"] };

// count : le chiffre de la pastille (par défaut, le nombre de textes qui en parlent)
export function entityChips(list, count = e => e.docs.length) {
  return `<div class="chips">${list.map(e => `<button type="button" class="chip" data-e="${S.entities.indexOf(e)}">
    ${esc(e.label)} <span class="n">${count(e)}</span></button>`).join("")}</div>`;
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
    <h2>Personnages et lieux</h2>
    <p class="hint">Le chiffre indique combien de textes en parlent. Chacun ouvre ces textes et les fait briller sur la carte.</p>
    ${Object.entries(KIND_LABELS).map(([k, [, plural]]) => {
      const list = S.entities.filter(e => e.kind === k);
      return list.length ? `<h3>${plural}</h3>${entityChips(list)}` : "";
    }).join("")}
    <h3>Dialogues</h3>
    <p class="hint">Tout ce que dit un personnage, dans l'ordre (le chiffre : nombre de passages).</p>
    <div class="chips">${[...S.dialogues].filter(([, l]) => l.length > 1).sort((a, b) => b[1].length - a[1].length)
      .map(([sp, l]) => `<button type="button" class="chip" data-sp="${esc(sp)}">${esc(sp)} <span class="n">${l.length}</span></button>`).join("")}</div>
  </article>`;
  bindEntityButtons();
  bindDialogueButtons();
  bindPanelTop();
  panel.scrollTop = 0;
  focusPanel("Personnages et lieux");
  draw();
}

export function openEntity(e, { fly = true, focus = true } = {}) {
  resetContext();
  S.entity = e;
  S.selected = -1;
  S.lit = new Set(e.docs);
  const docs = e.docs.map(i => S.docs[i]);
  const visible = docs.filter(d => !S.hidden.has(d.cat));
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
    <button type="button" class="to-index">Tous les personnages et lieux</button>
    <div class="cat">${KIND_LABELS[e.kind][0]}</div>
    <h2>${esc(e.label)}</h2>
    ${e.label !== e.name ? `<p class="jpname">${esc(e.name)} dans les textes</p>` : ""}
    ${speakersFor(e).length ? `<div class="tools">${dialogueButtons(speakersFor(e))}</div>` : ""}
    <p class="count">${e.docs.length} textes en parlent${visible.length < docs.length ? `, dont ${visible.length} dans les catégories affichées` : ""}. Ils brillent sur la carte.</p>
    ${related.length ? `<h3>Liés à</h3>
    <p class="hint">Les noms cités dans les mêmes textes, par affinité : d'abord ceux qui reviennent surtout avec celui-ci, pas seulement les plus fréquents. Le chiffre : textes en commun.</p>
    ${entityChips(related.map(([r]) => r), r => shared.get(r))}` : ""}
    ${groups.length ? `<h3>Surtout dans</h3><div class="chips">${groups.map(([c, n]) =>
      `<button type="button" class="chip" data-c="${c.id}">${esc(c.label)} <span class="n">${n}</span></button>`).join("")}</div>` : ""}
    <h3>Les textes</h3>
    <p class="hint">Ceux qui en parlent le plus d'abord ; ceux qui ne la nomment que dans leur titre en dernier.</p>
    <ol class="results">${visible.map(d => docRow(d, mark(esc(d.name), names), mark(esc(snippet(d.text, folded)), names))).join("")}</ol>
  </article>`;
  panel.querySelector(".to-index").addEventListener("click", showIndex);
  bindDialogueButtons();
  bindPanelTop();
  bindEntityButtons();
  panel.querySelectorAll("button[data-i]").forEach(b => b.addEventListener("click", () => select(+b.dataset.i)));
  panel.querySelectorAll("button[data-c]").forEach(b =>
    b.addEventListener("click", () => openCluster(clusterById(+b.dataset.c))));
  panel.scrollTop = 0;
  if (focus) focusPanel(`${e.label} : ${e.docs.length} textes en parlent`);
  if (fly) fitPoints(docs);
  draw();
}
$("#index").addEventListener("click", showIndex);

