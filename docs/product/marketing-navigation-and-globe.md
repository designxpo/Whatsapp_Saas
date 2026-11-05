# Visual navigation and connected-world section

The existing Next.js marketing site now has an illustrated mega-menu and an interactive globe section. The design follows the roomy cards, rounded panel and blurred backdrop in the owner's [Ultrahuman reference](https://www.ultrahuman.com/in/), while using Talko AI's blue-to-cyan palette and original illustrations. No Ultrahuman artwork, copy, customer statistics or product imagery is reused.

## Navigation

Platform, Solutions and Resources each reveal three large illustrated cards. Pricing remains a direct destination. Secondary links preserve the industry hub, affiliate program, changelog, status and contact routes. The nine SVG illustrations show the corresponding inbox, growth workflow, browser extension, commerce, education, creator, guides, journal and company concepts.

Desktop menus open on pointer hover or button activation. A short close delay lets the pointer cross into the panel. Escape works for a hover-open menu even when keyboard focus was outside the navigation and restores focus to its trigger. Arrow Down opens a group and focuses its first card. Outside clicks and link selection close the menu. Panels use disclosure semantics with native links; they are not application-style ARIA menus.

At 900px and below, navigation switches to tap-open accordion groups with compact illustrated cards, a scrollable panel, pricing/login links and the free-trial action. Background scrolling is restored when the menu closes. The marketing site's floating chat launcher is temporarily hidden while navigation is expanded so it cannot cover menu links. Consent controls are preserved.

Content: `src/app/(site)/_content/navigation.ts`. Interaction: `src/app/(site)/_components/mega-navigation.tsx`. The existing `SiteNav` export and footer remain in `chrome.tsx`. Original artwork lives in `public/marketing/navigation/`.

## Globe concept

“Your next customer could be anywhere” connects an international audience to Talko AI's actual product: six customer touchpoints in one connected workspace. The section lists WhatsApp, Instagram, Messenger, YouTube, Google Reviews and website chat. The six touchpoints are not presented as six identical inbox channels.

Mumbai, London, New York and Singapore select illustrative conversation examples: course qualification, a plan enquiry, creator resource delivery and a request for a demo. Each example changes the message card and highlighted globe marker. The visual explicitly says these are illustrative journeys, not live customer activity. Locations do not imply customers, offices, supported telephone regions, a particular language guarantee or service availability in those markets. No invented user counts, revenue or conversion rates appear.

The globe is built with the pinned MIT-licensed `cobe@2.0.1` WebGL library. It loads when the section enters the viewport. Its animation pauses outside the viewport, when the tab is hidden, when the visitor presses Pause, or when reduced motion is requested. Frame rate is limited to roughly 30 updates per second, pixel ratio to 1.5, with fewer map samples on small screens. Browser WebGL support is checked explicitly because the library returns a no-op instance when unsupported. An original SVG globe remains visible when WebGL is unavailable; city examples and text still work.

The globe does not use a mapping service, geolocation permission, live traffic feed or API key. The decorative canvas is hidden from assistive technology; the copy, city buttons and example conversation remain accessible HTML. It is not a live operational dashboard.

Implementation: `src/app/(site)/_components/global-conversations.tsx`. Original fallback: `public/marketing/globe-fallback.svg`. Layout and all new style rules are scoped in the existing marketing stylesheet. [COBE documentation](https://cobe.shud.in/) and the installed source/types were checked for its current initialization, resize and destroy behaviour.

## Search and existing work

The hero H1, route URLs, pricing/signup links, canonical metadata, FAQ content/schema and existing homepage anchors remain. The new section has its own `connected-world` anchor and sits after the creator story. The homepage's honest editorial revision is now November 5, 2026, shared by WebPage metadata and its sitemap entry through `HOMEPAGE_UPDATED`. Other pages' dates are retained.

Voice-foundation changes are maintained separately from the marketing implementation; ongoing review-feature work is preserved in the working tree. There is no application/database migration or provider credential change in this implementation. The marketing and voice updates were first verified locally, then prepared together for the requested push to main.

## Browser verification

Chrome checks passed at 1440, 1024, 900, 768, 390 and 320px. Checks covered all three illustrated menus, the hover bridge, Escape and focus restoration, Arrow Down, outside dismissal, route navigation, mobile accordion behaviour and scroll restoration, city selection, pause/resume, offscreen suspension, reduced motion and simulated WebGL unavailability. No horizontal overflow or browser page errors were observed.

Previews and the browser check summary are saved in `output/marketing-navigation/`. Production-build and test results are reported in the task handoff.

Final verification on November 5, 2026: production build (including type validation), changed-file ESLint and all 3,180 existing tests across 260 files passed in an isolated checkout containing only the marketing changes. The browser interaction checks above also passed against the production build. All 14 navigation destinations returned 200; the existing social-growth and creator anchors and the single homepage H1 were verified.
