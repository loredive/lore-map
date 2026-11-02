// La page d'un chemin d'échos : d'un texte à un autre en sautant d'écho en écho, comment le sens
// glisse d'un sujet à l'autre. On le commence depuis un texte (pathbar.js : startPath), et choisir le
// second texte ouvre cette page (le détour déclaré par la page d'un texte, text-ui.js).
import { S, esc, docRow, nameOf, textOf } from "./state.js";
import { fitPoints } from "./camera.js";
import { echoGraph, echoPath } from "./graph.js";
import { registerPage, openPage } from "./pages.js";
import { cancelPath } from "./pathbar.js";
import { snippet, mark, reasonContext } from "./links.js";
import { linkReason, reasonParts } from "./why.js";

const indexOf = name => S.docs.findIndex(x => x.name === name);

// ce qui relie deux textes voisins du chemin, en une ligne au-dessus du second
function whyLine(r) {
  const parts = [r.rank ? `echo #${r.rank}` : "echo", ...reasonParts(r).map(esc)];
  if (parts.length === 1) parts.push("close in meaning only (no shared names or rare words)");
  return { html: `<p class="why"><span aria-hidden="true">↓</span> ${parts.join(" · ")}</p>`, terms: r.terms };
}

registerPage({
  name: "path",
  address: {
    write: ({ a, b }) => "#path=" + encodeURIComponent(S.docs[a].name) + "&" + encodeURIComponent(S.docs[b].name),
    keys: ["path", "chemin"],                    // liens anglais, et anciens liens français
    read: (_, raw) => {
      const [a, b] = raw.split("&").map(decodeURIComponent).map(indexOf);
      return a >= 0 && b >= 0 ? { a, b } : null;
    },
  },
  backLabel: () => "Back to the path",
  clearsSearch: true,   // la recherche a servi à choisir l'arrivée
  onOpen: cancelPath,   // le chemin attendu est tracé
  render: ({ a, b }) => {
    S.echoAdj ||= echoGraph(S.docs.map(d => d.echoes));
    const path = echoPath(S.echoAdj, a, b);
    S.path = path; S.pathSet = path ? new Set(path) : null;
    if (!path) {
      return {
        html: `<article class="card"><h2>Echo path</h2>
      <p class="text">No echo path links “${esc(nameOf(S.docs[a]))}” to “${esc(nameOf(S.docs[b]))}”.</p></article>`,
        announce: "No echo path",
      };
    }
    const first = S.docs[path[0]], last = S.docs[path[path.length - 1]];
    const hops = path.length - 1;
    const ctx = reasonContext();
    const links = path.slice(1).map((b, k) => whyLine(linkReason(path[k], b, ctx)));   // links[k] : de l'étape k à k+1
    return {
      html: `<article class="card">
    <div class="cat">Echo path</div>
    <h2>${esc(nameOf(first))} → ${esc(nameOf(last))}</h2>
    <p class="count">${hops} ${hops > 1 ? "echoes" : "echo"}: at each step, the next text is one of the closest in meaning. Between steps: what the two texts share.</p>
    <ol class="results path">${path.map((i, k) => {
      const d = S.docs[i], before = links[k - 1], after = links[k];
      const terms = [...(before?.terms || []), ...(after?.terms || [])];
      return docRow(d, esc(nameOf(d)), mark(esc(snippet(textOf(d), terms)), terms), `<span class="step">${k + 1}</span>`, before?.html || "");
    }).join("")}</ol>
  </article>`,
      bind: panel => panel.querySelectorAll("button[data-i]").forEach(b => b.addEventListener("click", () => openPage("doc", { i: +b.dataset.i }))),
      announce: `Path of ${hops} ${hops > 1 ? "echoes" : "echo"}`,
      frame: () => fitPoints(path.map(i => S.docs[i]), 0),     // tout le chemin, au plus près
    };
  },
});
