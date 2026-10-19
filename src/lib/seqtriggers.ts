// ── What can start a sequence ────────────────────────────────────────────────
//
// This list used to hold ten options in a bare dropdown, four of which were
// wired to nothing: comment, tag_added, opt_in and ad_referral are accepted by
// the database and no code anywhere enrols anybody on them. Picking one saved
// cleanly, looked right on the list, and then waited forever — which is a worse
// outcome than the option not existing, because the person concludes the
// product is broken rather than that they chose the wrong thing.
//
// So the picker now offers only what actually fires, each with the sentence
// that says WHEN. A trigger whose meaning has to be inferred from two words in
// a dropdown is a trigger only its author can use.
//
// A sequence saved earlier on one of the dead four still round-trips: the
// picker shows it as an explicit "not connected" row rather than silently
// rewriting somebody's stored setting on the next save.
export type TriggerSpec = {
  value: string;
  label: string;
  when: string;
  platforms: ("whatsapp" | "instagram")[];
  note?: string;
  field?: { label: string; placeholder: string; help: string; required: boolean; numeric?: boolean };
};

export const SEQ_TRIGGERS: TriggerSpec[] = [
  {
    value: "keyword", label: "They send a word",
    when: "The contact messages you with one particular word.",
    platforms: ["whatsapp", "instagram"],
    field: {
      label: "The word they have to send", placeholder: "brochure", required: true,
      help: "It has to be their whole message, on its own. \u201cbrochure\u201d starts the sequence; \u201csend me the brochure\u201d does not. Capital letters make no difference.",
    },
  },
  {
    value: "inactivity", label: "The chat goes quiet",
    when: "You messaged them last and they never replied.",
    platforms: ["whatsapp", "instagram"],
    field: {
      label: "Minutes of silence before the first message", placeholder: "60", required: true, numeric: true,
      help: "Counted from your last message. Left blank it waits 10 minutes. These nudges stop on their own the moment the contact replies or a team member takes the chat over.",
    },
  },
  {
    value: "story_reply", label: "They reply to your story",
    when: "Someone replies to an Instagram story.",
    platforms: ["instagram"],
    field: {
      label: "Only when the reply contains", placeholder: "leave blank for every reply", required: false,
      help: "Unlike a keyword, this one matches anywhere in the message. Leave it empty and every story reply starts the sequence.",
    },
  },
  {
    value: "cart_abandoned", label: "A cart is abandoned",
    when: "A cart has been left untouched for an hour.",
    platforms: ["whatsapp"],
    note: "Checked once an hour. Needs the Catalog set up.",
  },
  {
    value: "order_placed", label: "An order is placed",
    when: "An order is recorded against the contact.",
    platforms: ["whatsapp"],
    note: "Needs the Catalog set up.",
  },
  {
    value: "manual", label: "Nothing automatic \u2014 you choose who",
    when: "Nobody is enrolled until something puts them in.",
    platforms: ["whatsapp", "instagram"],
    note: "Use this when the sequence is started by the Test box below, by a LeadSquared list or webhook, by a sales pipeline stage, or by the AI assistant.",
  },
];

// The four that were offered and never worked. Kept only so an existing
// sequence can show what it is currently set to.
export const SEQ_TRIGGERS_DEAD: Record<string, string> = {
  comment: "Comment", tag_added: "Tag added", opt_in: "Opt-in (growth tool)", ad_referral: "Ad referral",
};

export const triggerSpec = (v: string): TriggerSpec | undefined => SEQ_TRIGGERS.find(t => t.value === v);
export const triggerLabel = (v: string): string =>
  triggerSpec(v)?.label ?? (SEQ_TRIGGERS_DEAD[v] ? `${SEQ_TRIGGERS_DEAD[v]} (not connected)` : v);
