// The trigger list the portal offers must be the triggers that actually enrol.
//
// It used to offer ten. Four of them — comment, tag_added, opt_in, ad_referral
// — were accepted by the database and wired to nothing: no code anywhere
// enrolled a contact on them. Choosing one saved cleanly, read correctly on the
// list, and then waited for ever. That is worse than the option not existing,
// because the person concludes the product is broken rather than that they
// picked the wrong thing.
//
// A list curated by hand drifts back, in both directions: somebody adds an
// option ahead of the code, or wires a trigger and forgets the picker. So this
// reads the CALL SITES out of the source and compares.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SEQ_TRIGGERS, SEQ_TRIGGERS_DEAD, triggerSpec, triggerLabel } from "../seqtriggers";

function sources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) { if (e !== "__tests__") sources(full, out); }
    else if (/\.tsx?$/.test(e)) out.push(full);
  }
  return out;
}

/** Trigger kinds something in the codebase actually enrols on. */
function wiredTriggers(): Set<string> {
  const wired = new Set<string>();
  for (const f of sources("src")) {
    if (f.endsWith("seqtriggers.ts")) continue;
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/getSequenceByTrigger\(\s*"([a-z_]+)"/g)) wired.add(m[1]);
    // Keyword has its own resolver rather than going through getSequenceByTrigger.
    if (/matchKeywordSequence\(/.test(src) && !/export async function matchKeywordSequence/.test(src)) wired.add("keyword");
  }
  // `manual` is the absence of an automatic trigger: enrol() is called directly
  // by the test box, a LeadSquared list or webhook, a pipeline stage and the AI
  // tool. There is no string to grep for, so it is named here on purpose.
  wired.add("manual");
  return wired;
}

describe("what the portal offers", () => {
  it("offers every trigger the code actually enrols on", () => {
    const offered = new Set(SEQ_TRIGGERS.map(t => t.value));
    for (const w of wiredTriggers()) {
      expect(offered.has(w), `"${w}" enrols contacts but is not offered in the portal`).toBe(true);
    }
  });

  it("offers NOTHING that enrols nobody", () => {
    // The original failure, in the direction it happened.
    const wired = wiredTriggers();
    for (const t of SEQ_TRIGGERS) {
      expect(wired.has(t.value), `"${t.value}" is offered in the portal but nothing enrols on it`).toBe(true);
    }
  });

  it("keeps the four dead ones out of the picker but still able to be shown", () => {
    // A sequence saved on one of them must not be silently rewritten on the
    // next save — it has to be visible so somebody can change it deliberately.
    for (const dead of Object.keys(SEQ_TRIGGERS_DEAD)) {
      expect(SEQ_TRIGGERS.some(t => t.value === dead), dead).toBe(false);
      expect(triggerLabel(dead)).toMatch(/not connected/);
    }
  });
});

describe("what each option tells the person", () => {
  it("says when it fires, in a sentence, not just a name", () => {
    for (const t of SEQ_TRIGGERS) {
      expect(t.label.length, t.value).toBeGreaterThan(3);
      expect(t.when.trim().endsWith("."), `${t.value}: "when" should read as a sentence`).toBe(true);
      expect(t.when.length, t.value).toBeGreaterThan(20);
    }
  });

  it("gives every trigger at least one platform, and story replies only Instagram", () => {
    for (const t of SEQ_TRIGGERS) expect(t.platforms.length, t.value).toBeGreaterThan(0);
    expect(triggerSpec("story_reply")!.platforms).toEqual(["instagram"]);
    // Carts and orders are WhatsApp commerce; offering them on an Instagram
    // sequence would be a choice that silently never fires.
    for (const v of ["cart_abandoned", "order_placed"]) {
      expect(triggerSpec(v)!.platforms).toEqual(["whatsapp"]);
    }
  });

  it("explains the value box whenever there is one, and omits it when there is not", () => {
    // The old UI had one box labelled "Trigger value (keyword / tag / ref id)"
    // for every trigger, including the ones that ignore it entirely.
    expect(triggerSpec("keyword")!.field!.required).toBe(true);
    expect(triggerSpec("inactivity")!.field!.numeric).toBe(true);
    expect(triggerSpec("story_reply")!.field!.required).toBe(false);   // blank = every reply
    for (const v of ["cart_abandoned", "order_placed", "manual"]) {
      expect(triggerSpec(v)!.field, `${v} does not use a value`).toBeUndefined();
    }
    for (const t of SEQ_TRIGGERS) {
      if (t.field) expect(t.field.help.length, t.value).toBeGreaterThan(30);
    }
  });
});
