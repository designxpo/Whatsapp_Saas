// Content script — the "act on your selection" chip.
//
// COMPLIANCE: this script does NOT read, scrape, crawl, or automate the host
// page. It reacts ONLY to text the user highlights themselves, and only to
// OFFER an action. Nothing is captured, drafted, or sent without a click, and
// all network calls happen in the background worker — never here.
//
//   • Any page, selection contains a phone → "Add to Talko" (capture a lead)
//   • YouTube / Google Business → also "Draft reply" (AI draft, copied for you)

(() => {
  const PHONE_RE = /\+?\d[\d\s().-]{7,16}\d/;
  const host = location.hostname;
  const REPLY_KIND =
    /(^|\.)youtube\.com$/.test(host) ? "comment"
    : /(^|\.)business\.google\.com$/.test(host) || /(^|\.)maps\.google\./.test(host) ? "review"
    : null;

  let box = null;
  let hideTimer = null;

  const clearTimer = () => { clearTimeout(hideTimer); hideTimer = null; };
  function remove() { if (box) { box.remove(); box = null; } clearTimer(); }
  function scheduleClose(ms) { clearTimer(); hideTimer = setTimeout(remove, ms); }

  function selectionText() {
    const s = window.getSelection?.();
    return s && s.rangeCount ? String(s).replace(/\s+/g, " ").trim() : "";
  }
  function selectionRect() {
    const s = window.getSelection();
    if (!s || !s.rangeCount) return null;
    const r = s.getRangeAt(0).getBoundingClientRect();
    return r && (r.width || r.height) ? r : null;
  }

  function makeBox(rect) {
    remove();
    box = document.createElement("div");
    box.className = "talko-cap";
    box.style.top = `${Math.max(8, rect.top - 46)}px`;
    box.style.left = `${Math.min(Math.max(8, rect.left), window.innerWidth - 340)}px`;
    box.addEventListener("mousedown", (e) => e.preventDefault()); // keep selection alive
    document.documentElement.appendChild(box);
    hideTimer = setTimeout(remove, 7000);
    return box;
  }

  function btn(label, cls, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `talko-cap-btn ${cls}`;
    b.textContent = label;
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); onClick(b); });
    return b;
  }

  function status(text, cls) {
    if (!box) return;
    box.className = "talko-cap";
    box.innerHTML = "";
    const s = document.createElement("div");
    s.className = `talko-cap-status ${cls || ""}`;
    s.textContent = text;
    box.appendChild(s);
  }

  // Actions -------------------------------------------------------------------

  function doCapture(text) {
    status("Adding…", "busy");
    chrome.runtime.sendMessage({ type: "CAPTURE_TEXT", payload: { text, sourceUrl: location.href } }, (res) => {
      if (chrome.runtime.lastError) { status("Extension error", "err"); scheduleClose(2500); return; }
      if (res?.ok) { status("Added to Talko ✓", "ok"); scheduleClose(1800); }
      else if (res?.error === "no-phone") { status("No phone number found", "err"); scheduleClose(2200); }
      else { status(res?.error?.slice(0, 48) || "Couldn't add", "err"); scheduleClose(2800); }
    });
  }

  function doDraft(text) {
    status("Drafting a reply…", "busy");
    chrome.runtime.sendMessage({ type: "DRAFT_REPLY", payload: { text, kind: REPLY_KIND } }, (res) => {
      if (chrome.runtime.lastError) { status("Extension error", "err"); scheduleClose(2500); return; }
      if (res?.ok && res.data?.suggestion) { showDraft(res.data.suggestion); return; }
      status(res?.error?.slice(0, 60) || "Couldn't draft a reply", "err");
      scheduleClose(3000);
    });
  }

  function showDraft(text) {
    if (!box) return;
    clearTimer(); // keep open while the user reads/copies
    box.className = "talko-cap talko-cap-card";
    box.innerHTML = "";
    const label = document.createElement("div");
    label.className = "talko-cap-label";
    label.textContent = "Suggested reply — review before posting";
    const body = document.createElement("div");
    body.className = "talko-cap-draft";
    body.textContent = text;
    const bar = document.createElement("div");
    bar.className = "talko-cap-bar";
    const copy = btn("Copy", "cap", async (self) => {
      await navigator.clipboard.writeText(text).catch(() => {});
      self.textContent = "Copied ✓";
    });
    bar.append(copy, btn("✕", "ghost", remove));
    box.append(label, body, bar);
  }

  // Trigger -------------------------------------------------------------------

  function onSettled() {
    const text = selectionText();
    if (!text) { remove(); return; }
    const hasPhone = PHONE_RE.test(text);
    const canDraft = !!REPLY_KIND && text.length >= 15;
    if (!hasPhone && !canDraft) { remove(); return; }
    const rect = selectionRect();
    if (!rect) { remove(); return; }

    makeBox(rect);
    const bar = document.createElement("div");
    bar.className = "talko-cap-bar";
    if (hasPhone) bar.appendChild(btn("＋ Add to Talko", "cap", () => doCapture(text)));
    if (canDraft) bar.appendChild(btn("✨ Draft reply", "draft", () => doDraft(text)));
    box.appendChild(bar);
  }

  document.addEventListener("mouseup", () => setTimeout(onSettled, 10), true);
  document.addEventListener("scroll", remove, { passive: true, capture: true });
  document.addEventListener("mousedown", (e) => { if (box && !box.contains(e.target)) remove(); }, true);
})();
