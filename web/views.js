import { S, $, esc, MORPH_MS, reducedMotion } from "./state.js";
import { buildGrid, draw, render } from "./render.js";
import { setHover } from "./app.js";

// ------------------------------------------------------------------ vues (projections)
// Les mêmes textes et les mêmes groupes, aplatis autrement : passer d'une vue à l'autre
// fait glisser les étoiles, ce qui montre que seules les proximités ont un sens.
export function buildViewSwitch() {
  const box = $("#views");
  if (S.views.length < 2) return;
  box.hidden = false;
  box.innerHTML = `<span class="label">Projection</span>${S.views.map((v, k) =>
    `<button type="button" data-v="${k}" aria-pressed="${k === S.view}">${esc(v)}</button>`).join("")}`;
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
  const done = () => { S.morphing = false; buildGrid(); draw(); };
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

