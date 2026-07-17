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
    // Escaped defensively — it is concatenated into <img src="..."> markup.
    icon: (wc.iconUrl || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
    logoFit: wc.logoFit === "contain" ? "contain" : "cover",
    // Launcher offsets (px) — null = the built-in defaults. Lets a site nudge the
    // bubble clear of its own floating buttons (scroll-to-top, call widgets…).
    offsetSide: typeof wc.offsetSide === "number" ? wc.offsetSide : null,
    offsetBottom: typeof wc.offsetBottom === "number" ? wc.offsetBottom : null,
  });

  const js = "(function(){\n" +
"  if (window.__alabsWC) return; window.__alabsWC = true;\n" +
"  var CFG = " + cfg + ";\n" +
"  var LS = 'alabs_wc_visitor_' + CFG.siteKey;\n" +
"  var vid = localStorage.getItem(LS);\n" +
"  if (!vid) { vid = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(LS, vid); }\n" +
"  var since = null, open = false, timer = null, seen = {}, greeted = false, busy = false, escalated = false;\n" +
"  var BRAND = CFG.color, SIDE = CFG.position;\n" +
"  var OB = (CFG.offsetBottom==null?20:CFG.offsetBottom), OS = (CFG.offsetSide==null?20:CFG.offsetSide);\n" +
"  var MB = (CFG.offsetBottom==null?'12%':(OB+'px')), MS = (CFG.offsetSide==null?15:OS);\n" +   // mobile keeps its higher default unless explicitly overridden
"  function shade(hex){ try{ var h=hex.replace('#',''); if(h.length===3){h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];} var n=parseInt(h,16); var r=Math.max(0,((n>>16)&255)-18),g=Math.max(0,((n>>8)&255)-18),b=Math.max(0,(n&255)-18); return 'rgb('+r+','+g+','+b+')'; }catch(e){ return hex; } }\n" +
"  var DARK = shade(BRAND);\n" +
"  var FIT = CFG.logoFit === 'contain' ? 'contain' : 'cover';\n" +
"  var AVRAD = FIT === 'contain' ? '8px' : '50%';\n" +
"  var LOGO = !!CFG.icon;\n" +                                                            // custom logo uploaded -> launcher is the bare logo, no brand circle                                  // square-ish box for a full logo, circle for a cropped one
"  var HAVBG = (CFG.icon && FIT === 'contain') ? '#fff' : 'rgba(255,255,255,.22)';\n" +
"  var BAVBG = (CFG.icon && FIT === 'contain') ? '#fff' : BRAND;\n" +
"  var IMGSZ = (CFG.icon && FIT === 'contain') ? 'width:84%;height:84%;object-fit:contain;' : 'width:100%;height:100%;object-fit:' + FIT + ';';\n" +
"  var css = '' +\n" +
"   '.twc-launch{position:fixed;bottom:' + OB + 'px;' + SIDE + ':' + OS + 'px;width:60px;height:60px;border-radius:50%;background:' + BRAND + ';color:#fff;border:none;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.22);z-index:2147483000;display:flex;align-items:center;justify-content:center;transition:transform .15s ease,box-shadow .15s ease;animation:twcin .25s ease;}' +\n" +
"   '.twc-launch:hover{transform:translateY(-2px) scale(1.05);}' +\n" +
"   '@keyframes twcin{from{opacity:0;transform:scale(.6);}to{opacity:1;transform:scale(1);}}' +\n" +
"   '.twc-launch svg{width:28px;height:28px;}' +\n" +
"   '.twc-launch img{width:34px;height:34px;border-radius:' + AVRAD + ';object-fit:' + FIT + ';}' +\n" +
"   '.twc-launch .twc-x{display:none;font-size:26px;line-height:1;}' +\n" +
"   '.twc-launch.open .twc-ic{display:none;} .twc-launch.open .twc-x{display:block;}' +\n" +
"   '.twc-panel{position:fixed;bottom:' + (OB + 72) + 'px;' + SIDE + ':' + OS + 'px;width:374px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 120px);background:#fff;border-radius:18px;box-shadow:0 16px 56px rgba(0,0,0,.26);z-index:2147483000;display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;opacity:0;transform:translateY(12px);transition:opacity .18s ease,transform .18s ease;}' +\n" +
"   '.twc-panel.open{display:flex;opacity:1;transform:translateY(0);}' +\n" +
"   '.twc-head{background:linear-gradient(135deg,' + BRAND + ',' + DARK + ');color:#fff;padding:14px 16px;display:flex;align-items:center;gap:11px;}' +\n" +
"   '.twc-head .twc-av{width:38px;height:38px;border-radius:' + AVRAD + ';background:' + HAVBG + ';display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;overflow:hidden;flex:0 0 auto;}' +\n" +
"   '.twc-head .twc-av img{' + IMGSZ + '}' +\n" +
"   '.twc-head .twc-meta{flex:1;min-width:0;} .twc-head .twc-ttl{font-weight:700;font-size:15px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +\n" +
"   '.twc-head .twc-sub{font-size:11.5px;opacity:.85;display:flex;align-items:center;gap:5px;margin-top:1px;}' +\n" +
"   '.twc-head .twc-dot{width:7px;height:7px;border-radius:50%;background:#5ee08a;box-shadow:0 0 0 2px rgba(94,224,138,.3);}' +\n" +
"   '.twc-head .twc-close{background:transparent;border:none;color:#fff;cursor:pointer;font-size:22px;line-height:1;opacity:.85;padding:0 2px;}' +\n" +
"   '.twc-body{flex:1;overflow-y:auto;padding:16px 14px;background:#f5f6f8;display:flex;flex-direction:column;gap:3px;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;}' +\n" +
"   '.twc-row{display:flex;align-items:flex-end;gap:8px;margin-top:7px;max-width:100%;}' +\n" +
"   '.twc-row.u{justify-content:flex-end;}' +\n" +
"   '.twc-bav{width:26px;height:26px;border-radius:' + AVRAD + ';background:' + BAVBG + ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex:0 0 auto;overflow:hidden;}' +\n" +
"   '.twc-bav{box-shadow:0 0 0 1px rgba(15,23,42,.08);}' +\n" +
"   '.twc-bav img{' + IMGSZ + '}' +\n" +
"   '.twc-msg{max-width:76%;padding:10px 13px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-break:break-word;box-shadow:0 1px 1.5px rgba(0,0,0,.06);}' +\n" +
"   '.twc-row.b .twc-msg{background:#fff;color:#15181c;border-radius:16px 16px 16px 4px;}' +\n" +
"   '.twc-row.u .twc-msg{background:' + BRAND + ';color:#fff;border-radius:16px 16px 4px 16px;}' +\n" +
"   '.twc-msg img{max-width:100%;border-radius:10px;display:block;}' +\n" +
"   '.twc-msg a{color:inherit;text-decoration:underline;font-weight:600;word-break:break-all;}' +\n" +
"   '.twc-msg video{max-width:100%;border-radius:10px;display:block;}' +\n" +
"   '.twc-msg audio{max-width:100%;display:block;}' +\n" +
"   '.twc-file{display:flex;align-items:center;gap:8px;margin-top:7px;padding:9px 12px;border:1.5px solid ' + BRAND + ';border-radius:12px;color:' + BRAND + '!important;background:#fff;text-decoration:none!important;font-weight:700;font-size:13px;line-height:1.2;}' +\n" +
"   '.twc-file svg{width:18px;height:18px;flex:0 0 auto;}' +\n" +
"   '.twc-row.u .twc-file{border-color:rgba(255,255,255,.75);color:#fff!important;background:transparent;}' +\n" +
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
"   '@media (max-width:768px){ .twc-launch{width:52px;height:52px;bottom:' + MB + ';' + SIDE + ':' + MS + 'px;} .twc-launch svg{width:24px;height:24px;} .twc-panel{top:0;bottom:auto;' + SIDE + ':0;left:0;right:0;width:100vw;max-width:100vw;height:100vh;height:100dvh;max-height:none;border-radius:0;transform:none;transition:opacity .18s ease;} .twc-head{padding-top:calc(14px + env(safe-area-inset-top,0px));} .twc-foot{padding-bottom:calc(10px + env(safe-area-inset-bottom,0px));} .twc-foot input{font-size:16px;} .twc-close{padding:6px 10px;} html[data-twc-trig] .twc-launch{display:none!important;} }' +\n" +
"   (LOGO ? '.twc-launch{background:#fff!important;box-shadow:0 6px 20px rgba(15,23,42,.18),0 0 0 1px rgba(15,23,42,.06)!important;} .twc-launch:hover{box-shadow:0 10px 26px rgba(15,23,42,.24),0 0 0 1px rgba(15,23,42,.06)!important;} .twc-launch .twc-ic{width:100%;height:100%;display:flex;align-items:center;justify-content:center;} .twc-launch .twc-ic img{' + (FIT === 'contain' ? 'width:100%;height:100%;object-fit:contain;border-radius:0;' : 'width:100%;height:100%;object-fit:cover;border-radius:50%;') + '} .twc-launch.open{background:' + BRAND + '!important;} .twc-launch.open .twc-x{color:#fff;font-size:24px;}' : '');\n" +
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
"  // WhatsApp markup -> HTML on already-escaped text: *bold* _italic_ ~strike~.\n" +
"  function wamd(s){ return s.replace(/\\*(\\S(?:[^*\\n]*\\S)?)\\*/g,'<b>$1</b>').replace(/(^|[^\\w])_(\\S(?:[^_\\n]*\\S)?)_(?![\\w])/g,'$1<i>$2</i>').replace(/~(\\S(?:[^~\\n]*\\S)?)~/g,'<s>$1</s>'); }\n" +
"  function linkLabel(u){ try{ var x=new URL(u); var h=x.hostname.replace(/^www\\./,''); var p=x.pathname==='/'?'':x.pathname; var f=h+p; return f.length>34? f.slice(0,32)+'\\u2026' : f; }catch(e){ return u.length>36? u.slice(0,34)+'\\u2026' : u; } }\n" +
"  // Escape, then alternate text/URL segments: URLs render as short labeled\n" +
"  // links (the raw address is noise), text segments get the markup treatment.\n" +
"  function fmt(s){ var e=esc(s); var parts=e.split(/(https?:\\/\\/[^\\s<]+)/g); var h=''; for(var i=0;i<parts.length;i++){ h+=(i%2===1)?('<a href=\"'+parts[i]+'\" target=\"_blank\" rel=\"noopener noreferrer\">'+linkLabel(parts[i])+' \\u2197</a>'):wamd(parts[i]); } return h; }\n" +
"  var FILE_SVG='<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z\"></path><polyline points=\"14 2 14 8 20 8\"></polyline></svg>';\n" +
"  // File-looking URLs (brochure PDFs, Drive shares) also get a tappable card\n" +
"  // under the text so the share is unmissable.\n" +
"  function fileCards(raw){ var m=(raw||'').match(/https?:\\/\\/[^\\s]+/g)||[]; var h=''; var n=0; for(var i=0;i<m.length&&n<3;i++){ var u=m[i]; if(/\\.(pdf|docx?|xlsx?|pptx?|zip)([?#]|$)/i.test(u)||/drive\\.google\\.com\\/(file|uc)/i.test(u)){ h+='<a class=\"twc-file\" href=\"'+esc(u)+'\" target=\"_blank\" rel=\"noopener noreferrer\">'+FILE_SVG+'<span>Open file</span></a>'; n++; } } return h; }\n" +
"  function clearChips(){ var c=body.querySelectorAll('.twc-chips'); for(var i=0;i<c.length;i++){ c[i].parentNode.removeChild(c[i]); } }\n" +
"  function addRow(role, html){ var row=document.createElement('div'); row.className='twc-row '+(role==='u'?'u':'b'); var inner=''; if(role!=='u'){ inner='<div class=\"twc-bav\">' + avInner + '</div>'; } inner+='<div class=\"twc-msg\">'+html+'</div>'; row.innerHTML=inner; body.appendChild(row); body.scrollTop=body.scrollHeight; return row; }\n" +
"  function addUser(text){ addRow('u', fmt(text)); }\n" +
"  function addBot(m){ var html=''; if(m.mediaUrl){ var mt=String(m.mediaType||'').toLowerCase(); var mu=esc(m.mediaUrl); if(mt.indexOf('video')===0||/\\.(mp4|webm)([?#]|$)/i.test(m.mediaUrl)){ html+='<video controls src=\"'+mu+'\"></video>'; } else if(mt.indexOf('audio')===0){ html+='<audio controls src=\"'+mu+'\"></audio>'; } else if(mt.indexOf('document')===0||/\\.(pdf|docx?|xlsx?|pptx?|zip)([?#]|$)/i.test(m.mediaUrl)){ html+='<a class=\"twc-file\" href=\"'+mu+'\" target=\"_blank\" rel=\"noopener noreferrer\">'+FILE_SVG+'<span>Open file</span></a>'; } else { html+='<img alt=\"\" src=\"'+mu+'\">'; } } if(m.body){ if(html){html+='<br>';} html+=fmt(m.body)+fileCards(m.body); } if(!html){ return; } addRow('b', html); if(m.options && m.options.length){ var wrap=document.createElement('div'); wrap.className='twc-chips'; m.options.forEach(function(o){ var ch=document.createElement('button'); ch.className='twc-chip'; ch.textContent=o; ch.addEventListener('click', function(){ clearChips(); send(o); }); wrap.appendChild(ch); }); body.appendChild(wrap); body.scrollTop=body.scrollHeight; } }\n" +
"  function sysBanner(text){ var d=document.createElement('div'); d.className='twc-sys'; d.textContent=text; body.appendChild(d); body.scrollTop=body.scrollHeight; }\n" +
"  function render(arr){ (arr||[]).forEach(function(m){ if(m.id && seen[m.id]) return; if(m.id) seen[m.id]=1; if(m.at) since=m.at; addBot(m); }); }\n" +
"  var typingEl=null;\n" +
"  function showTyping(){ if(typingEl) return; var row=document.createElement('div'); row.className='twc-row b'; row.innerHTML='<div class=\"twc-bav\">' + avInner + '</div><div class=\"twc-typing\"><span></span><span></span><span></span></div>'; body.appendChild(row); body.scrollTop=body.scrollHeight; typingEl=row; }\n" +
"  function hideTyping(){ if(typingEl){ typingEl.parentNode.removeChild(typingEl); typingEl=null; } }\n" +
"  function poll(){ fetch(CFG.base+'/api/widget/poll?siteKey='+encodeURIComponent(CFG.siteKey)+'&visitorId='+encodeURIComponent(vid)+(since?'&since='+encodeURIComponent(since):''),{}).then(function(r){return r.json();}).then(function(d){ render(d.messages); if(d.status==='escalated' && !escalated){ escalated=true; sysBanner('Connecting you with our team — someone will reply here shortly.'); } }).catch(function(){}); }\n" +
"  function send(t){ t=(t==null?(input.value||''):t).trim(); if(!t||busy) return; input.value=''; clearChips(); addUser(t); busy=true; sendBtn.disabled=true; showTyping(); fetch(CFG.base+'/api/widget/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({siteKey:CFG.siteKey,visitorId:vid,text:t,identity:(typeof window.__twcIdentity==='object'?window.__twcIdentity:undefined)})}).then(function(r){return r.json();}).then(function(d){ hideTyping(); busy=false; sendBtn.disabled=false; var msgs=(d&&d.messages)?d.messages:(d&&d.reply?[{body:d.reply,id:d.id,at:d.at}]:[]); render(msgs); if(d&&d.escalated && !escalated){ escalated=true; sysBanner('Connecting you with our team — someone will reply here shortly.'); } }).catch(function(){ hideTyping(); busy=false; sendBtn.disabled=false; addBot({body:'Sorry, something went wrong. Please try again.'}); }); }\n" +
"  var MOB = window.matchMedia ? window.matchMedia('(max-width:768px)') : { matches:false };\n" +
"  var prevOv=null, prevBodyOv=null;\n" +
"  function lockScroll(on){ var de=document.documentElement, b=document.body; if(on){ prevOv=de.style.overflow; prevBodyOv=b.style.overflow; de.style.overflow='hidden'; b.style.overflow='hidden'; } else { de.style.overflow=prevOv||''; b.style.overflow=prevBodyOv||''; } }\n" +
"  // Keyboard-aware sizing: on phones the panel tracks the VISUAL viewport so\n" +
"  // the composer stays above the on-screen keyboard (100vh lies on mobile).\n" +
"  function vvFit(){ if(!open || !MOB.matches || !window.visualViewport) return; var vv=window.visualViewport; panel.style.height=vv.height+'px'; panel.style.transform='translateY('+vv.offsetTop+'px)'; body.scrollTop=body.scrollHeight; }\n" +
"  function toggle(o){ open=(o===undefined?!open:o); panel.className='twc-panel'+(open?' open':''); btn.className='twc-launch'+(open?' open':''); if(MOB.matches){ lockScroll(open); if(window.visualViewport){ if(open){ window.visualViewport.addEventListener('resize', vvFit); vvFit(); } else { window.visualViewport.removeEventListener('resize', vvFit); } } if(!open){ panel.style.height=''; panel.style.transform=''; } } if(open){ if(CFG.welcome && !greeted){ greeted=true; addBot({body:CFG.welcome}); } if(!MOB.matches){ setTimeout(function(){ input.focus(); },200); } poll(); if(!timer) timer=setInterval(poll, 4000); } }\n" +
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
