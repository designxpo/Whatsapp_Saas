import { NextResponse } from "next/server";
import { getChannelBySiteKey, sanitizeWidgetConfig } from "@/lib/channels";

export const dynamic = "force-dynamic";

// GET /api/widget/<siteKey>/loader.js — the embeddable web-chat widget.
// Customers add ONE line to their site:
//   <script src="https://app.example.com/api/widget/<siteKey>/loader.js" async></script>
// Dependency-free vanilla JS: floating launcher + chat panel, a localStorage
// visitor id, POST /api/widget/message to send (text bubbles + quick-reply chips
// returned inline) and GET /api/widget/poll for agent/flow replies. Look & feel
// (color/title/subtitle/welcome/position/icon) come from the channel's
// widgetConfig. No `${` / backticks below so it survives this template string.
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
    subtitle: wc.subtitle || "Typically replies instantly",
    welcome: wc.welcome || "",
    position: wc.position === "left" ? "left" : "right",
    icon: wc.iconUrl || "",
    logoFit: wc.logoFit === "contain" ? "contain" : "cover",
  });

  const js = "(function(){\n" +
"  if (window.__alabsWC) return; window.__alabsWC = true;\n" +
"  var CFG = " + cfg + ";\n" +
"  var LS = 'alabs_wc_visitor_' + CFG.siteKey;\n" +
"  var vid = localStorage.getItem(LS);\n" +
"  if (!vid) { vid = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(LS, vid); }\n" +
"  var since = null, open = false, timer = null, seen = {}, greeted = false, busy = false, escalated = false;\n" +
"  var BRAND = CFG.color, SIDE = CFG.position;\n" +
"  function shade(hex){ try{ var h=hex.replace('#',''); if(h.length===3){h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];} var n=parseInt(h,16); var r=Math.max(0,((n>>16)&255)-18),g=Math.max(0,((n>>8)&255)-18),b=Math.max(0,(n&255)-18); return 'rgb('+r+','+g+','+b+')'; }catch(e){ return hex; } }\n" +
"  var DARK = shade(BRAND);\n" +
"  var FIT = CFG.logoFit === 'contain' ? 'contain' : 'cover';\n" +
"  var AVRAD = FIT === 'contain' ? '8px' : '50%';\n" +
"  var LOGO = !!CFG.icon;\n" +                                                            // custom logo uploaded -> launcher is the bare logo, no brand circle                                  // square-ish box for a full logo, circle for a cropped one
"  var HAVBG = (CFG.icon && FIT === 'contain') ? 'transparent' : 'rgba(255,255,255,.22)';\n" +
"  var BAVBG = (CFG.icon && FIT === 'contain') ? 'transparent' : BRAND;\n" +
"  var css = '' +\n" +
"   '.twc-launch{position:fixed;bottom:20px;' + SIDE + ':20px;width:60px;height:60px;border-radius:50%;background:' + BRAND + ';color:#fff;border:none;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.22);z-index:2147483000;display:flex;align-items:center;justify-content:center;transition:transform .15s ease;}' +\n" +
"   '.twc-launch:hover{transform:scale(1.06);}' +\n" +
"   '.twc-launch svg{width:28px;height:28px;}' +\n" +
"   '.twc-launch img{width:34px;height:34px;border-radius:' + AVRAD + ';object-fit:' + FIT + ';}' +\n" +
"   '.twc-launch .twc-x{display:none;font-size:26px;line-height:1;}' +\n" +
"   '.twc-launch.open .twc-ic{display:none;} .twc-launch.open .twc-x{display:block;}' +\n" +
"   '.twc-panel{position:fixed;bottom:92px;' + SIDE + ':20px;width:374px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 120px);background:#fff;border-radius:18px;box-shadow:0 16px 56px rgba(0,0,0,.26);z-index:2147483000;display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;opacity:0;transform:translateY(12px);transition:opacity .18s ease,transform .18s ease;}' +\n" +
"   '.twc-panel.open{display:flex;opacity:1;transform:translateY(0);}' +\n" +
"   '.twc-head{background:linear-gradient(135deg,' + BRAND + ',' + DARK + ');color:#fff;padding:14px 16px;display:flex;align-items:center;gap:11px;}' +\n" +
"   '.twc-head .twc-av{width:38px;height:38px;border-radius:' + AVRAD + ';background:' + HAVBG + ';display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;overflow:hidden;flex:0 0 auto;}' +\n" +
"   '.twc-head .twc-av img{width:100%;height:100%;object-fit:' + FIT + ';}' +\n" +
"   '.twc-head .twc-meta{flex:1;min-width:0;} .twc-head .twc-ttl{font-weight:700;font-size:15px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +\n" +
"   '.twc-head .twc-sub{font-size:11.5px;opacity:.85;display:flex;align-items:center;gap:5px;margin-top:1px;}' +\n" +
"   '.twc-head .twc-dot{width:7px;height:7px;border-radius:50%;background:#5ee08a;box-shadow:0 0 0 2px rgba(94,224,138,.3);}' +\n" +
"   '.twc-head .twc-close{background:transparent;border:none;color:#fff;cursor:pointer;font-size:22px;line-height:1;opacity:.85;padding:0 2px;}' +\n" +
"   '.twc-body{flex:1;overflow-y:auto;padding:16px 14px;background:#f5f6f8;display:flex;flex-direction:column;gap:3px;}' +\n" +
"   '.twc-row{display:flex;align-items:flex-end;gap:8px;margin-top:7px;max-width:100%;}' +\n" +
"   '.twc-row.u{justify-content:flex-end;}' +\n" +
"   '.twc-bav{width:26px;height:26px;border-radius:' + AVRAD + ';background:' + BAVBG + ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex:0 0 auto;overflow:hidden;}' +\n" +
"   '.twc-bav img{width:100%;height:100%;object-fit:' + FIT + ';}' +\n" +
"   '.twc-msg{max-width:76%;padding:10px 13px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-break:break-word;box-shadow:0 1px 1.5px rgba(0,0,0,.06);}' +\n" +
"   '.twc-row.b .twc-msg{background:#fff;color:#15181c;border-radius:16px 16px 16px 4px;}' +\n" +
"   '.twc-row.u .twc-msg{background:' + BRAND + ';color:#fff;border-radius:16px 16px 4px 16px;}' +\n" +
"   '.twc-msg img{max-width:100%;border-radius:10px;display:block;}' +\n" +
"   '.twc-msg a{color:inherit;text-decoration:underline;}' +\n" +
"   '.twc-chips{display:flex;flex-wrap:wrap;gap:7px;margin:7px 0 2px 34px;}' +\n" +
"   '.twc-chip{background:#fff;border:1.5px solid ' + BRAND + ';color:' + BRAND + ';border-radius:18px;padding:7px 13px;font-size:13px;font-weight:600;cursor:pointer;transition:background .12s,color .12s;}' +\n" +
"   '.twc-chip:hover{background:' + BRAND + ';color:#fff;}' +\n" +
"   '.twc-sys{align-self:center;background:#e9ebef;color:#5b626b;font-size:11.5px;padding:5px 12px;border-radius:12px;margin:8px 0;text-align:center;}' +\n" +
"   '.twc-typing{display:flex;gap:4px;padding:12px 14px;background:#fff;border-radius:16px 16px 16px 4px;width:fit-content;box-shadow:0 1px 1.5px rgba(0,0,0,.06);}' +\n" +
"   '.twc-typing span{width:7px;height:7px;border-radius:50%;background:#b3b9c2;animation:twcb 1.2s infinite ease-in-out;}' +\n" +
"   '.twc-typing span:nth-child(2){animation-delay:.18s;} .twc-typing span:nth-child(3){animation-delay:.36s;}' +\n" +
"   '@keyframes twcb{0%,80%,100%{transform:translateY(0);opacity:.5;}40%{transform:translateY(-4px);opacity:1;}}' +\n" +
"   '.twc-foot{border-top:1px solid #eceef1;padding:10px 12px;display:flex;gap:8px;align-items:center;background:#fff;}' +\n" +
"   '.twc-foot input{flex:1;border:1px solid #dde1e6;border-radius:22px;padding:10px 15px;font-size:14px;outline:none;background:#f7f8fa;}' +\n" +
"   '.twc-foot input:focus{border-color:' + BRAND + ';background:#fff;}' +\n" +
"   '.twc-foot .twc-send{width:40px;height:40px;border-radius:50%;background:' + BRAND + ';color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:0 0 auto;}' +\n" +
"   '.twc-foot .twc-send:disabled{opacity:.5;cursor:default;} .twc-foot .twc-send svg{width:19px;height:19px;}' +\n" +
"   '.twc-pow{text-align:center;color:#aab0b8;font-size:10.5px;padding:0 0 8px;background:#fff;}' +\n" +
"   '@media (max-width:768px){ .twc-launch{width:52px;height:52px;bottom:12%;' + SIDE + ':15px;} .twc-launch svg{width:24px;height:24px;} .twc-panel{bottom:0;' + SIDE + ':0;left:0;right:0;width:100vw;max-width:100vw;height:100vh;max-height:100vh;border-radius:0;} html[data-twc-trig] .twc-launch{display:none!important;} }' +\n" +
"   (LOGO ? '.twc-launch{background:transparent;box-shadow:none;} .twc-launch .twc-ic{width:100%;height:100%;display:flex;align-items:center;justify-content:center;} .twc-launch .twc-ic img{width:100%;height:100%;border-radius:' + AVRAD + ';object-fit:' + FIT + ';filter:drop-shadow(0 5px 14px rgba(0,0,0,.30));} .twc-launch.open{background:' + BRAND + ';box-shadow:0 8px 24px rgba(0,0,0,.22);} .twc-launch.open .twc-x{color:#fff;}' : '');\n" +
"  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);\n" +
"  var initial = (CFG.title || 'A').trim().charAt(0).toUpperCase();\n" +
"  var SEND_SVG = '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><line x1=\"22\" y1=\"2\" x2=\"11\" y2=\"13\"></line><polygon points=\"22 2 15 22 11 13 2 9 22 2\"></polygon></svg>';\n" +
"  var CHAT_SVG = '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z\"></path></svg>';\n" +
"  var avInner = CFG.icon ? '<img alt=\"\" src=\"' + CFG.icon + '\">' : initial;\n" +
"  var btn = document.createElement('button'); btn.className = 'twc-launch'; btn.setAttribute('aria-label','Chat with us');\n" +
"  btn.innerHTML = '<span class=\"twc-ic\">' + (CFG.icon ? '<img alt=\"\" src=\"' + CFG.icon + '\">' : CHAT_SVG) + '</span><span class=\"twc-x\">&times;</span>';\n" +
"  var panel = document.createElement('div'); panel.className = 'twc-panel';\n" +
"  panel.innerHTML = '<div class=\"twc-head\"><div class=\"twc-av\">' + avInner + '</div><div class=\"twc-meta\"><div class=\"twc-ttl\"></div><div class=\"twc-sub\"><span class=\"twc-dot\"></span><span class=\"twc-subt\"></span></div></div><button class=\"twc-close\" aria-label=\"Close\">&times;</button></div>' +\n" +
"    '<div class=\"twc-body\"></div>' +\n" +
"    '<div class=\"twc-pow\">Powered by Talko AI</div>' +\n" +
"    '<div class=\"twc-foot\"><input type=\"text\" placeholder=\"Type a message...\" /><button class=\"twc-send\" aria-label=\"Send\">' + SEND_SVG + '</button></div>';\n" +
"  document.body.appendChild(btn); document.body.appendChild(panel);\n" +
"  panel.querySelector('.twc-ttl').textContent = CFG.title;\n" +
"  panel.querySelector('.twc-subt').textContent = CFG.subtitle;\n" +
"  var body = panel.querySelector('.twc-body');\n" +
"  var input = panel.querySelector('.twc-foot input');\n" +
"  var sendBtn = panel.querySelector('.twc-send');\n" +
"  function esc(s){ var d=document.createElement('div'); d.textContent=s; return d.innerHTML; }\n" +
"  function linkify(s){ return esc(s).replace(/(https?:\\/\\/[^\\s]+)/g, function(u){ return '<a href=\"' + u + '\" target=\"_blank\" rel=\"noopener\">' + u + '</a>'; }); }\n" +
"  function clearChips(){ var c=body.querySelectorAll('.twc-chips'); for(var i=0;i<c.length;i++){ c[i].parentNode.removeChild(c[i]); } }\n" +
"  function addRow(role, html){ var row=document.createElement('div'); row.className='twc-row '+(role==='u'?'u':'b'); var inner=''; if(role!=='u'){ inner='<div class=\"twc-bav\">' + avInner + '</div>'; } inner+='<div class=\"twc-msg\">'+html+'</div>'; row.innerHTML=inner; body.appendChild(row); body.scrollTop=body.scrollHeight; return row; }\n" +
"  function addUser(text){ addRow('u', linkify(text)); }\n" +
"  function addBot(m){ var html=''; if(m.mediaUrl){ html+='<img alt=\"\" src=\"'+esc(m.mediaUrl)+'\">'; } if(m.body){ if(html){html+='<br>';} html+=linkify(m.body); } if(!html){ return; } addRow('b', html); if(m.options && m.options.length){ var wrap=document.createElement('div'); wrap.className='twc-chips'; m.options.forEach(function(o){ var ch=document.createElement('button'); ch.className='twc-chip'; ch.textContent=o; ch.addEventListener('click', function(){ clearChips(); send(o); }); wrap.appendChild(ch); }); body.appendChild(wrap); body.scrollTop=body.scrollHeight; } }\n" +
"  function sysBanner(text){ var d=document.createElement('div'); d.className='twc-sys'; d.textContent=text; body.appendChild(d); body.scrollTop=body.scrollHeight; }\n" +
"  function render(arr){ (arr||[]).forEach(function(m){ if(m.id && seen[m.id]) return; if(m.id) seen[m.id]=1; if(m.at) since=m.at; addBot(m); }); }\n" +
"  var typingEl=null;\n" +
"  function showTyping(){ if(typingEl) return; var row=document.createElement('div'); row.className='twc-row b'; row.innerHTML='<div class=\"twc-bav\">' + avInner + '</div><div class=\"twc-typing\"><span></span><span></span><span></span></div>'; body.appendChild(row); body.scrollTop=body.scrollHeight; typingEl=row; }\n" +
"  function hideTyping(){ if(typingEl){ typingEl.parentNode.removeChild(typingEl); typingEl=null; } }\n" +
"  function poll(){ fetch(CFG.base+'/api/widget/poll?siteKey='+encodeURIComponent(CFG.siteKey)+'&visitorId='+encodeURIComponent(vid)+(since?'&since='+encodeURIComponent(since):''),{}).then(function(r){return r.json();}).then(function(d){ render(d.messages); if(d.status==='escalated' && !escalated){ escalated=true; sysBanner('Connecting you with our team — someone will reply here shortly.'); } }).catch(function(){}); }\n" +
"  function send(t){ t=(t==null?(input.value||''):t).trim(); if(!t||busy) return; input.value=''; clearChips(); addUser(t); busy=true; sendBtn.disabled=true; showTyping(); fetch(CFG.base+'/api/widget/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({siteKey:CFG.siteKey,visitorId:vid,text:t})}).then(function(r){return r.json();}).then(function(d){ hideTyping(); busy=false; sendBtn.disabled=false; var msgs=(d&&d.messages)?d.messages:(d&&d.reply?[{body:d.reply,id:d.id,at:d.at}]:[]); render(msgs); if(d&&d.escalated && !escalated){ escalated=true; sysBanner('Connecting you with our team — someone will reply here shortly.'); } }).catch(function(){ hideTyping(); busy=false; sendBtn.disabled=false; addBot({body:'Sorry, something went wrong. Please try again.'}); }); }\n" +
"  function toggle(o){ open=(o===undefined?!open:o); panel.className='twc-panel'+(open?' open':''); btn.className='twc-launch'+(open?' open':''); if(open){ if(CFG.welcome && !greeted){ greeted=true; addBot({body:CFG.welcome}); } setTimeout(function(){ input.focus(); },200); poll(); if(!timer) timer=setInterval(poll, 4000); } }\n" +
"  btn.addEventListener('click', function(){ toggle(); });\n" +
"  panel.querySelector('.twc-close').addEventListener('click', function(){ toggle(false); });\n" +
"  sendBtn.addEventListener('click', function(){ send(); });\n" +
"  input.addEventListener('keydown', function(e){ if(e.key==='Enter'){ send(); } });\n" +
"  // Public API + open-from-any-element: put data-alabs-chat on a link/button (e.g.\n" +
"  // a sticky-footer <li>) to open the chat. When such a trigger exists the floating\n" +
"  // launcher is hidden on mobile so it doesn't obstruct — the footer item opens it.\n" +
"  window.AlabsWC = { open: function(){ toggle(true); }, close: function(){ toggle(false); }, toggle: function(){ toggle(); } };\n" +
"  function twcTrig(){ if (document.querySelector('[data-alabs-chat]')) document.documentElement.setAttribute('data-twc-trig','1'); }\n" +
"  twcTrig(); if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', twcTrig); }\n" +
"  document.addEventListener('click', function(e){ var el = e.target; var t = (el && el.closest) ? el.closest('[data-alabs-chat]') : null; if (t) { e.preventDefault(); toggle(true); } });\n" +
"})();\n";

  return new NextResponse(js, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
