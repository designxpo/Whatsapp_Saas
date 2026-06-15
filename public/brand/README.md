# Brand assets

Drop your Talko AI brand files here. The app picks them up automatically — no
code change needed. (Anything in `public/` is served from the site root, so
`public/brand/logo.svg` is reachable at `/brand/logo.svg`.)

## Files to add

| File | Used for | Recommended |
|------|----------|-------------|
| `logo.svg` | The square **mark** shown in the sidebar, login and marketing nav/footer (next to the "Talko AI" text). | Square SVG, transparent background. PNG also works — rename to `logo.svg`? No — for PNG use `logo.png` and tell us to switch the reference. |
| `favicon.ico` | Browser tab icon. | 32×32 (multi-size .ico ideal). |
| `icon.svg` | Modern browsers' scalable tab icon (optional). | Square SVG. |
| `apple-icon.png` | iOS home-screen icon (optional). | 180×180 PNG. |

## Notes
- If a file is missing, the app falls back gracefully: the logo shows the
  default gradient mark, and the favicon just stays the browser default — nothing
  breaks.
- `logo.svg` is treated as a **square mark** (it sits beside the "Talko AI"
  wordmark text). If you'd rather show a full logo lockup (icon + name as one
  image) instead of mark + text, say so and we'll switch it.
- After uploading, redeploy (or restart `npm run dev`) so the static files are
  served.
