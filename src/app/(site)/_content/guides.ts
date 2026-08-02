// Public "how to set up Talko AI" guides — plain-language, step-by-step pages
// aimed at a non-technical business owner. Grounded in the REAL in-app copy
// (button labels, field names, checklist items) so a guide never tells
// someone to click something that doesn't exist. Keep it that way: if the
// product UI's wording changes, update the matching guide here too.

export type GuideStep = { title: string; body: string };
export type GuideFaq = { q: string; a: string };
export type Guide = {
  slug: string;
  category: "Getting started" | "Connect a channel" | "Automate";
  title: string;          // page <h1>
  summary: string;        // intro line, doubles as the meta description seed
  timeEstimate: string;
  before?: string[];      // "Before you start" checklist
  steps: GuideStep[];
  tip?: string;           // one callout — a gotcha worth flagging up front
  faqs?: GuideFaq[];
};

export const GUIDES: Guide[] = [
  {
    slug: "getting-started",
    category: "Getting started",
    title: "Getting started with Talko AI",
    summary: "The first-day walkthrough: sign up, connect your first channel, add your AI key, and send yourself a test message — all in one sitting.",
    timeEstimate: "15-20 minutes",
    steps: [
      { title: "Start your free trial", body: "Sign up with your work email. Every plan includes a 14-day free trial and no credit card is required to start — you can explore the full platform before paying for anything." },
      { title: "Open Setup & status", body: "This is the first thing you'll see after signing up. It's a checklist built for your specific plan — it only asks you to set up the channels and features your plan actually includes, so you're never staring at options you can't use yet. Each item shows a status pill: Ready, Attention, Problem, or Not set up." },
      { title: "Add your AI key", body: "Before any channel can reply, Talko AI needs an AI model to think with. Click \"Set up\" next to AI in the checklist, or jump straight to our AI key guide." },
      { title: "Connect your first channel", body: "Pick whichever channel your customers actually use — WhatsApp, Instagram, Facebook Messenger, YouTube, Google Business Profile reviews, or a website chat widget. Each has its own short guide below. Most take five to ten minutes." },
      { title: "Send yourself a test message", body: "Once a channel shows \"Ready\", message it from your own phone or account. You should get an AI reply within a few seconds, drawn from your knowledge base if you've added one, or a sensible default reply if you haven't yet." },
      { title: "Invite your team", body: "Add teammates from Settings so conversations can be assigned, labelled, and handled together — not just by whoever happens to be logged in." },
    ],
    tip: "Do the channels in order of how many customers actually message you there. If WhatsApp is 90% of your inbound, connect that first — you'll feel the win immediately instead of waiting until everything is wired up.",
    faqs: [
      { q: "Do I need a developer to set any of this up?", a: "No. Every channel connects through a guided click-through flow (Meta's or Google's own login popup) — no code, no API keys to hunt down yourself, unless you choose the manual fallback option that some channels offer." },
      { q: "What happens when the 14-day trial ends?", a: "You'll be asked to pick a plan to keep going. Nothing is deleted or paused mid-trial — you get the full 14 days to actually test it with real conversations." },
      { q: "I don't see a channel I expected in my checklist. Why?", a: "The Setup & status checklist is plan-aware — it only shows channels included in your current plan. Check the pricing page, or upgrade from Settings, to unlock additional channels." },
    ],
  },
  {
    slug: "connect-whatsapp",
    category: "Connect a channel",
    title: "How to connect WhatsApp to Talko AI",
    summary: "Connect a WhatsApp number through Meta's official WhatsApp Business Platform, in a guided click-through flow — no manual API tokens required.",
    timeEstimate: "5-10 minutes, plus Meta's own verification time",
    before: [
      "A Facebook account with admin access to your business",
      "A phone number you can receive an OTP on",
      "If the number is currently active in the regular WhatsApp Business app, decide whether you want a fresh number for the API, or to use coexistence (see step 2) to keep using both",
    ],
    steps: [
      { title: "Open the WhatsApp section", body: "From Setup & status, click \"Set up\" next to WhatsApp — or go to Settings → WhatsApp numbers directly." },
      { title: "Choose your connection type", body: "Click \"Connect with Facebook\" to onboard a brand-new number through Meta's official Embedded Signup flow. If you'd rather keep using your existing number in the regular WhatsApp Business app at the same time, click \"Connect existing app number\" instead — this is called coexistence: you scan a QR code from the app, and the number becomes usable in both places at once, with all its existing chats intact." },
      { title: "Log in with Facebook and pick your number", body: "A popup opens (not a redirect) asking you to log in with the Facebook account that manages your business, then to confirm or add the WhatsApp number. This is Meta's own screen, not Talko AI's — your login details never pass through us." },
      { title: "Wait for the \"Ready\" status", body: "Once Meta confirms the connection, the pill switches to Ready and the webhook is subscribed automatically so incoming messages reach your inbox." },
      { title: "Send a test message", body: "Message the number from your own phone. You should see it appear in your Talko AI inbox within seconds, with an AI reply if you've already added an AI key." },
    ],
    tip: "If you see \"Saved, but Meta refused the webhook subscription,\" your number is stored but messages won't arrive yet. This almost always means a permission or verification step on Meta's side is incomplete — check Setup & status → Meta connection doctor for the specific reason.",
    faqs: [
      { q: "Can I keep using the WhatsApp Business app after connecting to Talko AI?", a: "Yes, if you use the coexistence option (\"Connect existing app number\"). Your number and chat history keep working in the app exactly as before, and the same number also becomes usable through Talko AI." },
      { q: "Do I need Meta business verification before I connect?", a: "You can connect before verification finishes, but verification lifts your starter messaging cap and unlocks your approved display name — it's worth starting early since it can take Meta a few business days." },
      { q: "What if I don't want to use the guided popup?", a: "There's a manual fallback: click \"Add manually\" and enter your Phone Number ID, WABA ID, App ID, and access token directly, if you already have a Meta developer app set up yourself." },
    ],
  },
  {
    slug: "connect-instagram",
    category: "Connect a channel",
    title: "How to connect Instagram to Talko AI",
    summary: "Automate Instagram DMs and turn comments into replies or private messages, connected through Meta's official API — fully within Instagram's messaging rules.",
    timeEstimate: "5-10 minutes",
    before: [
      "Switch your Instagram account to Professional in the Instagram app (Settings → Account type), and link it to a Facebook Page",
      "In Instagram, go to Settings → Messages → Connected tools and turn ON \"Allow access to messages\"",
    ],
    steps: [
      { title: "Open the Instagram tab", body: "From Setup & status, click \"Set up\" next to Instagram." },
      { title: "Click \"Connect with Facebook\"", body: "This launches Meta's official Embedded Signup popup. Log in with the Facebook account linked to your Instagram Professional account." },
      { title: "Confirm the account", body: "Pick the Instagram account you want connected. Talko AI only requests the permissions it needs to read and reply to your messages and comments." },
      { title: "Send yourself a test DM", body: "Message your own Instagram account from another account. It should land in your Talko AI inbox and get an AI reply if your knowledge base and AI key are set up." },
      { title: "(Optional) Turn on comment automation", body: "In the Instagram tab, \"New rule\" turns a comment into an automatic DM, and \"New reply rule\" adds a public reply — with keyword triggers, up to three link buttons, and rotating reply variants so it doesn't look copy-pasted." },
    ],
    tip: "Instagram's rules only allow replying to someone who messaged you within the last 24 hours, and cold outreach to people who never contacted you isn't allowed at all — the one exception is a single automatic reply to a comment on your own post. Talko AI enforces this automatically so your account doesn't get flagged.",
    faqs: [
      { q: "Does my Instagram account need to be a Business or Creator account?", a: "It needs to be a Professional account (Business or Creator both work) linked to a Facebook Page — that's what Meta's Instagram messaging API requires." },
      { q: "Can Talko AI message people who never contacted me?", a: "No, and it shouldn't — that would violate Meta's platform rules and put your account at risk. Every automated reply responds to something the customer did first (a message or a comment)." },
      { q: "What if \"Connect with Facebook\" doesn't work?", a: "There's a manual fallback (\"Add manually\") if you already have your own Instagram account ID and access token from a Meta developer app." },
    ],
  },
  {
    slug: "connect-messenger",
    category: "Connect a channel",
    title: "How to connect Facebook Messenger to Talko AI",
    summary: "Bring Facebook Page messages and comments into the same inbox as your other channels, connected through Meta's official Messenger Platform.",
    timeEstimate: "5-10 minutes",
    before: ["A Facebook Page you're an admin of (a personal profile alone isn't enough — Messenger automation attaches to a Page)"],
    steps: [
      { title: "Open the Messenger tab", body: "From Setup & status, click \"Set up\" next to Messenger (labelled Facebook in the portal)." },
      { title: "Click \"Connect with Facebook\"", body: "Meta's Embedded Signup popup opens. Log in with the account that administers your Facebook Page." },
      { title: "Pick your Page", body: "Confirm which Page you want connected. Talko AI requests messaging permission, plus comment-engagement permissions if you want comment-to-DM automation too." },
      { title: "Send a test message", body: "Message your Page from a personal Facebook account. It should appear in your Talko AI inbox with an AI reply." },
    ],
    tip: "Messenger shares the same 24-hour reply window and no-cold-outreach rule as Instagram — Talko AI enforces both automatically.",
    faqs: [
      { q: "Can one inbox handle both my Instagram and my Facebook Page?", a: "Yes — that's the point. Both land in the same unified inbox, use the same AI persona and knowledge base if you want, and can be assigned to the same team." },
      { q: "Does this also cover comments on my Facebook Page posts?", a: "Yes, if you grant the comment-engagement permissions during connection — a comment can then trigger an automatic private reply, the same pattern as Instagram." },
    ],
  },
  {
    slug: "connect-youtube",
    category: "Connect a channel",
    title: "How to connect YouTube comment automation",
    summary: "Auto-reply to comments on your own YouTube videos, moderate spam, and let AI take over a thread — connected through Google's official YouTube Data API.",
    timeEstimate: "5 minutes to connect, plus a few minutes for the first check",
    steps: [
      { title: "Open the YouTube tab", body: "From Setup & status, click \"Set up\" next to YouTube." },
      { title: "Click \"Connect with Google\"", body: "This redirects you to Google's own login and consent screen (a full page redirect, not a popup) asking for permission to read and manage comments on your channel." },
      { title: "Pick your channel if asked", body: "If the Google account you logged in with manages more than one YouTube channel (common for Brand Accounts run by a team), you'll see a picker asking \"Which YouTube channel is this?\" — choose the right one." },
      { title: "Create a comment rule", body: "Pick a target video (or all videos), set a keyword trigger, and write the automatic reply. You can also set moderation rules to hold or reject spammy comments." },
      { title: "Post a fresh comment to test it", body: "The poller only reacts to comments made after the rule was created, so reuse or refresh an old comment won't trigger it. Post a brand-new test comment, then use \"Check now\" in the YouTube tab to see it react immediately instead of waiting for the next automatic check." },
    ],
    tip: "YouTube comments are checked on a short interval, not instantly via webhook — a reply can take a couple of minutes to appear, which is normal. If it still doesn't show up on YouTube itself, check YouTube Studio's \"Held for review\" tab; a reply can post successfully via the API but still sit there pending manual approval on Google's side.",
    faqs: [
      { q: "Why does the reply not show up right away?", a: "YouTube comment automation polls on an interval rather than reacting instantly like a webhook does. Use \"Check now\" in the YouTube tab if you want to force an immediate check while testing." },
      { q: "My channel is run as a Brand Account by our team. Will that work?", a: "Yes — if the Google login manages more than one channel, Talko AI shows a channel picker after you connect, so you choose the exact one to automate." },
      { q: "Does this work on any video, or only new ones?", a: "Any video on your channel — you choose whether a rule targets one specific video or all of them." },
    ],
  },
  {
    slug: "connect-google-reviews",
    category: "Connect a channel",
    title: "How to connect Google Business Profile reviews",
    summary: "Draft or auto-post AI replies to your Google reviews, warm for great reviews and calm for the tough ones, connected through your own Google Business Profile.",
    timeEstimate: "5 minutes to connect",
    steps: [
      { title: "Open the Reviews tab", body: "From Setup & status, click \"Set up\" next to Reviews." },
      { title: "Click \"Connect with Google\"", body: "This redirects to Google's login and consent screen, requesting permission to manage your Business Profile." },
      { title: "Pick your location", body: "If your Google account manages more than one business location, a picker appears asking which one this connection is for." },
      { title: "Set your auto-post threshold", body: "Choose whether AI replies post automatically (options: 5-star only, 4-star and up, 3-star and up, or never auto-post) — anything below your threshold is drafted for your approval instead of posted straight away." },
    ],
    tip: "Google gates live review reply/read access behind a separate \"Business Profile API access\" approval, on top of the login itself — this is unrelated to how well your connection is set up, and can take Google a few weeks to grant. Until it's approved, connecting still works, but reviews won't actually flow in yet. Set your expectations accordingly and don't assume something's broken on the setup side.",
    faqs: [
      { q: "Why does it say reviews aren't loading even though I connected successfully?", a: "This is almost always Google's separate Business Profile API access approval still pending, not a setup mistake. It's a one-time approval per Google Cloud project, and it can take a few weeks." },
      { q: "Can I review AI replies before they go live?", a: "Yes, for anything below your chosen auto-post star threshold — those are drafted for you to read and approve rather than posted automatically." },
      { q: "What if I manage several locations?", a: "Connect each one separately from the Reviews tab; each location gets its own connection and its own auto-post threshold." },
    ],
  },
  {
    slug: "website-chat-widget",
    category: "Connect a channel",
    title: "How to add the website chat widget",
    summary: "Drop a live-chat bubble on your site with one line of code — no Meta account, no approval process, and visitors chat with your AI instantly.",
    timeEstimate: "5 minutes",
    steps: [
      { title: "Open the Website chat tab", body: "From Setup & status, click \"Set up\" next to Web chat." },
      { title: "Create a new widget", body: "Click \"New widget\". Optionally restrict it to specific domains (\"allowed origins\") so it only loads on your own site." },
      { title: "Copy the snippet", body: "Click \"Copy\" next to the one-line embed code. It looks like this:" },
      { title: "Paste it into your site", body: "Add the snippet just before the closing </body> tag on every page you want the widget to appear on. Most website builders (Shopify, WordPress, Webflow, a custom site's footer template) have a place for exactly this kind of custom script." },
      { title: "Test it live", body: "Reload your site, click the chat bubble, and send yourself a message — it should reach your Talko AI inbox and get an AI reply." },
    ],
    tip: "The snippet is a single async script tag: <script src=\"https://app.thetalko.in/api/widget/{your-site-key}/loader.js\" async></script> — nothing else to install, and it won't slow your page down since it loads asynchronously.",
    faqs: [
      { q: "Do I need a developer to install this?", a: "For most site builders, no — paste the one line wherever the platform lets you add custom scripts or footer code. A fully custom-built site may need a developer for a minute, but it's a single line." },
      { q: "Does this need a Meta or Google account?", a: "No — the website widget is entirely independent of WhatsApp, Instagram, or Google. It works standalone." },
      { q: "Can I limit which sites the widget works on?", a: "Yes — set \"allowed origins\" when creating the widget so it only loads on domains you specify." },
    ],
  },
  {
    slug: "add-your-ai-key",
    category: "Automate",
    title: "How to add your own AI key",
    summary: "Bring your own Gemini, OpenAI, or Anthropic key so AI replies run on your account, billed transparently, with full control over the model.",
    timeEstimate: "2 minutes, once you have a key from your chosen provider",
    steps: [
      { title: "Get an API key from your AI provider", body: "Create an account with Google AI Studio (Gemini), OpenAI, or Anthropic, and generate an API key from their dashboard. This step happens on the provider's site, not in Talko AI." },
      { title: "Open the AI Hub", body: "In your Talko AI portal, go to AI Hub → AI provider & key." },
      { title: "Choose your provider and model", body: "Pick Gemini, OpenAI, or Anthropic (Claude) from the dropdown. A sensible default model is pre-filled (for example gemini-2.5-flash or gpt-4o-mini) — change it only if you know you want a different one." },
      { title: "Paste your key and save", body: "Enter your API key and click \"Validate & save\". Talko AI checks the key works before saving it, and encrypts it at rest." },
      { title: "Confirm it's connected", body: "The status pill should read \"Connected · {provider} · {key hint}\". From here, every channel you've connected will start replying using this key." },
    ],
    tip: "Your AI key is billed directly by your provider, not marked up by Talko AI, and used only for chat replies — the platform's own document search (finding the right paragraph of your knowledge base) runs separately and doesn't touch your key or its cost.",
    faqs: [
      { q: "Which provider should I choose?", a: "Any of the three work well. Gemini and GPT-4o-mini are usually the cheapest for high message volume; Anthropic's Claude models are a common pick for teams who want a specific tone or more careful reasoning. You can switch later without losing your flows or knowledge base." },
      { q: "What happens if I remove my key?", a: "AI auto-replies stop for your workspace until you add a new one — nothing else about your setup (channels, flows, contacts) is affected." },
      { q: "Is my key visible to anyone else?", a: "No — it's encrypted at rest and only a short hint (like the last few characters) is ever shown back to you in the portal." },
    ],
  },
  {
    slug: "build-your-first-chatbot-flow",
    category: "Automate",
    title: "How to build your first chatbot flow",
    summary: "A no-code flow that greets a customer, offers a menu, and books or answers automatically — triggered by a keyword, no developer needed.",
    timeEstimate: "10-15 minutes for a simple flow",
    steps: [
      { title: "Open the Flows tab", body: "Go to Flows in your Talko AI portal." },
      { title: "Create a new flow", body: "Type a name (for example \"Enquiry menu\") into the \"Flow name\" field and click \"Create & open builder\"." },
      { title: "Set the trigger", body: "Choose the keyword that starts the flow — a common choice is a greeting like \"hi\" or a menu word like \"menu\"." },
      { title: "Add your steps", body: "Build the conversation using the available blocks: Buttons/List for a menu, Ask & save to capture an answer (like a name or budget), WhatsApp form for structured data, Send template, Reminder, Business hours (route differently outside working hours), and Webhook for a custom integration. Steps run in the order you place them." },
      { title: "Set a fallback", body: "If a customer asks something that isn't on the script, AI answers instantly using your knowledge base, then the menu picks back up where it left off — nobody gets stuck." },
      { title: "Turn it on", body: "Flip the status toggle to Active. It stays editable any time from the Flows list." },
    ],
    tip: "Start with one simple flow: trigger \"hi\" → a welcome menu with two buttons (\"Product info\" / \"Talk to a person\") → the fallback handles anything else. Get that working end to end before building anything more elaborate.",
    faqs: [
      { q: "What happens if a customer's message doesn't match any step?", a: "The fallback kicks in — AI answers from your knowledge base directly, then returns to wherever the flow left off, so the conversation doesn't dead-end." },
      { q: "Can a flow run outside business hours differently?", a: "Yes — the Business hours block lets you route a conversation differently (for example, to an out-of-hours message) based on the time it arrives." },
      { q: "Do I need to write any code for this?", a: "No — flows are built entirely from ready-made blocks in the builder. The Webhook block exists for teams who do want a custom integration, but it's optional." },
    ],
  },
];
