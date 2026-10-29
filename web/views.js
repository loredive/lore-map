import { S, $, esc, MORPH_MS, reducedMotion } from "./state.js";
import { buildGrid, draw, render, setHover } from "./render.js";
import { focusDoc, fitPoints } from "./camera.js";
import { SHELVES } from "./shelves.js";

// ------------------------------------------------------------------ vues (projections)
// Les mêmes textes et les mêmes groupes, aplatis autrement : passer d'une vue à l'autre
// fait glisser les étoiles, ce qui montre que seules les proximités ont un sens.
// la vue rayons (shelves.js) est construite au chargement, avec les autres (lore.js)

export function buildViewSwitch() {
  const box = $("#views");
  if (S.views.length < 2) return;
  box.hidden = false;
  // des noms parlants ; la méthode (t-SNE) reste dans l'infobulle
  const names = ["by meaning"];
  const name = (v, k) => v === SHELVES ? "by category" : names[k] || v;
  const title = v => v === SHELVES ? "Columns are categories, blocks are topics, texts sorted by name" : `Computed with ${v}`;
  box.innerHTML = `<span class="label">Map</span>${S.views.map((v, k) =>
    `<button type="button" data-v="${k}" aria-pressed="${k === S.view}" title="${esc(title(v))}">${esc(name(v, k))}</button>`).join("")}`;
  box.querySelectorAll("button").forEach(b => b.addEventListener("click", () => setView(+b.dataset.v)));
}

let morph = 0;
export function setView(k) {
  if (k === S.view) return;
  S.view = k;
  $("#views").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.v === k)));
  const from = S.docs.map(d => [d.x, d.y]), cfrom = S.clusters.map(c => [c.x, c.y]);
  const place = e => {
    S.docs.forEach((d, i) => {
      d.x = from[i][0] + (d.views[k][0] - from[i][0]) * e;
      d.y = from[i][1] + (d.views[k][1] - from[i][1]) * e;
    });
    S.clusters.forEach((c, i) => {
      c.x = cfrom[i][0] + (c.views[k].x - cfrom[i][0]) * e;
      c.y = cfrom[i][1] + (c.views[k].y - cfrom[i][1]) * e;
    });
  };
  // à l'arrivée, ce qui est ouvert revient au centre (sinon le texte choisi peut sortir de l'écran)
  const recenter = () => {
    if (S.selected >= 0) focusDoc(S.docs[S.selected]);
    else if (S.path) fitPoints(S.path.map(i => S.docs[i]), 0);
    else if (S.cluster) fitPoints(S.docs.filter(d => d.cluster === S.cluster.id));
    else if (S.entity) fitPoints(S.entity.docs.map(i => S.docs[i]));
  };
  const done = () => { S.morphing = false; buildGrid(); recenter(); draw(); };
  cancelAnimationFrame(morph);
  setHover(-1);
  if (reducedMotion) { place(1); done(); return; }
  S.morphing = true;
  const t0 = performance.now();
  const ease = t => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  const step = now => {
    const t = Math.min(1, (now - t0) / MORPH_MS);
    place(ease(t));
    render();
    if (t < 1) morph = requestAnimationFrame(step); else done();
  };
  morph = requestAnimationFrame(step);
}

