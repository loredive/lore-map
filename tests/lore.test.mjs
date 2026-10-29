// Le décodage de lore.json, sur les fixtures écrites par lore_format.write_lore (tests/test_lore_fixtures.py)
// et sur les deux cartes publiées : la couture Python ↔ page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeLore } from "../web/lore.js";
import { shelves, SHELVES } from "../web/shelves.js";

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const full = () => read("./fixtures/lore-full.json");
const plain = () => read("./fixtures/lore-plain.json");

test("a doc has every field, its views and the shelves position last", () => {
  const L = decodeLore(full());
  const pos = shelves(L.docs, 2).pos;
  assert.deepEqual(L.docs[0], {
    i: 0, name: "Épée de Lune", cat: 0, text: "Ligne 0\n« citée » é", jp: "テキスト0", jpName: "名前0",
    alt: "Texte 0 (fr)", altName: "Nom 0 (fr)", dlc: false,
    views: [[0.1, 0.2], [-0.3, 0.4], pos[0]], x: 0.1, y: 0.2, cluster: 0, echoes: [1, 2], echoedBy: 5,
  });
  assert.equal(L.docs[6].dlc, true);
  assert.deepEqual([L.docs[3].alt, L.docs[3].altName], ["", ""]);
  assert.equal(L.docs[7].cluster, -1);
  assert.deepEqual(L.docs.map(d => d.i), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test("echoedBy counts the texts that list a doc among their echoes", () => {
  assert.deepEqual(decodeLore(plain()).docs.map(d => d.echoedBy), [5, 2, 2, 0, 3, 2, 1, 1]);
});

test("clusters come biggest first, placed on the first view, with the shelves view last", () => {
  const L = decodeLore(full());
  assert.deepEqual(L.clusters.map(c => c.id), [0, 1]);
  const big = L.clusters[0], S = shelves(L.docs, 2).clusters;
  assert.deepEqual(big, {
    id: 0, label: "Les armes", description: "Des lames et un arc.", keywords: "Lame, Arc", n: 4,
    views: [{ x: 0.11, y: 0.21, cohesion: 0.75 }, { x: -0.31, y: 0.41, cohesion: 1.0 }, S.get(0)],
    x: 0.11, y: 0.21,
  });
  assert.equal(L.clusters[1].altLabel, "The Doll");
  assert.equal(L.clusters[1].altDescription, "Gehrman, Maria and the Doll.");
  assert.equal(decodeLore(plain()).clusters[1].altLabel, undefined);
});

test("entities come most cited first, and docEntities lists each text's", () => {
  const L = decodeLore(full());
  assert.deepEqual(L.entities.map(e => e.name), ["Gehrman", "Maria"]);
  assert.deepEqual(L.entities[0], { name: "Gehrman", label: "Gehrman", kind: "personnage", aliases: [],
    docs: [4, 5, 6], broad: false, related: [["Maria", 1]] });
  assert.deepEqual(L.docEntities.map(es => es.map(e => e.name)), [[], [], [], [], ["Gehrman"], ["Gehrman", "Maria"], ["Gehrman"], []]);
  assert.equal(L.docEntities[5][0], L.entities[0]);
});

test("the shelves layout is appended to views, with its index, columns and cell", () => {
  const L = decodeLore(full());
  assert.deepEqual(L.views, ["t-SNE", "UMAP", SHELVES]);
  const ref = shelves(L.docs, 2);
  assert.deepEqual(L.shelves, { k: 2, columns: ref.columns, cell: ref.cell });
  assert.deepEqual(L.categories, ["Armes", "Dialogues"]);
  for (const d of L.docs) assert.equal(d.views.length, 3);
  for (const c of L.clusters) assert.equal(c.views.length, 3);
});

test("optional fields default: no alt, no dlc, no entities", () => {
  const json = plain();
  delete json.entities;
  const L = decodeLore(json);
  for (const d of L.docs) assert.deepEqual([d.alt, d.altName, d.dlc], ["", "", false]);
  assert.deepEqual(L.entities, []);
  assert.deepEqual(L.docEntities, L.docs.map(() => []));
});

test("the file read is left as it was", () => {
  const json = full(), before = JSON.stringify(json);
  decodeLore(json);
  assert.equal(JSON.stringify(json), before);
});

test("a missing required field throws an error naming it", () => {
  for (const k of ["fields", "views", "categories", "clusters", "docs"]) {
    const json = full();
    delete json[k];
    assert.throws(() => decodeLore(json), { message: `lore.json: missing required field "${k}"` });
  }
  for (const f of ["name", "cat", "text", "jp", "jpName", "xy", "cluster", "echoes"]) {
    const json = full();
    json.fields = json.fields.filter(x => x !== f);
    assert.throws(() => decodeLore(json), { message: `lore.json: missing required field "${f}"` });
  }
  const json = full();
  delete json.clusters[1].views;
  assert.throws(() => decodeLore(json), { message: 'lore.json: missing required field "clusters[1].views"' });
});

for (const [game, docs, clusters, entities, alt, dlc] of [
  ["bloodborne", 591, 28, 72, true, true], ["elden-ring", 3049, 64, 126, false, false]]) {
  test(`the published ${game} map decodes`, () => {
    const L = decodeLore(read(`../web/data/${game}/lore.json`));
    assert.deepEqual([L.docs.length, L.clusters.length, L.entities.length], [docs, clusters, entities]);
    assert.deepEqual(L.views, ["t-SNE", SHELVES]);
    assert.equal(L.docs.some(d => d.alt !== ""), alt);
    assert.equal(L.docs.some(d => d.dlc), dlc);
    for (const d of L.docs) assert.ok(d.views.length === 2 && d.views.every(p => p.every(Number.isFinite)));
    for (const c of L.clusters) assert.ok(c.views.length === 2 && Number.isFinite(c.x));
    for (let j = 1; j < L.clusters.length; j++) assert.ok(L.clusters[j - 1].n >= L.clusters[j].n);
    assert.equal(L.docs.reduce((s, d) => s + d.echoedBy, 0), L.docs.reduce((s, d) => s + d.echoes.length, 0));
  });
}
