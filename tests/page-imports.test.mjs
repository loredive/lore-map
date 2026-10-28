// Les modules de pages ne s'importent pas entre eux (ni le module du panneau) : un lien vers une
// autre page passe par pages.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PAGES = ["help-ui.js", "entities-ui.js", "dialogue-ui.js", "tours-ui.js"];
const BANNED = new Set([...PAGES, "panel.js"]);

for (const f of PAGES) {
  test(`${f} imports no other page module`, () => {
    const src = readFileSync(new URL(`../web/${f}`, import.meta.url), "utf8");
    const imported = [...src.matchAll(/^import\s[^;]*?from\s+"\.\/([^"]+)"/gm)].map(m => m[1]);
    assert.deepEqual(imported.filter(m => BANNED.has(m) && m !== f), []);
  });
}
