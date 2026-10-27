// Questions au lore : le visiteur pose une question, la recherche hybride choisit des textes, un modèle
// (avec la clé du visiteur) répond en les citant [n] ; les textes cités s'allument sur la carte.
import { S, $, panel, mode, esc, resetContext, focusPanel, docRow, isHidden, announce } from "./state.js";
import { draw, fitPoints } from "./render.js";
import { panelTop, bindPanelTop, select } from "./panel.js";
import { record } from "./nav.js";
import { lexicalRanking, hybridRanking } from "./search.js";
import { embedQuery } from "./search-ui.js";
import { searchQuery, growPool, systemPrompt, citations } from "./rag.js";
import { PROVIDERS, streamAnswer, LLMError } from "./llm.js";

const SETTINGS_KEY = "lore-map:llm", KEY_KEY = "lore-map:llm-key";

// la conversation de la visite : les textes donnés au modèle (numérotés une fois pour toutes) et les tours
const chat = { pool: [], turns: [], busy: null };   // turns : { question, text, cited, model, error }

// ------------------------------------------------------------------ réglages
function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch { /* stockage bloqué */ }
  let key = "";
  try { key = localStorage.getItem(KEY_KEY) || sessionStorage.getItem(KEY_KEY) || ""; } catch { /* idem */ }
  const provider = PROVIDERS[s.provider] ? s.provider : "anthropic";
  return { provider, model: s.model || PROVIDERS[provider].models[0] || "", key, remember: !!s.remember };
}

function saveSettings({ provider, model, key, remember }) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ provider, model, remember }));
    localStorage.removeItem(KEY_KEY);
    sessionStorage.removeItem(KEY_KEY);
    if (key) (remember ? localStorage : sessionStorage).setItem(KEY_KEY, key);
  } catch { /* stockage bloqué : la clé ne vaudra que pour cette page */ }
  memoryKey = key;
}
let memoryKey = "";   // si le stockage est bloqué
const settings = () => { const s = loadSettings(); return { ...s, key: s.key || memoryKey }; };

function modelField(provider, model) {
  const p = PROVIDERS[provider];
  if (p.models.length) {
    return `<select name="model">${p.models.map(m => `<option${m === model ? " selected" : ""}>${esc(m)}</option>`).join("")}</select>`;
  }
  return `<input name="model" required placeholder="Model name, as listed by ${esc(p.label.split(" ")[0])}" value="${esc(model)}" autocomplete="off" spellcheck="false">`;
}

function showSettings(note = "") {
  const s = settings();
  render(`<h2>Ask about the lore</h2>
    <p class="hint">Ask a question in any language: the map finds the texts that matter, and a language model answers
      from them, citing each text so you can read it. It runs with your own API key.</p>
    ${note ? `<p class="chat-error">${esc(note)}</p>` : ""}
    <form class="chat-settings">
      <label>Provider <select name="provider">${Object.entries(PROVIDERS).map(([id, p]) =>
        `<option value="${id}"${id === s.provider ? " selected" : ""}>${esc(p.label)}</option>`).join("")}</select></label>
      <label>Model <span class="model-field">${modelField(s.provider, s.model)}</span></label>
      <label>API key <input name="key" type="password" required autocomplete="off" spellcheck="false"
        placeholder="${esc(PROVIDERS[s.provider].keyHint)}" value="${esc(s.key)}"></label>
      <label class="check"><input name="remember" type="checkbox"${s.remember ? " checked" : ""}> Remember the key on this device</label>
      <p class="hint">The key stays in your browser and is sent only to the provider you chose. Questions are billed to your
        account. <a class="key-link" href="${PROVIDERS[s.provider].keyUrl}" target="_blank" rel="noopener">Get a key</a></p>
      <div class="chat-actions"><button type="submit">Save</button>
        ${s.key ? '<button type="button" class="forget">Forget the key</button>' : ""}</div>
    </form>`);
  const form = panel.querySelector(".chat-settings");
  form.provider.addEventListener("change", () => {
    const p = form.provider.value;
    panel.querySelector(".model-field").innerHTML = modelField(p, PROVIDERS[p].models[0] || "");
    form.key.placeholder = PROVIDERS[p].keyHint;
    panel.querySelector(".key-link").href = PROVIDERS[p].keyUrl;
  });
  form.addEventListener("submit", e => {
    e.preventDefault();
    saveSettings({ provider: form.provider.value, model: form.model.value.trim(), key: form.key.value.trim(),
      remember: form.remember.checked });
    showChat();
  });
  form.querySelector(".forget")?.addEventListener("click", () => {
    saveSettings({ ...settings(), key: "", remember: false });
    showSettings();
  });
  form.querySelector("input, select").focus();
}

// ------------------------------------------------------------------ conversation
function render(inner) {
  panel.hidden = false;
  panel.dataset.view = "chat";
  panel.innerHTML = `${panelTop()}<article class="card chat">${inner}</article>`;
  bindPanelTop();
}

// réponse du modèle : paragraphes, gras, et [n] en boutons vers les textes
function answerHtml(text) {
  const cite = n => {
    const i = chat.pool[n - 1];
    return i === undefined ? `${n}` : `<button type="button" class="cite" data-i="${i}" title="${esc(S.docs[i].name)}">${n}</button>`;
  };
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g, (_, list) => `<span class="cites">${list.split(",").map(part => {
      const [a, b = a] = part.split(/[–-]/).map(s => +s.trim());
      return Array.from({ length: Math.min(b, a + 20) - a + 1 }, (_, k) => cite(a + k)).join("");
    }).join("")}</span>`)
    .split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
}

function turnHtml(t, k) {
  const last = k === chat.turns.length - 1;
  const body = t.error ? `<p class="chat-error">${esc(t.error)}${t.errorKind === "key" || t.errorKind === "model"
      ? ' <button type="button" class="open-settings">Change settings</button>' : ""}</p>`
    : t.text ? answerHtml(t.text)
    : `<p class="chat-wait">${esc(t.status || "Thinking…")}</p>`;
  const sources = t.cited?.length ? `<details class="chat-sources"${last ? " open" : ""}><summary>Sources (${t.cited.length})</summary>
      <ol class="results">${t.cited.map(i => docRow(S.docs[i], esc(S.docs[i].name), "")).join("")}</ol></details>` : "";
  return `<li class="chat-turn"><p class="chat-q">${esc(t.question)}</p><div class="chat-a">${body}</div>${sources}</li>`;
}

function showChat() {
  const s = settings();
  if (!s.key || !s.model) { showSettings(); record({ view: "chat" }); return; }
  resetContext();
  S.selected = -1;
  const lastCited = chat.turns.findLast(t => t.cited?.length)?.cited;
  if (lastCited) S.lit = new Set(lastCited);
  const examples = (S.ui.chat_examples || []).map(q => `<button type="button" class="example">${esc(q)}</button>`).join("");
  render(`<h2>Ask about the lore</h2>
    <p class="chat-model">${esc(PROVIDERS[s.provider].label.split(" (")[0])} · ${esc(s.model)} ·
      <button type="button" class="open-settings">Settings</button>${chat.turns.length ? ' · <button type="button" class="new-chat">New conversation</button>' : ""}</p>
    ${chat.turns.length ? "" : `<p class="hint">Answers come from the game's texts, with numbered links to each one.${examples ? " For example:" : ""}</p>
      <div class="chat-examples">${examples}</div>`}
    <ol class="chat-turns">${chat.turns.map(turnHtml).join("")}</ol>
    <form class="chat-form">
      <textarea name="q" rows="2" placeholder="Ask a question about the lore…" aria-label="Your question"></textarea>
      <button type="submit">${chat.busy ? "Stop" : "Ask"}</button>
    </form>`);
  record({ view: "chat" });
  bindChat();
  panel.scrollTop = panel.scrollHeight;
  draw();
}

function bindChat() {
  const form = panel.querySelector(".chat-form");
  form.addEventListener("submit", e => {
    e.preventDefault();
    if (chat.busy) { chat.busy.abort(); return; }
    const q = form.q.value.trim();
    if (q) ask(q);
  });
  form.q.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });
  panel.querySelectorAll(".example").forEach(b => b.addEventListener("click", () => ask(b.textContent)));
  panel.querySelectorAll(".open-settings").forEach(b => b.addEventListener("click", () => showSettings()));
  panel.querySelector(".new-chat")?.addEventListener("click", () => {
    chat.busy?.abort();
    chat.pool = []; chat.turns = [];
    S.lit = null;
    showChat();
  });
  panel.querySelectorAll("button.cite, .chat-sources button[data-i]").forEach(b =>
    b.addEventListener("click", () => select(+b.dataset.i)));
  if (!chat.busy) form.q.focus();
}

// met à jour la conversation affichée (sans reconstruire le panneau s'il montre autre chose)
let frame = 0;
function refresh(k) {
  if (panel.hidden || panel.dataset.view !== "chat" || !panel.querySelector(".chat-turns")) return;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    const li = panel.querySelectorAll(".chat-turn")[k];
    if (!li) { showChat(); return; }
    const atBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 80;
    li.outerHTML = turnHtml(chat.turns[k], k);
    panel.querySelector(".chat-form button[type=submit]").textContent = chat.busy ? "Stop" : "Ask";
    panel.querySelectorAll(".chat-turn")[k].querySelectorAll("button.cite, .chat-sources button[data-i], .open-settings")
      .forEach(b => b.addEventListener("click", () => (b.classList.contains("open-settings") ? showSettings() : select(+b.dataset.i))));
    if (atBottom) panel.scrollTop = panel.scrollHeight;
  });
}

async function ask(question) {
  const s = settings();
  const history = chat.turns.filter(t => t.text && !t.error).flatMap(t => [
    { role: "user", content: t.question }, { role: "assistant", content: t.text }]);
  const turn = { question, text: "", status: "Looking for the texts that matter…" };
  chat.turns.push(turn);
  const k = chat.turns.length - 1;
  const ctrl = new AbortController();
  chat.busy = ctrl;
  showChat();
  try {
    // les textes : mots-clés tout de suite, puis par le sens si le modèle de recherche est disponible
    const q = searchQuery(question, history);
    let ranked = lexicalRanking(S.bm25, q);
    if (S.meta.semantic) {
      const before = mode.textContent;
      const qv = await embedQuery(q);
      if (qv) ranked = hybridRanking(ranked, qv, S.emb, S.meta.dim);
      // le premier appel charge le modèle de recherche et l'annonce sous la recherche : effacer ce message
      if (qv && mode.textContent.startsWith("Loading")) mode.textContent = before.startsWith("Loading") ? "" : before;
    }
    if (ctrl.signal.aborted) throw new DOMException("aborted", "AbortError");
    chat.pool = growPool(chat.pool, ranked, i => isHidden(S.docs[i]));
    turn.status = "Writing the answer…";
    refresh(k);
    const title = S.games.find(g => g.id === S.game)?.title || "the game";
    const { text, model } = await streamAnswer({
      provider: s.provider, model: s.model, key: s.key, signal: ctrl.signal,
      system: systemPrompt(title, chat.pool, S.docs, S.cats),
      messages: [...history, { role: "user", content: question }],
      onText: delta => { turn.text += delta; refresh(k); },
    });
    turn.text = text;
    turn.model = model;
    turn.cited = citations(text, chat.pool);
    if (turn.cited.length) {
      S.lit = new Set(turn.cited);
      if (panel.dataset.view === "chat") fitPoints(turn.cited.map(i => S.docs[i]), 0);
    }
    announce("Answer ready");
  } catch (err) {
    turn.text = turn.text || "";
    if (ctrl.signal.aborted) {
      turn.error = turn.text ? "" : "Stopped.";
    } else {
      turn.error = err instanceof LLMError ? err.message : "Something went wrong while answering.";
      turn.errorKind = err.kind;
      if (!(err instanceof LLMError)) console.warn(err);
    }
    if (turn.error && turn.text) turn.text = "";
  } finally {
    chat.busy = null;
    refresh(k);
    draw();
  }
}

export function openChat() { showChat(); focusPanel("Ask about the lore"); }
export { showChat };

$("#ask").addEventListener("click", openChat);
