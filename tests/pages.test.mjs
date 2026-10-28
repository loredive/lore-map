// Le module des pages, par son interface seulement : des sortes de pages factices, un panneau
// factice et un historique de navigateur factice (pas de DOM).
import { test } from "node:test";
import assert from "node:assert/strict";
import { record } from "../web/nav.js";
import { registerPage, startPages, openPage, rerenderPage, closePage, currentPage, backLabel, goBack, openFromAddress, stepOf, pageOfStep } from "../web/pages.js";

// historique du navigateur : une liste d'adresses, Retour prévient l'écouteur comme popstate
function fakeBrowser() {
  const entries = [{ state: null, url: "/" }];
  let at = 0, listener = null;
  return {
    entries,
    push(state, url) { entries.splice(at + 1); entries.push({ state, url }); at++; },
    replace(state, url) { entries[at] = { state, url }; },
    back() { if (at > 0) { at--; listener?.(entries[at].state); } },
    href: () => entries[at].url,
    plain: () => "/",
    onPop(f) { listener = f; },
  };
}

// démarre le module avec des faux, et note ce que chaque appel a fait
function start(fallback = {}) {
  const log = [];
  const panel = { hidden: true, dataset: {}, innerHTML: "", scrollTop: 0 };
  const browser = fakeBrowser();
  startPages({
    panel, browser, fallback,
    query: () => "",
    resetFocus: () => log.push("reset"),
    top: label => `<top ${label ?? "-"}>`,
    bindTop: () => log.push("bindTop"),
    focus: msg => log.push(`focus ${msg}`),
    frame: stars => log.push(`frame ${stars}`),
    draw: () => log.push("draw"),
  });
  return { log, panel, browser, urls: () => browser.entries.map(e => e.url) };
}

registerPage({
  name: "note",
  address: { write: a => "#note=" + encodeURIComponent(a.id), keys: ["note", "notiz"], read: v => ({ id: v }) },
  backLabel: a => `Back to note ${a.id}`,
  keepsFocus: true,
  step: a => ({ kind: "page", key: a.id }),
  fromStep: { kind: "page", page: key => key === "gone" ? null : { id: key } },
  render: a => ({ html: `<h2>${a.id}</h2>`, announce: `Note ${a.id}`, frame: [a.id] }),
});
registerPage({
  name: "list",
  backLabel: () => "Back to the list",
  step: () => ({ kind: "page", key: "list" }),         // compte comme la note « list », comme une étape de visite
  render: () => ({ html: "<h2>List</h2>", announce: "List", bind: p => { p.bound = true; } }),
});
registerPage({
  name: "find",
  replacesPrevious: true,
  address: {},
  backLabel: a => `Back to the results for “${a.q}”`,
  render: a => ({ html: `<h2>${a.q}</h2>` }),
});
registerPage({ name: "none", panel: false, backLabel: () => null, render: () => ({}) });

test("opening a page records it once, with its address, and runs the opening sequence", () => {
  const { log, panel, urls } = start();
  openPage("list");
  assert.deepEqual(log, ["reset", "bindTop", "focus List", "draw"]);
  assert.equal(panel.hidden, false);
  assert.equal(panel.dataset.view, "list");
  assert.equal(panel.innerHTML, "<top ->" + "<h2>List</h2>");
  assert.equal(panel.bound, true);
  openPage("note", { id: "a" });
  assert.deepEqual(urls(), ["/", "#note=a"]);
  assert.deepEqual(currentPage(), { view: "note", id: "a", q: "" });
  assert.equal(panel.innerHTML, "<top Back to the list><h2>a</h2>");
  assert.deepEqual(log.slice(4), ["bindTop", "focus Note a", "frame a", "draw"]);   // garde le focus
});

test("opening the same page twice replaces it instead of stacking", () => {
  const { urls } = start();
  openPage("list");
  openPage("note", { id: "a" });
  openPage("note", { id: "a" });
  assert.deepEqual(urls(), ["/", "#note=a"]);
  assert.equal(backLabel(), "Back to the list");
  openPage("note", { id: "b" });
  assert.deepEqual(urls(), ["/", "#note=a", "#note=b"]);
});

test("a page that replaces the previous one of its kind does so whatever its arguments", () => {
  const { urls } = start();
  openPage("note", { id: "a" });
  openPage("find", { q: "b" });
  openPage("find", { q: "bl" });
  openPage("find", { q: "blo" });
  assert.deepEqual(urls(), ["#note=a", "/"]);
  assert.deepEqual(currentPage(), { view: "find", q: "blo" });
  assert.equal(backLabel(), "Back to note a");
});

test("Back reopens the previous page without recording it, and names it", () => {
  const { panel, urls, log } = start();
  assert.equal(backLabel(), null);
  goBack();                                       // rien avant : Retour ne fait rien
  assert.equal(panel.hidden, true);
  openPage("note", { id: "a" });
  assert.equal(backLabel(), null);                // premier pas : pas de « Retour à »
  openPage("list");
  assert.equal(backLabel(), "Back to note a");
  log.length = 0;
  goBack();
  assert.equal(panel.dataset.view, "note");
  assert.deepEqual(currentPage(), { view: "note", id: "a", q: "" });
  assert.deepEqual(urls(), ["#note=a", "/"]);     // rien d'enregistré : l'entrée suivante reste
  assert.equal(backLabel(), null);
  assert.ok(log.includes("frame a"));
});

test("the first entry replaces the load entry", () => {
  const { urls } = start();
  openPage("note", { id: "a" });
  assert.deepEqual(urls(), ["#note=a"]);          // Retour depuis elle quitte le site (voulu)
});

test("re-render redraws in place: no record, no framing, no focus move", () => {
  const { log, panel, urls } = start();
  openPage("list");
  openPage("note", { id: "a" });
  panel.innerHTML = "";
  log.length = 0;
  rerenderPage();
  assert.equal(panel.innerHTML, "<top Back to the list><h2>a</h2>");
  assert.deepEqual(log, ["bindTop", "draw"]);
  assert.deepEqual(urls(), ["/", "#note=a"]);
});

test("a page keeps the focus only if it says so", () => {
  const { log } = start();
  openPage("note", { id: "a" });
  assert.ok(!log.includes("reset"));
  openPage("list");
  assert.equal(log.filter(x => x === "reset").length, 1);
});

test("closing is an entry that Back undoes", () => {
  const { panel } = start();
  openPage("note", { id: "a" });
  closePage();
  assert.equal(panel.hidden, true);
  assert.equal(panel.dataset.view, "");
  assert.deepEqual(currentPage(), { view: "none", q: "" });
  assert.equal(backLabel(), "Back to note a");
  goBack();
  assert.equal(panel.hidden, false);
  assert.equal(panel.dataset.view, "note");
});

test("an address is read back to its page, old aliases included", () => {
  start();
  assert.equal(openFromAddress("#note=x%20y"), true);
  assert.deepEqual(currentPage(), { view: "note", id: "x y", q: "" });
  openFromAddress("#notiz=z");
  assert.deepEqual(currentPage(), { view: "note", id: "z", q: "" });
});

test("an unknown address is ignored", () => {
  const { panel } = start();
  assert.equal(openFromAddress("#nothing=here"), false);
  assert.equal(openFromAddress(""), false);
  assert.equal(panel.hidden, true);
  assert.equal(currentPage(), null);
});

test("page kinds not registered go through the old code", () => {
  const reopened = [];
  const { urls } = start({
    address: e => "#old=" + e.n,
    backLabel: e => `Back to old ${e.n}`,
    reopen: e => reopened.push(e),
    // l'ancien code enregistre lui-même sa page, par la navigation
    readAddress: hash => hash.startsWith("#old=") && (record({ view: "old", n: hash.slice(5) }), true),
  });
  assert.equal(openFromAddress("#old=3"), true);
  openPage("note", { id: "a" });
  assert.deepEqual(urls(), ["#old=3", "#note=a"]);
  assert.equal(backLabel(), "Back to old 3");
  goBack();
  assert.deepEqual(reopened, [{ view: "old", n: "3", q: "" }]);
});

test("opening a page kind not registered yet hands it to the old code", () => {
  const reopened = [];
  start({ reopen: e => reopened.push(e) });
  openPage("old", { n: 4 });
  assert.deepEqual(reopened, [{ view: "old", n: 4 }]);
});

let framed = 0;
registerPage({ name: "framer", render: () => ({ html: "<h2>F</h2>", frame: () => framed++ }) });

test("a page can frame the camera itself, and not when re-rendered", () => {
  const { log } = start();
  framed = 0;
  openPage("framer");
  assert.equal(framed, 1);
  assert.ok(!log.some(x => x.startsWith("frame ")));
  rerenderPage();
  assert.equal(framed, 1);
});

test("a History step maps to its page and back", () => {
  start();
  assert.deepEqual(stepOf({ view: "note", id: "a", q: "" }), { kind: "page", key: "a" });
  assert.deepEqual(stepOf({ view: "list", q: "" }), { kind: "page", key: "list" });
  assert.equal(stepOf({ view: "find", q: "x" }), null);
  assert.deepEqual(pageOfStep({ kind: "page", key: "a" }), { view: "note", id: "a" });
  assert.equal(pageOfStep({ kind: "page", key: "gone" }), null);
  assert.equal(pageOfStep({ kind: "other", key: "a" }), null);
});
