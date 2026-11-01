// La galaxie de la page d'accueil, à l'écran : une constellation par jeu, dessinée sur sa propre toile
// (#galaxy, par-dessus la carte), et un vrai bouton par constellation (#galaxy-nav) pour la souris, le
// toucher, le clavier et les lecteurs d'écran. Choisir un jeu lance le vol ; app.js charge la carte
// pendant ce temps, puis finish() fond la galaxie dans la carte, dessinée au même cadre dessous.
// Les calculs (disposition, cadre d'arrivée, vol) sont dans galaxy.js.
import { $, reducedMotion } from "./state.js";
import { layoutGalaxy, landingFrame, flightAt, FLIGHT_MS } from "./galaxy.js";
import { FADE_MS } from "./intro.js";

const cv = $("#galaxy"), ctx = cv.getContext("2d"), nav = $("#galaxy-nav"), title = $("#galaxy-title");
const namesAlways = matchMedia("(hover: none)").matches;   // au toucher, rien ne se survole : les noms restent

// poussière fixe (graine fixe : la même à chaque visite)
let seed = 11;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const DUST = Array.from({ length: 700 }, () => [rnd(), rnd(), rnd() ** 3]);

const fetchSky = id => fetch(`data/${id}/sky.json`).then(r => (r.ok ? r.json() : null)).catch(() => null);

// la zone des constellations (entre le titre et la ligne de crédit) ; et la vue de la carte (sous la barre du haut)
const galaxyView = () => ({ width: innerWidth, height: $(".galaxy-credit").getBoundingClientRect().top - 6,
  top: title.getBoundingClientRect().bottom + 12 });
const mapView = () => ({ width: innerWidth, height: innerHeight, top: $(".topbar")?.getBoundingClientRect().bottom || 0 });

// skies : les sky.json chargés -> null si aucun ; sinon une promesse, tenue au choix d'un jeu
export async function runGalaxy(games) {
  const skies = (await Promise.all(games.map(g => fetchSky(g.id)))).filter(Boolean);
  if (!skies.length) return null;
  const byId = new Map(skies.map(s => [s.id, s]));
  for (const s of skies) s.twinkle = Array.from({ length: s.n }, () => rnd() * 6.283);

  let places = [], lit = null, chosen = null, t0 = 0, phase = "idle", running = true, dpr = 1;
  let landedResolve;
  const landed = new Promise(r => { landedResolve = r; });

  function layout() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    places = layoutGalaxy(skies, galaxyView());
    for (const p of places) {
      const b = nav.querySelector(`[data-id="${p.id}"]`);
      Object.assign(b.style, { left: `${p.cx - p.r}px`, top: `${p.cy - p.r}px`, width: `${2 * p.r}px`, height: `${2 * p.r}px` });
    }
  }

  // les boutons, dans l'ordre des sorties (celui de layoutGalaxy)
  nav.dataset.names = namesAlways ? "always" : "hover";
  nav.innerHTML = "";
  for (const { id } of layoutGalaxy(skies, galaxyView())) {
    const s = byId.get(id), b = document.createElement("button");
    b.type = "button";
    b.dataset.id = id;
    b.setAttribute("aria-label", `${s.title}, ${s.n.toLocaleString("en")} texts`);
    b.addEventListener("pointerenter", () => { lit = id; });
    b.addEventListener("pointerleave", () => { if (lit === id) lit = null; });
    b.addEventListener("focus", () => { lit = id; });
    b.addEventListener("blur", () => { if (lit === id) lit = null; });
    b.addEventListener("keydown", e => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const all = [...nav.children], i = all.indexOf(b);
      all[(i + step + all.length) % all.length].focus();
    });
    nav.append(b);
  }
  document.body.classList.add("galaxy");
  layout();
  addEventListener("resize", layout);

  // le cadre où est dessinée la constellation p : au repos, son cercle ; en vol, le chemin vers la carte
  function frameOf(p, now) {
    if (phase === "idle") return { cx: p.cx, cy: p.cy, k: p.r };
    const from = places.find(q => q.id === chosen), to = landingFrame(mapView());
    const t = phase === "flying" ? Math.min(1, (now - t0) / FLIGHT_MS) : 1;
    if (t >= 1 && phase === "flying") { phase = "landed"; landedResolve(); }
    const f = flightAt(t, { cx: from.cx, cy: from.cy, k: from.r }, to), z = f.k / from.r;
    return p.id === chosen ? f : { cx: f.cx + (p.cx - from.cx) * z, cy: f.cy + (p.cy - from.cy) * z, k: p.r * z };
  }

  function progress(now) {
    return phase === "idle" ? 0 : phase === "flying" ? Math.min(1, (now - t0) / FLIGHT_MS) : 1;
  }

  function draw(now) {
    const W = innerWidth, H = innerHeight, t = progress(now);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#05060b";
    ctx.fillRect(0, 0, W, H);
    // poussière : en vol, elle s'écarte doucement du centre choisi (parallaxe)
    const home = chosen && places.find(q => q.id === chosen), focus = home && frameOf(home, now);
    const spread = home ? (focus.k / home.r) ** 0.25 : 1;
    ctx.fillStyle = "#c8cde6";
    for (const [u, v, b] of DUST) {
      const x = home ? focus.cx + (u * W - home.cx) * spread : u * W, y = home ? focus.cy + (v * H - home.cy) * spread : v * H;
      ctx.globalAlpha = 0.08 + 0.35 * b;
      ctx.fillRect(((x % W) + W) % W, ((y % H) + H) % H, 1, 1);
    }
    ctx.globalCompositeOperation = "lighter";
    for (const p of places) {
      const s = byId.get(p.id), f = frameOf(p, now), on = lit === p.id || chosen === p.id;
      const others = chosen && chosen !== p.id ? Math.max(0, 1 - 2 * t) : 1;
      if (others <= 0) continue;
      const fade = chosen ? 1 - t : 1;            // halo et lignes s'effacent pendant le vol : la carte n'en a pas
      // halo
      if (fade > 0) {
        const rad = f.k * 1.45, g = ctx.createRadialGradient(f.cx, f.cy, 0, f.cx, f.cy, rad);
        g.addColorStop(0, s.tint + (on ? "40" : "22"));
        g.addColorStop(1, s.tint + "00");
        ctx.globalAlpha = others * fade;
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(f.cx, f.cy, rad, 0, 6.283); ctx.fill();
        // lignes entre les centres des groupes, et les centres eux-mêmes
        ctx.strokeStyle = s.tint + (on ? "a0" : "60");
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        for (const [a, b] of s.lines) {
          const [ax, ay] = s.centres[a], [bx, by] = s.centres[b];
          ctx.moveTo(f.cx + ax * f.k, f.cy - ay * f.k);
          ctx.lineTo(f.cx + bx * f.k, f.cy - by * f.k);
        }
        ctx.stroke();
        ctx.fillStyle = "#fff6dc";
        for (const [x, y, n] of s.centres) {
          ctx.beginPath(); ctx.arc(f.cx + x * f.k, f.cy - y * f.k, 0.8 + Math.sqrt(n) * 0.22, 0, 6.283); ctx.fill();
        }
      }
      // étoiles, dans les couleurs de leur catégorie
      const size = Math.min(3, 0.6 + 0.0065 * f.k), half = size / 2;
      for (let i = 0; i < s.n; i++) {
        const x = f.cx + s.stars[4 * i] * f.k, y = f.cy - s.stars[4 * i + 1] * f.k;
        if (x < -4 || y < -4 || x > W + 4 || y > H + 4) continue;
        const tw = reducedMotion ? 0.85 : 0.65 + 0.35 * Math.sin(now / 900 + s.twinkle[i]);
        ctx.globalAlpha = others * tw * (on ? 1 : 0.78);
        ctx.fillStyle = s.colors[s.stars[4 * i + 2]] || "#cccccc";
        ctx.fillRect(x - half, y - half, size, size);
      }
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    // noms : sous la constellation éclairée (ou sous toutes, au toucher), jamais pendant le vol
    if (!chosen) for (const p of places) {
      if (!namesAlways && lit !== p.id) continue;
      const s = byId.get(p.id), y = p.cy + p.r + 20;
      ctx.textAlign = "center";
      ctx.fillStyle = lit === p.id ? "#f6ebc8" : "rgba(232, 226, 207, .75)";
      ctx.font = `500 ${lit === p.id ? 23 : 20}px "Cormorant Garamond", serif`;
      ctx.fillText(s.title, p.cx, y);
      ctx.font = `italic 13px "EB Garamond", serif`;
      ctx.fillStyle = "rgba(232, 226, 207, .5)";
      ctx.fillText(`${s.n.toLocaleString("en")} texts`, p.cx, y + 17);
    }
  }

  const loop = now => {
    if (!running) return;
    draw(now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // la page attend le choix ; un second choix (double clic, autre constellation pendant le vol) est ignoré
  return new Promise(resolve => {
    nav.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b || chosen) return;
      chosen = b.dataset.id;
      lit = null;
      t0 = performance.now();
      phase = reducedMotion ? "landed" : "flying";
      if (reducedMotion) landedResolve();
      document.body.classList.add("flying");
      for (const x of nav.children) x.disabled = true;
      resolve({ game: chosen, landed, finish });
    });
  });

  // la carte est prête, dessinée dessous au même cadre : la galaxie s'efface, la barre du haut revient
  function finish() {
    draw(performance.now());
    document.body.classList.remove("galaxy", "flying");
    document.body.classList.add("leaving");
    removeEventListener("resize", layout);
    setTimeout(() => {
      running = false;
      document.body.classList.remove("leaving");
      nav.innerHTML = "";
    }, FADE_MS);
  }
}
