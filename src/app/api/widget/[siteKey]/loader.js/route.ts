import { NextResponse } from "next/server";
import { getChannelBySiteKey, sanitizeWidgetConfig } from "@/lib/channels";

export const dynamic = "force-dynamic";

// GET /api/widget/<siteKey>/loader.js — the embeddable web-chat widget.
// Customers add ONE line to their site:
//   <script src="https://app.example.com/api/widget/<siteKey>/loader.js" async></script>
// Dependency-free vanilla JS: floating bubble + panel, a localStorage visitor id,
// POST /api/widget/message to send (reply returned inline) and GET /api/widget/poll
// to receive agent replies. Look & feel (color/title/welcome/position) come from
// the channel's widgetConfig. No `${` / backticks below so it survives this template.
export async function GET(req: Request, { params }: { params: Promise<{ siteKey: string }> }) {
  const { siteKey } = await params;
  const base = new URL(req.url).origin;

  // Pull the widget's look & feel (sanitized — color is injected into CSS).
  const ch = await getChannelBySiteKey(siteKey).catch(() => null);
  const wc = sanitizeWidgetConfig(ch?.widgetConfig);
  const cfg = JSON.stringify({
    siteKey, base,
    color: wc.color || "#0783fd",
    title: wc.title || "Chat with us",
    welcome: wc.welcome || "",
    position: wc.position === "left" ? "left" : "right",
  });

  const js = "(function(){\n" +
"  if (window.__talkoWC) return; window.__talkoWC = true;\n" +
"  var CFG = " + cfg + ";\n" +
"  var LS = 'talko_wc_visitor_' + CFG.siteKey;\n" +
"  var vid = localStorage.getItem(LS);\n" +
"  if (!vid) { vid = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(LS, vid); }\n" +
"  var since = null, open = false, timer = null, seen = {}, greeted = false;\n" +
"  var BRAND = CFG.color, SIDE = CFG.position;\n" +
"  var css = '' +\n" +
"   '.twc-btn{position:fixed;bottom:20px;' + SIDE + ':20px;width:56px;height:56px;border-radius:50%;background:' + BRAND + ';color:#fff;border:none;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.18);z-index:2147483000;display:flex;align-items:center;justify-content:center;}' +\n" +
"   '.twc-btn svg{width:26px;height:26px;}' +\n" +
"   '.twc-panel{position:fixed;bottom:88px;' + SIDE + ':20px;width:360px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;box-shadow:0 12px 48px rgba(0,0,0,.22);z-index:2147483000;display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;}' +\n" +
"   '.twc-panel.open{display:flex;}' +\n" +
"   '.twc-head{background:' + BRAND + ';color:#fff;padding:14px 16px;font-weight:700;font-size:15px;display:flex;align-items:center;justify-content:space-between;}' +\n" +
"   '.twc-head button{background:transparent;border:none;color:#fff;cursor:pointer;font-size:20px;line-height:1;opacity:.8;}' +\n" +
"   '.twc-body{flex:1;overflow-y:auto;padding:14px;background:#f7f8fa;display:flex;flex-direction:column;gap:8px;}' +\n" +
"   '.twc-msg{max-width:78%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-break:break-word;}' +\n" +
"   '.twc-u{align-self:flex-end;background:' + BRAND + ';color:#fff;border-bottom-right-radius:4px;}' +\n" +
"   '.twc-b{align-self:flex-start;background:#fff;color:#1a1a1a;border:1px solid #e6e8eb;border-bottom-left-radius:4px;}' +\n" +
"   '.twc-foot{border-top:1px solid #eceef0;padding:10px;display:flex;gap:8px;background:#fff;}' +\n" +
"   '.twc-foot input{flex:1;border:1px solid #dfe2e6;border-radius:10px;padding:9px 12px;font-size:14px;outline:none;}' +\n" +
"   '.twc-foot button{background:' + BRAND + ';color:#fff;border:none;border-radius:10px;padding:0 14px;font-weight:700;cursor:pointer;}' +\n" +
"   '.twc-note{text-align:center;color:#9aa0a6;font-size:11px;padding:4px 0 8px;}';\n" +
"  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);\n" +
"  var btn = document.createElement('button'); btn.className = 'twc-btn'; btn.setAttribute('aria-label','Chat with us');\n" +
"  btn.innerHTML = '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z\"></path></svg>';\n" +
"  var panel = document.createElement('div'); panel.className = 'twc-panel';\n" +
"  panel.innerHTML = '<div class=\"twc-head\"><span class=\"twc-ttl\"></span><button aria-label=\"Close\">&times;</button></div>' +\n" +
"    '<div class=\"twc-body\"></div>' +\n" +
"    '<div class=\"twc-note\">Powered by Talko AI</div>' +\n" +
"    '<div class=\"twc-foot\"><input type=\"text\" placeholder=\"Type a message...\" /><button>Send</button></div>';\n" +
"  document.body.appendChild(btn); document.body.appendChild(panel);\n" +
"  panel.querySelector('.twc-ttl').textContent = CFG.title;\n" +
"  var body = panel.querySelector('.twc-body');\n" +
"  var input = panel.querySelector('.twc-foot input');\n" +
"  var sendBtn = panel.querySelector('.twc-foot button');\n" +
"  function add(role, text){ if(!text) return; var d=document.createElement('div'); d.className='twc-msg '+(role==='u'?'twc-u':'twc-b'); d.textContent=text; body.appendChild(d); body.scrollTop=body.scrollHeight; }\n" +
"  function poll(){ fetch(CFG.base+'/api/widget/poll?siteKey='+encodeURIComponent(CFG.siteKey)+'&visitorId='+encodeURIComponent(vid)+(since?'&since='+encodeURIComponent(since):''),{}).then(function(r){return r.json();}).then(function(d){ (d.messages||[]).forEach(function(m){ if(seen[m.id]) return; seen[m.id]=1; since=m.at; add('b', m.body); }); }).catch(function(){}); }\n" +
"  function send(){ var t=(input.value||'').trim(); if(!t) return; input.value=''; add('u', t); fetch(CFG.base+'/api/widget/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({siteKey:CFG.siteKey,visitorId:vid,text:t})}).then(function(r){return r.json();}).then(function(d){ if(d&&d.reply){ add('b', d.reply); } }).catch(function(){ add('b','Sorry, something went wrong. Please try again.'); }); }\n" +
"  function toggle(o){ open = (o===undefined?!open:o); panel.className='twc-panel'+(open?' open':''); if(open){ if(CFG.welcome && !greeted){ greeted=true; add('b', CFG.welcome); } input.focus(); poll(); if(!timer) timer=setInterval(poll, 4000); } }\n" +
"  btn.addEventListener('click', function(){ toggle(); });\n" +
"  panel.querySelector('.twc-head button').addEventListener('click', function(){ toggle(false); });\n" +
"  sendBtn.addEventListener('click', send);\n" +
"  input.addEventListener('keydown', function(e){ if(e.key==='Enter'){ send(); } });\n" +
"})();\n";

  return new NextResponse(js, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
