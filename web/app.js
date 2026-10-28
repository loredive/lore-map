// Point d'entrée : chargement des données, souris, clavier, légende.
import { S, $, canvas, panel, tip, status, input, mode, esc, colorOf, announce, dataPath, DEFAULT_GAME, nameOf, groupName, resetContext, focusPanel } from "./state.js";
import { buildGrid, buildSprites, computeHulls, resize, draw, toWorld, nearest, flyTo, zoomAt, setHover, starsNear, viewCenter, frameFrom } from "./render.js";
import { buildViewSwitch, addShelves } from "./views.js";
import { prepareSky } from "./sky.js";
import { buildDialogues } from "./dialogue-ui.js";
import { buildIndex, runSearch, renderResults, resetSearch } from "./search-ui.js";
import { select, openCluster, closePanel, cancelPath, panelTop, bindPanelTop, oldPages } from "./panel.js";
import { record, current, openEntry } from "./nav.js";
import { showTip } from "./tip.js";
import { openEntity } from "./entities-ui.js";
import { initTrail } from "./trail-ui.js";
import { loadTours } from "./tours-ui.js";
import { startPages, openFromAddress, rerenderPage } from "./pages.js";
import "./help-ui.js";
import "./text-ui.js";
import "./group-ui.js";
import "./path-ui.js";

// ------------------------------------------------------------------ pages du panneau
// pages.js reçoit ici tout ce qui touche au DOM et à l'état partagé ; les sortes de pages se sont
// enregistrées en important leur module (help-ui.js, text-ui.js…), les autres passent encore par panel.js.
startPages({
  panel,
  browser: {
    push: (state, url) => history.pushState(state, "", url),
    replace: (state, url) => history.replaceState(state, "", url),
    back: () => history.back(),
    href: () => location.href,
    plain: () => location.pathname + location.search,     // une page sans adresse propre
    onPop: f => addEventListener("popstate", e => f(e.state)),
  },
  query: () => S.query,
  resetFocus: () => { resetContext(); S.selected = -1; },
  top: panelTop,
  bindTop: bindPanelTop,
  focus: focusPanel,
  frame: frameFrom,
  draw,
  // revenir à une page ouverte avant la recherche efface la recherche
  onReopen: e => { if (e.view !== "results" && !e.q && S.query) resetSearch(); },
  fallback: oldPages,
});

// ------------------------------------------------------------------ jeu
const optional = (f, empty) => fetch(f).then(r => r.ok ? r.json() : empty).catch(() => empty);

// ?game=… (ou l'ancien ?jeu=…) s'il fait partie des jeux dont les données sont prêtes (data/games.json), sinon le jeu par
// défaut ; puis ses couleurs et ses exemples (data/<jeu>/game.json)
async function chooseGame() {
  S.games = await optional("data/games.json", []);
  const params = new URLSearchParams(location.search);
  const want = params.get("game") || params.get("jeu");
  S.game = S.games.some(g => g.id === want) ? want : DEFAULT_GAME;
  const g = await optional(dataPath("game.json"), {});
  S.colors = g.colors || {};
  document.body.dataset.game = S.game;        // ciel propre au jeu (style.css)
  S.hasImages = !!g.images;
  S.hasTours = !!g.tours;
  S.ui = g.ui || {};
  if (S.ui.tagline) { $(".tagline").textContent = S.ui.tagline; $(".brand h1").title = S.ui.tagline; }
  if (S.ui.aria) canvas.setAttribute("aria-label", S.ui.aria);
  if (S.ui.credit) $(".credit").textContent = S.ui.credit;
  if (S.games.length > 1) {
    document.title = `The Lore Map · ${g.title}`;
    buildGameSwitch();
  }
}

// « Elden Ring · Bloodborne » sous le titre : un lien par jeu, le jeu affiché marqué
function buildGameSwitch() {
  const nav = document.createElement("nav");
  nav.className = "games";
  nav.setAttribute("aria-label", "Choose the game");
  nav.innerHTML = S.games.map(g => g.id === S.game
    ? `<a aria-current="page">${esc(g.title)}</a>`
    : `<a href="?game=${encodeURIComponent(g.id)}">${esc(g.title)}</a>`).join('<span class="sep" aria-hidden="true">·</span>');
  $(".drawer").prepend(nav);
}

// ------------------------------------------------------------------ données
async function load() {
  await chooseGame();
  let lore, meta, images;
  try {
    [lore, meta, images] = await Promise.all([
      fetch(dataPath("lore.json")).then(r => { if (!r.ok) throw r; return r.json(); }),
      fetch(dataPath("meta.json")).then(r => { if (!r.ok) throw r; return r.json(); }),
      // icônes (images.py) : seulement pour un jeu qui en a (game.json : images) ; la carte s'en passe
      S.hasImages ? optional(dataPath("images.json"), {}) : {},
    ]);
  } catch {
    status.innerHTML = `Could not read <code>${dataPath("lore.json")}</code>. Run <code>python prepare.py</code>, ` +
      "then open the page through a local server: <code>python -m http.server -d web</code>.";
    return;
  }
  const F = Object.fromEntries(lore.fields.map((f, i) => [f, i]));
  S.cats = lore.categories;
  S.clusters = lore.clusters.sort((a, b) => b.n - a.n);
  S.meta = meta;
  S.images = new Map(Object.entries(images));
  // chaque texte a une position par vue ([x1, y1, x2, y2…]) ; la première est la carte principale
  S.views = lore.views || ["Map"];
  S.docs = lore.docs.map((r, i) => {
    const xy = F.xy !== undefined ? r[F.xy] : [r[F.x], r[F.y]];
    const views = S.views.map((_, k) => [xy[2 * k], xy[2 * k + 1]]);
    return { i, name: r[F.name], cat: r[F.cat], text: r[F.text], jp: r[F.jp], jpName: r[F.jpName],
             alt: F.alt !== undefined ? r[F.alt] : "", altName: F.altName !== undefined ? r[F.altName] : "",
             dlc: F.dlc !== undefined && !!r[F.dlc],
             views, x: views[0][0], y: views[0][1], cluster: r[F.cluster], echoes: r[F.echoes] };
  });
  for (const c of S.clusters) {
    c.views = c.views || [{ x: c.x, y: c.y, cohesion: 1 }];
    Object.assign(c, { x: c.views[0].x, y: c.views[0].y });
  }
  addShelves();
  S.entities = (lore.entities || []).sort((a, b) => b.docs.length - a.docs.length);
  S.docEntities = S.docs.map(() => []);
  S.entities.forEach(e => e.docs.forEach(i => S.docEntities[i].push(e)));
  buildIndex();
  buildGrid();
  computeHulls();
  prepareSky();
  buildDialogues();
  buildSprites();
  buildLegend();
  legendFade();
  buildViewSwitch();
  buildLangSwitch();
  initTrail();                                  // avant openFromAddress : le lien collé est un premier pas
  await loadTours();                            // data/<jeu>/tours.json, s'il y en a
  status.textContent = "";
  mode.textContent = "";                       // la ligne d'état ne parle que quand il y a du nouveau
  resize();
  openFromAddress(location.hash);
  if (!current()) record({ view: "none" });     // premier état : la carte seule, panneau fermé
}


// ------------------------------------------------------------------ interactions
const pointers = new Map();
let drag = null, pinch = null;

canvas.addEventListener("pointerdown", e => {
  closeChooser();
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
    if (e.pointerType !== "mouse" && tapZoom(e.clientX, e.clientY, label)) { drag = null; return; }
    const i = near >= 0 ? near : label ? -1 : pick(e.clientX, e.clientY, e.pointerType === "mouse" ? 12 : 22);
    if (i >= 0) select(i);
    else if (label) openCluster(label);
    else if (!panel.hidden && panel.dataset.view !== "results") closePanel();
  }
  drag = null;
});
// Au doigt, plusieurs étoiles tiennent souvent sous la pulpe (toutes, au zoom initial) : plutôt
// qu'ouvrir l'une d'elles au hasard, on zoome s'il y en a beaucoup, et sinon on propose leurs noms.
// Mesuré avec une erreur de doigt de 6 px : l'étoile la plus proche n'était la bonne que 2 fois sur 20.
// Un nom de groupe sous le doigt, avec peu d'étoiles, devient le premier choix de la liste.
const TAP_PX = 22, MAX_ZOOM = 80, CHOICES = 6, TAP_ZOOM = 4;   // ×4 : moins de touches qu'à ×2,5 (mesuré)
const chooser = $("#chooser");
function tapZoom(sx, sy, label) {
  closeChooser();
  const c = starsNear(sx, sy, TAP_PX);
  if (label) {
    if (c.length > CHOICES) return false;            // carte vue de loin : toucher un nom ouvre son groupe
    openChooser(c.map(([i]) => i), sx, sy, label);
    return true;
  }
  if (c.length <= 1) return false;                   // une seule étoile sous le doigt : elle s'ouvre
  if (c.length > CHOICES && S.cam.s * TAP_ZOOM <= MAX_ZOOM) {
    const [wx, wy] = toWorld(sx, sy);
    flyTo(wx, wy, S.cam.s * TAP_ZOOM, 450);
    return true;
  }
  openChooser(c.slice(0, CHOICES).map(([i]) => i), sx, sy);
  return true;
}
function openChooser(list, sx, sy, group = null) {
  chooser.innerHTML = `<p class="title">Several things here</p><ul>${group
    ? `<li><button type="button" class="group" data-c="${group.id}">Group: ${esc(groupName(group))}</button></li>` : ""}${list.map(i => {
    const d = S.docs[i];
    return `<li><button type="button" data-i="${i}"><span class="dot" style="--c:${colorOf(d.cat)}"></span>${esc(nameOf(d))}</button></li>`;
  }).join("")}</ul>`;
  chooser.hidden = false;
  const w = chooser.offsetWidth, h = chooser.offsetHeight;
  chooser.style.left = Math.max(8, Math.min(sx - w / 2, S.W - w - 8)) + "px";
  chooser.style.top = (sy + 24 + h < S.H ? sy + 24 : Math.max(8, sy - h - 24)) + "px";
  chooser.querySelectorAll("button[data-i]").forEach(b => b.addEventListener("click", () => { closeChooser(); select(+b.dataset.i); }));
  chooser.querySelector("button[data-c]")?.addEventListener("click", () => { closeChooser(); openCluster(group); });
  chooser.querySelector("button").focus({ preventScroll: true });
}
export function closeChooser() { chooser.hidden = true; }

// Au clavier : la carte reçoit le focus, un viseur marque le centre ; l'étoile la plus proche du
// viseur est nommée, Entrée l'ouvre.
function aimAtCenter() {
  const [cx, cy] = viewCenter();
  const i = pick(cx, cy, 30);
  setHover(i);
  if (i >= 0) {
    showTip(i, cx, cy, { hint: "Enter to open", dx: 40, dy: 34 });
  }
  announce(i >= 0 ? `Aiming at: ${S.docs[i].name}` : "No star at the center");
}
canvas.addEventListener("focus", () => { if (canvas.matches(":focus-visible")) { S.kbd = true; aimAtCenter(); draw(); } });
canvas.addEventListener("blur", () => { S.kbd = false; setHover(-1); draw(); });

canvas.addEventListener("pointercancel", e => { pointers.delete(e.pointerId); drag = pinch = null; });
canvas.addEventListener("pointerleave", () => { S.hoverLabel = null; setHover(-1); });
canvas.addEventListener("wheel", e => {
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015)));
}, { passive: false });
canvas.addEventListener("dblclick", e => zoomAt(e.clientX, e.clientY, 2.2));
addEventListener("resize", resize);
// la barre du haut change de hauteur (largeur de fenêtre, polices chargées) : la carte se recale sous elle
new ResizeObserver(() => { resize(); legendFade(); }).observe($(".topbar"));
// catégories trop nombreuses pour la ligne : le bord droit s'estompe, sauf une fois arrivé au bout
function legendFade() {
  const l = $("#legend");
  l.classList.toggle("scrolls", l.scrollWidth > l.clientWidth + 1);
  l.classList.toggle("at-end", l.scrollLeft + l.clientWidth >= l.scrollWidth - 1);
}
$("#legend").addEventListener("scroll", legendFade, { passive: true });
// téléphone : « Menu » ouvre le reste de la barre par-dessus la carte ; un choix fait, il se referme
const menuBtn = $(".menu-btn"), topbar = $(".topbar");
function setMenu(open) {
  topbar.classList.toggle("open", open);
  menuBtn.setAttribute("aria-expanded", String(open));
}
menuBtn.addEventListener("click", () => setMenu(!topbar.classList.contains("open")));
topbar.querySelectorAll(".links button, .games a").forEach(b => b.addEventListener("click", () => setMenu(false)));
canvas.addEventListener("pointerdown", () => setMenu(false));
// les images ne sont pas versionnées (images.py, icons.py) : une icône absente disparaît,
// et sa fiche reprend la mise en page sans image
addEventListener("error", e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  img.closest(".card-head")?.classList.remove("has-img");
  img.remove();
}, true);

addEventListener("keydown", e => {
  const typing = document.activeElement === input;
  if (e.key === "/" && !typing && !e.target.closest?.("textarea, input, select")) { e.preventDefault(); input.focus(); input.select(); return; }
  if (e.key === "Escape" && topbar.classList.contains("open")) { setMenu(false); menuBtn.focus(); return; }
  if (e.key === "Escape") {
    // Échap défait la dernière chose en cours : un chemin à choisir, une recherche, la fiche ouverte
    if (!chooser.hidden) closeChooser();
    else if (S.pathFrom >= 0) { cancelPath(); draw(); }
    else if (input.value) { input.value = ""; runSearch(); }
    else if (!panel.hidden) closePanel();
    return;
  }
  if (typing || document.activeElement?.closest("#panel")) return;
  if (e.key === "Enter" && document.activeElement === canvas && S.hover >= 0) { e.preventDefault(); select(S.hover); return; }
  const step = 80 / (S.cam.s * S.base);
  const keys = {
    "+": () => zoomAt(S.W / 2, S.cy, 1.3), "=": () => zoomAt(S.W / 2, S.cy, 1.3),
    "-": () => zoomAt(S.W / 2, S.cy, 1 / 1.3),
    ArrowLeft: () => { S.cam.x -= step; draw(); }, ArrowRight: () => { S.cam.x += step; draw(); },
    ArrowUp: () => { S.cam.y += step; draw(); }, ArrowDown: () => { S.cam.y -= step; draw(); },
    "0": () => flyTo(0, 0, 1),
  };
  if (keys[e.key]) {
    e.preventDefault();
    keys[e.key]();
    if (S.kbd) setTimeout(aimAtCenter, e.key === "0" ? 700 : 0);   // « 0 » recentre en douceur
  }
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
    showTip(i, sx, sy);
  }
}

// ------------------------------------------------------------------ langue des textes
// Un jeu dont les données ont une seconde langue (Bloodborne : le français officiel) propose
// « English | Français » ; le choix est gardé par jeu, et ce qui est ouvert se réaffiche aussitôt.
const NATIVE = { fr: "Français", ja: "日本語", de: "Deutsch", es: "Español", it: "Italiano" };
const langKey = () => `lore-map:lang:${S.game}`;
function buildLangSwitch() {
  const box = $("#lang");
  if (!S.ui.alt_lang || !S.docs.some(d => d.alt)) return;
  try { S.altLang = localStorage.getItem(langKey()) === "alt"; } catch { /* stockage bloqué */ }
  const label = NATIVE[S.ui.alt_lang] || S.ui.alt_label;
  box.innerHTML = `<button type="button" data-alt="0" lang="en">English</button><button type="button" data-alt="1" lang="${esc(S.ui.alt_lang)}">${esc(label)}</button>`;
  box.hidden = false;
  const mark = () => box.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.alt === +S.altLang)));
  mark();
  box.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    if (+b.dataset.alt === +S.altLang) return;
    S.altLang = !S.altLang;
    try { localStorage.setItem(langKey(), S.altLang ? "alt" : "main"); } catch { /* idem */ }
    mark();
    tip.hidden = true;
    if (!panel.hidden && current()) openEntry(current());   // la fiche, la liste ou la visite ouverte, dans l'autre langue
    draw();
    announce(S.altLang ? `Texts in ${label}` : "Texts in English");
  }));
}

// ------------------------------------------------------------------ légende
function buildLegend() {
  const counts = new Map();
  for (const d of S.docs) counts.set(d.cat, (counts.get(d.cat) || 0) + 1);
  const nav = $("#legend");
  // téléphone : la légende est dans le menu replié ; le bouton dit combien de catégories sont masquées
  const menu = $(".menu-btn");
  const label = () => {
    const off = S.hidden.size + (S.hideDlc ? 1 : 0);
    menu.textContent = off ? `Menu · ${off} hidden` : "Menu";
  };
  label();
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
      label();
      refreshVisible();
    });
    nav.append(b);
  });
  // textes ajoutés par le DLC (Bloodborne : The Old Hunters) : les masquer d'un coup, toutes catégories
  const dlc = S.docs.filter(d => d.dlc).length;
  if (dlc) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "dlc";
    b.setAttribute("aria-pressed", "true");
    b.innerHTML = `<span class="dlc-badge">DLC</span><span class="label">${esc(S.ui.dlc_label || "DLC")}</span> <span class="n">${dlc}</span>`;
    b.title = `Show or hide the texts added with ${S.ui.dlc_label || "the DLC"}`;
    b.addEventListener("click", () => {
      S.hideDlc = !S.hideDlc;
      b.setAttribute("aria-pressed", String(!S.hideDlc));
      label();
      refreshVisible();
    });
    nav.append(b);
  }
}

// une catégorie (ou le DLC) masquée ou réaffichée : les listes ouvertes et la carte suivent
function refreshVisible() {
  if (S.results.length && S.selected < 0) renderResults();
  else if (S.cluster && S.selected < 0) rerenderPage();
  else if (S.entity && S.selected < 0) openEntity(S.entity, { fly: false, focus: false });
  draw();
}

load();
