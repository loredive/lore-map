// La page d'un texte : catégorie, nom, texte (et ses autres langues), mentions, échos.
// C'est la seule page qui garde le focus de la carte : un texte ouvert depuis un groupe, une
// entité ou une visite laisse ce groupe, cette entité ou cette visite allumés.
// Ouvert depuis une liste (list : { from, items }, voir openInList), il la garde à côté : la liste reste
// à droite, telle qu'on la lisait, et le texte s'ouvre à sa gauche (grand écran) ; sinon « précédent ·
// 3 sur 28 · suivant » en tête de la fiche.
import { tokenize } from "./search.js";
import { S, esc, colorOf, isHidden, docRow, clusterById, portrait, nameOf, textOf, textLang, groupName } from "./state.js";
import { setHover } from "./render.js";
import { registerPage, openPage, describeEntry, reopen } from "./pages.js";
import { startPath } from "./pathbar.js";
import { entityChips, bindEntityButtons, linkText, dialogueButtons, bindDialogueButtons, dlcBadge, groupOf, snippet, mark, unsureMark } from "./links.js";
import { tipAtStar } from "./tip.js";

registerPage({
  name: "doc",
  address: {
    write: ({ i }) => "#" + encodeURIComponent(S.docs[i].name),
    read: name => { const d = S.docs.find(x => x.name === name); return d ? { i: d.i } : null; },
  },
  backLabel: ({ i }) => `Back to “${nameOf(S.docs[i])}”`,
  keepsFocus: true,
  // un chemin attend son second texte (pathbar.js) : choisir un texte ouvre plutôt le chemin
  divert: ({ i }) => (S.pathFrom >= 0 && i !== S.pathFrom ? { page: "path", a: S.pathFrom, b: i } : null),
  render: ({ i, list }) => {
    S.selected = i;
    const d = S.docs[i];
    const items = list && list.items.filter(j => !isHidden(S.docs[j]));
    return {
      html: (items ? pager(i, items) : "") + card(d),
      bind: panel => bind(panel, d, list),
      side: items && { html: column(i, items, list), bind: col => bindColumn(col, list) },
      announce: `Text: ${nameOf(d)}`,
      frame: [d],          // sans zoomer
    };
  },
});

// « ‹ Previous · 3 of 28 · Next › » : la liste sans la colonne (téléphone, écran moyen) ; rien pour un
// texte hors de la liste (un écho suivi depuis elle)
function pager(i, items) {
  const at = items.indexOf(i);
  if (at < 0) return "";
  const step = (j, cls, label) => (j === undefined ? `<span class="${cls}"></span>`
    : `<button type="button" class="${cls}" data-i="${j}" title="${esc(nameOf(S.docs[j]))}">${label}</button>`);
  return `<nav class="pager" aria-label="This list">${step(items[at - 1], "prev", "‹ Previous")}
    <span class="at">${at + 1} of ${items.length}</span>${step(items[at + 1], "next", "Next ›")}</nav>`;
}

// la colonne : la liste telle qu'on la lisait (nom et extrait de chaque texte), le texte ouvert marqué ;
// son titre rouvre la page de la liste
function column(i, items, list) {
  const { from } = list, terms = from.page === "results" ? tokenize(from.q) : [];
  const what = describeEntry(from);
  return `<div class="list-top"><div class="cat">${esc(what.kind)}</div>
    <button type="button" class="list-close" aria-label="Close this list">×</button></div>
    <h2><button type="button" class="list-back" title="Open the whole page">${esc(what.label)}</button></h2>
    <p class="count">${items.length} texts</p>
    <ol class="results">${items.map(j => {
      const x = S.docs[j], row = docRow(x, mark(esc(nameOf(x)), terms), mark(esc(snippet(textOf(x), terms)), terms));
      return j === i ? row.replace("<button ", '<button aria-current="true" ') : row;
    }).join("")}</ol>`;
}

function bindColumn(col, list) {
  col.querySelector(".list-back").addEventListener("click", () => reopen(list.from));
  // fermer la liste : le même texte, seul (Retour la rouvre)
  col.querySelector(".list-close").addEventListener("click", () => openPage("doc", { i: S.selected }, { fly: false }));
  col.querySelectorAll("button[data-i]").forEach(b => {
    b.addEventListener("click", () => { setHover(-1); openPage("doc", { i: +b.dataset.i, list }); });
    lightOnHover(b);
  });
  col.querySelector("[aria-current]")?.scrollIntoView({ block: "nearest" });
}

// survol ou focus d'un texte d'une liste : son étoile s'allume sur la carte, avec sa bulle
// (souris et clavier seulement : au doigt, le toucher ouvre directement la fiche)
function lightOnHover(b) {
  const on = () => { setHover(+b.dataset.i); tipAtStar(+b.dataset.i); }, off = () => setHover(-1);
  b.addEventListener("pointerenter", e => { if (e.pointerType === "mouse") on(); });
  b.addEventListener("focus", () => { if (b.matches(":focus-visible")) on(); });
  b.addEventListener("pointerleave", off); b.addEventListener("blur", off);
}

// l'autre langue du texte (le français si l'anglais est affiché, et inversement), sous le bouton « Show the … text »
function other(d) {
  return {
    name: S.altLang ? d.name : d.altName, text: S.altLang ? d.text : d.alt,
    lang: S.altLang ? "en" : S.ui.alt_lang || "en", label: S.altLang ? "English" : S.ui.alt_label || "English",
  };
}
const mentionsOf = d => S.docEntities[d.i].filter(e => !e.broad);   // Erdtree, Entre-terre… : partout, donc sans intérêt ici

function card(d) {
  const terms = tokenize(S.query || ""), mentions = mentionsOf(d), o = other(d);
  const icon = portrait(d, "portrait", 96);
  return `<article class="card">
    <div class="card-head${icon ? " has-img" : ""}">${icon}<div>
    <div class="cat"><span class="dot" style="--c:${colorOf(d.cat)}"></span>${esc(S.cats[d.cat])}${dlcBadge(d)}</div>
    <h2>${esc(nameOf(d))}${d.speaker ? unsureMark(d.speaker) : ""}</h2>
    ${groupLine(d)}
    ${o.name && o.name !== nameOf(d) ? `<p class="jpname" lang="${o.lang}">${esc(o.name)}</p>` : ""}
    ${d.jpName ? `<p class="jpname" lang="ja">${esc(d.jpName)}</p>` : ""}
    </div></div>
    <p class="text" lang="${textLang(d)}">${linkText(textOf(d), mentions, terms)}</p>
    ${d.alt ? `<div class="alt text" lang="${o.lang}" hidden>${linkText(o.text, mentions)}</div>` : ""}
    <div class="jp" lang="ja" hidden>${esc(d.jp)}</div>
    <div class="tools">
      ${d.alt ? `<button type="button" class="talt" aria-expanded="false">Show the ${esc(o.label)} text</button>` : ""}
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
}

function bind(panel, d, list) {
  panel.querySelectorAll(".pager button").forEach(b =>
    b.addEventListener("click", () => openPage("doc", { i: +b.dataset.i, list })));
  panel.querySelector(".tjp")?.addEventListener("click", ev => {
    const jp = panel.querySelector(".jp"), open = jp.hidden;
    jp.hidden = !open;
    ev.target.setAttribute("aria-expanded", String(open));
    ev.target.textContent = open ? "Hide the Japanese text" : "Show the Japanese text";
  });
  panel.querySelector(".talt")?.addEventListener("click", ev => {
    const alt = panel.querySelector(".alt"), open = alt.hidden, lang = other(d).label;
    alt.hidden = !open;
    ev.target.setAttribute("aria-expanded", String(open));
    ev.target.textContent = open ? `Hide the ${lang} text` : `Show the ${lang} text`;
  });
  panel.querySelector(".tlink").addEventListener("click", ev => {
    navigator.clipboard?.writeText(location.href).then(() => { ev.target.textContent = "Link copied"; });
  });
  // suivre un écho garde la liste à côté
  panel.querySelectorAll(".echoes button").forEach(b => {
    b.addEventListener("click", () => { setHover(-1); openPage("doc", { i: +b.dataset.i, list }); });   // la liste est remplacée : pas de pointerleave
    lightOnHover(b);
  });
  panel.querySelector(".tpath").addEventListener("click", () => startPath(d.i));
  bindDialogueButtons(d.i);
  panel.querySelectorAll("button.glink").forEach(b => {
    const c = clusterById(+b.dataset.c);
    b.addEventListener("click", () => openPage("cluster", { id: c.id, label: c.label }));
  });
  bindEntityButtons();
}

// le groupe du texte, ou pour un texte hors groupe celui de la plupart de ses échos
function groupLine(d) {
  const g = groupOf(d);
  if (!g?.c) return "";
  const link = `<button type="button" class="glink" data-c="${g.c.id}">${esc(groupName(g.c))}</button>`;
  return `<p class="group">${g.near ? `Outside any group · nearest: ${link}` : `Group: ${link}`}</p>`;
}
