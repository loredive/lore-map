// Seule la caméra (camera.js) tient ses nombres : aucun autre module ne les relit dans l'état partagé
// (S.cam, S.base, S.cy, S.top, S.W, S.H), ni ne refait le seuil du téléphone (isPhone, dans state.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const WEB = new URL("../web/", import.meta.url);
const OLD = /\bS\.(cam|base|cy|top|W|H)\b|innerWidth\s*<=\s*760/g;

test("no web module but camera.js reads the camera's numbers through S or redoes the phone width", () => {
  const found = readdirSync(WEB).filter(f => f.endsWith(".js") && f !== "camera.js").flatMap(f =>
    readFileSync(new URL(f, WEB), "utf8").split("\n").flatMap((line, n) =>
      [...line.matchAll(OLD)].map(m => `${f}:${n + 1}: ${m[0]}`)));
  assert.deepEqual(found, []);
});
