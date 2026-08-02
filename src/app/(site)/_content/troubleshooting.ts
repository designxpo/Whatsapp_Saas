// Troubleshooting content — symptom/cause/fix, not a step-by-step walkthrough,
// so it's a separate shape from Guide (guides.ts). Grounded in real issues
// this platform has actually surfaced (not hypothetical ones): a webhook
// rejection looks different from a quota error, and a tenant trying to
// self-diagnose needs the real distinguishing detail, not a generic guess.

export type Issue = { q: string; cause: string; fix: string; guideHref?: string; guideLabel?: string };
export type TroubleshootingSection = { key: string; title: string; issues: Issue[] };

export const TROUBLESHOOTING: TroubleshootingSection[] = [
  {
    key: "whatsapp", title: "WhatsApp",
    issues: [
      {
        q: "I connected a number, but messages from customers never arrive.",
        cause: "Connecting the number and Meta actually delivering messages to it are two separate steps. This almost always means Meta rejected the webhook subscription, or a required permission wasn't fully granted during connection.",
        fix: "Check Settings → WhatsApp numbers for a status message next to the number — if it says Meta refused the webhook subscription, go to Setup & status → Meta connection doctor for the specific reason (usually a missing permission or an unverified Business Manager). Reconnecting via \"Connect with Facebook\" re-requests the right permissions.",
        guideHref: "/guides/connect-whatsapp", guideLabel: "Connect WhatsApp guide",
      },
      {
        q: "Messages were working, then replies quietly stopped.",
        cause: "WhatsApp tracks a quality rating per number based on block and report rates. If it drops too low, Meta pauses that number's ability to send — business-initiated conversational replies inside the 24-hour window are usually the last thing affected.",
        fix: "Check the number's quality rating in Meta Business Manager. Avoid messaging contacts who haven't opted in, and don't run another tool against the same WhatsApp Business Account at the same time — that's a common way quality quietly degrades without anything in Talko AI itself changing.",
      },
      {
        q: "A message template got rejected.",
        cause: "Meta reviews every template before it can be used. Vague templates, or ones that look like marketing while declared as a different category, are the most common rejection reasons.",
        fix: "Make the template specific and honest about its category (utility vs. marketing), then resubmit — Templates → status shows Meta's exact rejection reason.",
      },
      {
        q: "Can I keep using the regular WhatsApp Business app after connecting?",
        cause: "Yes, with coexistence — a distinct connection mode from a fresh number.",
        fix: "Use \"Connect existing app number\" instead of a new-number connection; you'll scan a QR code from the app, and the number keeps working in both places with its chat history intact.",
        guideHref: "/guides/connect-whatsapp", guideLabel: "Connect WhatsApp guide",
      },
    ],
  },
  {
    key: "instagram-messenger", title: "Instagram & Messenger",
    issues: [
      {
        q: "A comment automation rule isn't triggering on new comments.",
        cause: "The single most common cause: a rule only reacts to activity that happens after it was created. It can't retroactively match a comment the system already looked at before the rule existed.",
        fix: "Post a brand-new test comment after saving the rule — don't reuse or refresh an old one. Also confirm the account is a Professional account with \"Allow access to messages\" turned on under Instagram's own Settings → Messages → Connected tools.",
      },
      {
        q: "\"Connect with Facebook\" doesn't do anything, or fails partway through.",
        cause: "Almost always because the Instagram account isn't switched to Professional yet, or isn't linked to a Facebook Page — Meta's login flow needs both before it can hand over messaging permissions.",
        fix: "Switch to a Professional account in the Instagram app first and link it to a Page, then try connecting again.",
        guideHref: "/guides/connect-instagram", guideLabel: "Connect Instagram guide",
      },
      {
        q: "A DM won't send to a customer who messaged a while ago.",
        cause: "This is Meta's own 24-hour messaging window policy, the same rule WhatsApp enforces — not a bug, and not something Talko AI can override.",
        fix: "Wait for the customer to message again to reopen the window. A reply to one of their post comments doesn't have this restriction, if that applies here.",
      },
    ],
  },
  {
    key: "youtube", title: "YouTube",
    issues: [
      {
        q: "The video picker says \"No videos loaded yet\" or shows an error.",
        cause: "This used to fail silently and just look empty — it now shows the real reason in red text, distinct from the generic amber warning. The usual cause is a Google API permission gap on the connected account.",
        fix: "Read the red error text under the picker for the specific cause (not the generic amber hint above it). If it points at API access or scope approval, reconnect via Setup & status → YouTube.",
        guideHref: "/guides/connect-youtube", guideLabel: "Connect YouTube guide",
      },
      {
        q: "I created a comment rule but it's never replied.",
        cause: "Same root cause as Instagram/Messenger rules: the poller only reacts to comments it sees after the rule was created, not ones already sitting there.",
        fix: "Post a fresh test comment after saving the rule, then use \"Check now\" in the YouTube tab instead of waiting for the next automatic check.",
      },
      {
        q: "A reply says it posted, but I can't see it on YouTube.",
        cause: "Two likely causes: the poller checks on an interval rather than instantly, so a short delay is normal; or YouTube itself is holding the reply for manual review.",
        fix: "Wait a couple of minutes, then check YouTube Studio's \"Held for review\" tab — a reply can post successfully through the API but still sit there pending Google's own approval.",
      },
      {
        q: "My channel is run as a Brand Account by my team and won't connect.",
        cause: "A personal Google login doesn't automatically show Brand Account channels it manages under the default lookup Google's API uses.",
        fix: "Talko AI falls back to checking every channel your login manages and shows a picker when there's more than one — choose the right channel there.",
      },
      {
        q: "Replies stopped and something mentions a quota.",
        cause: "YouTube's API enforces a shared daily quota across everything using it. Heavy comment volume can occasionally reach it.",
        fix: "No action needed — this clears automatically when the quota resets the next day.",
      },
    ],
  },
  {
    key: "google-reviews", title: "Google Reviews",
    issues: [
      {
        q: "The location picker shows nothing, or an error.",
        cause: "Either the connected Google account doesn't manage any Business Profile, or Google's separate Business Profile APIs aren't approved for this project yet.",
        fix: "Read the specific error text shown — it now distinguishes \"this account has no Business Profile\" from \"API access is still pending\" instead of one generic failure message.",
        guideHref: "/guides/connect-google-reviews", guideLabel: "Connect Google Reviews guide",
      },
      {
        q: "I connected successfully, but reviews never actually show up.",
        cause: "Google gates live review access behind a separate \"Business Profile API access\" approval, on top of the OAuth login itself. This is unrelated to how correctly you set things up, and can take a few weeks.",
        fix: "This isn't a setup mistake — it resolves once Google approves the access request. See the Google Reviews guide for what that application needs.",
      },
      {
        q: "I see a 429 error, or something that looks like rate limiting.",
        cause: "A 429 on a brand-new connection almost always means the Business Profile API access request is still pending, not genuine traffic-based rate limiting — Google enforces a near-zero default quota on unapproved projects.",
        fix: "Waiting and retrying won't fix this; it clears once Google approves API access for the project.",
      },
    ],
  },
  {
    key: "ai-replies", title: "AI & replies",
    issues: [
      {
        q: "Nothing replies at all, on any channel.",
        cause: "Almost always a missing or invalid AI key — every channel relies on the same one.",
        fix: "Check AI Hub → AI provider & key — the status pill should read \"Connected.\" If it says \"Not configured,\" add a key.",
        guideHref: "/guides/add-your-ai-key", guideLabel: "Add your AI key guide",
      },
      {
        q: "Replies are generic or don't seem to know my business.",
        cause: "The AI answers from your knowledge base. If nothing's uploaded yet, or it's still syncing, replies fall back to a generic answer instead of a grounded one.",
        fix: "Add docs and FAQs to your knowledge base and give it a few minutes to sync — check its status in AI Hub.",
      },
      {
        q: "A reply went out that was wrong or off-brand.",
        cause: "AI can occasionally misread intent on short or ambiguous messages, or answer from contradictory knowledge-base content.",
        fix: "Add a rule or flow step to handle that specific case deterministically, and check your knowledge base for conflicting information on the topic.",
      },
    ],
  },
  {
    key: "billing-plan", title: "Billing & plan",
    issues: [
      {
        q: "A tab or channel shows \"not available on your plan.\"",
        cause: "Every tab and channel is gated by your current plan — the Setup checklist only ever asks for what your plan actually includes.",
        fix: "Compare against the pricing page, then upgrade from Settings if you need the feature.",
      },
      {
        q: "My trial is ending — what happens?",
        cause: "Nothing is deleted or paused mid-trial.",
        fix: "Pick a plan before the 14 days end to keep everything running without interruption.",
      },
      {
        q: "Everything feels delayed — replies, broadcasts, all of it at once.",
        cause: "Every automated feature runs on one shared background engine that ticks every few minutes, so a delay in one shows up as a delay in all of them together.",
        fix: "Check the status page — if it isn't reporting \"All systems operational,\" that's why, and it resolves on its own once the engine catches up.",
        guideHref: "/status", guideLabel: "System status",
      },
    ],
  },
];
