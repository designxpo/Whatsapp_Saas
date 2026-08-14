import { getSettings } from "./api.js";
import { parseSelection, waClickToChatUrl, qrImageUrl, normalizePhone, sourceLabel } from "./wa.js";

const $ = (id) => document.getElementById(id);
const els = {
  status: $("status"), name: $("name"), phone: $("phone"), email: $("email"),
  tags: $("tags"), consent: $("consent"), source: $("source"), tagHint: $("tagHint"),
  submit: $("submit"), result: $("result"), quick: $("quick"),
  openWa: $("openWa"), copyWa: $("copyWa"), qr: $("qr"),
  grab: $("grab"), inbox: $("inbox"), opts: $("opts"), form: $("lead"),
};

let currentTab = null;

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function readSelection(tabId) {
  try {
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => String(window.getSelection?.() ?? ""),
    });
    return result || "";
  } catch { return ""; }         // chrome://, web store, or restricted pages
}

function send(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

function showResult(kind, text) {
  els.result.hidden = false;
  els.result.className = `result ${kind}`;
  els.result.textContent = text;
}

async function refreshTagHint() {
  const { defaultTags } = await getSettings();
  let host = "";
  try { host = currentTab?.url ? new URL(currentTab.url).hostname : ""; } catch { /* ignore */ }
  const auto = [...(defaultTags || []), "web-capture", ...(host ? [`source:${sourceLabel(host)}`] : [])];
  els.tagHint.textContent = `Auto-added: ${auto.join(", ")}`;
}

function updateQuickActions() {
  const { digits } = normalizePhone(els.phone.value);
  const ok = digits.length >= 8;
  els.quick.hidden = !ok;
  if (!ok) return;
  const url = waClickToChatUrl(digits, els.name.value ? `Hi ${els.name.value.split(" ")[0]}, ` : "");
  els.openWa.dataset.url = url;
  els.copyWa.dataset.url = url;
  if (els.qr.dataset.for !== digits) { els.qr.dataset.for = digits; els.qr.src = qrImageUrl(url, 180); }
}

async function checkConnection() {
  const res = await send({ type: "WHOAMI" });
  if (res?.ok) {
    els.status.textContent = `● ${res.data?.workspace || "Connected"}`;
    els.status.className = "status ok";
    els.status.title = `Connected to ${res.data?.workspace || "your workspace"}${res.data?.plan ? ` · ${res.data.plan}` : ""}`;
  } else {
    els.status.textContent = res?.status === 401 ? "Key invalid — fix" : "Not connected — set key";
    els.status.className = "status bad";
    els.status.title = res?.error || "Open settings to paste your API key";
  }
}

async function prefillFromPage() {
  currentTab = await activeTab();
  if (currentTab?.url) {
    els.source.hidden = false;
    els.source.textContent = `From: ${currentTab.url}`;
  }
  await refreshTagHint();
  const sel = currentTab?.id ? await readSelection(currentTab.id) : "";
  if (sel.trim()) applyParsed(parseSelection(sel));
  updateQuickActions();
}

function applyParsed(p) {
  if (p.name && !els.name.value) els.name.value = p.name;
  if (p.phone && !els.phone.value) els.phone.value = p.phone;
  if (p.email && !els.email.value) els.email.value = p.email;
  updateQuickActions();
}

// Events ----------------------------------------------------------------------

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const phone = els.phone.value.trim();
  if (!phone) { showResult("bad", "A phone number is required."); return; }
  els.submit.disabled = true;
  els.submit.textContent = "Adding…";
  const res = await send({
    type: "ADD_LEAD",
    payload: {
      phone,
      name: els.name.value.trim(),
      email: els.email.value.trim(),
      tags: els.tags.value.split(",").map(t => t.trim()).filter(Boolean),
      sourceUrl: currentTab?.url || "",
      consent: els.consent.checked,
    },
  });
  els.submit.disabled = false;
  els.submit.textContent = "Add to Talko";
  if (res?.ok) {
    const inserted = res.data?.inserted;
    showResult("ok", inserted === 0 ? "Already in Talko — nothing changed." : "Lead added to Talko ✓");
    updateQuickActions();
  } else {
    showResult("bad", res?.error || "Couldn't add the lead.");
  }
});

els.phone.addEventListener("input", updateQuickActions);
els.name.addEventListener("input", updateQuickActions);

els.openWa.addEventListener("click", () => {
  if (els.openWa.dataset.url) chrome.tabs.create({ url: els.openWa.dataset.url });
});
els.copyWa.addEventListener("click", async () => {
  if (!els.copyWa.dataset.url) return;
  await navigator.clipboard.writeText(els.copyWa.dataset.url).catch(() => {});
  els.copyWa.textContent = "Copied ✓";
  setTimeout(() => (els.copyWa.textContent = "Copy chat link"), 1500);
});

els.grab.addEventListener("click", async () => {
  const tab = currentTab || await activeTab();
  const sel = tab?.id ? await readSelection(tab.id) : "";
  if (sel.trim()) { applyParsed(parseSelection(sel)); showResult("ok", "Pulled the selection in — check the fields."); }
  else showResult("bad", "Nothing is selected on the page.");
});

els.inbox.addEventListener("click", async () => {
  try {
    const win = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: win.id });
    window.close();
  } catch { showResult("bad", "Couldn't open the inbox panel."); }
});
els.opts.addEventListener("click", () => chrome.runtime.openOptionsPage());
els.status.addEventListener("click", () => chrome.runtime.openOptionsPage());

// Boot ------------------------------------------------------------------------
checkConnection();
prefillFromPage();
