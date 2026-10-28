// La page d'aide : comment lire la carte, et ce qu'on peut y faire (exemples propres au jeu).
import { S, $, esc } from "./state.js";
import { registerPage, openPage } from "./pages.js";

registerPage({
  name: "help",
  backLabel: () => "Back to help",
  render: () => {
    const ui = S.ui, x = ui.precise || {};     // exemples propres au jeu (game.json)
    return {
      announce: "Help: how to read this map",
      html: `<article class="card">
    <h2>How to read this map</h2>
    <ul class="help">
      <li>Each point is a text from the game: an item, a weapon, a piece of armor, a dialogue…</li>
      <li>Texts close together talk about the same things; distant ones, about other subjects.</li>
      <li>The names written on the map label groups of neighboring texts.</li>
      <li>Click a point to read it, or a name to browse its group.</li>
    </ul>
    <h3>What you can do</h3>
    <ul class="help">
      ${S.tours.length ? "<li><strong>Guided tours</strong>, in the top bar: short walks through the story, step by step. The best place to start.</li>" : ""}
      <li><strong>Search</strong> by name or by meaning: ${(ui.search_examples || []).map(q => `“${esc(q)}”`).join(", ")}; or precisely: <code>${esc(x.both)}</code>, <code>${esc(x.exclude)}</code>, <code>"${esc(x.phrase)}"</code>, <code>${esc(x.category)}</code>.</li>
      <li><strong>Characters and places</strong>: every text that mentions ${esc(ui.entity_examples || "")}…, and the names linked to them.</li>
      <li><strong>Echoes</strong>: under each text, the ones closest to it in meaning.</li>
      <li><strong>Trace a path</strong> between two texts, from echo to echo, starting from any text.</li>
      <li><strong>By meaning / by category</strong>, in the top bar: texts placed by what they talk about, or sorted into columns by category.</li>
      <li><strong>Categories</strong>, in the top bar: click one to hide or show its texts.</li>
      <li><strong>History</strong>, in the top bar: every page you opened, and how many texts you have read. On the map, a ring marks each text already read, and the text you came from is named.</li>
      <li><strong>Back</strong> (or the browser's Back button) returns to the previous page; Escape closes.</li>
      <li>By touch: tapping a crowded spot zooms in, then lists the texts there.</li>
      <li>By keyboard: Tab to the map, arrow keys to move, + and − to zoom, Enter to open the targeted star.</li>
    </ul>
  </article>`,
    };
  },
});

$("#help").addEventListener("click", () => openPage("help"));
