// Visites guidées (data/<jeu>/tours.json, écrites à la main) : une suite de textes, chacun avec
// une phrase qui le situe. La carte trace la visite comme un chemin numéroté (render.js), l'étape
// en cours entourée ; le panneau lit l'étape, avec Précédent / Suivant.
import { S, $, panel, esc, colorOf, resetContext, focusPanel, portrait, dataPath, nameOf, textOf, textLang } from "./state.js";
import { draw, fitPoints, frameFrom } from "./render.js";
import { panelTop, bindPanelTop, select, dlcBadge } from "./panel.js";
import { record } from "./nav.js";
import { linkText, bindEntityButtons } from "./entities-ui.js";

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

export function showTours() {
  resetContext();
  S.selected = -1;
  panel.hidden = false;
  panel.dataset.view = "tours";
  record({ view: "tours" });
  panel.innerHTML = `${panelTop()}<article class="card">
    <h2>Guided tours</h2>
    <p class="hint">Short walks through the texts, each step with a line of context. A good way in if you're new to the story.</p>
    <ol class="tours">${S.tours.map(t => `<li><button type="button" data-t="${esc(t.id)}">
      <span class="name">${esc(t.title)}</span> <span class="n">${t.steps.length} steps</span>
      <span class="snip">${esc(t.intro)}</span></button></li>`).join("")}</ol>
  </article>`;
  bindPanelTop();
  panel.querySelectorAll("button[data-t]").forEach(b => b.addEventListener("click", () => openTour(b.dataset.t, 0)));
  panel.scrollTop = 0;
  focusPanel("Guided tours");
  draw();
}

export function openTour(id, k = 0) {
  const t = S.tours.find(x => x.id === id);
  if (!t) return;
  k = Math.max(0, Math.min(t.steps.length - 1, k));
  const fresh = S.tour !== t;
  resetContext();
  S.selected = -1;
  S.tour = t; S.tourStep = k;
  S.path = t.steps.map(s => s.i); S.pathSet = new Set(S.path);
  const step = t.steps[k], d = S.docs[step.i];
  panel.hidden = false;
  panel.dataset.view = "tour";
  record({ view: "tour", id, k, i: d.i });
  const icon = portrait(d, "portrait", 72);
  const last = k === t.steps.length - 1;
  panel.innerHTML = `${panelTop()}<article class="card tour">
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
  </article>`;
  bindPanelTop();
  bindEntityButtons();
  panel.querySelector(".topen").addEventListener("click", () => select(d.i));
  panel.querySelector(".tprev").addEventListener("click", () => openTour(id, k - 1));
  panel.querySelector(".tnext").addEventListener("click", () => (last ? showTours() : openTour(id, k + 1)));
  panel.querySelectorAll(".tour-steps button").forEach(b => b.addEventListener("click", () => openTour(id, +b.dataset.k)));
  panel.scrollTop = 0;
  focusPanel(`${t.title}, step ${k + 1} of ${t.steps.length}: ${nameOf(d)}`);
  // au départ, toute la visite à l'écran ; ensuite, l'étape avec la précédente, sans zoomer
  if (fresh) fitPoints(t.steps.map(s => S.docs[s.i]), 0);
  else frameFrom([d]);
  draw();
}
button.addEventListener("click", showTours);
