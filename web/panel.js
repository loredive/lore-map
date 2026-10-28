// Le panneau de droite : fiche d'un texte, fiche d'un groupe, aide, liens (#…).
import { tokenize } from "./search.js";
import { S, $, panel, input, esc, colorOf, resetContext, clusterById, docRow, focusPanel, portrait, isHidden, nameOf, textOf, textLang, groupName, groupDesc } from "./state.js";
import { draw, focusDoc, fitPoints, frameFrom, setHover } from "./render.js";
import { echoGraph, echoPath } from "./graph.js";
import { resetSearch } from "./search-ui.js";
import { entityChips, bindEntityButtons, openEntity, showIndex, linkText } from "./entities-ui.js";
import { record, poppedHere } from "./nav.js";
import { registerPage, backLabel, goBack, closePage, openFromAddress } from "./pages.js";
import { openDialogue, dialogueButtons, bindDialogueButtons } from "./dialogue-ui.js";
import { tipAtStar } from "./tip.js";
import { showTours, openTour } from "./tours-ui.js";

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
export function panelTop(back = backLabel()) {
  const on = document.body.classList.contains("reading");
  return `<div class="panel-top">${back ? `<button type="button" class="back">${esc(back)}</button>` : "<span></span>"}
    <span class="actions"><button type="button" class="widen" aria-pressed="${on}" title="Widen the panel for reading">${on ? "Narrow" : "Widen"}</button>
    <button type="button" class="close" aria-label="Close the panel">Close</button></span></div>`;
}
export function bindPanelTop() {
  panel.querySelector(".panel-top .back")?.addEventListener("click", goBack);
  panel.querySelector(".panel-top .widen").addEventListener("click", ev => toggleReading(ev.currentTarget));
  panel.querySelector(".panel-top .close").addEventListener("click", closePage);
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
  // l'autre langue du texte (le français si l'anglais est affiché, et inversement), sous le bouton « Show the … text »
  const otherName = S.altLang ? d.name : d.altName, otherText = S.altLang ? d.text : d.alt;
  const otherLang = S.altLang ? "en" : S.ui.alt_lang || "en", otherLabel = S.altLang ? "English" : S.ui.alt_label || "English";
  panel.innerHTML = `${panelTop()}<article class="card">
    <div class="card-head${icon ? " has-img" : ""}">${icon}<div>
    <div class="cat"><span class="dot" style="--c:${colorOf(d.cat)}"></span>${esc(S.cats[d.cat])}${dlcBadge(d)}</div>
    <h2>${esc(nameOf(d))}</h2>
    ${groupLine(d)}
    ${otherName && otherName !== nameOf(d) ? `<p class="jpname" lang="${otherLang}">${esc(otherName)}</p>` : ""}
    ${d.jpName ? `<p class="jpname" lang="ja">${esc(d.jpName)}</p>` : ""}
    </div></div>
    <p class="text" lang="${textLang(d)}">${linkText(textOf(d), mentions, terms)}</p>
    ${d.alt ? `<div class="alt text" lang="${otherLang}" hidden>${linkText(otherText, mentions)}</div>` : ""}
    <div class="jp" lang="ja" hidden>${esc(d.jp)}</div>
    <div class="tools">
      ${d.alt ? `<button type="button" class="talt" aria-expanded="false">Show the ${esc(otherLabel)} text</button>` : ""}
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
    const alt = panel.querySelector(".alt"), open = alt.hidden, lang = otherLabel;
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
  focusPanel(`Text: ${nameOf(d)}`);
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
    <h2>${esc(groupName(c))}</h2>
    ${groupDesc(c) ? `<p class="text">${esc(groupDesc(c))}</p>` : ""}
    <p class="count">${c.n} texts${visible.length < members.length ? `, ${visible.length} of them shown` : ""}.</p>
    ${keywords}
    <ol class="results">${visible.map(d => docRow(d, esc(nameOf(d)), esc(snippet(textOf(d), [])))).join("")}</ol>
  </article>`;
  panel.querySelectorAll("button[data-i]").forEach(b =>
    b.addEventListener("click", () => select(+b.dataset.i)));
  bindPanelTop();
  panel.scrollTop = 0;
  if (focus) focusPanel(`Group ${groupName(c)}: ${c.n} texts`);
  if (fly) frameFrom(members);      // les étoiles du groupe à l'écran, avec le texte d'où l'on vient
  draw();
}

// Le panneau fermé est une page : fermer est une étape, Retour rouvre ce qu'on vient de fermer.
registerPage({ name: "none", panel: false, render: () => { cancelPath(); return {}; } });
export const closePanel = closePage;


// ------------------------------------------------------------------ pages pas encore enregistrées
// L'ancien code des pages que pages.js ne connaît pas encore : il s'en sert en dernier recours.
// Chaque sorte de page qui s'enregistre auprès de pages.js disparaît de ces aiguillages.

// adresse d'une entrée de l'historique ; null : pas d'adresse propre (résultats, index, rien)
function address(e) {
  switch (e.view) {
    case "doc": return "#" + encodeURIComponent(S.docs[e.i].name);
    case "cluster": return "#group=" + encodeURIComponent(e.label);
    case "entity": return "#entity=" + encodeURIComponent(e.name);
    case "path": return "#path=" + encodeURIComponent(S.docs[e.a].name) + "&" + encodeURIComponent(S.docs[e.b].name);
    case "dialogue": return "#dialogue=" + encodeURIComponent(e.speaker);
    case "tour": return `#tour=${encodeURIComponent(e.id)}/${e.k + 1}`;
    default: return null;
  }
}

function oldBackLabel(e) {
  switch (e.view) {
    case "doc": return `Back to “${nameOf(S.docs[e.i])}”`;
    case "cluster": { const c = S.clusters.find(x => x.label === e.label); return `Back to the group “${c ? groupName(c) : e.label}”`; }
    case "entity": return `Back to “${S.entities.find(x => x.name === e.name)?.label || e.name}”`;
    case "index": return "Back to characters and places";
    case "path": return "Back to the path";
    case "dialogue": return `Back to the dialogue of ${e.speaker}`;
    case "tours": return "Back to the guided tours";
    case "tour": return `Back to “${S.tours.find(t => t.id === e.id)?.title || e.id}”, step ${e.k + 1}`;
    default: return null;                       // avant : le panneau fermé, « Fermer » suffit
  }
}

// ouvre la page d'une adresse ; false si aucune ancienne sorte de page ne la reconnaît
function readAddress(hash) {
  const name = decodeURIComponent(hash.slice(1));
  if (!name) return false;
  // liens anglais (#group=…) et anciens liens français (#groupe=…), toujours reconnus
  const arg = (...keys) => { const k = keys.find(p => name.startsWith(p + "=")); return k === undefined ? null : name.slice(k.length + 1); };
  const group = arg("group", "groupe"), path = arg("path", "chemin"), entity = arg("entity", "entite");
  if (group !== null) {
    const c = S.clusters.find(x => x.label === group);
    if (c) openCluster(c);
    return true;
  }
  if (path !== null) {
    const [a, b] = hash.slice(hash.indexOf("=") + 1).split("&").map(decodeURIComponent)
      .map(n => S.docs.findIndex(x => x.name === n));
    if (a >= 0 && b >= 0) showPath(a, b);
    return true;
  }
  if (name.startsWith("tour=")) {                 // #tour=paleblood/3
    const [id, k] = name.slice(5).split("/");
    openTour(id, (+k || 1) - 1);
    return true;
  }
  if (name.startsWith("dialogue=")) {
    openDialogue(name.slice(9));
    return true;
  }
  if (entity !== null) {
    const e = S.entities.find(x => x.name === entity);
    if (e) openEntity(e);
    return true;
  }
  const d = S.docs.find(x => x.name === name);
  if (d) select(d.i);
  return !!d;
}

// lien collé dans la barre d'adresse sans recharger la page (replaceState ne déclenche pas l'événement)
addEventListener("hashchange", () => { if (S.docs.length && !poppedHere()) openFromAddress(location.hash); });

// Rouvre une entrée de l'historique (bouton Retour, « Retour à … »)
function reopen(e) {
  if (e.view === "doc") select(e.i);
  else if (e.view === "cluster") { const c = clusterById(e.id) || S.clusters.find(x => x.label === e.label); if (c) openCluster(c); }
  else if (e.view === "entity") { const x = S.entities.find(y => y.name === e.name); if (x) openEntity(x); }
  else if (e.view === "index") showIndex();
  else if (e.view === "path") showPath(e.a, e.b);
  else if (e.view === "dialogue") openDialogue(e.speaker);
  else if (e.view === "tours") showTours();
  else if (e.view === "tour") openTour(e.id, e.k);
}

export const oldPages = { address, backLabel: oldBackLabel, reopen, readAddress };


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
  const link = `<button type="button" class="glink" data-c="${g.c.id}">${esc(groupName(g.c))}</button>`;
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
      <p class="text">No echo path links “${esc(nameOf(S.docs[from]))}” to “${esc(nameOf(S.docs[to]))}”.</p></article>`;
    bindPanelTop();
    draw();
    return;
  }
  const first = S.docs[S.path[0]], last = S.docs[S.path[S.path.length - 1]];
  const hops = S.path.length - 1;
  panel.innerHTML = `${panelTop()}<article class="card">
    <div class="cat">Echo path</div>
    <h2>${esc(nameOf(first))} → ${esc(nameOf(last))}</h2>
    <p class="count">${hops} ${hops > 1 ? "echoes" : "echo"}: at each step, the next text is one of the closest in meaning.</p>
    <ol class="results path">${S.path.map((i, k) => {
      const d = S.docs[i];
      return docRow(d, esc(nameOf(d)), esc(snippet(textOf(d), [])), `<span class="step">${k + 1}</span>`);
    }).join("")}</ol>
  </article>`;
  panel.querySelectorAll("button[data-i]").forEach(b => b.addEventListener("click", () => select(+b.dataset.i)));
  bindPanelTop();
  panel.scrollTop = 0;
  focusPanel(`Path of ${hops} ${hops > 1 ? "echoes" : "echo"}`);
  draw();
}
