// Meta ad previews (`/<ad>/previews`, `act_<id>/generatepreviews`) come back as
// an HTML snippet — in practice one iframe pointing at Facebook's preview
// renderer:
//
//   <iframe src="https://www.facebook.com/ads/api/preview_iframe.php?d=…&amp;t=…"
//           width="540" height="690" scrolling="yes" style="border: none;"></iframe>
//
// Putting that HTML into our page (innerHTML, or an srcdoc iframe that inherits
// our origin) would run whatever it contains as the portal. So we never render
// the HTML itself: we pull out the iframe's src, accept it only when it is an
// https URL on Facebook's own hosts, and render our own iframe to it.

export interface MetaPreviewFrame { src: string; width: number | null; height: number | null }

const ALLOWED_HOSTS = ["facebook.com", "fb.com"];

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? "") : null;
}

/** A Facebook-hosted https URL, or null. */
export function safeMetaPreviewUrl(raw: string | null | undefined): string | null {
  let u: URL;
  try { u = new URL((raw ?? "").trim()); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.some(h => host === h || host.endsWith(`.${h}`))) return null;
  return u.toString();
}

/** The Facebook preview iframe inside Meta's preview HTML, or null if there isn't a safe one. */
export function metaPreviewFrame(html: string | null | undefined): MetaPreviewFrame | null {
  const tag = /<iframe\b[^>]*>/i.exec(html ?? "")?.[0];
  if (!tag) return null;
  const src = safeMetaPreviewUrl(attr(tag, "src"));
  if (!src) return null;
  const num = (v: string | null) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n) : null; };
  return { src, width: num(attr(tag, "width")), height: num(attr(tag, "height")) };
}
