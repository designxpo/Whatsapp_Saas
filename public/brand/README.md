# Brand assets

Drop your Talko AI brand files here with the **exact names below** and the app
picks them up automatically — no code change needed. Anything in `public/` is
served from the site root, so `public/brand/favicon.svg` → `/brand/favicon.svg`.
After replacing a file, redeploy (or restart `npm run dev`) so it's served.

The app uses **two** files today:

## 1. `talkoail_logo.svg` — horizontal logo lockup (icon + "Talko AI")

Shown in the app sidebar, the login & signup screens, and the marketing
site's nav and footer. It's rendered **by height** (the app sets ~30–44px tall)
and the **width scales automatically** to the artwork's aspect ratio.

| Spec | Recommendation |
|------|----------------|
| Shape | **Horizontal lockup** — icon on the left, "Talko AI" wordmark on the right |
| Aspect ratio | **~3.5 : 1 to 4 : 1** (width : height). e.g. viewBox `0 0 360 96` or `0 0 400 100` |
| Padding | **Trim tight to the artwork** — keep ≤ ~6% transparent margin. *Extra padding is the #1 reason a logo looks small.* |
| Background | Transparent |
| Format | SVG (vector, scales crisply). If only PNG: export at **≥ 800 × 200**, transparent, and tell us to switch the reference. |
| Legibility | Must read well at **~32–40px tall** — keep the wordmark bold and the icon simple. |

> The current file is a 2 : 1 lockup with heavy internal padding, which is why
> it renders small. A tighter ~3.5–4 : 1 lockup at the same height will look
> noticeably bigger and more balanced beside the nav text.

## 2. `favicon.svg` — square app mark (icon only, no text)

The browser-tab icon (and the Apple touch-icon fallback).

| Spec | Recommendation |
|------|----------------|
| Shape | **Square mark only** — just the icon, no wordmark |
| Aspect ratio | **1 : 1**. e.g. viewBox `0 0 512 512` |
| Padding | The mark should **fill ~85–95%** of the square. *If the tab icon looks tiny, the mark has too much padding — trim it.* |
| Background | Transparent (or a solid brand colour if you want a filled badge) |
| Format | SVG |

## Optional (better cross-browser / iOS) — ask us to wire these

| File | Used for | Spec |
|------|----------|------|
| `favicon.ico` | Older browsers | 32 × 32 (multi-size 16/32/48 ideal) |
| `apple-icon.png` | iOS home screen | **180 × 180** PNG, square, on a **solid** (non-transparent) background |

## Notes
- Missing files fall back gracefully: the logo shows the default gradient mark +
  "Talko AI" text, and the favicon stays the browser default — nothing breaks.
- Text is unreadable at 16px, so the tab icon should always be the **icon-only**
  square mark, never the full lockup.
