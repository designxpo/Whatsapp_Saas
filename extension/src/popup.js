import { getSettings } from "./api.js";
import { parseSelection, waClickToChatUrl, qrImageUrl, normalizePhone, sourceLabel } from "./wa.js";
import { initTheme, themeSwitch } from "./theme.js";
import { contactsFromCandidates, IMPORT_LIMIT, SCAN_LIMIT } from "./scan.js";
import { signalsFromCandidates, SIGNAL_LIMIT } from "./signals.js";

const $ = (id) => document.getElementById(id);
const els = {
  status: $("status"), name: $("name"), phone: $("phone"), email: $("email"),
  tags: $("tags"), consent: $("consent"), source: $("source"), tagHint: $("tagHint"),
  submit: $("submit"), result: $("result"), quick: $("quick"),
  openWa: $("openWa"), copyWa: $("copyWa"), qr: $("qr"),
  grab: $("grab"), inbox: $("inbox"), opts: $("opts"), form: $("lead"),
  themeSlot: $("themeSlot"), actions: $("actions"), actionHint: $("actionHint"), scan: $("scan"),
  scanPanel: $("scanPanel"), scanBack: $("scanBack"), scanCount: $("scanCount"),
  scanNote: $("scanNote"), scanList: $("scanList"), scanConsent: $("scanConsent"),
  scanToggleAll: $("scanToggleAll"), scanImport: $("scanImport"), scanMsg: $("scanMsg"),
  findLeads: $("findLeads"), signalsPanel: $("signalsPanel"), signalsBack: $("signalsBack"),
  signalsCount: $("signalsCount"), signalsNote: $("signalsNote"), signalsList: $("signalsList"),
  signalsMsg: $("signalsMsg"),
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
    els.status.textContent = `● Connected — ${res.data?.workspace || "your workspace"}${res.data?.plan ? ` · ${res.data.plan}` : ""}`;
    els.status.className = "statusrow ok";
    els.status.title = "Open settings";
  } else {
    els.status.textContent = res?.status === 401 ? "● Key rejected — open settings"
      : res?.status === 402 ? "● Upgrade required — Copilot isn't on your plan"
      : "● Not connected — add your API key";
    els.status.className = "statusrow bad";
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

// ── Scan this page ───────────────────────────────────────────────────────────
//
// Runs ONLY on this click, ONLY on the tab in front of the tenant, and only
// COLLECTS candidates — scan.js decides what looks like a person, and the tenant
// ticks the rows before anything is saved.
//
// This function is injected into the page, so it must stand alone: no imports,
// no closure variables, nothing from this module.
function collectPageContacts() {
  const PHONE = /\+?\d[\d\s().-]{7,16}\d/;
  const MAX = 400;
  const out = [];
  const clip = (s) => String(s || "").replace(/\u00a0/g, " ").slice(0, 400);  // nbsp → space
  const push = (o) => { if (out.length < MAX) out.push(o); };

  // 1. tel:/mailto: links — the strongest signal there is. The visible text may
  //    read "Call us"; the href carries the number the site itself dials.
  for (const a of document.querySelectorAll('a[href^="tel:"], a[href^="mailto:"]')) {
    const href = a.getAttribute("href") || "";
    const isTel = /^tel:/i.test(href);
    let value = href.replace(/^(tel:|mailto:)/i, "");
    try { value = decodeURIComponent(value); } catch { /* keep the raw value */ }
    // A small container carries the name beside the link; a big one would be the
    // whole page, so fall back to the link's own text.
    const near = a.closest("li, tr, td, p, h1, h2, h3, h4, article, address, figcaption");
    const nearText = near ? String(near.innerText || "") : "";
    const context = nearText && nearText.length <= 300 ? nearText : String(a.innerText || "");
    push({
      tel: isTel ? value : "",
      mail: isTel ? "" : value.split("?")[0],
      text: clip(`${a.innerText || ""}\n${context}`),
    });
  }

  // 2. Visible text, line by line. A name sits just above its number far more
  //    often than below, so each hit carries the two lines before it.
  const lines = String((document.body && document.body.innerText) || "").split("\n");
  for (let i = 0; i < lines.length && i < 6000; i++) {
    const line = lines[i].trim();
    if (!line || !PHONE.test(line)) continue;
    push({ text: clip([lines[i - 2], lines[i - 1], line, lines[i + 1]].filter(Boolean).map(s => s.trim()).join("\n")) });
  }

  return { url: location.href, title: document.title, candidates: out };
}

// ── Find leads ───────────────────────────────────────────────────────────────
//
// Runs ONLY on this click, ONLY on the tab in front of the tenant, and only
// COLLECTS candidate posts/comments — signals.js decides which ones read as a
// buying signal. Nothing is saved anywhere; each result offers a copy-only
// drafted opener, never an auto-send.
//
// Per-platform selectors are best-effort: a site redesign yields no candidates
// for that platform, which reads as "no signals found," never an error.
//
// This function is injected into the page, so it must stand alone: no imports,
// no closure variables, nothing from this module.
function collectPageSignals() {
  const MAX = 400;
  const out = [];
  const push = (o) => { if (out.length < MAX) out.push(o); };
  const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n || 2000);
  const host = location.hostname.replace(/^www\./, "");

  if (/(^|\.)reddit\.com$/.test(host)) {
    // New Reddit's shreddit web components carry author/permalink as attributes.
    for (const el of document.querySelectorAll("shreddit-post, shreddit-comment")) {
      const author = el.getAttribute("author") || "";
      const permalink = el.getAttribute("permalink") || el.getAttribute("content-href") || "";
      const body = el.querySelector('[slot="text-body"], [slot="comment"], .md');
      const text = body ? body.innerText : el.innerText;
      push({ platform: "reddit", author, text: clip(text), permalink: permalink ? new URL(permalink, location.href).href : "" });
    }
    // old.reddit.com fallback.
    for (const el of document.querySelectorAll(".thing, .comment")) {
      const author = el.querySelector("a.author")?.innerText || "";
      const body = el.querySelector(".usertext-body .md, .md");
      const permalink = el.querySelector("a.bylink")?.href || "";
      if (body) push({ platform: "reddit", author, text: clip(body.innerText), permalink });
    }
  } else if (/(^|\.)(x\.com|twitter\.com)$/.test(host)) {
    for (const el of document.querySelectorAll('article[data-testid="tweet"]')) {
      const textEl = el.querySelector('[data-testid="tweetText"]');
      const authorEl = el.querySelector('[data-testid="User-Name"]');
      const linkEl = [...el.querySelectorAll('a[href*="/status/"]')].find((a) => /\/status\/\d+/.test(a.href));
      if (textEl) push({ platform: "x", author: authorEl ? clip(authorEl.innerText, 120) : "", text: clip(textEl.innerText), permalink: linkEl ? linkEl.href : "" });
    }
  } else if (/(^|\.)linkedin\.com$/.test(host)) {
    for (const el of document.querySelectorAll(".feed-shared-update-v2, .comments-comment-item")) {
      const textEl = el.querySelector(".feed-shared-text, .comments-comment-item__main-content");
      const authorEl = el.querySelector(".feed-shared-actor__name, .comments-post-meta__name-text");
      if (textEl) push({ platform: "linkedin", author: authorEl ? clip(authorEl.innerText, 120) : "", text: clip(textEl.innerText), permalink: "" });
    }
  } else if (/(^|\.)discord\.com$/.test(host)) {
    // Discord's other class names are hashed/unstable — id prefixes are the
    // only reliable hook. No in-DOM message permalink; falls back below.
    for (const el of document.querySelectorAll('li[id^="chat-messages-"]')) {
      const textEl = el.querySelector('[id^="message-content-"]');
      const authorEl = el.querySelector('h3[id^="message-username-"]');
      if (textEl) push({ platform: "discord", author: authorEl ? clip(authorEl.innerText, 120) : "", text: clip(textEl.innerText), permalink: "" });
    }
  } else {
    // Any other page: paragraph-ish blocks in a plausible comment length —
    // no author, since there's no reliable convention to read one from.
    for (const el of document.querySelectorAll("p, li, blockquote")) {
      const text = el.innerText || "";
      if (text.length < 40 || text.length > 600) continue;
      push({ platform: "web", author: "", text: clip(text, 600), permalink: "" });
    }
  }

  // A permalink-less result still needs somewhere for "Open post" to go.
  for (const c of out) if (!c.permalink) c.permalink = location.href;

  return { url: location.href, title: document.title, candidates: out };
}

function scanMsg(kind, text) {
  els.scanMsg.hidden = !text;
  els.scanMsg.className = `result ${kind || "info"}`;
  els.scanMsg.textContent = text || "";
}

// One switch for all three views (lead form / contact scan / signal scan) so
// they stay mutually exclusive — two independent on/off flags would leave a
// path where two panels show at once once there's a third.
/** @param {"form" | "scan" | "signals"} mode */
function setPanel(mode) {
  const onForm = mode === "form";
  els.scanPanel.hidden = mode !== "scan";
  els.signalsPanel.hidden = mode !== "signals";
  els.form.hidden = !onForm;
  els.actions.hidden = !onForm;
  els.actionHint.hidden = !onForm;
  // The scan panel carries its own "Add N to Talko", so the pinned lead-form
  // button stands down — two primaries would be two different actions.
  els.submit.hidden = !onForm;
  if (onForm) updateQuickActions(); else els.quick.hidden = true;
  // The popup's middle is the only scroller now — start a new view at the top.
  document.querySelector("main")?.scrollTo({ top: 0 });
}

function checkedRows() {
  return [...els.scanList.querySelectorAll("input[type=checkbox]")]
    .filter(i => i.checked)
    .map(i => JSON.parse(i.dataset.contact || "{}"));
}

function syncImportButton() {
  const n = checkedRows().length;
  els.scanImport.textContent = n ? `Add ${n} to Talko` : "Add to Talko";
  els.scanImport.disabled = n === 0 || n > IMPORT_LIMIT;
  if (n > IMPORT_LIMIT) scanMsg("bad", `Add up to ${IMPORT_LIMIT} at a time — untick ${n - IMPORT_LIMIT}.`);
  else if (els.scanMsg.className.includes("bad")) scanMsg("", "");
}

function scanRow(c) {
  const li = document.createElement("li");
  li.className = "srow";

  const box = document.createElement("input");
  box.type = "checkbox";
  box.dataset.contact = JSON.stringify(c);
  box.setAttribute("aria-label", `Add ${c.name || c.phone}`);
  box.addEventListener("change", syncImportButton);

  const info = document.createElement("div");
  info.className = "sinfo";
  const name = document.createElement("div");
  name.className = `sname${c.name ? "" : " unknown"}`;
  name.textContent = c.name || "Name not found";
  const meta = document.createElement("div");
  meta.className = "smeta";
  meta.textContent = [`+${c.phone}`, c.email].filter(Boolean).join(" · ");
  meta.title = c.context || "";
  info.append(name, meta);

  const use = document.createElement("button");
  use.type = "button";
  use.className = "usebtn";
  use.textContent = "Use";
  use.title = "Fill the form with this contact";
  use.addEventListener("click", (e) => {
    e.stopPropagation();
    els.name.value = c.name || "";
    els.phone.value = `+${c.phone}`;
    els.email.value = c.email || "";
    setPanel("form");
    showResult("info", "Pulled in — check the fields, then add.");
    updateQuickActions();
  });

  // The whole row toggles, so ticking ten people doesn't mean ten small targets.
  li.addEventListener("click", (e) => {
    if (e.target !== box) { box.checked = !box.checked; syncImportButton(); }
  });
  li.append(box, info, use);
  return li;
}

async function doScan() {
  const tab = currentTab || await activeTab();
  setPanel("scan");
  els.scanList.replaceChildren();
  els.scanCount.textContent = "Scanning…";
  els.scanNote.textContent = "Reading the visible text on this page.";
  els.scanToggleAll.textContent = "Select all";
  els.scanImport.disabled = true;
  scanMsg("", "");

  let payload = null;
  try {
    if (!tab?.id) throw new Error("no tab");
    const [{ result } = {}] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectPageContacts });
    payload = result;
  } catch {
    els.scanCount.textContent = "Can't scan this page";
    els.scanNote.textContent = "Chrome blocks extensions here (browser settings pages, the Web Store, and PDFs). Open a normal web page and try again.";
    return;
  }

  const { defaultCc } = await getSettings();
  const { contacts, total } = contactsFromCandidates(payload?.candidates ?? [], { cc: defaultCc });

  if (!contacts.length) {
    els.scanCount.textContent = "No contacts found";
    els.scanNote.textContent = "No phone numbers on this page. Highlight the details you can see and use Grab selection instead.";
    return;
  }

  els.scanCount.textContent = `${contacts.length} contact${contacts.length > 1 ? "s" : ""} found`;
  els.scanNote.textContent = total > contacts.length
    ? `Showing the first ${SCAN_LIMIT} of ${total}. Tick who to add — up to ${IMPORT_LIMIT} at a time.`
    : `Tick who to add — up to ${IMPORT_LIMIT} at a time. Nothing is saved until you do.`;
  for (const c of contacts) els.scanList.append(scanRow(c));
  syncImportButton();
}

async function doImport() {
  const contacts = checkedRows();
  if (!contacts.length) return;
  els.scanImport.disabled = true;
  const label = els.scanImport.textContent;
  els.scanImport.textContent = "Adding…";
  scanMsg("info", "Adding to Talko…");

  const res = await send({
    type: "ADD_LEADS",
    payload: { contacts, sourceUrl: currentTab?.url || "", consent: els.scanConsent.checked },
  });

  els.scanImport.textContent = label;
  if (!res?.ok) {
    els.scanImport.disabled = false;
    scanMsg("bad", res?.error || "Couldn't add those contacts.");
    return;
  }
  // Clear what landed, so a second pass can't double-add the same people.
  for (const box of [...els.scanList.querySelectorAll("input[type=checkbox]")]) {
    if (box.checked) box.closest("li")?.remove();
  }
  const added = res.data?.inserted;
  const n = res.data?.count ?? contacts.length;
  scanMsg("ok", added === 0
    ? `Already in Talko — nothing changed (${n} checked).`
    : `Added ${added ?? n} contact${(added ?? n) > 1 ? "s" : ""} ✓ · tagged ${(res.data?.tags || []).join(", ")}`);
  els.scanCount.textContent = `${els.scanList.children.length} contact${els.scanList.children.length === 1 ? "" : "s"} left`;
  syncImportButton();
}

// ── Find leads (signal scan) ─────────────────────────────────────────────────

const PLATFORM_LABEL = { reddit: "Reddit", x: "X", linkedin: "LinkedIn", discord: "Discord", web: "Web" };

function signalsMsg(kind, text) {
  els.signalsMsg.hidden = !text;
  els.signalsMsg.className = `result ${kind || "info"}`;
  els.signalsMsg.textContent = text || "";
}

// Swaps a row's action bar for the drafted opener text + a Copy button. The
// opener is never sent from here — it's copied and pasted into that
// platform's own DM composer by the tenant.
function showOpener(li, text) {
  li.querySelectorAll(".sigopener, .sigopenerbar").forEach((n) => n.remove());
  const box = document.createElement("p");
  box.className = "sigopener";
  box.textContent = text;
  const bar = document.createElement("div");
  bar.className = "sigopenerbar";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "usebtn";
  copy.textContent = "Copy";
  copy.addEventListener("click", async () => {
    await navigator.clipboard.writeText(text).catch(() => {});
    copy.textContent = "Copied ✓";
    setTimeout(() => (copy.textContent = "Copy"), 1500);
  });
  bar.append(copy);
  li.append(box, bar);
}

function signalRow(s) {
  const li = document.createElement("li");
  li.className = "sigrow";

  const top = document.createElement("div");
  top.className = "sigtop";
  const plat = document.createElement("span");
  plat.className = "sigplat";
  plat.textContent = PLATFORM_LABEL[s.platform] || s.platform || "Web";
  const cat = document.createElement("span");
  cat.className = "sigcat";
  cat.textContent = s.label;
  top.append(plat, cat);

  const author = document.createElement("div");
  author.className = "sigauthor";
  author.textContent = s.author || "Unknown author";

  const snippet = document.createElement("blockquote");
  snippet.className = "sigsnippet";
  snippet.textContent = `“${s.snippet}”`;

  const actions = document.createElement("div");
  actions.className = "sigactions";

  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "usebtn";
  openBtn.textContent = "Open post";
  openBtn.addEventListener("click", () => { if (s.permalink) chrome.tabs.create({ url: s.permalink }); });

  const draftBtn = document.createElement("button");
  draftBtn.type = "button";
  draftBtn.className = "usebtn";
  draftBtn.textContent = "✨ Draft opener";
  draftBtn.addEventListener("click", async () => {
    draftBtn.disabled = true;
    draftBtn.textContent = "Drafting…";
    const res = await send({
      type: "DRAFT_OUTREACH",
      payload: { text: s.text, author: s.author, platform: s.platform, category: s.category },
    });
    draftBtn.disabled = false;
    draftBtn.textContent = "✨ Draft opener";
    if (!res?.ok) { signalsMsg("bad", res?.error || "Couldn't draft an opener."); return; }
    showOpener(li, res.data?.opener || "");
  });

  actions.append(openBtn, draftBtn);
  li.append(top, author, snippet, actions);
  return li;
}

async function doSignals() {
  const tab = currentTab || await activeTab();
  setPanel("signals");
  els.signalsList.replaceChildren();
  els.signalsCount.textContent = "Scanning…";
  els.signalsNote.textContent = "Reading the visible posts and comments on this page — a prospecting helper, not a Talko channel.";
  signalsMsg("", "");

  let payload = null;
  try {
    if (!tab?.id) throw new Error("no tab");
    const [{ result } = {}] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectPageSignals });
    payload = result;
  } catch {
    els.signalsCount.textContent = "Can't scan this page";
    els.signalsNote.textContent = "Chrome blocks extensions here (browser settings pages, the Web Store, and PDFs). Open a normal web page and try again.";
    return;
  }

  const { signals, total } = signalsFromCandidates(payload?.candidates ?? []);

  if (!signals.length) {
    els.signalsCount.textContent = "No signals found";
    els.signalsNote.textContent = "No high-intent posts or comments on this page right now. Try a subreddit, a search results page, or a busier thread.";
    return;
  }

  els.signalsCount.textContent = `${signals.length} signal${signals.length > 1 ? "s" : ""} found`;
  els.signalsNote.textContent = total > signals.length
    ? `Showing the first ${SIGNAL_LIMIT} of ${total}. None of this is saved to Talko — draft an opener, then reply to them where you found them.`
    : "None of this is saved to Talko — draft an opener, then reply to them where you found them.";
  for (const s of signals) els.signalsList.append(signalRow(s));
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
  setPanel("form");
  if (sel.trim()) { applyParsed(parseSelection(sel)); showResult("ok", "Pulled the selection in — check the fields."); }
  else showResult("bad", "Nothing is selected on the page.");
});

els.scan.addEventListener("click", doScan);
els.scanBack.addEventListener("click", () => setPanel("form"));
els.scanImport.addEventListener("click", doImport);
els.findLeads.addEventListener("click", doSignals);
els.signalsBack.addEventListener("click", () => setPanel("form"));
els.scanToggleAll.addEventListener("click", () => {
  const boxes = [...els.scanList.querySelectorAll("input[type=checkbox]")];
  const turnOn = boxes.some(b => !b.checked);
  // "Select all" respects the import cap, so the button it feeds stays usable.
  boxes.forEach((b, i) => { b.checked = turnOn && i < IMPORT_LIMIT; });
  els.scanToggleAll.textContent = turnOn ? "Clear all" : "Select all";
  syncImportButton();
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
(async () => {
  const mode = await initTheme();
  els.themeSlot.append(themeSwitch({ mode, compact: true }));
  const { attestConsent } = await getSettings();
  els.scanConsent.checked = !!attestConsent;
})();
checkConnection();
prefillFromPage();
