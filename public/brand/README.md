# Brand assets

Talko AI brand files live here. Anything in `public/` is served from the site
root, so `public/brand/talko-logo.png` → `/brand/talko-logo.png`.
After replacing a file, redeploy (or restart `npm run dev`) so it's served.

The horizontal lockup and square mark are shipped as **small rasters** (not the
original multi-MB embedded-raster SVGs, which downloaded on every route). The
favicons are generated from `talkopng.png` / `icon-512.png` — see the icon set
wired in `src/app/layout.tsx`.

## 1. `talko-logo.png` — horizontal logo lockup (icon + "Talko AI")

Shown in the app sidebar, the login & signup screens, the support desk header,
and the marketing site's nav and footer, via `src/components/BrandLogo.tsx`.
Rendered **by height** (the app sets ~28–44px tall) with the width derived from
a fixed aspect ratio. **540 × 138** (ratio ~3.9 : 1, ~22KB) — crisp to 44px tall
even at 3× DPR.

> To replace: export a tight ~3.5–4 : 1 horizontal lockup, transparent
> background, at **≥ 540px wide** PNG (or supply an SVG and ask us to swap the
> reference + `LOGO_RATIO` in `BrandLogo.tsx`). Trim to ≤ ~6% margin — extra
> padding is the #1 reason a logo renders small.

## 2. Square app mark (icon only, no text)

The channels-wall "web chat" logo reuses `favicon-96.png` (96 × 96, ~14KB); the
browser-tab / Apple-touch icons use the `favicon-32/48/96/180.png` set. All are
the same blue chat-bubble mark. To replace, drop a new square source and
regenerate the sizes.

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
