import { getSettings, saveSettings, DEFAULTS } from "./api.js";
import { initTheme, themeSwitch } from "./theme.js";

const $ = (id) => document.getElementById(id);
const els = {
  apiKey: $("apiKey"), baseUrl: $("baseUrl"), defaultTags: $("defaultTags"),
  defaultCc: $("defaultCc"), themeSlot: $("themeSlot"),
  attestConsent: $("attestConsent"), test: $("test"), testResult: $("testResult"),
  save: $("save"), saveResult: $("saveResult"),
};

async function load() {
  const s = await getSettings();
  els.apiKey.value = s.apiKey || "";
  els.baseUrl.value = s.baseUrl || DEFAULTS.baseUrl;
  els.defaultTags.value = (s.defaultTags || DEFAULTS.defaultTags).join(", ");
  els.defaultCc.value = s.defaultCc || DEFAULTS.defaultCc;
  els.attestConsent.checked = !!s.attestConsent;
}

function pill(el, kind, text) {
  el.hidden = false;
  el.className = `pill ${kind}`;
  el.textContent = text;
}

async function persist() {
  await saveSettings({
    apiKey: els.apiKey.value.trim(),
    baseUrl: els.baseUrl.value.trim().replace(/\/+$/, "") || DEFAULTS.baseUrl,
    defaultTags: els.defaultTags.value.split(",").map(t => t.trim()).filter(Boolean),
    defaultCc: els.defaultCc.value.replace(/\D/g, "") || DEFAULTS.defaultCc,
    attestConsent: els.attestConsent.checked,
  });
}

els.save.addEventListener("click", async () => {
  await persist();
  await load();                          // show the cleaned-up values back
  els.saveResult.hidden = false;
  setTimeout(() => (els.saveResult.hidden = true), 1800);
});

els.test.addEventListener("click", async () => {
  await persist();                       // test what's on screen
  pill(els.testResult, "ok", "Checking…");
  els.testResult.className = "pill";
  const res = await new Promise((r) => chrome.runtime.sendMessage({ type: "WHOAMI" }, r));
  if (res?.ok) pill(els.testResult, "ok", `Connected — ${res.data?.workspace || "workspace"}${res.data?.plan ? ` (${res.data.plan})` : ""}`);
  else if (res?.status === 401) pill(els.testResult, "bad", "Key rejected — check it's copied in full and not revoked.");
  else pill(els.testResult, "bad", res?.error || "Couldn't reach the workspace.");
});

// The theme switch saves on click — it's a preference, not part of the form.
(async () => {
  const mode = await initTheme();
  els.themeSlot.append(themeSwitch({ mode }));
})();
load();
