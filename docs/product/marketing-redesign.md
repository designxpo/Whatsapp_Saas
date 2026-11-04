# Talko AI marketing redesign

The homepage is positioned as a customer engagement and growth platform: six platform areas, six interactive workflow examples, five growth capabilities, creator use cases, an eleven-view product explorer, expandable product details, plans and FAQs. The features page also introduces social growth and creator workflows.

Research reference: [n8n's current homepage](https://n8n.io/), inspected in a real browser. Its visual demonstrations and clear section hierarchy informed the initial direction. Following the owner's feedback, the final design uses Talko's blue, Inter typography, conversation-shaped panels, a blue/navy creator section and original workflow illustrations. It does not reuse n8n's copy, artwork or pink theme.

## Content and product accuracy

- Campaign context, promise tracking, demand briefs, outcome experiments and explicit cross-channel handoffs match the shipped growth workflows.
- Creator examples cover digital guides, workshops, coaching and partnership commitments.
- Instagram follow requirements remain optional. Direct delivery, verification inside DM and verification before DM are distinct choices; available Meta profile access determines whether a pre-DM check is possible.
- Illustrations are identified as examples. There are no invented customer logos, revenue figures or conversion claims in the new sections.
- Payment-confirmed purchases and manually recorded outcomes remain distinct. Tracking a promise does not automatically send reminders.

## Search and analytics preservation

The redesign retains route URLs, titles, descriptions, canonical tags, robots metadata, Open Graph/Twitter data and JSON-LD. The owner explicitly requested a broader headline: “Turn every customer interaction into growth.” This is the only intentional H1 change; the `#hero-heading` / `#site-tldr` speakable targets remain server-rendered. Homepage FAQ answers still use the same source as FAQPage JSON-LD. Reviews, sequences and contact audience groups have clearly labelled illustrative explorer views; the eight existing product screenshots remain available. Audience groups mean contact labels and segments, not native WhatsApp group messaging. Existing deeper product content is available in native expandable sections, including plan signup links.

Root metadata, sitemap, robots, middleware, `llms.txt`, shared schema and SEO content sources, consent code and analytics code are unchanged. Legal, resource and product footer destinations remain linked. Marketing CSS is scoped to the marketing route group.

## Validation

- Production build, TypeScript and changed-file ESLint.
- Existing test suite: 258 files, 3,151 tests passed.
- Before/after HTTP checks on 11 marketing routes for titles, all named/property metadata, canonicals, JSON-LD, H1s (allowing the requested homepage headline change), existing anchors and plan signup destinations; FAQ DOM/schema parity and speakable targets checked on the homepage.
- SHA-256 comparison of 10 protected SEO/analytics files.
- Chrome checks at 1440, 768, 390 and 320px: workflow switching, navigation, keyboard Escape, expandable content, signup links, hydration errors and horizontal overflow.

These checks protect the technical search contracts. Search rankings and AI-engine citations depend on external systems and are not guaranteed by a visual redesign.

## Shared theme and moving feature cards

The full marketing route group now shares the logo's blue-to-cyan gradient, white foregrounds on gradient buttons and icon tiles, a 22px dotted canvas, consistent headings, card borders and section widths. Pricing, forms, expanded details and the shared CTA use these same styles.

The feature grid is now two continuously scrolling rails with alternating card tilts, faded edges and travelling corner sparks. It has no control buttons: hovering pauses the animation and leaving resumes it. Keyboard focus also pauses it. Reduced-motion preferences show all fourteen features in a static layout. The carousel is server-rendered with CSS animation, and duplicate loop copies are hidden from assistive technology. Existing feature wording remains available in the HTML.

Additional browser checks cover hover pause/resume, absence of carousel buttons, reduced-motion layouts, white icon foregrounds and gradient button backgrounds. Expanded content and inner pages are checked for horizontal overflow.

## Interactive homepage and workflow walkthroughs

The six customer-journey overview cards now reuse the same opposing infinite rails as the feature cards. The homepage adds pointer-responsive card tilt, a subtle cursor glow and decorative channel signals. A shared visibility observer pauses marked animation regions when they leave the viewport or the tab is hidden.

Fourteen selectable workflow demonstrations cover the overall customer journey, Google Reviews, sequences, comment-to-DM resources, qualification, promises, broadcasts, commerce, audience segments, AI knowledge, YouTube, website chat, WhatsApp handoffs and outcome experiments. Signals travel between numbered steps; selecting a node pauses the visual walkthrough and exposes that step's detail. The same explorer is available on the Features page. Deeper agent/use-case diagrams and review/sequence product previews also animate. These remain explicitly illustrative demonstrations.

The footer's tilted tiles have been replaced with centred message, AI and outcome nodes, travelling packets and an orbital signal. The icon boxes and SVG centres are aligned on the same horizontal axis at every tested size. Decorative hero SVGs explicitly use no fill and remain absolutely contained behind the page content, preventing the default black SVG fill seen during development.

### Theme audit — 5 November 2026

All 50 canonical public marketing pages in the sitemap were checked in Chrome at 1440px and 390px: shared dotted canvas, blue-to-cyan primary buttons with white foregrounds, navigation/footer, one H1, no page overflow and no client errors. This covers the homepage, feature/pricing pages, industry pages, comparison pages, blog posts, guides, legal policies, status/changelog, contact, affiliate and extension pages. Article and policy pages retain their reading layouts within the same theme.

Before/after checks across all 50 URLs confirmed identical status codes, titles, named/property metadata, canonical URLs, JSON-LD, H1 wording and plan signup destinations; existing anchors remain. The 10 protected SEO/analytics source files are unchanged. Homepage interactions were additionally checked at 1440, 768, 390 and 320px, including all fourteen workflows, node inspection, automatic carousel movement, hover pause/resume, centred footer icons and reduced-motion settings. The production build, changed-file ESLint and all 3,151 existing tests passed.
