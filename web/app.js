// Point d'entrée : chargement des données, souris, clavier, légende.
import { S, $, canvas, panel, tip, status, input, mode, esc, colorOf } from "./state.js";
import { buildGrid, buildSprites, computeHulls, resize, draw, toWorld, nearest, flyTo, zoomAt } from "./render.js";
import { buildViewSwitch } from "./views.js";
import { buildIndex, runSearch, renderResults } from "./search-ui.js";
import { select, deselect, openCluster, closePanel, openFromHash, cancelPath } from "./panel.js";
import { openEntity } from "./entities-ui.js";

// ------------------------------------------------------------------ données
async function load() {
  let lore, meta;
  try {
    [lore, meta] = await Promise.all([
      fetch("data/lore.json").then(r => { if (!r.ok) throw r; return r.json(); }),
      fetch("data/meta.json").then(r => { if (!r.ok) throw r; return r.json(); }),
    ]);
  } catch {
    status.innerHTML = "Impossible de lire <code>data/lore.json</code>. Lance <code>python prepare.py</code>, " +
      "puis ouvre la page via un serveur local : <code>python -m http.server -d web</code>.";
    return;
  }
  const F = Object.fromEntries(lore.fields.map((f, i) => [f, i]));
  S.cats = lore.categories;
  S.clusters = lore.clusters.sort((a, b) => b.n - a.n);
  S.meta = meta;
  // chaque texte a une position par vue ([x1, y1, x2, y2…]) ; la première est la carte principale
  S.views = lore.views || ["Carte"];
  S.docs = lore.docs.map((r, i) => {
    const xy = F.xy !== undefined ? r[F.xy] : [r[F.x], r[F.y]];
    const views = S.views.map((_, k) => [xy[2 * k], xy[2 * k + 1]]);
    return { i, name: r[F.name], cat: r[F.cat], text: r[F.text], jp: r[F.jp], jpName: r[F.jpName],
             views, x: views[0][0], y: views[0][1], cluster: r[F.cluster], echoes: r[F.echoes] };
  });
  for (const c of S.clusters) {
    c.views = c.views || [{ x: c.x, y: c.y, cohesion: 1 }];
    Object.assign(c, { x: c.views[0].x, y: c.views[0].y });
  }
  S.entities = (lore.entities || []).sort((a, b) => b.docs.length - a.docs.length);
  S.docEntities = S.docs.map(() => []);
  S.entities.forEach(e => e.docs.forEach(i => S.docEntities[i].push(e)));
  buildIndex();
  buildGrid();
  computeHulls();
  buildSprites();
  buildLegend();
  buildViewSwitch();
  status.textContent = "";
  mode.textContent = meta.semantic ? "Recherche par mots-clés et par sens" : "Recherche par mots-clés";
  resize();
  openFromHash();
}


// ------------------------------------------------------------------ interactions
const pointers = new Map();
let drag = null, pinch = null;

canvas.addEventListener("pointerdown", e => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, moved: 0 };
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) };
    drag = null;
  }
});
canvas.addEventListener("pointermove", e => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / pinch.d);
    pinch.d = d;
    return;
  }
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.moved > 3) {
      canvas.classList.add("dragging");
      S.cam.x -= dx / (S.cam.s * S.base);
      S.cam.y += dy / (S.cam.s * S.base);
      drag.x = e.clientX; drag.y = e.clientY;
      setHover(-1);
      draw();
      return;
    }
  }
  if (e.pointerType === "mouse") updateHover(e.clientX, e.clientY);
});
canvas.addEventListener("pointerup", e => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  canvas.classList.remove("dragging");
  if (drag && drag.moved <= 3) {
    // une étoile tout près du curseur passe avant le nom de groupe dessiné par-dessus
    const near = pick(e.clientX, e.clientY, 5);
    const label = near < 0 ? labelAt(e.clientX, e.clientY) : null;
    const i = near >= 0 ? near : label ? -1 : pick(e.clientX, e.clientY, e.pointerType === "mouse" ? 12 : 22);
    if (i >= 0) select(i);
    else if (label) openCluster(label);
    else if (S.selected >= 0) deselect();
    else if (!panel.hidden && panel.dataset.view !== "results") closePanel();
  }
  drag = null;
});
canvas.addEventListener("pointercancel", e => { pointers.delete(e.pointerId); drag = pinch = null; });
canvas.addEventListener("pointerleave", () => { S.hoverLabel = null; setHover(-1); });
canvas.addEventListener("wheel", e => {
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015)));
}, { passive: false });
canvas.addEventListener("dblclick", e => zoomAt(e.clientX, e.clientY, 2.2));
addEventListener("resize", resize);

addEventListener("keydown", e => {
  const typing = document.activeElement === input;
  if (e.key === "/" && !typing) { e.preventDefault(); input.focus(); input.select(); return; }
  if (e.key === "Escape") {
    if (S.pathFrom >= 0) { cancelPath(); draw(); }
    else if (S.selected >= 0) deselect();
    else if (!panel.hidden && panel.dataset.view !== "results") closePanel();
    else if (input.value) { input.value = ""; runSearch(); }
    return;
  }
  if (typing || document.activeElement?.closest("#panel")) return;
  const step = 80 / (S.cam.s * S.base);
  const keys = {
    "+": () => zoomAt(S.W / 2, S.H / 2, 1.3), "=": () => zoomAt(S.W / 2, S.H / 2, 1.3),
    "-": () => zoomAt(S.W / 2, S.H / 2, 1 / 1.3),
    ArrowLeft: () => { S.cam.x -= step; draw(); }, ArrowRight: () => { S.cam.x += step; draw(); },
    ArrowUp: () => { S.cam.y += step; draw(); }, ArrowDown: () => { S.cam.y -= step; draw(); },
    "0": () => flyTo(0, 0, 1),
  };
  if (keys[e.key]) { e.preventDefault(); keys[e.key](); }
});

function pick(sx, sy, px) {
  const [wx, wy] = toWorld(sx, sy);
  return nearest(wx, wy, px / (S.cam.s * S.base));
}
function labelAt(sx, sy) {
  const b = S.labelBoxes.find(([x0, y0, x1, y1]) => sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1);
  return b ? b[4] : null;
}
function updateHover(sx, sy) {
  const near = pick(sx, sy, 5);
  const label = near < 0 ? labelAt(sx, sy) : null;
  if (label !== S.hoverLabel) { S.hoverLabel = label; draw(); }
  const i = near >= 0 || label ? near : pick(sx, sy, 12);
  setHover(i);
  canvas.classList.toggle("pointing", i >= 0 || !!label);
  if (i >= 0) {
    const d = S.docs[i];
    tip.innerHTML = `<span class="name">${esc(d.name)}</span><span class="sub">${esc(S.cats[d.cat])}</span>`;
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.min(sx + 16, S.W - tw - 8) + "px";
    tip.style.top = Math.min(sy + 14, S.H - th - 8) + "px";
  }
}
export function setHover(i) {
  if (i === S.hover) return;
  S.hover = i;
  if (i < 0) tip.hidden = true;
  canvas.classList.toggle("pointing", i >= 0);
  draw();
}

// ------------------------------------------------------------------ légende
function buildLegend() {
  const counts = new Map();
  for (const d of S.docs) counts.set(d.cat, (counts.get(d.cat) || 0) + 1);
  const nav = $("#legend");
  S.cats.forEach((c, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-pressed", "true");
    b.innerHTML = `<span class="dot" style="--c:${colorOf(i)}"></span><span class="label">${esc(c)}</span> <span class="n">${counts.get(i) || 0}</span>`;
    b.title = c;
    b.addEventListener("click", () => {
      const on = S.hidden.has(i);
      on ? S.hidden.delete(i) : S.hidden.add(i);
      b.setAttribute("aria-pressed", String(on));
      if (S.results.length && S.selected < 0) renderResults();
      else if (S.cluster && S.selected < 0) openCluster(S.cluster, { fly: false });
      else if (S.entity && S.selected < 0) openEntity(S.entity, { fly: false });
      draw();
    });
    nav.append(b);
  });
}

load();
