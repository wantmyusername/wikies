const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "chat") {
    handleChat(msg.payload)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
    return true;
  }
  if (msg && msg.type === "openOptions") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }
});

async function handleChat(payload) {
  const store = await chrome.storage.local.get({ apiKey: "", model: "gpt-4o-mini" });
  const apiKey = store.apiKey;
  if (!apiKey) {
    return { ok: false, error: "Falta la API key de OpenAI. Ábrela en Opciones (clic derecho en la extensión)." };
  }

  const model = (payload && payload.model) || store.model || "gpt-4o-mini";
  const body = {
    model,
    messages: payload.messages,
    temperature: 0.2,
    max_tokens: payload.max_tokens || 4096,
  };
  if (payload.json) body.response_format = { type: "json_object" };

  if (/^gpt-5/.test(model)) {
    body.max_completion_tokens = body.max_tokens;
    delete body.max_tokens;
    delete body.temperature;
  }

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text();
    return { ok: false, error: "OpenAI " + res.status + ": " + t.slice(0, 400) };
  }
  const data = await res.json();
  const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
  return { ok: true, content };
}
