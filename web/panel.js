// Le panneau de droite : fiche d'un texte, fiche d'un groupe, aide, liens (#…).
import { tokenize } from "./search.js";
import { S, $, panel, input, esc, colorOf, resetContext, clusterById, docRow, focusPanel } from "./state.js";
import { draw, focusDoc, fitPoints } from "./render.js";
import { echoGraph, echoPath } from "./graph.js";
import { runSearch, resetSearch } from "./search-ui.js";
import { entityChips, bindEntityButtons, openEntity, showIndex } from "./entities-ui.js";
import { record, goBack, backLabel, setOpener, poppedHere } from "./nav.js";
import { openDialogue, dialogueButtons, bindDialogueButtons } from "./dialogue-ui.js";

// En-tête commun du panneau : « Retour à … » (l'entrée précédente de l'historique) et « Fermer ».
export function panelTop() {
  const back = backLabel();
  return `<div class="panel-top">${back ? `<button type="button" class="back">${esc(back)}</button>` : "<span></span>"}
    <button type="button" class="close" aria-label="Fermer le panneau">Fermer</button></div>`;
}
export function bindPanelTop() {
  panel.querySelector(".panel-top .back")?.addEventListener("click", goBack);
  panel.querySelector(".panel-top .close").addEventListener("click", closePanel);
}

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
  const mentions = S.docEntities[i].filter(e => !e.broad);   // Erdtree, Entre-terre… : partout, donc sans intérêt ici
  record({ view: "doc", i });
  panel.innerHTML = `${panelTop()}<article class="card">
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
      ${d.speaker && S.dialogues.get(d.speaker).length > 1 ? dialogueButtons([d.speaker]) : ""}
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
  bindPanelTop();
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
  bindDialogueButtons(i);
  bindGroupButtons();
  bindEntityButtons();
  panel.scrollTop = 0;
  focusPanel(`Texte : ${d.name}`);
  if (fly) focusDoc(d, Math.max(S.cam.s, 4));
  draw();
}


// ------------------------------------------------------------------ fiche d'un groupe
export function openCluster(c, { fly = true, focus = true } = {}) {
  resetContext();
  S.cluster = c;
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
  record({ view: "cluster", id: c.id, label: c.label });
  panel.innerHTML = `${panelTop()}<article class="card">
    <div class="cat">Groupe de textes</div>
    <h2>${esc(c.label)}</h2>
    ${c.description ? `<p class="text">${esc(c.description)}</p>` : ""}
    <p class="count">${c.n} textes${visible.length < members.length ? `, dont ${visible.length} dans les catégories affichées` : ""}.</p>
    ${keywords}
    <ol class="results">${visible.map(d => docRow(d, esc(d.name), esc(snippet(d.text, [])))).join("")}</ol>
  </article>`;
  panel.querySelectorAll("button[data-i]").forEach(b =>
    b.addEventListener("click", () => select(+b.dataset.i)));
  bindPanelTop();
  panel.scrollTop = 0;
  if (focus) focusPanel(`Groupe ${c.label} : ${c.n} textes`);
  if (fly) fitPoints(members);      // la plupart des étoiles du groupe à l'écran
  draw();
}

export function closePanel() {
  resetContext();
  cancelPath();
  S.selected = -1;
  panel.hidden = true;
  panel.dataset.view = "";
  record({ view: "none" });       // fermer est une étape : Retour rouvre ce qu'on vient de fermer
  draw();
}


export function showHelp() {
  resetContext();
  S.selected = -1;
  panel.hidden = false;
  panel.dataset.view = "help";
  record({ view: "help" });
  panel.innerHTML = `${panelTop()}<article class="card">
    <h2>Comment lire cette carte</h2>
    <ul class="help">
      <li>Chaque point est un texte du jeu : objet, arme, armure, dialogue…</li>
      <li>Les textes proches parlent des mêmes choses ; les éloignés, d'autres sujets.</li>
      <li>Les noms écrits sur la carte désignent des groupes de textes voisins.</li>
      <li>Cliquer un point pour le lire, ou un nom pour parcourir son groupe.</li>
    </ul>
    <h3>Ce qu'on peut faire</h3>
    <ul class="help">
      <li><strong>Chercher</strong> en français ou en anglais : « qui a tué Godwyn », « Malenia » ; et précisément : « Ranni + Blaidd », « -Malenia », « "Destined Death" », « dans:armes ».</li>
      <li><strong>Personnages et lieux</strong> : tous les textes qui parlent de Ranni, de Leyndell…, et les noms qui leur sont liés.</li>
      <li><strong>Échos</strong> : sous chaque texte, ceux qui en sont le plus proches par le sens.</li>
      <li><strong>Tracer un chemin</strong> entre deux textes, d'écho en écho, depuis la fiche d'un texte.</li>
      <li><strong>Autre agencement</strong>, en bas à droite : la même carte disposée autrement ; ce qui reste proche l'est vraiment.</li>
      <li><strong>Retour</strong> (ou le bouton du navigateur) revient à la fiche précédente ; Échap ferme.</li>
      <li>Au doigt : toucher un endroit dense zoome, puis propose les textes qui s'y trouvent.</li>
      <li>Au clavier : Tab jusqu'à la carte, flèches pour se déplacer, + et − pour zoomer, Entrée pour ouvrir l'étoile visée.</li>
    </ul>
  </article>`;
  bindPanelTop();
  panel.scrollTop = 0;
  focusPanel("Aide : comment lire cette carte");
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
  if (name.startsWith("chemin=")) {
    const [a, b] = location.hash.slice(8).split("&").map(decodeURIComponent)
      .map(n => S.docs.findIndex(x => x.name === n));
    if (a >= 0 && b >= 0) showPath(a, b);
    return;
  }
  if (name.startsWith("dialogue=")) {
    openDialogue(name.slice(9));
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
addEventListener("hashchange", () => { if (S.docs.length && !poppedHere()) openFromHash(); });

// Rouvre une entrée de l'historique (bouton Retour, « Retour à … »)
setOpener(e => {
  if (e.view !== "results" && !e.q && S.query) resetSearch();
  if (e.view === "doc") select(e.i);
  else if (e.view === "cluster") { const c = clusterById(e.id) || S.clusters.find(x => x.label === e.label); if (c) openCluster(c); }
  else if (e.view === "entity") { const x = S.entities.find(y => y.name === e.name); if (x) openEntity(x); }
  else if (e.view === "index") showIndex();
  else if (e.view === "help") showHelp();
  else if (e.view === "path") showPath(e.a, e.b);
  else if (e.view === "dialogue") openDialogue(e.speaker);
  else if (e.view === "results") { input.value = e.q; runSearch(); }
  else closePanel();
});


// ------------------------------------------------------------------ groupe d'un texte
// Le groupe du texte, ou pour un texte hors groupe celui de la plupart de ses échos.
function groupOf(d) {
  if (d.cluster >= 0) return { c: clusterById(d.cluster), near: false };
  const votes = new Map();
  for (const e of d.echoes) {
    const k = S.docs[e].cluster;
    if (k >= 0) votes.set(k, (votes.get(k) || 0) + 1);
  }
  const best = [...votes].sort((a, b) => b[1] - a[1])[0];
  return best ? { c: clusterById(best[0]), near: true } : null;
}
function groupLine(d) {
  const g = groupOf(d);
  if (!g?.c) return "";
  const link = `<button type="button" class="glink" data-c="${g.c.id}">${esc(g.c.label)}</button>`;
  return `<p class="group">${g.near ? `Hors groupe · le plus proche : ${link}` : `Groupe : ${link}`}</p>`;
}
function bindGroupButtons() {
  panel.querySelectorAll("button.glink").forEach(b =>
    b.addEventListener("click", () => openCluster(clusterById(+b.dataset.c))));
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
  resetContext();
  S.selected = -1;
  S.path = path; S.pathSet = path ? new Set(path) : null;
  record({ view: "path", a, b });
  showPathView({ from: a, to: b });
  if (path) fitPoints(path.map(i => S.docs[i]), 0);
}

function showPathView({ from, to } = {}) {
  panel.hidden = false;
  panel.dataset.view = "path";
  if (!S.path) {
    panel.innerHTML = `${panelTop()}<article class="card"><h2>Chemin d'échos</h2>
      <p class="text">Aucun chemin d'échos ne relie « ${esc(S.docs[from].name)} » à « ${esc(S.docs[to].name)} ».</p></article>`;
    bindPanelTop();
    draw();
    return;
  }
  const first = S.docs[S.path[0]], last = S.docs[S.path[S.path.length - 1]];
  const hops = S.path.length - 1;
  panel.innerHTML = `${panelTop()}<article class="card">
    <div class="cat">Chemin d'échos</div>
    <h2>${esc(first.name)} → ${esc(last.name)}</h2>
    <p class="count">${hops} ${hops > 1 ? "échos" : "écho"} : à chaque étape, le texte suivant est l'un des plus proches par le sens.</p>
    <ol class="results path">${S.path.map((i, k) => {
      const d = S.docs[i];
      return docRow(d, esc(d.name), esc(snippet(d.text, [])), `<span class="step">${k + 1}</span>`);
    }).join("")}</ol>
  </article>`;
  panel.querySelectorAll("button[data-i]").forEach(b => b.addEventListener("click", () => select(+b.dataset.i)));
  bindPanelTop();
  panel.scrollTop = 0;
  focusPanel(`Chemin de ${hops} ${hops > 1 ? "échos" : "écho"}`);
  draw();
}
