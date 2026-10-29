// Les modules de pages ne s'importent pas entre eux (ni le module du panneau, ni la navigation) : un
// lien vers une autre page passe par pages.js. Et les modules du site ne s'importent pas en boucle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const WEB = new URL("../web/", import.meta.url);
const PAGES = ["help-ui.js", "entities-ui.js", "dialogue-ui.js", "tours-ui.js", "text-ui.js", "group-ui.js",
  "path-ui.js", "search-ui.js"];
const BANNED = new Set([...PAGES, "panel.js", "nav.js"]);

const importsOf = f => [...readFileSync(new URL(f, WEB), "utf8").matchAll(/^import\s[^;]*?from\s+"\.\/([^"]+)"/gm)]
  .map(m => m[1]);

for (const f of PAGES) {
  test(`${f} imports no other page module`, () => {
    assert.deepEqual(importsOf(f).filter(m => BANNED.has(m) && m !== f), []);
  });
}

test("every module that registers a page is checked above", () => {
  const registering = readdirSync(WEB).filter(f => f.endsWith(".js") && f !== "pages.js" && f !== "panel.js"
    && /registerPage\(/.test(readFileSync(new URL(f, WEB), "utf8")));
  assert.deepEqual(registering.sort(), [...PAGES].sort());
});

test("the web modules import no one in a loop", () => {
  const files = readdirSync(WEB).filter(f => f.endsWith(".js"));
  const graph = new Map(files.map(f => [f, importsOf(f)]));
  const loops = [];
  const state = new Map();          // 1 : en cours de visite, 2 : fini
  const visit = (f, path) => {
    if (state.get(f) === 2) return;
    if (state.get(f) === 1) { loops.push([...path.slice(path.indexOf(f)), f].join(" -> ")); return; }
    state.set(f, 1);
    for (const g of graph.get(f) || []) visit(g, [...path, f]);
    state.set(f, 2);
  };
  for (const f of files) visit(f, []);
  assert.deepEqual(loops, []);
});
