// La musique d'ambiance : une piste par humeur (data/<jeu>/music.json, fichiers dans music/<jeu>/), choisie
// par le groupe au centre de l'écran (mood.js). Rien ne joue avant le premier geste (règle des navigateurs) ;
// le bouton Son coupe ou remet la musique, et ce choix est retenu d'une visite à l'autre.
// Les volumes passent par des GainNode (Web Audio) : sur iPhone, audio.volume est ignoré.
import { S, $, panel } from "./state.js";
import { camera } from "./camera.js";
import { MASTER, FADE_IN_S, CROSSFADE_S, DIM_S, centerMood, createSettler, readingPage, targetLevel } from "./mood.js";

const KEY = "lore-map:sound";
const TICK_MS = 250;

let data = null, on = true, started = false, mood = null, level = -1;
let audio = null, master = null;
const voices = new Map();          // humeur -> { el, gain }
const settle = createSettler();

export const musicState = () => ({ on, started, mood });
export const musicCredits = () => (data ? Object.values(data.tracks).map(({ title, author, source, license }) => ({ title, author, source, license })) : []);

// music : le contenu de music.json, ou null (pas de musique pour ce jeu : pas de bouton)
export function startMusic(music) {
  if (!music?.tracks?.[music.default]) return;
  data = music;
  try { on = localStorage.getItem(KEY) !== "off"; } catch { /* stockage bloqué */ }
  const btn = $("#sound");
  btn.hidden = false;
  btn.setAttribute("aria-pressed", String(on));
  btn.addEventListener("click", () => toggle(btn));
  // le premier geste, où qu'il soit ; play() doit être appelé pendant ce geste
  for (const type of ["pointerdown", "keydown"]) document.addEventListener(type, () => { if (on && !started) begin(); }, { capture: true });
  document.addEventListener("visibilitychange", () => {
    if (!audio) return;
    (document.hidden ? audio.suspend() : audio.resume()).catch(() => {});
  });
  setInterval(tick, TICK_MS);
}

function toggle(btn) {
  on = !on;
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* stockage bloqué */ }
  btn.setAttribute("aria-pressed", String(on));
  if (on && !started) begin();           // ce clic est lui-même un geste
  else if (on) play(voices.get(mood));
  tick();
  // coupée : la piste s'arrête une fois le volume descendu
  if (!on) setTimeout(() => { if (!on) voices.get(mood)?.el.pause(); }, DIM_S * 1000 + 100);
}

const ext = () => (new Audio().canPlayType('audio/ogg; codecs="vorbis"') ? "ogg" : "m4a");

function ramp(param, to, seconds) {
  const t = audio.currentTime;
  param.cancelScheduledValues(t);
  param.setValueAtTime(param.value, t);
  param.linearRampToValueAtTime(to, t + seconds);
}

// une piste, chargée au premier besoin ; un fichier absent reste muet, sans erreur
function voice(m) {
  if (voices.has(m)) return voices.get(m);
  const el = new Audio();
  el.loop = true;
  el.preload = "none";
  el.addEventListener("error", () => {});
  el.src = `music/${S.game}/${data.tracks[m].file}.${ext()}`;
  const gain = audio.createGain();
  gain.gain.value = 0;
  audio.createMediaElementSource(el).connect(gain).connect(master);
  const v = { el, gain };
  voices.set(m, v);
  return v;
}

function play(v) { v?.el.play().catch(() => {}); }

function begin() {
  started = true;
  try {
    audio ||= new AudioContext();
    if (!master) { master = audio.createGain(); master.gain.value = 0; master.connect(audio.destination); }
    audio.resume().catch(() => {});
  } catch { return; }                    // pas de Web Audio : la carte reste muette
  mood = settle(wantedMood(), performance.now());
  const v = voice(mood);
  v.gain.gain.value = 1;
  play(v);
  level = targetLevel(levelInputs());
  ramp(master.gain, MASTER * level, FADE_IN_S);
}

function wantedMood() {
  const { x, y } = camera(), k = S.view;
  return centerMood({
    clusters: S.clusters, k, at: [x, y], radiusOf: c => c.radius[k],
    moodOf: c => data.groups[c.label] ?? data.default,
    current: mood, fallback: data.default, byCategory: k === S.shelves?.k,
  });
}

const levelInputs = () => ({ on, started, reading: readingPage(panel.dataset.page), hidden: document.hidden });

// quatre fois par seconde : l'humeur du centre (après le temps de pose) et le volume visé
function tick() {
  if (!started || !master) return;
  const next = settle(wantedMood(), performance.now());
  if (next !== mood) {
    const old = voices.get(mood), was = mood;
    mood = next;
    if (old) {
      ramp(old.gain.gain, 0, CROSSFADE_S);
      setTimeout(() => { if (mood !== was) old.el.pause(); }, CROSSFADE_S * 1000 + 100);
    }
    const v = voice(next);
    if (on) play(v);
    ramp(v.gain.gain, 1, CROSSFADE_S);
  }
  const want = targetLevel(levelInputs());
  if (want !== level) { level = want; ramp(master.gain, MASTER * level, DIM_S); }
}
