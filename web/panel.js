// Le panneau de droite : fiche d'un texte, fiche d'un groupe, aide, liens (#…).
import { tokenize } from "./search.js";
import { S, $, panel, esc, colorOf, clearHash } from "./state.js";
import { draw, focusDoc } from "./render.js";
import { echoGraph, echoPath } from "./graph.js";
import { renderResults, resetSearch } from "./search-ui.js";
import { entityChips, bindEntityButtons, openEntity } from "./entities-ui.js";

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


// ------------------------------------------------------------------ fiche d'un texte
export function select(i, { fly = true } = {}) {
  if (S.pathFrom >= 0 && i !== S.pathFrom) { showPath(S.pathFrom, i); return; }
  S.selected = i;
  const d = S.docs[i];
  const terms = tokenize(S.query || "");
  panel.hidden = false;
  panel.dataset.view = "doc";
  const back = S.path ? "Retour au chemin"
    : S.results.length ? "Retour aux résultats"
    : S.cluster ? `Retour au groupe « ${S.cluster.label} »`
    : S.entity ? `Retour à « ${S.entity.label} »` : "";
  const mentions = S.docEntities[i].filter(e => !e.broad);   // Erdtree, Entre-terre… : partout, donc sans intérêt ici
  panel.innerHTML = `<article class="card">
    ${back ? `<button type="button" class="back">${esc(back)}</button>` : ""}
    <div class="cat"><span class="dot" style="--c:${colorOf(d.cat)}"></span>${esc(S.cats[d.cat])}</div>
    <h2>${esc(d.name)}</h2>
    ${groupLine(d)}
    ${d.jpName ? `<p class="jpname" lang="ja">${esc(d.jpName)}</p>` : ""}
    <p class="text">${mark(esc(d.text), terms)}</p>
    <div class="jp" lang="ja" hidden>${esc(d.jp)}</div>
    <div class="tools">
      ${d.jp ? `<button type="button" class="tjp" aria-expanded="false">Voir le texte japonais</button>` : ""}
      <button type="button" class="tlink">Copier le lien vers ce texte</button>
      <button type="button" class="tpath">Tracer un chemin vers un autre texte</button>
    </div>
    ${mentions.length ? `<h3>Mentionne</h3>
    <p class="hint">Personnages, lieux et notions cités : chacun ouvre les autres textes qui en parlent.</p>
    ${entityChips(mentions)}` : ""}
    <h3>Échos</h3>
    <p class="hint">Les textes les plus proches par le sens, reliés à celui-ci sur la carte.</p>
    <ol class="echoes">${d.echoes.map(e => {
      const x = S.docs[e];
      return `<li><button type="button" data-i="${e}"><span class="head"><span class="dot" style="--c:${colorOf(x.cat)}"></span><span class="name">${esc(x.name)}</span></span><small>${esc(S.cats[x.cat])}</small></button></li>`;
    }).join("")}</ol>
  </article>`;
  panel.querySelector(".back")?.addEventListener("click", deselect);
  panel.querySelector(".tjp")?.addEventListener("click", ev => {
    const jp = panel.querySelector(".jp"), open = jp.hidden;
    jp.hidden = !open;
    ev.target.setAttribute("aria-expanded", String(open));
    ev.target.textContent = open ? "Masquer le texte japonais" : "Voir le texte japonais";
  });
  panel.querySelector(".tlink").addEventListener("click", ev => {
    navigator.clipboard?.writeText(location.href).then(() => { ev.target.textContent = "Lien copié"; });
  });
  panel.querySelectorAll(".echoes button").forEach(b => b.addEventListener("click", () => select(+b.dataset.i)));
  panel.querySelector(".tpath").addEventListener("click", () => startPath(i));
  bindGroupButtons();
  bindEntityButtons();
  panel.scrollTop = 0;
  history.replaceState(null, "", "#" + encodeURIComponent(d.name));
  if (fly) focusDoc(d, Math.max(S.cam.s, 4));
  draw();
}

export function deselect() {
  S.selected = -1;
  clearHash();
  if (S.path) showPathView();
  else if (S.results.length) renderResults();
  else if (S.cluster) openCluster(S.cluster, { fly: false });
  else if (S.entity) openEntity(S.entity, { fly: false });
  else panel.hidden = true;
  draw();
}

// ------------------------------------------------------------------ fiche d'un groupe
export function openCluster(c, { fly = true } = {}) {
  S.cluster = c;
  S.entity = S.lit = S.path = S.pathSet = null;
  S.selected = -1;
  const members = S.docs.filter(d => d.cluster === c.id);
  // les textes du cœur du groupe d'abord
  const dist = d => (d.x - c.x) ** 2 + (d.y - c.y) ** 2;
  members.sort((a, b) => dist(a) - dist(b));
  const visible = members.filter(d => !S.hidden.has(d.cat));
  const keywords = c.keywords && c.keywords !== c.label
    ? `<p class="keywords"><span>Mots clés</span> ${esc(c.keywords)}</p>` : "";
  panel.hidden = false;
  panel.dataset.view = "cluster";
  panel.innerHTML = `<article class="card">
    <div class="cat">Groupe de textes</div>
    <h2>${esc(c.label)}</h2>
    ${c.description ? `<p class="text">${esc(c.description)}</p>` : ""}
    <p class="count">${c.n} textes${visible.length < members.length ? `, dont ${visible.length} dans les catégories affichées` : ""}.</p>
    ${keywords}
    <ol class="results">${visible.map(d => `<li><button type="button" data-i="${d.i}">
        <span class="head"><span class="dot" style="--c:${colorOf(d.cat)}"></span><span class="name">${esc(d.name)}</span></span>
        <span class="snip">${esc(snippet(d.text, []))}</span></button></li>`).join("")}</ol>
  </article>`;
  panel.querySelectorAll("button[data-i]").forEach(b =>
    b.addEventListener("click", () => select(+b.dataset.i)));
  panel.scrollTop = 0;
  history.replaceState(null, "", "#groupe=" + encodeURIComponent(c.label));
  if (fly) {
    // zoom pour que la plupart des étoiles du groupe tiennent à l'écran
    const r = Math.sqrt(dist(members[Math.floor(members.length * 0.9)] || c)) || 0.1;
    focusDoc(c, Math.max(1, Math.min(12, 0.8 / r)));
  }
  draw();
}

export function closePanel() {
  S.cluster = S.entity = S.lit = S.path = S.pathSet = null;
  cancelPath();
  panel.hidden = true;
  panel.dataset.view = "";
  clearHash();
  draw();
}


export function showHelp() {
  S.cluster = S.entity = S.lit = S.path = S.pathSet = null;
  if (S.selected >= 0) { S.selected = -1; clearHash(); }
  panel.hidden = false;
  panel.dataset.view = "help";
  panel.innerHTML = `<article class="card">
    <h2>Comment lire cette carte</h2>
    <ul class="help">
      <li>Chaque point est un texte du jeu : objet, arme, armure, dialogue…</li>
      <li>Les textes proches parlent des mêmes choses ; les éloignés, d'autres sujets.</li>
      <li>Les noms écrits sur la carte désignent des groupes de textes voisins.</li>
      <li>Cliquer un point pour le lire, ou un nom pour parcourir son groupe.</li>
    </ul>
  </article>`;
  panel.scrollTop = 0;
  draw();
}
$("#help").addEventListener("click", showHelp);

export function openFromHash() {
  const name = decodeURIComponent(location.hash.slice(1));
  if (!name) return;
  if (name.startsWith("groupe=")) {
    const c = S.clusters.find(x => x.label === name.slice(7));
    if (c) openCluster(c);
    return;
  }
  if (name.startsWith("entite=")) {
    const e = S.entities.find(x => x.name === name.slice(7));
    if (e) openEntity(e);
    return;
  }
  const d = S.docs.find(x => x.name === name);
  if (d) select(d.i);
}

// lien collé dans la barre d'adresse sans recharger la page (replaceState ne déclenche pas l'événement)
addEventListener("hashchange", () => { if (S.docs.length) openFromHash(); });


// ------------------------------------------------------------------ groupe d'un texte
// Le groupe du texte, ou pour un texte hors groupe celui de la plupart de ses échos.
function groupOf(d) {
  if (d.cluster >= 0) return { c: S.clusters.find(x => x.id === d.cluster), near: false };
  const votes = new Map();
  for (const e of d.echoes) {
    const k = S.docs[e].cluster;
    if (k >= 0) votes.set(k, (votes.get(k) || 0) + 1);
  }
  const best = [...votes].sort((a, b) => b[1] - a[1])[0];
  return best ? { c: S.clusters.find(x => x.id === best[0]), near: true } : null;
}
function groupLine(d) {
  const g = groupOf(d);
  if (!g?.c) return "";
  const link = `<button type="button" class="glink" data-c="${g.c.id}">${esc(g.c.label)}</button>`;
  return `<p class="group">${g.near ? `Hors groupe · le plus proche : ${link}` : `Groupe : ${link}`}</p>`;
}
function bindGroupButtons() {
  panel.querySelectorAll("button.glink").forEach(b =>
    b.addEventListener("click", () => openCluster(S.clusters.find(c => c.id === +b.dataset.c))));
}

// ------------------------------------------------------------------ chemin d'échos
// D'un texte à un autre en sautant d'écho en écho : comment le sens glisse d'un sujet à l'autre.
const pathbar = $("#pathbar");
function startPath(i) {
  S.pathFrom = i;
  pathbar.querySelector(".from").textContent = S.docs[i].name;
  pathbar.hidden = false;
}
export function cancelPath() {
  S.pathFrom = -1;
  pathbar.hidden = true;
}
$("#pathbar .cancel").addEventListener("click", () => { cancelPath(); draw(); });

function showPath(a, b) {
  cancelPath();
  resetSearch();      // la recherche a servi à choisir l'arrivée
  S.echoAdj ||= echoGraph(S.docs.map(d => d.echoes));
  const path = echoPath(S.echoAdj, a, b);
  S.cluster = S.entity = S.lit = null;
  S.selected = -1;
  S.path = path; S.pathSet = path ? new Set(path) : null;
  showPathView({ from: a, to: b });
  if (path) {
    const xs = path.map(i => S.docs[i].x), ys = path.map(i => S.docs[i].y);
    const r = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 || 0.1;
    focusDoc({ x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 },
             Math.max(0.8, Math.min(12, 0.75 / r)));
  }
}

function showPathView({ from, to } = {}) {
  panel.hidden = false;
  panel.dataset.view = "path";
  clearHash();
  if (!S.path) {
    panel.innerHTML = `<article class="card"><h2>Chemin d'échos</h2>
      <p class="text">Aucun chemin d'échos ne relie « ${esc(S.docs[from].name)} » à « ${esc(S.docs[to].name)} ».</p></article>`;
    draw();
    return;
  }
  const first = S.docs[S.path[0]], last = S.docs[S.path[S.path.length - 1]];
  const hops = S.path.length - 1;
  panel.innerHTML = `<article class="card">
    <div class="cat">Chemin d'échos</div>
    <h2>${esc(first.name)} → ${esc(last.name)}</h2>
    <p class="count">${hops} ${hops > 1 ? "échos" : "écho"} : à chaque étape, le texte suivant est l'un des plus proches par le sens.</p>
    <ol class="results path">${S.path.map((i, k) => {
      const d = S.docs[i];
      return `<li><button type="button" data-i="${i}">
        <span class="head"><span class="step">${k + 1}</span><span class="dot" style="--c:${colorOf(d.cat)}"></span><span class="name">${esc(d.name)}</span></span>
        <span class="snip">${esc(snippet(d.text, []))}</span></button></li>`;
    }).join("")}</ol>
  </article>`;
  panel.querySelectorAll("button[data-i]").forEach(b => b.addEventListener("click", () => select(+b.dataset.i)));
  panel.scrollTop = 0;
  draw();
}
