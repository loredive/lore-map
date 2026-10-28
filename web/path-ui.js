// La page d'un chemin d'échos : d'un texte à un autre en sautant d'écho en écho, comment le sens
// glisse d'un sujet à l'autre. On le commence depuis un texte (pathbar.js : startPath), et choisir le
// second texte ouvre cette page (le détour déclaré par la page d'un texte, text-ui.js).
import { S, esc, docRow, nameOf, textOf } from "./state.js";
import { fitPoints } from "./render.js";
import { echoGraph, echoPath } from "./graph.js";
import { registerPage, openPage } from "./pages.js";
import { cancelPath } from "./pathbar.js";
import { snippet } from "./links.js";

const indexOf = name => S.docs.findIndex(x => x.name === name);

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
    return {
      html: `<article class="card">
    <div class="cat">Echo path</div>
    <h2>${esc(nameOf(first))} → ${esc(nameOf(last))}</h2>
    <p class="count">${hops} ${hops > 1 ? "echoes" : "echo"}: at each step, the next text is one of the closest in meaning.</p>
    <ol class="results path">${path.map((i, k) => {
      const d = S.docs[i];
      return docRow(d, esc(nameOf(d)), esc(snippet(textOf(d), [])), `<span class="step">${k + 1}</span>`);
    }).join("")}</ol>
  </article>`,
      bind: panel => panel.querySelectorAll("button[data-i]").forEach(b => b.addEventListener("click", () => openPage("doc", { i: +b.dataset.i }))),
      announce: `Path of ${hops} ${hops > 1 ? "echoes" : "echo"}`,
      frame: () => fitPoints(path.map(i => S.docs[i]), 0),     // tout le chemin, au plus près
    };
  },
});
