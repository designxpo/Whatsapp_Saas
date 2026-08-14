import {
  getSettings, listInbox, getThread, sendReply, suggestReply,
  listTemplates, listQuickReplies, setBot, setStatus,
} from "./api.js";
import { CHANNELS, STATUS_FILTERS, channelMeta, supportsTemplates, relativeTime, windowStatus } from "./channels.js";

const $ = (id) => document.getElementById(id);
const el = {
  ws: $("ws"), refresh: $("refresh"), openPortal: $("openPortal"),
  connect: $("connect"), openOpts: $("openOpts"),
  listView: $("listView"), viewChats: $("viewChats"), viewComments: $("viewComments"),
  nChats: $("nChats"), nComments: $("nComments"), search: $("search"),
  channels: $("channels"), statuses: $("statuses"),
  list: $("list"), listState: $("listState"),
  threadView: $("threadView"), back: $("back"), tName: $("tName"),
  tChannel: $("tChannel"), tPhone: $("tPhone"), tEscalated: $("tEscalated"),
  botToggle: $("botToggle"), escalate: $("escalate"), openThreadPortal: $("openThreadPortal"),
  tStatus: $("tStatus"), tStatusLabel: $("tStatusLabel"), tStatusHint: $("tStatusHint"),
  messages: $("messages"),
  templateRow: $("templateRow"), tplName: $("tplName"), tplParams: $("tplParams"), tplHint: $("tplHint"),
  textRow: $("textRow"), quickRow: $("quickRow"), draft: $("draft"),
  suggest: $("suggest"), send: $("send"), composerMsg: $("composerMsg"),
};

const q = { view: "chats", platform: null, status: "all", q: "" };
let current = null;         // the open conversation
let quickReplies = [];      // loaded once
let baseUrl = "https://app.thetalko.in";
let searchTimer = null;

const initials = (name) => (name || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
const chanClass = (id) => `c-${CHANNELS.some(c => c.id === id) ? id : "other"}`;

function showView(which) {
  el.connect.hidden = which !== "connect";
  el.listView.hidden = which !== "list";
  el.threadView.hidden = which !== "thread";
}

// ── Filters ─────────────────────────────────────────────────────────────────

function renderStatusChips() {
  el.statuses.replaceChildren();
  for (const s of STATUS_FILTERS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "stchip";
    b.textContent = s.label;
    b.setAttribute("aria-pressed", String(q.status === s.id));
    b.addEventListener("click", () => { if (q.status !== s.id) { q.status = s.id; loadList(); } });
    el.statuses.append(b);
  }
}

function renderChannelTabs(counts = {}) {
  el.channels.replaceChildren();
  for (const t of [{ id: null, label: "All" }, ...CHANNELS]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chtab";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(q.platform === t.id));
    b.append(document.createTextNode(t.label));
    const n = t.id === null ? counts.all : counts[t.id];
    if (typeof n === "number") {
      const badge = document.createElement("span");
      badge.className = "n";
      badge.textContent = String(n);
      b.append(badge);
      if (n === 0 && t.id !== null) b.disabled = true;
    }
    b.addEventListener("click", () => { if (q.platform !== t.id) { q.platform = t.id; loadList(); } });
    el.channels.append(b);
  }
}

function syncViewTabs(counts = {}) {
  el.viewChats.setAttribute("aria-selected", String(q.view === "chats"));
  el.viewComments.setAttribute("aria-selected", String(q.view === "comments"));
  if (typeof counts.chats === "number") el.nChats.textContent = String(counts.chats);
  if (typeof counts.comments === "number") el.nComments.textContent = String(counts.comments);
}

// ── List ────────────────────────────────────────────────────────────────────

async function loadList() {
  el.list.replaceChildren();
  renderStatusChips();
  renderChannelTabs();
  state("Loading…");

  const res = await listInbox({ limit: 50, ...q });
  if (!res.ok) {
    state(res.status === 401 ? "Your API key was rejected." : (res.error || "Couldn't load your chats."),
          res.status === 401 ? "Open settings" : null);
    return;
  }
  const counts = res.data?.counts ?? {};
  renderChannelTabs(counts);
  syncViewTabs(counts);

  const convs = res.data?.conversations ?? [];
  if (!convs.length) {
    state(emptyMessage());
    return;
  }
  el.listState.hidden = true;
  for (const c of convs) el.list.append(rowFor(c));
}

function emptyMessage() {
  if (q.q) return `Nothing matches “${q.q}”.`;
  const where = q.platform ? ` in ${channelMeta(q.platform).label}` : "";
  const noun = q.view === "comments" ? "comments" : "chats";
  if (q.status === "needs_reply") return `Nothing needs a reply${where}.`;
  if (q.status === "escalated") return `No escalated ${noun}${where}.`;
  if (q.status === "bot_off") return `No ${noun} with the AI paused${where}.`;
  return `No ${noun} yet${where}.`;
}

function state(text, actionLabel) {
  el.listState.hidden = false;
  const p = document.createElement("p");
  p.textContent = text;
  el.listState.replaceChildren(p);
  if (actionLabel) {
    const b = document.createElement("button");
    b.className = "primary";
    b.type = "button";
    b.textContent = actionLabel;
    b.addEventListener("click", () => chrome.runtime.openOptionsPage());
    el.listState.append(b);
  }
}

function rowFor(c) {
  const meta = channelMeta(c.platform);
  const li = document.createElement("li");
  li.className = `row${c.needsReply ? " unread" : ""}`;
  li.tabIndex = 0;
  li.setAttribute("role", "button");
  li.setAttribute("aria-label", `${c.name}, ${meta.label}${c.needsReply ? ", needs reply" : ""}`);

  const wrap = document.createElement("div");
  wrap.className = "avatarwrap";
  const av = document.createElement("div");
  av.className = "avatar";
  if (c.avatarUrl) {
    const img = document.createElement("img");
    img.src = c.avatarUrl; img.alt = "";
    av.append(img);
  } else {
    av.textContent = initials(c.name);
  }
  const badge = document.createElement("span");
  badge.className = `chanbadge ${chanClass(meta.id)}`;
  badge.textContent = meta.short;
  badge.title = meta.label;
  wrap.append(av, badge);

  const mid = document.createElement("div");
  mid.className = "rowmid";
  const nameLine = document.createElement("div");
  nameLine.className = "rowname";
  const nm = document.createElement("span");
  nm.className = "nm";
  nm.textContent = c.name;
  nameLine.append(nm);
  if (c.status === "escalated") {
    const t = document.createElement("span");
    t.className = "tag escalated";
    t.textContent = "Escalated";
    nameLine.append(t);
  }
  const prev = document.createElement("div");
  prev.className = "preview";
  prev.textContent = c.lastMessage || "No messages yet";
  mid.append(nameLine, prev);

  const right = document.createElement("div");
  right.className = "rowright";
  const t = document.createElement("span");
  t.className = "time";
  t.textContent = relativeTime(c.lastInboundAt || c.lastOutboundAt);
  right.append(t);
  if (c.needsReply) {
    const b = document.createElement("span");
    b.className = "needs";
    b.textContent = "reply";
    right.append(b);
  }

  li.append(wrap, mid, right);
  const open = () => openThread(c);
  li.addEventListener("click", open);
  li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  return li;
}

// ── Thread ──────────────────────────────────────────────────────────────────

async function openThread(c) {
  const meta = channelMeta(c.platform);
  current = { ...c, conversationId: c.id, meta };
  el.tName.textContent = c.name;
  el.tChannel.textContent = meta.label;
  el.tChannel.className = `chan ${chanClass(meta.id)}`;
  el.tPhone.textContent = c.phone ? `+${c.phone}` : (c.handle ? `@${c.handle}` : "");
  el.messages.replaceChildren();
  el.composerMsg.hidden = true;
  el.draft.value = "";
  el.tplParams.value = "";
  const portalUrl = `${baseUrl}/admin?tab=livechat`;
  el.openThreadPortal.href = portalUrl;
  syncTools();
  applyComposerMode(current);
  showView("thread");

  const res = await getThread({ conversationId: c.id });
  if (!res.ok) { composerMsg("bad", res.error || "Couldn't load this chat."); return; }
  // The list row can be minutes stale — trust the thread's fresher state.
  current.windowOpen = res.data?.window === "open";
  if (res.data?.conversation) {
    current.botEnabled = res.data.conversation.botEnabled;
    current.status = res.data.conversation.status;
  }
  syncTools();
  applyComposerMode(current);

  const msgs = res.data?.messages ?? [];
  if (!msgs.length) {
    const p = document.createElement("p");
    p.className = "statushint";
    p.textContent = "No messages in this chat yet.";
    el.messages.append(p);
  }
  for (const m of msgs) el.messages.append(bubble(m));
  el.messages.scrollTop = el.messages.scrollHeight;
}

function syncTools() {
  const botOn = !!current?.botEnabled;
  el.botToggle.textContent = botOn ? "AI is answering" : "AI paused — you reply";
  el.botToggle.className = `tool${botOn ? " on" : ""}`;
  el.botToggle.title = botOn ? "Pause the AI on this chat" : "Let the AI answer this chat again";

  const escalated = current?.status === "escalated";
  el.tEscalated.hidden = !escalated;
  el.escalate.textContent = escalated ? "Mark active" : "Escalate";
  el.escalate.className = `tool${escalated ? "" : " danger"}`;
}

// One place decides what the composer allows, so the wording and the controls can
// never disagree. Three cases, driven by the channel:
//   open                     → free-form reply (every channel)
//   closed + WhatsApp        → an approved template is the only way back in
//   closed + Instagram/FB    → nothing to send; they must message again
function applyComposerMode(c) {
  const st = windowStatus(c);
  el.tStatus.className = `statusbar ${st.state}`;
  el.tStatusLabel.textContent = st.label;
  el.tStatusHint.textContent = st.hint;

  const closed = st.state !== "open";
  const needsTemplate = closed && supportsTemplates(c.platform);
  const blocked = closed && !needsTemplate;

  el.templateRow.hidden = !needsTemplate;
  el.textRow.hidden = needsTemplate;
  el.draft.disabled = blocked;
  el.draft.placeholder = blocked ? "You can reply once they message again" : "Write a reply…";
  el.suggest.disabled = blocked;
  el.send.disabled = blocked;
  el.send.textContent = needsTemplate ? "Send template" : "Send";

  if (needsTemplate) loadTemplates();
  else if (!blocked) renderQuickReplies();
  else el.quickRow.hidden = true;
}

async function loadTemplates() {
  el.tplName.replaceChildren(new Option("Loading templates…", ""));
  el.tplParams.hidden = true;
  el.tplHint.hidden = true;
  const res = await listTemplates({ conversationId: current.conversationId });
  const templates = res.ok ? (res.data?.templates ?? []) : [];
  if (!templates.length) {
    el.tplName.replaceChildren(new Option("No approved templates", ""));
    el.tplHint.hidden = false;
    el.tplHint.textContent = res.data?.notice || "Get a template approved in the portal to reach this contact.";
    return;
  }
  el.tplName.replaceChildren(new Option("Choose a template…", ""));
  for (const t of templates) {
    const opt = new Option(`${t.name} · ${t.language}${t.params ? ` · ${t.params} value${t.params > 1 ? "s" : ""}` : ""}`, t.name);
    opt.dataset.lang = t.language;
    opt.dataset.params = String(t.params || 0);
    el.tplName.append(opt);
  }
}

function renderQuickReplies() {
  el.quickRow.replaceChildren();
  el.quickRow.hidden = !quickReplies.length;
  for (const qr of quickReplies.slice(0, 8)) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "qr";
    b.textContent = `/${qr.shortcut}`;
    b.title = qr.body;
    b.addEventListener("click", () => {
      el.draft.value = qr.body;
      el.draft.focus();
      composerMsg("info", "Quick reply inserted — edit it, then send.");
    });
    el.quickRow.append(b);
  }
}

function bubble(m) {
  const d = document.createElement("div");
  d.className = `msg ${m.role === "user" ? "user" : "assistant"}`;
  d.textContent = m.body || (m.mediaType ? `[${m.mediaType}]` : "");
  const meta = document.createElement("span");
  meta.className = "meta";
  const who = m.source === "agent" ? "You" : m.source === "bot" ? "AI" : current?.name?.split(" ")[0] || "Them";
  meta.textContent = `${who} · ${relativeTime(m.createdAt)}`;
  d.append(meta);
  return d;
}

function composerMsg(kind, text) {
  el.composerMsg.hidden = false;
  el.composerMsg.className = `cmsg ${kind}`;
  el.composerMsg.textContent = text;
}

// ── Actions ─────────────────────────────────────────────────────────────────

async function toggleBot() {
  if (!current) return;
  const next = !current.botEnabled;
  el.botToggle.disabled = true;
  const res = await setBot({ conversationId: current.conversationId, enabled: next });
  el.botToggle.disabled = false;
  if (res.ok) { current.botEnabled = next; syncTools(); composerMsg("info", next ? "The AI will answer this chat." : "The AI is paused — replies are yours."); }
  else composerMsg("bad", res.error || "Couldn't change that.");
}

async function toggleEscalate() {
  if (!current) return;
  const next = current.status === "escalated" ? "active" : "escalated";
  el.escalate.disabled = true;
  const res = await setStatus({ conversationId: current.conversationId, status: next });
  el.escalate.disabled = false;
  if (res.ok) {
    current.status = next;
    // Escalating pauses the AI server-side; mirror that here.
    if (next === "escalated") current.botEnabled = false;
    syncTools();
    composerMsg("info", next === "escalated" ? "Escalated — the AI is paused." : "Marked active again.");
  } else composerMsg("bad", res.error || "Couldn't change that.");
}

async function doSuggest() {
  if (!current) return;
  el.suggest.disabled = true;
  const label = el.suggest.textContent;
  el.suggest.textContent = "Drafting…";
  const res = await suggestReply({ conversationId: current.conversationId });
  el.suggest.disabled = false;
  el.suggest.textContent = label;
  if (res.ok && res.data?.suggestion) {
    el.draft.value = res.data.suggestion;
    el.draft.focus();
    composerMsg("info", "Draft ready — edit it, then send.");
  } else {
    composerMsg("bad", res.data?.escalate
      ? "The AI thinks a person should answer this one."
      : (res.error || "Couldn't draft a reply."));
  }
}

async function doSend() {
  if (!current) return;
  const payload = { conversationId: current.conversationId };
  const needsTemplate = el.templateRow.hidden === false;

  if (!needsTemplate) {
    const message = el.draft.value.trim();
    if (!message) { composerMsg("bad", "Write a message first."); return; }
    payload.message = message;
  } else {
    const opt = el.tplName.selectedOptions[0];
    if (!el.tplName.value) { composerMsg("bad", "Choose an approved template."); return; }
    payload.templateName = el.tplName.value;
    if (opt?.dataset.lang) payload.templateLang = opt.dataset.lang;
    const needed = Number(opt?.dataset.params || 0);
    const params = el.tplParams.value.split(",").map(s => s.trim()).filter(Boolean);
    if (needed && params.length < needed) { composerMsg("bad", `This template needs ${needed} value${needed > 1 ? "s" : ""}.`); return; }
    if (params.length) payload.templateParams = params;
  }

  el.send.disabled = true;
  const label = el.send.textContent;
  el.send.textContent = "Sending…";
  const res = await sendReply(payload);
  el.send.disabled = false;
  el.send.textContent = label;
  if (res.ok) {
    composerMsg("ok", "Sent ✓");
    el.messages.append(bubble({
      role: "assistant", source: "agent", createdAt: new Date().toISOString(),
      body: payload.message || `[template: ${payload.templateName}]`,
    }));
    el.messages.scrollTop = el.messages.scrollHeight;
    el.draft.value = "";
    // Replying pauses the bot server-side (pauseBot defaults true).
    current.botEnabled = false;
    syncTools();
  } else {
    composerMsg("bad", res.error || "Couldn't send.");
  }
}

// ── Events ──────────────────────────────────────────────────────────────────

el.viewChats.addEventListener("click", () => { if (q.view !== "chats") { q.view = "chats"; q.platform = null; loadList(); } });
el.viewComments.addEventListener("click", () => { if (q.view !== "comments") { q.view = "comments"; q.platform = null; loadList(); } });
el.search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { q.q = el.search.value; loadList(); }, 250);
});
el.refresh.addEventListener("click", loadList);
el.back.addEventListener("click", () => { showView("list"); loadList(); });
el.botToggle.addEventListener("click", toggleBot);
el.escalate.addEventListener("click", toggleEscalate);
el.tplName.addEventListener("change", () => {
  const n = Number(el.tplName.selectedOptions[0]?.dataset.params || 0);
  el.tplParams.hidden = n === 0;
  el.tplHint.hidden = !el.tplName.value;
  el.tplHint.textContent = n
    ? `Fill ${n} value${n > 1 ? "s" : ""}, comma-separated, in order.`
    : el.tplName.value ? "This template needs no values." : "";
});
el.suggest.addEventListener("click", doSuggest);
el.send.addEventListener("click", doSend);
el.openOpts.addEventListener("click", () => chrome.runtime.openOptionsPage());
el.draft.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") doSend(); });

// ── Boot ────────────────────────────────────────────────────────────────────
(async () => {
  const s = await getSettings();
  if (!s.apiKey) { showView("connect"); return; }
  baseUrl = s.baseUrl || baseUrl;
  el.openPortal.href = `${baseUrl}/admin`;
  try { el.ws.textContent = new URL(baseUrl).hostname.replace(/^app\./, ""); } catch { /* ignore */ }
  showView("list");
  loadList();
  // Canned replies rarely change — fetch once, use on every thread.
  listQuickReplies().then(r => { if (r.ok) quickReplies = r.data?.quickReplies ?? []; });
})();
