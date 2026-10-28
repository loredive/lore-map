// Le chemin d'échos en attente : commencé depuis un texte (text-ui.js), le texte suivant choisi ouvre
// le chemin (path-ui.js). La barre sous la recherche rappelle d'où il part.
import { S, $ } from "./state.js";
import { draw } from "./render.js";

const pathbar = $("#pathbar");

export function startPath(i) {
  S.pathFrom = i;
  pathbar.querySelector(".from").textContent = S.docs[i].name;
  pathbar.hidden = false;
}

export function cancelPath() {
  S.pathFrom = -1;
  pathbar.hidden = true;
}

$("#pathbar .cancel").addEventListener("click", () => { cancelPath(); draw(); });
