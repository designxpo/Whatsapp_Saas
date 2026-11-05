# WhatsApp handoff — comments and DMs continue on WhatsApp

## Intent

A comment or DM on Instagram, Facebook or YouTube is an anonymous, rented
conversation: the platform owns it, the 24-hour window closes it, and YouTube
has no private messages at all. Indian businesses close sales on WhatsApp.
The handoff moves the person there with their context — which post, what they
asked — so the business gets a real contact it can keep talking to, and sees
which posts and videos actually produce chats and sales.

Comment-to-DM tools stop at the DM; YouTube reply tools only reply. Turning a
comment into a WhatsApp customer, with the sale attributed to the post, is the
gap (research 2026-11-01).

## Decided by Priyesh

- Build it for Instagram and Facebook.
- YouTube only without links (YouTube hides replies with links). "Another way"
  is acceptable: a typed code, with the WhatsApp number in a pinned comment.
- No new Meta App Review. Instagram/Facebook comment triggers ride the comment
  permissions already submitted (they reach clients when that approval lands;
  today they work on the owner's own accounts). DMs are approved now.

## Decided by Claude (calls, open to change)

- **Codes.** Instagram/Facebook: a 10-character code hidden in the WhatsApp
  link's prefilled message, using Handle Hub's invisible-ref encoding (source
  codes are 7 characters and session codes 12, so the three never collide).
  YouTube: a short typed code, `YT-4821`, unique per workspace among open codes.
  A code is claimed once, by the first WhatsApp number that sends it, and
  expires after 30 days.
- **The WhatsApp number** is the workspace's first Handle Hub entry point
  (already validated to include the country code). Without one, no link is
  made, the rule still sends its DM, and the rule editor says what to add.
- **Triggers in v1:** comment rules on all three platforms get "Continue on
  WhatsApp" — Instagram/Facebook add a "Continue on WhatsApp" button to the
  rule's DM (counts toward Meta's 3-button cap); YouTube appends the code
  sentence to the public reply. A rule with the option on must say what to send
  on WhatsApp when the person arrives.
- **On arrival** (WhatsApp inbound with a valid code): the handoff is claimed,
  the contact is tagged with where they came from and the original comment is
  kept on the contact, the rule's WhatsApp message is sent (inside the
  customer-opened 24-hour window, so no template is needed), and the AI then
  carries on as for any WhatsApp chat.
- **Results:** a "WhatsApp handoffs" section in each platform tab — invites
  sent, chats started, orders and revenue (paid orders from that number after
  the chat started), per post/video, range + paging like "Replies sent".

## Not in v1 (next)

- Live Chat "Send WhatsApp link" button for agents on Instagram/Facebook DMs.
- The AI offering the handoff by itself.

## Constraints

- Isolation: every row carries the workspace; claims match codes only within
  the workspace that owns the receiving WhatsApp number.
- Never block a reply or DM because handoff creation failed — the DM goes out
  without the button.
- Works before its migration is applied (rules save without the new columns).
