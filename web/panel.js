// Le panneau de droite : fiche d'un texte, fiche d'un groupe, aide, liens (#…).
import { tokenize } from "./search.js";
import { S, $, panel, input, esc, colorOf, resetContext, clusterById, docRow, focusPanel, portrait, isHidden } from "./state.js";
import { draw, focusDoc, fitPoints, frameFrom, setHover } from "./render.js";
import { echoGraph, echoPath } from "./graph.js";
import { runSearch, resetSearch } from "./search-ui.js";
import { entityChips, bindEntityButtons, openEntity, showIndex, linkText } from "./entities-ui.js";
import { record, goBack, backLabel, setOpener, poppedHere } from "./nav.js";
import { openDialogue, dialogueButtons, bindDialogueButtons } from "./dialogue-ui.js";
import { tipAtStar } from "./tip.js";
import { showTrail } from "./trail-ui.js";
import { showTours, openTour } from "./tours-ui.js";
import { showChat } from "./chat-ui.js";

// Mode lecture : le panneau s'élargit (environ la moitié de l'écran) ; retenu d'une visite à l'autre.
const READING_KEY = "lore-map:reading";
try { document.body.classList.toggle("reading", localStorage.getItem(READING_KEY) === "1"); } catch { /* stockage bloqué */ }

function toggleReading(btn) {
  const on = document.body.classList.toggle("reading");
  try { localStorage.setItem(READING_KEY, on ? "1" : "0"); } catch { /* stockage bloqué */ }
  btn.setAttribute("aria-pressed", String(on));
  btn.textContent = on ? "Narrow" : "Widen";
  // la carte visible a changé de largeur : y recentrer le texte ouvert
  if (S.selected >= 0) focusDoc(S.docs[S.selected], S.cam.s);
  else draw();
}

// En-tête commun du panneau : « Retour à … » (l'entrée précédente de l'historique), « Agrandir » et « Fermer ».
export function panelTop() {
  const back = backLabel();
  const on = document.body.classList.contains("reading");
  return `<div class="panel-top">${back ? `<button type="button" class="back">${esc(back)}</button>` : "<span></span>"}
    <span class="actions"><button type="button" class="widen" aria-pressed="${on}" title="Widen the panel for reading">${on ? "Narrow" : "Widen"}</button>
    <button type="button" class="close" aria-label="Close the panel">Close</button></span></div>`;
}
export function bindPanelTop() {
  panel.querySelector(".panel-top .back")?.addEventListener("click", goBack);
  panel.querySelector(".panel-top .widen").addEventListener("click", ev => toggleReading(ev.currentTarget));
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
// « The Old Hunters » à côté de la catégorie d'un texte ajouté par le DLC (game.json : ui.dlc_label)
export function dlcBadge(d) {
  return d.dlc ? `<span class="dlc-badge" title="Added with ${esc(S.ui.dlc_label || "the DLC")}">${esc(S.ui.dlc_label || "DLC")}</span>` : "";
}

export function select(i, { fly = true } = {}) {
  if (S.pathFrom >= 0 && i !== S.pathFrom) { showPath(S.pathFrom, i); return; }
  S.selected = i;
  const d = S.docs[i];
  const terms = tokenize(S.query || "");
  panel.hidden = false;
  panel.dataset.view = "doc";
  const mentions = S.docEntities[i].filter(e => !e.broad);   // Erdtree, Entre-terre… : partout, donc sans intérêt ici
  record({ view: "doc", i });
  const icon = portrait(d, "portrait", 96);
  panel.innerHTML = `${panelTop()}<article class="card">
    <div class="card-head${icon ? " has-img" : ""}">${icon}<div>
    <div class="cat"><span class="dot" style="--c:${colorOf(d.cat)}"></span>${esc(S.cats[d.cat])}${dlcBadge(d)}</div>
    <h2>${esc(d.name)}</h2>
    ${groupLine(d)}
    ${d.altName && d.altName !== d.name ? `<p class="jpname" lang="${S.ui.alt_lang || "en"}">${esc(d.altName)}</p>` : ""}
    ${d.jpName ? `<p class="jpname" lang="ja">${esc(d.jpName)}</p>` : ""}
    </div></div>
    <p class="text">${linkText(d.text, mentions, terms)}</p>
    ${d.alt ? `<div class="alt text" lang="${S.ui.alt_lang || "en"}" hidden>${linkText(d.alt, mentions)}</div>` : ""}
    <div class="jp" lang="ja" hidden>${esc(d.jp)}</div>
    <div class="tools">
      ${d.alt ? `<button type="button" class="talt" aria-expanded="false">Show the ${esc(S.ui.alt_label || "English")} text</button>` : ""}
      ${d.jp ? `<button type="button" class="tjp" aria-expanded="false">Show the Japanese text</button>` : ""}
      <button type="button" class="tlink">Copy a link to this text</button>
      <button type="button" class="tpath">Trace a path to another text</button>
      ${d.speaker && S.dialogues.get(d.speaker).length > 1 ? dialogueButtons([d.speaker]) : ""}
    </div>
    ${mentions.length ? `<h3>Mentions</h3>
    ${entityChips(mentions)}` : ""}
    <h3>Echoes</h3>
    <p class="hint">Closest in meaning, linked to it on the map.</p>
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
    ev.target.textContent = open ? "Hide the Japanese text" : "Show the Japanese text";
  });
  panel.querySelector(".talt")?.addEventListener("click", ev => {
    const alt = panel.querySelector(".alt"), open = alt.hidden, lang = S.ui.alt_label || "English";
    alt.hidden = !open;
    ev.target.setAttribute("aria-expanded", String(open));
    ev.target.textContent = open ? `Hide the ${lang} text` : `Show the ${lang} text`;
  });
  panel.querySelector(".tlink").addEventListener("click", ev => {
    navigator.clipboard?.writeText(location.href).then(() => { ev.target.textContent = "Link copied"; });
  });
  panel.querySelectorAll(".echoes button").forEach(b => {
    b.addEventListener("click", () => { setHover(-1); select(+b.dataset.i); });   // la liste est remplacée : pas de pointerleave
    // survol ou focus d'un écho : son étoile s'allume sur la carte, avec sa bulle
    // (souris et clavier seulement : au doigt, le toucher ouvre directement la fiche)
    const on = () => { setHover(+b.dataset.i); tipAtStar(+b.dataset.i); }, off = () => setHover(-1);
    b.addEventListener("pointerenter", e => { if (e.pointerType === "mouse") on(); });
    b.addEventListener("focus", () => { if (b.matches(":focus-visible")) on(); });
    b.addEventListener("pointerleave", off); b.addEventListener("blur", off);
  });
  panel.querySelector(".tpath").addEventListener("click", () => startPath(i));
  bindDialogueButtons(i);
  bindGroupButtons();
  bindEntityButtons();
  panel.scrollTop = 0;
  focusPanel(`Text: ${d.name}`);
  if (fly) frameFrom([d]);        // sans zoomer : le texte, et celui d'où l'on vient
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
  const visible = members.filter(d => !isHidden(d));
  const keywords = c.keywords && c.keywords !== c.label
    ? `<p class="keywords"><span>Keywords</span> ${esc(c.keywords)}</p>` : "";
  panel.hidden = false;
  panel.dataset.view = "cluster";
  record({ view: "cluster", id: c.id, label: c.label });
  panel.innerHTML = `${panelTop()}<article class="card">
    <div class="cat">Group of texts</div>
    <h2>${esc(c.label)}</h2>
    ${c.description ? `<p class="text">${esc(c.description)}</p>` : ""}
    <p class="count">${c.n} texts${visible.length < members.length ? `, ${visible.length} of them shown` : ""}.</p>
    ${keywords}
    <ol class="results">${visible.map(d => docRow(d, esc(d.name), esc(snippet(d.text, [])))).join("")}</ol>
  </article>`;
  panel.querySelectorAll("button[data-i]").forEach(b =>
    b.addEventListener("click", () => select(+b.dataset.i)));
  bindPanelTop();
  panel.scrollTop = 0;
  if (focus) focusPanel(`Group ${c.label}: ${c.n} texts`);
  if (fly) frameFrom(members);      // les étoiles du groupe à l'écran, avec le texte d'où l'on vient
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
  const ui = S.ui, x = ui.precise || {};     // exemples propres au jeu (game.json)
  panel.innerHTML = `${panelTop()}<article class="card">
    <h2>How to read this map</h2>
    <ul class="help">
      <li>Each point is a text from the game: an item, a weapon, a piece of armor, a dialogue…</li>
      <li>Texts close together talk about the same things; distant ones, about other subjects.</li>
      <li>The names written on the map label groups of neighboring texts.</li>
      <li>Click a point to read it, or a name to browse its group.</li>
    </ul>
    <h3>What you can do</h3>
    <ul class="help">
      ${S.tours.length ? "<li><strong>Guided tours</strong>, under the title: short walks through the story, step by step. The best place to start.</li>" : ""}
      <li><strong>Search</strong> by name or by meaning: ${(ui.search_examples || []).map(q => `“${esc(q)}”`).join(", ")}; or precisely: <code>${esc(x.both)}</code>, <code>${esc(x.exclude)}</code>, <code>"${esc(x.phrase)}"</code>, <code>${esc(x.category)}</code>.</li>
      <li><strong>Characters and places</strong>: every text that mentions ${esc(ui.entity_examples || "")}…, and the names linked to them.</li>
      <li><strong>Echoes</strong>: under each text, the ones closest to it in meaning.</li>
      <li><strong>Trace a path</strong> between two texts, from echo to echo, starting from any text.</li>
      <li><strong>Other layout</strong>, bottom right: the same map arranged differently; what stays close really is close.</li>
      <li><strong>Your trail</strong>, under the search bar: the last pages you opened. On the map, a dotted line joins the texts you read, a ring marks each text already read, and the text you came from is named.</li>
      <li><strong>Back</strong> (or the browser's Back button) returns to the previous page; Escape closes.</li>
      <li>By touch: tapping a crowded spot zooms in, then lists the texts there.</li>
      <li>By keyboard: Tab to the map, arrow keys to move, + and − to zoom, Enter to open the targeted star.</li>
    </ul>
  </article>`;
  bindPanelTop();
  panel.scrollTop = 0;
  focusPanel("Help: how to read this map");
  draw();
}
$("#help").addEventListener("click", showHelp);

export function openFromHash() {
  const name = decodeURIComponent(location.hash.slice(1));
  if (!name) return;
  // liens anglais (#group=…) et anciens liens français (#groupe=…), toujours reconnus
  const arg = (...keys) => { const k = keys.find(p => name.startsWith(p + "=")); return k === undefined ? null : name.slice(k.length + 1); };
  const group = arg("group", "groupe"), path = arg("path", "chemin"), entity = arg("entity", "entite");
  if (group !== null) {
    const c = S.clusters.find(x => x.label === group);
    if (c) openCluster(c);
    return;
  }
  if (path !== null) {
    const [a, b] = location.hash.slice(location.hash.indexOf("=") + 1).split("&").map(decodeURIComponent)
      .map(n => S.docs.findIndex(x => x.name === n));
    if (a >= 0 && b >= 0) showPath(a, b);
    return;
  }
  if (name.startsWith("tour=")) {                 // #tour=paleblood/3
    const [id, k] = name.slice(5).split("/");
    openTour(id, (+k || 1) - 1);
    return;
  }
  if (name.startsWith("dialogue=")) {
    openDialogue(name.slice(9));
    return;
  }
  if (entity !== null) {
    const e = S.entities.find(x => x.name === entity);
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
  else if (e.view === "trail") showTrail();
  else if (e.view === "tours") showTours();
  else if (e.view === "tour") openTour(e.id, e.k);
  else if (e.view === "chat") showChat();
  else closePanel();
});


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
function groupLine(d) {
  const g = groupOf(d);
  if (!g?.c) return "";
  const link = `<button type="button" class="glink" data-c="${g.c.id}">${esc(g.c.label)}</button>`;
  return `<p class="group">${g.near ? `Outside any group · nearest: ${link}` : `Group: ${link}`}</p>`;
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
    panel.innerHTML = `${panelTop()}<article class="card"><h2>Echo path</h2>
      <p class="text">No echo path links “${esc(S.docs[from].name)}” to “${esc(S.docs[to].name)}”.</p></article>`;
    bindPanelTop();
    draw();
    return;
  }
  const first = S.docs[S.path[0]], last = S.docs[S.path[S.path.length - 1]];
  const hops = S.path.length - 1;
  panel.innerHTML = `${panelTop()}<article class="card">
    <div class="cat">Echo path</div>
    <h2>${esc(first.name)} → ${esc(last.name)}</h2>
    <p class="count">${hops} ${hops > 1 ? "echoes" : "echo"}: at each step, the next text is one of the closest in meaning.</p>
    <ol class="results path">${S.path.map((i, k) => {
      const d = S.docs[i];
      return docRow(d, esc(d.name), esc(snippet(d.text, [])), `<span class="step">${k + 1}</span>`);
    }).join("")}</ol>
  </article>`;
  panel.querySelectorAll("button[data-i]").forEach(b => b.addEventListener("click", () => select(+b.dataset.i)));
  bindPanelTop();
  panel.scrollTop = 0;
  focusPanel(`Path of ${hops} ${hops > 1 ? "echoes" : "echo"}`);
  draw();
}
