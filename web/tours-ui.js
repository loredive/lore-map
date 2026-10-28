// Visites guidées (data/<jeu>/tours.json, écrites à la main) : une suite de textes, chacun avec
// une phrase qui le situe. La carte trace la visite comme un chemin numéroté (render.js), l'étape
// en cours entourée ; le panneau lit l'étape, avec Précédent / Suivant.
import { S, $, esc, colorOf, portrait, dataPath, nameOf, textOf, textLang } from "./state.js";
import { fitPoints, frameFrom } from "./render.js";
import { registerPage, openPage, currentPage } from "./pages.js";
import { linkText, bindEntityButtons, dlcBadge } from "./links.js";

const button = $("#tours");

export async function loadTours() {
  S.tours = [];
  if (S.hasTours) try {
    const r = await fetch(dataPath("tours.json"));
    S.tours = r.ok ? await r.json() : [];
  } catch { S.tours = []; }
  const index = new Map(S.docs.map(d => [d.name, d.i]));
  // une étape dont le texte a disparu des données est ignorée (publish_tours les vérifie déjà)
  S.tours = S.tours.map(t => ({ ...t, steps: t.steps.filter(s => index.has(s.text)).map(s => ({ ...s, i: index.get(s.text) })) }))
    .filter(t => t.steps.length);
  button.hidden = !S.tours.length;
}

const tourById = id => S.tours.find(x => x.id === id);

// l'étape k (comptée de 0, ramenée dans la visite) et son texte i ; null pour une visite inconnue
function stepArgs(id, k) {
  const t = tourById(id);
  if (!t) return null;
  k = Math.max(0, Math.min(t.steps.length - 1, k));
  return { id, k, i: t.steps[k].i };
}
const openStep = (id, k) => openPage("tour", stepArgs(id, k));

registerPage({
  name: "tours",
  backLabel: () => "Back to the guided tours",
  render: () => ({
    announce: "Guided tours",
    html: `<article class="card">
    <h2>Guided tours</h2>
    <p class="hint">Short walks through the texts, each step with a line of context. A good way in if you're new to the story.</p>
    <ol class="tours">${S.tours.map(t => `<li><button type="button" data-t="${esc(t.id)}">
      <span class="name">${esc(t.title)}</span> <span class="n">${t.steps.length} steps</span>
      <span class="snip">${esc(t.intro)}</span></button></li>`).join("")}</ol>
  </article>`,
    bind: p => p.querySelectorAll("button[data-t]").forEach(b => b.addEventListener("click", () => openStep(b.dataset.t, 0))),
  }),
});

registerPage({
  name: "tour",
  address: {
    write: a => `#tour=${encodeURIComponent(a.id)}/${a.k + 1}`,      // #tour=paleblood/3 : l'étape 3
    keys: ["tour"],
    read: v => { const [id, k] = v.split("/"); return stepArgs(id, (+k || 1) - 1); },
  },
  backLabel: a => `Back to “${tourById(a.id)?.title || a.id}”, step ${a.k + 1}`,
  step: a => ({ kind: "doc", key: S.docs[a.i].name }),          // une étape de visite : un texte lu
  render: ({ id, k }) => {
    const t = tourById(id);
    // la page d'avant (pas encore remplacée) était-elle déjà cette visite ?
    const was = currentPage();
    const fresh = !(was && was.page === "tour" && was.id === id);
    S.tour = t; S.tourStep = k;
    S.path = t.steps.map(s => s.i); S.pathSet = new Set(S.path);
    const step = t.steps[k], d = S.docs[step.i];
    const icon = portrait(d, "portrait", 72);
    const last = k === t.steps.length - 1;
    return {
      announce: `${t.title}, step ${k + 1} of ${t.steps.length}: ${nameOf(d)}`,
      // au départ, toute la visite à l'écran ; ensuite, l'étape avec la précédente, sans zoomer
      frame: () => (fresh ? fitPoints(t.steps.map(s => S.docs[s.i]), 0) : frameFrom([d])),
      html: `<article class="card tour">
    <div class="cat">Guided tour · step ${k + 1} of ${t.steps.length}</div>
    <h2>${esc(t.title)}</h2>
    ${k === 0 ? `<p class="tour-intro">${esc(t.intro)}</p>` : ""}
    <p class="tour-note">${esc(step.note)}</p>
    <div class="tour-text">
      <div class="card-head${icon ? " has-img" : ""}">${icon}<div>
        <div class="cat"><span class="dot" style="--c:${colorOf(d.cat)}"></span>${esc(S.cats[d.cat])}${dlcBadge(d)}</div>
        <h3>${esc(nameOf(d))}</h3></div></div>
      <p class="text" lang="${textLang(d)}">${linkText(textOf(d), S.docEntities[d.i])}</p>
      <div class="tools"><button type="button" class="topen">Open this text (echoes, links…)</button></div>
    </div>
    <nav class="tour-nav" aria-label="Tour steps">
      <button type="button" class="tprev"${k === 0 ? " disabled" : ""}>← Previous</button>
      <button type="button" class="tnext">${last ? "All tours" : "Next →"}</button>
    </nav>
    <ol class="tour-steps">${t.steps.map((s, j) => `<li><button type="button" data-k="${j}"${j === k ? ' aria-current="step"' : ""}>
      <span class="step">${j + 1}</span> ${esc(nameOf(S.docs[s.i]))}</button></li>`).join("")}</ol>
  </article>`,
      bind: p => {
        bindEntityButtons(p);
        p.querySelector(".topen").addEventListener("click", () => openPage("doc", { i: d.i }));
        p.querySelector(".tprev").addEventListener("click", () => openStep(id, k - 1));
        p.querySelector(".tnext").addEventListener("click", () => (last ? openPage("tours") : openStep(id, k + 1)));
        p.querySelectorAll(".tour-steps button").forEach(b => b.addEventListener("click", () => openStep(id, +b.dataset.k)));
      },
    };
  },
});

button.addEventListener("click", () => openPage("tours"));
