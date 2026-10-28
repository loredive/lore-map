// Le panneau de droite : en-tête commun, panneau fermé, liens collés dans la barre d'adresse.
import { S, panel, esc } from "./state.js";
import { draw, focusDoc } from "./render.js";
import { poppedHere } from "./nav.js";
import { registerPage, backLabel, goBack, closePage, openFromAddress } from "./pages.js";
import { cancelPath } from "./pathbar.js";

// Mode lecture : le panneau s'élargit (environ la moitié de l'écran) ; retenu d'une visite à l'autre.
const READING_KEY = "lore-map:reading";
try { document.body.classList.toggle("reading", localStorage.getItem(READING_KEY) === "1"); } catch { /* stockage bloqué */ }

function toggleReading(btn) {
  const on = document.body.classList.toggle("reading");
  try { localStorage.setItem(READING_KEY, on ? "1" : "0"); } catch { /* stockage bloqué */ }
  btn.setAttribute("aria-pressed", String(on));
  btn.textContent = on ? "Narrow" : "Widen";
  // la carte visible a changé de largeur : y recentrer le texte ouvert
  if (S.selected >= 0) focusDoc(S.docs[S.selected], S.cam.s);
  else draw();
}

// En-tête commun du panneau : « Retour à … » (l'entrée précédente de l'historique), « Agrandir » et « Fermer ».
export function panelTop(back = backLabel()) {
  const on = document.body.classList.contains("reading");
  return `<div class="panel-top">${back ? `<button type="button" class="back">${esc(back)}</button>` : "<span></span>"}
    <span class="actions"><button type="button" class="widen" aria-pressed="${on}" title="Widen the panel for reading">${on ? "Narrow" : "Widen"}</button>
    <button type="button" class="close" aria-label="Close the panel">Close</button></span></div>`;
}
export function bindPanelTop() {
  panel.querySelector(".panel-top .back")?.addEventListener("click", goBack);
  panel.querySelector(".panel-top .widen").addEventListener("click", ev => toggleReading(ev.currentTarget));
  panel.querySelector(".panel-top .close").addEventListener("click", closePage);
}

// Le panneau fermé est une page : fermer est une étape, Retour rouvre ce qu'on vient de fermer.
registerPage({ name: "none", panel: false, onOpen: cancelPath, render: () => ({}) });

// lien collé dans la barre d'adresse sans recharger la page (replaceState ne déclenche pas l'événement)
addEventListener("hashchange", () => { if (S.docs.length && !poppedHere()) openFromAddress(location.hash); });
