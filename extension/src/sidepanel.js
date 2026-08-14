import { getSettings, listInbox, getThread, sendReply, suggestReply, listTemplates } from "./api.js";
import { CHANNELS, channelMeta, isReplyable, relativeTime, windowStatus } from "./channels.js";

const $ = (id) => document.getElementById(id);
const el = {
  ws: $("ws"), refresh: $("refresh"),
  connect: $("connect"), openOpts: $("openOpts"),
  listView: $("listView"), channels: $("channels"), filter: $("filter"),
  listCount: $("listCount"), list: $("list"), listState: $("listState"),
  threadView: $("threadView"), back: $("back"), tName: $("tName"),
  tChannel: $("tChannel"), tPhone: $("tPhone"),
  tStatus: $("tStatus"), tStatusLabel: $("tStatusLabel"), tStatusHint: $("tStatusHint"),
  messages: $("messages"),
  templateRow: $("templateRow"), tplName: $("tplName"), tplParams: $("tplParams"), tplHint: $("tplHint"),
  textRow: $("textRow"), draft: $("draft"),
  suggest: $("suggest"), send: $("send"), composerMsg: $("composerMsg"),
};

let needsReplyOnly = false;
let channel = null;             // null = All channels
let current = null;             // the open conversation
const initials = (name) => (name || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
const chanClass = (id) => `c-${CHANNELS.some(c => c.id === id) ? id : "other"}`;

function showView(which) {
  el.connect.hidden = which !== "connect";
  el.listView.hidden = which !== "list";
  el.threadView.hidden = which !== "thread";
}

// ── Channel tabs ────────────────────────────────────────────────────────────

function renderTabs(counts = {}) {
  el.channels.replaceChildren();
  const tabs = [{ id: null, label: "All", short: "ALL" }, ...CHANNELS];
  for (const t of tabs) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chtab";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(channel === t.id));
    const n = t.id === null ? counts.all : counts[t.id];
    b.append(document.createTextNode(t.label));
    if (typeof n === "number") {
      const badge = document.createElement("span");
      badge.className = "n";
      badge.textContent = String(n);
      b.append(badge);
      // Nothing to show on that channel — visible, but not a dead end to click.
      if (n === 0 && t.id !== null) b.disabled = true;
    }
    b.addEventListener("click", () => { if (channel !== t.id) { channel = t.id; loadList(); } });
    el.channels.append(b);
  }
}

// ── List ────────────────────────────────────────────────────────────────────

async function loadList() {
  el.list.replaceChildren();
  el.listState.hidden = false;
  el.listState.replaceChildren(Object.assign(document.createElement("p"), { textContent: "Loading…" }));
  renderTabs();

  const res = await listInbox({ limit: 50, needsReply: needsReplyOnly, platform: channel });
  if (!res.ok) {
    state(res.status === 401 ? "Your API key was rejected." : (res.error || "Couldn't load your chats."),
          res.status === 401 ? "Open settings" : null);
    return;
  }
  const counts = res.data?.counts ?? {};
  renderTabs(counts);
  el.listCount.textContent = typeof counts.needsReply === "number" ? `${counts.needsReply} waiting` : "";

  const convs = res.data?.conversations ?? [];
  if (!convs.length) {
    const where = channel ? ` in ${channelMeta(channel).label}` : "";
    state(needsReplyOnly ? `Nothing needs a reply${where}.` : `No chats yet${where}.`);
    return;
  }
  el.listState.hidden = true;
  for (const c of convs) el.list.append(rowFor(c));
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

  // Avatar + channel badge — the source is readable without opening the chat.
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
  el.tPhone.textContent = c.phone ? `+${c.phone}` : "";
  el.messages.replaceChildren();
  el.composerMsg.hidden = true;
  el.draft.value = "";
  el.tplParams.value = "";
  applyComposerMode(c);
  showView("thread");

  const res = await getThread({ conversationId: c.id });
  if (!res.ok) { composerMsg("bad", res.error || "Couldn't load this chat."); return; }
  // The list row can be minutes stale — trust the thread's fresher window state.
  current.windowOpen = res.data?.window === "open";
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

// One place decides what the composer allows, so the wording and the controls
// can never disagree about whether a template is required.
function applyComposerMode(c) {
  const st = windowStatus(c);
  el.tStatus.className = `statusbar ${st.state}`;
  el.tStatusLabel.textContent = st.label;
  el.tStatusHint.textContent = st.hint;

  const replyable = isReplyable(c.platform);
  const needsTemplate = replyable && st.state !== "open";

  el.templateRow.hidden = !needsTemplate;
  el.textRow.hidden = needsTemplate;
  el.draft.disabled = !replyable;
  el.suggest.disabled = !replyable || needsTemplate;
  el.send.disabled = !replyable;
  el.send.textContent = needsTemplate ? "Send template" : "Send";
  if (needsTemplate) loadTemplates();
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
  } else {
    composerMsg("bad", res.error || "Couldn't send.");
  }
}

// ── Events ──────────────────────────────────────────────────────────────────

el.filter.addEventListener("click", () => {
  needsReplyOnly = !needsReplyOnly;
  el.filter.setAttribute("aria-pressed", String(needsReplyOnly));
  loadList();
});
el.refresh.addEventListener("click", loadList);
el.back.addEventListener("click", () => { showView("list"); loadList(); });
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
  const { apiKey, baseUrl } = await getSettings();
  if (!apiKey) { showView("connect"); return; }
  try { el.ws.textContent = new URL(baseUrl).hostname.replace(/^app\./, ""); } catch { /* ignore */ }
  showView("list");
  loadList();
})();
