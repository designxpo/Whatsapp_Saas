import { getSettings, listInbox, getThread, sendReply, suggestReply, listTemplates } from "./api.js";

const $ = (id) => document.getElementById(id);
const el = {
  ws: $("ws"), filter: $("filter"), refresh: $("refresh"),
  connect: $("connect"), openOpts: $("openOpts"),
  listView: $("listView"), list: $("list"), listState: $("listState"),
  threadView: $("threadView"), back: $("back"), tName: $("tName"), tPhone: $("tPhone"), tWindow: $("tWindow"),
  messages: $("messages"), closedNotice: $("closedNotice"), draft: $("draft"),
  templateRow: $("templateRow"), tplName: $("tplName"), tplParams: $("tplParams"), tplHint: $("tplHint"),
  suggest: $("suggest"), send: $("send"), composerMsg: $("composerMsg"),
};

let needsReplyOnly = false;
let current = null; // { conversationId, phone, name, windowOpen }

function ago(iso) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / 604800)}w`;
}
const initials = (name) => (name || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";

function showView(which) {
  el.connect.hidden = which !== "connect";
  el.listView.hidden = which !== "list";
  el.threadView.hidden = which !== "thread";
}

// List ------------------------------------------------------------------------

async function loadList() {
  el.listState.hidden = false;
  el.listState.textContent = "Loading…";
  el.list.innerHTML = "";
  const res = await listInbox({ limit: 50, needsReply: needsReplyOnly });
  if (!res.ok) {
    el.listState.hidden = false;
    el.listState.textContent = res.status === 401 ? "API key invalid — open settings." : (res.error || "Couldn't load conversations.");
    return;
  }
  const convs = res.data?.conversations ?? [];
  if (!convs.length) {
    el.listState.hidden = false;
    el.listState.textContent = needsReplyOnly ? "Nothing needs a reply. 🎉" : "No conversations yet.";
    return;
  }
  el.listState.hidden = true;
  for (const c of convs) el.list.appendChild(rowFor(c));
}

function rowFor(c) {
  const li = document.createElement("li");
  li.className = "row";
  li.tabIndex = 0;

  const av = document.createElement("div");
  av.className = "avatar";
  av.textContent = initials(c.name);

  const mid = document.createElement("div");
  mid.className = "rowmid";
  const nameLine = document.createElement("div");
  nameLine.className = "rowname";
  const dot = document.createElement("span");
  dot.className = `dot ${c.windowOpen ? "open" : "closed"}`;
  dot.title = c.windowOpen ? "24h window open" : "24h window closed";
  const nm = document.createElement("span");
  nm.className = "nm";
  nm.textContent = c.name;
  nameLine.append(dot, nm);
  const prev = document.createElement("div");
  prev.className = "preview";
  prev.textContent = c.lastMessage || "—";
  mid.append(nameLine, prev);

  const right = document.createElement("div");
  right.className = "rowright";
  const t = document.createElement("span");
  t.className = "time";
  t.textContent = ago(c.lastInboundAt || c.lastOutboundAt);
  right.append(t);
  if (c.needsReply) {
    const b = document.createElement("span");
    b.className = "badge";
    b.textContent = "reply";
    right.append(b);
  }

  li.append(av, mid, right);
  const open = () => openThread(c);
  li.addEventListener("click", open);
  li.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
  return li;
}

// Thread ----------------------------------------------------------------------

async function openThread(c) {
  current = { conversationId: c.id, phone: c.phone, name: c.name, windowOpen: c.windowOpen };
  el.tName.textContent = c.name;
  el.tPhone.textContent = c.phone ? `+${c.phone}` : "";
  el.messages.innerHTML = "";
  el.composerMsg.hidden = true;
  el.draft.value = "";
  el.tplName.value = ""; el.tplParams.value = "";
  showView("thread");

  const res = await getThread({ conversationId: c.id });
  if (!res.ok) { composerMsg("bad", res.error || "Couldn't load the thread."); return; }
  const windowOpen = res.data?.window === "open";
  current.windowOpen = windowOpen;
  el.tWindow.textContent = windowOpen ? "● open" : "○ closed";
  el.tWindow.className = `wpill ${windowOpen ? "open" : "closed"}`;
  el.closedNotice.hidden = windowOpen;
  el.templateRow.hidden = windowOpen;
  el.draft.placeholder = windowOpen ? "Write a reply…" : "Notes / draft (send uses a template below)";
  if (!windowOpen) loadTemplates();

  for (const m of res.data?.messages ?? []) el.messages.appendChild(bubble(m));
  el.messages.scrollTop = el.messages.scrollHeight;
}

async function loadTemplates() {
  el.tplName.innerHTML = '<option value="">Loading templates…</option>';
  el.tplParams.hidden = true;
  el.tplHint.hidden = true;
  const res = await listTemplates({ conversationId: current.conversationId });
  const templates = res.ok ? (res.data?.templates ?? []) : [];
  if (!templates.length) {
    el.tplName.innerHTML = '<option value="">No approved templates</option>';
    el.tplHint.hidden = false;
    el.tplHint.textContent = res.data?.notice || "No approved templates on this number yet.";
    return;
  }
  el.tplName.innerHTML = '<option value="">Choose an approved template…</option>';
  for (const t of templates) {
    const opt = document.createElement("option");
    opt.value = t.name;
    opt.dataset.lang = t.language;
    opt.dataset.params = String(t.params || 0);
    opt.textContent = `${t.name} · ${t.language}${t.params ? ` · ${t.params} value${t.params > 1 ? "s" : ""}` : ""}`;
    el.tplName.appendChild(opt);
  }
}

function bubble(m) {
  const d = document.createElement("div");
  d.className = `msg ${m.role === "user" ? "user" : "assistant"}`;
  d.textContent = m.body || (m.mediaType ? `[${m.mediaType}]` : "");
  const meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent = `${m.source === "agent" ? "you" : m.source === "bot" ? "AI" : "lead"} · ${ago(m.createdAt)}`;
  d.append(meta);
  return d;
}

function composerMsg(kind, text) {
  el.composerMsg.hidden = false;
  el.composerMsg.className = `cmsg ${kind}`;
  el.composerMsg.textContent = text;
}

async function doSuggest() {
  if (!current) return;
  el.suggest.disabled = true;
  el.suggest.textContent = "Drafting…";
  const res = await suggestReply({ conversationId: current.conversationId });
  el.suggest.disabled = false;
  el.suggest.textContent = "✨ Draft with AI";
  if (res.ok && res.data?.suggestion) { el.draft.value = res.data.suggestion; el.draft.focus(); composerMsg("ok", "Draft ready — review, edit, then send."); }
  else composerMsg("bad", res.data?.escalate ? "The AI suggests a human should handle this one." : (res.error || "Couldn't draft a reply."));
}

async function doSend() {
  if (!current) return;
  const payload = { conversationId: current.conversationId };
  if (current.windowOpen) {
    const message = el.draft.value.trim();
    if (!message) { composerMsg("bad", "Write a message first."); return; }
    payload.message = message;
  } else {
    const opt = el.tplName.selectedOptions[0];
    const templateName = el.tplName.value.trim();
    if (!templateName) { composerMsg("bad", "The window is closed — choose an approved template."); return; }
    payload.templateName = templateName;
    if (opt?.dataset.lang) payload.templateLang = opt.dataset.lang;
    const needed = Number(opt?.dataset.params || 0);
    const params = el.tplParams.value.split(",").map(s => s.trim()).filter(Boolean);
    if (needed && params.length < needed) { composerMsg("bad", `This template needs ${needed} value${needed > 1 ? "s" : ""}.`); return; }
    if (params.length) payload.templateParams = params;
  }
  el.send.disabled = true;
  el.send.textContent = "Sending…";
  const res = await sendReply(payload);
  el.send.disabled = false;
  el.send.textContent = "Send";
  if (res.ok) {
    composerMsg("ok", "Sent ✓");
    el.messages.appendChild(bubble({ role: "assistant", body: payload.message || `[template: ${payload.templateName}]`, source: "agent", createdAt: new Date().toISOString() }));
    el.messages.scrollTop = el.messages.scrollHeight;
    el.draft.value = "";
  } else {
    composerMsg("bad", res.error || "Couldn't send.");
  }
}

// Events ----------------------------------------------------------------------

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
  el.tplHint.textContent = n ? `Fill ${n} value${n > 1 ? "s" : ""}, comma-separated.` : el.tplName.value ? "No values needed." : "";
});
el.suggest.addEventListener("click", doSuggest);
el.send.addEventListener("click", doSend);
el.openOpts.addEventListener("click", () => chrome.runtime.openOptionsPage());
el.draft.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") doSend(); });

// Boot ------------------------------------------------------------------------
(async () => {
  const { apiKey, baseUrl } = await getSettings();
  if (!apiKey) { showView("connect"); return; }
  el.ws.textContent = "Inbox";
  try { el.ws.title = new URL(baseUrl).hostname; } catch { /* ignore */ }
  showView("list");
  loadList();
})();
