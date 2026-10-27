// Bulle d'une étoile : nom, catégorie et groupe, début du texte ; si une fiche est ouverte et que
// l'étoile est l'un de ses échos, son rang. Partagée par le survol de la carte, la visée au clavier
// et le survol de la liste des échos dans le panneau.
import { S, tip, esc, portrait, nameOf, textOf } from "./state.js";
import { toScreen } from "./render.js";
import { groupOf, snippet, dlcBadge } from "./panel.js";

const TIP_SNIPPET = 180;    // caractères du texte montrés dans la bulle
const TIP_WIDTH = 360;      // px, largeur maximale de la bulle

function tipHTML(i, hint) {
  const d = S.docs[i], g = groupOf(d);
  const group = g?.c ? ` · ${g.near ? "near " : ""}${esc(g.c.label)}` : "";
  const sel = S.selected >= 0 && S.selected !== i ? S.docs[S.selected] : null;
  const rank = sel ? sel.echoes.indexOf(i) : -1;
  return portrait(d, "thumb", 48)
    + `<span class="name">${esc(nameOf(d))}</span>`
    + `<span class="sub">${esc(S.cats[d.cat])}${group}${dlcBadge(d)}</span>`
    + (rank >= 0 ? `<span class="echo">Echo #${rank + 1} of “${esc(nameOf(sel))}”</span>` : "")
    + `<span class="snip">${esc(snippet(textOf(d), [], TIP_SNIPPET))}</span>`
    + (hint ? `<span class="sub">${hint}</span>` : "");
}

// (sx, sy) : le point visé à l'écran ; la bulle se place en bas à droite, ou de l'autre côté si
// elle sortirait de l'écran (ou passerait sous le panneau ouvert)
export function showTip(i, sx, sy, { hint = "", dx = 16, dy = 14 } = {}) {
  const right = panelLeft() - 8;
  tip.innerHTML = tipHTML(i, hint);
  tip.style.maxWidth = Math.min(TIP_WIDTH, right - 8) + "px";   // tablette : la carte ne fait que 340 px
  tip.hidden = false;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  tip.style.left = Math.max(8, sx + dx + tw <= right ? sx + dx : sx - dx - tw) + "px";
  tip.style.top = Math.max(8, sy + dy + th <= S.H - 8 ? sy + dy : sy - dy - th) + "px";
}

function panelLeft() {
  const p = document.getElementById("panel");
  return p.hidden || innerWidth <= 760 ? S.W : p.getBoundingClientRect().left;
}

// survol d'un écho dans le panneau : l'étoile s'allume et la bulle s'affiche à côté d'elle,
// si elle est visible à gauche du panneau
export function tipAtStar(i) {
  const [sx, sy] = toScreen(S.docs[i].x, S.docs[i].y);
  if (sx < 0 || sy < 0 || sx > panelLeft() || sy > S.H) { tip.hidden = true; return; }
  showTip(i, sx, sy);
}
