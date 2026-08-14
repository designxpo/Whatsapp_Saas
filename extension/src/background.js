// Service worker — the ONLY place that talks to Talko's API. Content scripts and
// the popup message us; we call the backend (host_permission bypasses CORS here)
// and report back. Nothing here automates any third-party site.

import { addLead, whoami, draftReply, listInbox } from "./api.js";
import { parseSelection } from "./wa.js";

const MENU_ID = "talko-capture-selection";
const POLL_ALARM = "inbox-poll";

function setup() {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Add “%s” to Talko as a lead",
    contexts: ["selection"],
  }, () => void chrome.runtime.lastError); // ignore "already exists" on re-setup
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 3 });
  refreshInboxBadge();
}

chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === POLL_ALARM) refreshInboxBadge(); });
// Re-check the moment the tenant pastes/changes their key.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && (changes.apiKey || changes.baseUrl)) refreshInboxBadge();
});

// Toolbar badge = how many conversations are waiting for a reply. Cleared when
// there are none, or when no key / the key is rejected.
async function refreshInboxBadge() {
  try {
    const res = await listInbox({ needsReply: true, limit: 100 });
    if (!res.ok) { await chrome.action.setBadgeText({ text: "" }); return; }
    const n = (res.data?.conversations ?? []).length;
    await chrome.action.setBadgeBackgroundColor({ color: "#0783FD" });
    await chrome.action.setBadgeText({ text: n ? (n > 99 ? "99+" : String(n)) : "" });
  } catch { /* ignore */ }
}

// Small helpers ---------------------------------------------------------------

function notify(title, message) {
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title,
      message,
    });
  } catch { /* notifications may be off */ }
}

async function flashBadge(ok) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: ok ? "#16A34A" : "#DC2626" });
    await chrome.action.setBadgeText({ text: ok ? "✓" : "!" });
    // Restore the needs-reply count once the flash fades (don't wipe it).
    setTimeout(() => refreshInboxBadge(), 4000);
  } catch { /* ignore */ }
}

// Capture a blob of selected text: parse → send → report. Used by the context
// menu and the keyboard shortcut, where there's no form to confirm in — so we
// only proceed when a phone number is clearly present.
async function captureText(text, sourceUrl) {
  const parsed = parseSelection(text);
  if (!parsed.phone) {
    notify("No phone number found", "Highlight text that includes a phone number, or use the popup to add details.");
    await flashBadge(false);
    return { ok: false, error: "no-phone" };
  }
  const res = await addLead({ ...parsed, sourceUrl });
  if (res.ok) {
    notify("Lead added to Talko", `${parsed.name || parsed.phone} was saved${res.data?.tags ? ` · ${res.data.tags.join(", ")}` : ""}.`);
  } else {
    notify("Couldn't add the lead", res.error || "Unknown error");
  }
  await flashBadge(res.ok);
  return res;
}

async function selectionFromTab(tabId) {
  try {
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => String(window.getSelection?.() ?? ""),
    });
    return result || "";
  } catch { return ""; }
}

// Triggers --------------------------------------------------------------------

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  captureText(info.selectionText || "", info.pageUrl || tab?.url || "");
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "capture-selection" || !tab?.id) return;
  const text = await selectionFromTab(tab.id);
  if (!text.trim()) { notify("Nothing selected", "Highlight a name and phone number first, then press the shortcut."); return; }
  captureText(text, tab.url || "");
});

// Message API for the popup and content script -------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case "WHOAMI":
          sendResponse(await whoami());
          break;
        case "ADD_LEAD": {
          const res = await addLead(msg.payload || {});
          flashBadge(res.ok);
          sendResponse(res);
          break;
        }
        case "CAPTURE_TEXT":
          sendResponse(await captureText(msg.payload?.text || "", msg.payload?.sourceUrl || ""));
          break;
        case "DRAFT_REPLY":
          sendResponse(await draftReply(msg.payload || {}));
          break;
        default:
          sendResponse({ ok: false, error: `Unknown message type: ${msg?.type}` });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
  })();
  return true; // async response
});
