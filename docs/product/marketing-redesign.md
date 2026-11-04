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
