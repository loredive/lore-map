// Appels aux modèles avec la clé du visiteur, depuis le navigateur : la clé ne va qu'au fournisseur choisi.
// Anthropic par son SDK officiel (chargé à la demande) ; OpenAI et OpenRouter par leur API commune.

const ANTHROPIC_SDK = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.133.0/+esm";

export const PROVIDERS = {
  anthropic: {
    label: "Anthropic (Claude)", keyHint: "sk-ant-…", keyUrl: "https://platform.claude.com/",
    models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  },
  openai: {
    label: "OpenAI", keyHint: "sk-…", keyUrl: "https://platform.openai.com/api-keys",
    base: "https://api.openai.com/v1", models: ["gpt-6.1-sol", "gpt-6.1-terra"],
  },
  openrouter: {
    label: "OpenRouter (many models, some free)", keyHint: "sk-or-…", keyUrl: "https://openrouter.ai/keys",
    base: "https://openrouter.ai/api/v1",
    models: ["anthropic/claude-opus-5.5", "openai/gpt-6.1-sol", "google/gemini-4-argon", "deepseek/deepseek-v4.1-flash"],
    other: "Any model listed on openrouter.ai/models, including the free ones ending in :free.",
  },
};

// kind : "key" (clé refusée), "rate" (limite atteinte), "model" (modèle inconnu), "network",
// "refusal" (le modèle a décliné), "other"
export class LLMError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

// Réponse en continu : onText reçoit chaque morceau ; renvoie { text, model } (le modèle qui a répondu).
export async function streamAnswer({ provider, model, key, system, messages, onText, signal }) {
  if (provider === "anthropic") return anthropicAnswer({ model, key, system, messages, onText, signal });
  const base = PROVIDERS[provider]?.base;
  if (!base) throw new LLMError("other", `Unknown provider: ${provider}`);
  return openaiAnswer({ base, model, key, system, messages, onText, signal });
}

// ------------------------------------------------------------------ Anthropic
let sdk = null;
async function anthropicAnswer({ model, key, system, messages, onText, signal }) {
  try { sdk ||= (await import(ANTHROPIC_SDK)).default; }
  catch { throw new LLMError("network", "Could not load the Anthropic SDK."); }
  const Anthropic = sdk;
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1 });
  // Opus et Sonnet : si le modèle décline, l'API relance la question sur un modèle de repli
  const fallback = model.startsWith("claude-opus-") || model.startsWith("claude-sonnet-");
  const params = {
    model, max_tokens: 64000, system, messages,
    output_config: { effort: "medium" },
    ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
  };
  try {
    const stream = client.beta.messages.stream(params, { signal });
    let text = "";
    stream.on("text", delta => { text += delta; onText(delta); });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new LLMError("refusal", "The model declined to answer this question.");
    return { text, model: msg.model };
  } catch (err) {
    if (err instanceof LLMError) throw err;
    if (err instanceof Anthropic.APIUserAbortError) throw err;
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
      throw new LLMError("key", "The API key was refused.");
    if (err instanceof Anthropic.NotFoundError) throw new LLMError("model", `Unknown model: ${model}.`);
    if (err instanceof Anthropic.RateLimitError) throw new LLMError("rate", "Rate limit reached: wait a moment and try again.");
    if (err instanceof Anthropic.APIConnectionError) throw new LLMError("network", "Could not reach Anthropic.");
    if (err instanceof Anthropic.APIError) throw new LLMError("other", err.message);
    throw err;
  }
}

// ------------------------------------------------------------------ OpenAI et compatibles
async function openaiAnswer({ base, model, key, system, messages, onText, signal }) {
  let r;
  try {
    r = await fetch(`${base}/chat/completions`, {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, stream: true, messages: [{ role: "system", content: system }, ...messages] }),
    });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new LLMError("network", "Could not reach the provider.");
  }
  if (!r.ok) {
    const detail = await r.json().then(j => j.error?.message || "").catch(() => "");
    if (r.status === 401 || r.status === 403) throw new LLMError("key", "The API key was refused.");
    if (r.status === 404) throw new LLMError("model", detail || `Unknown model: ${model}.`);
    if (r.status === 429) throw new LLMError("rate", "Rate limit reached: wait a moment and try again.");
    throw new LLMError("other", detail || `The provider answered ${r.status}.`);
  }
  const reader = r.body.getReader(), decoder = new TextDecoder();
  let buf = "", text = "", served = model;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      const chunk = readChunk(line);
      if (!chunk) continue;
      if (chunk.error) throw new LLMError("other", chunk.error);
      served = chunk.model || served;
      if (chunk.text) { text += chunk.text; onText(chunk.text); }
    }
  }
  return { text, model: served };
}

// Une ligne du flux SSE : { text, model } ou { error }, ou null (commentaire, fin, ligne vide).
export function readChunk(line) {
  if (!line.startsWith("data:")) return null;
  const data = line.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  let j;
  try { j = JSON.parse(data); } catch { return null; }
  if (j.error) return { error: j.error.message || "The provider reported an error." };
  return { text: j.choices?.[0]?.delta?.content || "", model: j.model };
}
