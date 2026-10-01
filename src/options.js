const keyEl = document.getElementById("key");
const modelEl = document.getElementById("model");
const statusEl = document.getElementById("status");

chrome.storage.local.get({ apiKey: "", model: "gpt-4o-mini" }, (s) => {
  keyEl.value = s.apiKey;
  modelEl.value = s.model;
});

document.getElementById("save").addEventListener("click", async () => {
  await chrome.storage.local.set({ apiKey: keyEl.value.trim(), model: modelEl.value });
  statusEl.textContent = "Guardado ✓";
  setTimeout(() => (statusEl.textContent = ""), 1500);
});
