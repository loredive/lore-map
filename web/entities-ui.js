// Personnages, lieux, factions et notions : index, fiches et pastilles.
import { S, $, panel, esc, fold, colorOf, clearHash } from "./state.js";
import { draw, focusDoc } from "./render.js";
import { select, openCluster, snippet, mark } from "./panel.js";

// ------------------------------------------------------------------ personnages, lieux…
const KIND_LABELS = { personnage: ["Personnage", "Personnages"], lieu: ["Lieu", "Lieux"],
                      faction: ["Faction", "Factions"], notion: ["Notion", "Notions"] };

export function entityChips(list) {
  return `<div class="chips">${list.map(e => `<button type="button" class="chip" data-e="${S.entities.indexOf(e)}">
    ${esc(e.label)} <span class="n">${e.docs.length}</span></button>`).join("")}</div>`;
}
export function bindEntityButtons() {
  panel.querySelectorAll("button[data-e]").forEach(b =>
    b.addEventListener("click", () => openEntity(S.entities[+b.dataset.e])));
}

export function showIndex() {
  S.cluster = S.entity = S.lit = null;
  S.selected = -1;
  panel.hidden = false;
  panel.dataset.view = "index";
  panel.innerHTML = `<article class="card">
    <h2>Personnages et lieux</h2>
    <p class="hint">Le chiffre indique combien de textes en parlent. Chacun ouvre ces textes et les fait briller sur la carte.</p>
    ${Object.entries(KIND_LABELS).map(([k, [, plural]]) => {
      const list = S.entities.filter(e => e.kind === k);
      return list.length ? `<h3>${plural}</h3>${entityChips(list)}` : "";
    }).join("")}
  </article>`;
  bindEntityButtons();
  panel.scrollTop = 0;
  clearHash();
  draw();
}

export function openEntity(e, { fly = true } = {}) {
  S.entity = e;
  S.cluster = null;
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
    .map(([id, n]) => [S.clusters.find(c => c.id === id), n]).filter(([c]) => c);
  const byName = new Map(S.entities.map(x => [x.name, x]));
  const related = (e.related || []).map(([n, k]) => [byName.get(n), k]).filter(([r]) => r);
  panel.hidden = false;
  panel.dataset.view = "entity";
  panel.innerHTML = `<article class="card">
    <button type="button" class="back">Tous les personnages et lieux</button>
    <div class="cat">${KIND_LABELS[e.kind][0]}</div>
    <h2>${esc(e.label)}</h2>
    ${e.label !== e.name ? `<p class="jpname">${esc(e.name)} dans les textes</p>` : ""}
    <p class="count">${e.docs.length} textes en parlent${visible.length < docs.length ? `, dont ${visible.length} dans les catégories affichées` : ""}. Ils brillent sur la carte.</p>
    ${related.length ? `<h3>Liés à</h3>
    <p class="hint">Les noms le plus souvent cités dans les mêmes textes (le chiffre : textes en commun).</p>
    <div class="chips">${related.map(([r, n]) => `<button type="button" class="chip" data-e="${S.entities.indexOf(r)}">
      ${esc(r.label)} <span class="n">${n}</span></button>`).join("")}</div>` : ""}
    ${groups.length ? `<h3>Surtout dans</h3><div class="chips">${groups.map(([c, n]) =>
      `<button type="button" class="chip" data-c="${c.id}">${esc(c.label)} <span class="n">${n}</span></button>`).join("")}</div>` : ""}
    <h3>Les textes</h3>
    <p class="hint">Ceux qui en parlent le plus d'abord ; ceux qui ne la nomment que dans leur titre en dernier.</p>
    <ol class="results">${visible.map(d => `<li><button type="button" data-i="${d.i}">
        <span class="head"><span class="dot" style="--c:${colorOf(d.cat)}"></span><span class="name">${mark(esc(d.name), names)}</span></span>
        <span class="snip">${mark(esc(snippet(d.text, folded)), names)}</span></button></li>`).join("")}</ol>
  </article>`;
  panel.querySelector(".back").addEventListener("click", showIndex);
  bindEntityButtons();
  panel.querySelectorAll("button[data-i]").forEach(b => b.addEventListener("click", () => select(+b.dataset.i)));
  panel.querySelectorAll("button[data-c]").forEach(b =>
    b.addEventListener("click", () => openCluster(S.clusters.find(c => c.id === +b.dataset.c))));
  panel.scrollTop = 0;
  history.replaceState(null, "", "#entite=" + encodeURIComponent(e.name));
  if (fly && docs.length) {
    const xs = docs.map(d => d.x).sort((a, b) => a - b), ys = docs.map(d => d.y).sort((a, b) => a - b);
    const at = (a, q) => a[Math.min(a.length - 1, Math.floor(a.length * q))];
    const center = { x: at(xs, 0.5), y: at(ys, 0.5) };
    const r = Math.max(at(xs, 0.9) - at(xs, 0.1), at(ys, 0.9) - at(ys, 0.1)) / 2 || 0.1;
    focusDoc(center, Math.max(0.8, Math.min(12, 0.8 / r)));
  }
  draw();
}
$("#index").addEventListener("click", showIndex);

