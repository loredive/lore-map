// La page d'un texte : catégorie, nom, texte (et ses autres langues), mentions, échos.
// C'est la seule page qui garde le focus de la carte : un texte ouvert depuis un groupe, une
// entité ou une visite laisse ce groupe, cette entité ou cette visite allumés.
import { tokenize } from "./search.js";
import { S, esc, colorOf, clusterById, portrait, nameOf, textOf, textLang, groupName } from "./state.js";
import { setHover } from "./render.js";
import { registerPage, openPage } from "./pages.js";
import { select, startPath, groupOf, dlcBadge } from "./panel.js";
import { entityChips, bindEntityButtons, linkText } from "./entities-ui.js";
import { dialogueButtons, bindDialogueButtons } from "./dialogue-ui.js";
import { tipAtStar } from "./tip.js";

registerPage({
  name: "doc",
  address: {
    write: ({ i }) => "#" + encodeURIComponent(S.docs[i].name),
    read: name => { const d = S.docs.find(x => x.name === name); return d ? { i: d.i } : null; },
  },
  backLabel: ({ i }) => `Back to “${nameOf(S.docs[i])}”`,
  step: ({ i }) => ({ kind: "doc", key: S.docs[i].name }),
  fromStep: { kind: "doc", page: key => { const d = S.docs.find(x => x.name === key); return d ? { i: d.i } : null; } },
  keepsFocus: true,
  render: ({ i }) => {
    S.selected = i;
    const d = S.docs[i];
    return { html: card(d), bind: panel => bind(panel, d), announce: `Text: ${nameOf(d)}`, frame: [d] };   // sans zoomer : le texte, et celui d'où l'on vient
  },
});

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
    <h2>${esc(nameOf(d))}</h2>
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

function bind(panel, d) {
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
  panel.querySelectorAll(".echoes button").forEach(b => {
    b.addEventListener("click", () => { setHover(-1); select(+b.dataset.i); });   // la liste est remplacée : pas de pointerleave
    // survol ou focus d'un écho : son étoile s'allume sur la carte, avec sa bulle
    // (souris et clavier seulement : au doigt, le toucher ouvre directement la fiche)
    const on = () => { setHover(+b.dataset.i); tipAtStar(+b.dataset.i); }, off = () => setHover(-1);
    b.addEventListener("pointerenter", e => { if (e.pointerType === "mouse") on(); });
    b.addEventListener("focus", () => { if (b.matches(":focus-visible")) on(); });
    b.addEventListener("pointerleave", off); b.addEventListener("blur", off);
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
