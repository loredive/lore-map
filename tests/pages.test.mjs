// Le module des pages, par son interface seulement : des sortes de pages factices, un panneau
// factice et un historique de navigateur factice (pas de DOM).
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerPage, startPages, openPage, rerenderPage, closePage, currentPage, backLabel, goBack, openFromAddress, stepOf, pageOfStep, openStep, onStep } from "../web/pages.js";

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
function start() {
  const log = [];
  const panel = { hidden: true, dataset: {}, innerHTML: "", scrollTop: 0 };
  const browser = fakeBrowser();
  startPages({
    panel, browser,
    clearSearch: () => log.push("clear search"),
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
  assert.equal(panel.dataset.page, "list");
  assert.equal(panel.innerHTML, "<top ->" + "<h2>List</h2>");
  assert.equal(panel.bound, true);
  openPage("note", { id: "a" });
  assert.deepEqual(urls(), ["/", "#note=a"]);
  assert.deepEqual(currentPage(), { page: "note", id: "a", q: "" });
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
  assert.deepEqual(currentPage(), { page: "find", q: "blo" });
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
  assert.equal(panel.dataset.page, "note");
  assert.deepEqual(currentPage(), { page: "note", id: "a", q: "" });
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

test("a page can frame the camera itself, but not on re-render or when asked not to fly", () => {
  const { log } = start();
  const framed = [];
  registerPage({ name: "route", render: a => ({ html: "<h2>Route</h2>", frame: () => framed.push(a.id) }) });
  openPage("route", { id: "a" });
  assert.deepEqual(framed, ["a"]);
  assert.ok(!log.some(x => x.startsWith("frame")));   // pas le cadrage commun
  rerenderPage();
  openPage("route", { id: "b" }, { fly: false });
  assert.deepEqual(framed, ["a"]);
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
  assert.equal(panel.dataset.page, "");
  assert.deepEqual(currentPage(), { page: "none", q: "" });
  assert.equal(backLabel(), "Back to note a");
  goBack();
  assert.equal(panel.hidden, false);
  assert.equal(panel.dataset.page, "note");
});

test("an address is read back to its page, old aliases included", () => {
  start();
  assert.equal(openFromAddress("#note=x%20y"), true);
  assert.deepEqual(currentPage(), { page: "note", id: "x y", q: "" });
  openFromAddress("#notiz=z");
  assert.deepEqual(currentPage(), { page: "note", id: "z", q: "" });
});

test("an unknown address is ignored", () => {
  const { panel } = start();
  assert.equal(openFromAddress("#nothing=here"), false);
  assert.equal(openFromAddress(""), false);
  assert.equal(panel.hidden, true);
  assert.equal(currentPage(), null);
});

test("an address with a known key but an unknown value opens nothing", () => {
  const { panel } = start();
  registerPage({ name: "shelf", address: { keys: ["shelf"], read: v => (v === "top" ? { at: v } : null) }, render: () => ({ html: "" }) });
  assert.equal(openFromAddress("#shelf=nope"), false);
  assert.equal(panel.hidden, true);
  assert.equal(currentPage(), null);
  assert.equal(openFromAddress("#shelf=top"), true);
});

test("a History step maps to its page and back", () => {
  start();
  assert.deepEqual(stepOf({ page: "note", id: "a", q: "" }), { kind: "page", key: "a" });
  assert.deepEqual(stepOf({ page: "list", q: "" }), { kind: "page", key: "list" });
  assert.equal(stepOf({ page: "find", q: "x" }), null);
  assert.deepEqual(pageOfStep({ kind: "page", key: "a" }), { page: "note", id: "a" });
  assert.equal(pageOfStep({ kind: "page", key: "gone" }), null);
  assert.equal(pageOfStep({ kind: "other", key: "a" }), null);
});

test("a History step reopens its page as a new entry", () => {
  const { urls } = start();
  openPage("list");
  openStep({ kind: "page", key: "b" });
  assert.deepEqual(currentPage(), { page: "note", id: "b", q: "" });
  assert.deepEqual(urls(), ["/", "#note=b"]);
  assert.equal(backLabel(), "Back to the list");
  openStep({ kind: "page", key: "gone" });          // un pas dont la page n'existe plus : rien
  assert.deepEqual(currentPage(), { page: "note", id: "b", q: "" });
});

test("a page can send the reader to another page instead", () => {
  start();
  registerPage({ name: "pick", divert: a => (a.n > 1 ? { page: "note", id: `from ${a.n}` } : null),
    render: a => ({ html: `<h2>${a.n}</h2>` }) });
  openPage("pick", { n: 1 });
  assert.deepEqual(currentPage(), { page: "pick", n: 1, q: "" });
  openPage("pick", { n: 2 });
  assert.deepEqual(currentPage(), { page: "note", id: "from 2", q: "" });
});

test("each page opened, Back included, reports its History step", () => {
  start();
  const seen = [];
  onStep(s => seen.push(s));
  openPage("note", { id: "a" });
  openPage("find", { q: "x" });
  goBack();
  assert.deepEqual(seen, [{ kind: "page", key: "a" }, null, { kind: "page", key: "a" }]);
  onStep(() => {});
});

test("a page can clear the search when opened, but not on re-render", () => {
  const { log } = start();
  registerPage({ name: "trace", clearsSearch: true, render: () => ({ html: "<h2>Trace</h2>" }) });
  openPage("trace");
  assert.equal(log.filter(x => x === "clear search").length, 1);
  rerenderPage();
  assert.equal(log.filter(x => x === "clear search").length, 1);
});

test("what a page does on opening is not done again on re-render", () => {
  start();
  const opened = [];
  registerPage({ name: "walk", onOpen: a => opened.push(a.id), render: a => ({ html: `<h2>${a.id}</h2>` }) });
  openPage("walk", { id: "a" });
  rerenderPage();
  assert.deepEqual(opened, ["a"]);
  goBack();                                         // pas de page avant : rien
  openPage("list");
  goBack();                                         // rouverte par Retour : c'est une ouverture
  assert.deepEqual(opened, ["a", "a"]);
});

test("re-render with no page open does nothing", () => {
  const { log, urls } = start();
  rerenderPage();
  assert.deepEqual(log, []);
  assert.deepEqual(urls(), ["/"]);
});

test("re-render keeps the panel's scroll position, even when the page scrolls itself on open", () => {
  const { panel } = start();
  registerPage({ name: "script", render: () => ({ html: "<h2>Script</h2>", bind: p => { p.scrollTop = 500; } }) });
  openPage("list");
  panel.scrollTop = 120;
  rerenderPage();
  assert.equal(panel.scrollTop, 120);
  openPage("script");
  assert.equal(panel.scrollTop, 500);              // ouverte : elle défile jusqu'à son passage
  panel.scrollTop = 80;
  rerenderPage();
  assert.equal(panel.scrollTop, 80);
});

test("a page is told which page the reader came from, on opening and on Back", () => {
  start();
  const from = [];
  registerPage({ name: "stop", render: (a, how) => { from.push(how.from && { ...how.from }); return { html: `<h2>${a.id}</h2>` }; } });
  openPage("stop", { id: "a" });
  openPage("list");
  openPage("stop", { id: "b" });
  goBack();                                         // Retour à la liste : pas une page « stop »
  goBack();                                         // Retour à « a », depuis la liste
  assert.deepEqual(from, [null, { page: "list", q: "" }, { page: "list", q: "" }]);
  from.length = 0;
  openPage("stop", { id: "c" });
  openPage("stop", { id: "d" });
  assert.deepEqual(from, [{ page: "stop", id: "a", q: "" }, { page: "stop", id: "c", q: "" }]);
});
