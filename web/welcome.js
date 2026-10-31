// Le mot d'accueil, à la première visite seulement : lire une étoile, chercher, commencer par une
// visite guidée ou l'aide. Il se ferme de lui-même dès qu'une page s'ouvre, et ne revient plus.
import { S, $, panel } from "./state.js";
import { openPage } from "./pages.js";

const KEY = "lore-map:welcomed";
const box = $("#welcome");

function seen() {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }   // stockage bloqué : il revient, sans gravité
}

function close() {
  if (box.hidden) return;
  box.hidden = true;
  try { localStorage.setItem(KEY, "1"); } catch { /* stockage bloqué */ }
}

export function showWelcome() {
  if (seen()) return;
  box.innerHTML = `<p>Each star is a text: click one to read it. Search by name or by meaning.</p>
    <p>New here? ${S.tours.length ? `Start with a <button type="button" data-go="tours">guided tour</button>, or read the ` : "Read the "}<button type="button" data-go="help">help</button>.</p>
    <button type="button" class="close" aria-label="Close this hint">×</button>`;
  box.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => { close(); openPage(b.dataset.go); }));
  box.querySelector(".close").addEventListener("click", close);
  addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  new MutationObserver(() => { if (!panel.hidden) close(); }).observe(panel, { attributes: true, attributeFilter: ["hidden"] });
  box.hidden = false;
}
