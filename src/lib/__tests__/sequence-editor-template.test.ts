// Two things the sequence editor must keep doing, neither of which has a
// runtime test because the portal is one large client component.
//
//   1. Offer templates as a LIST, scoped to the sending number. A typed
//      template name fails at send time, weeks later, as one line in
//      last_error that nobody is watching.
//
//   2. Carry each step's audience through a save. There is no editor for it
//      yet, so a save that dropped it would widen the three restricted RNR
//      steps to every enrolled lead — silently, and with an unverified
//      salary claim in one of them.
//
// Read as text, the way the palette and tenant-coverage guards do, because
// what is being protected is the wiring rather than a rendered result.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const page = readFileSync(join(process.cwd(), "src/app/admin/_tabs/SequencesTab.tsx"), "utf8");
const route = readFileSync(join(process.cwd(), "src/app/api/admin/sequences/route.ts"), "utf8");

/**
 * Just the picker's own source.
 *
 * Found by mutation testing: an assertion against the whole file passed
 * while the picker was broken, because the identical line exists three
 * times — the Broadcast and Canned tabs filter templates the same way. A
 * guard that any other tab can satisfy guards nothing.
 */
function sourceOf(fn: string): string {
  const start = page.indexOf(`function ${fn}`);
  expect(start, `${fn} is gone`).toBeGreaterThan(-1);
  const end = page.indexOf("\nfunction ", start + 1);
  return page.slice(start, end === -1 ? undefined : end);
}

const picker = sourceOf("SeqTemplatePicker");
const media = sourceOf("SeqMediaPicker");

describe("the template field is a picker, not a free-text box", () => {
  it("the step editor renders the picker for a template step", () => {
    expect(page).toContain("<SeqTemplatePicker");
  });

  it("the picker asks for templates on the sequence's own number", () => {
    // Templates are WABA-scoped: the same name approved on another account
    // does not exist here, and the send fails with a name-not-found error
    // that says nothing about which account it looked in.
    expect(picker).toMatch(/api\/admin\/templates\$\{channelId \? `\?channelId=\$\{encodeURIComponent\(channelId\)\}`/);
  });

  it("offers only APPROVED templates", () => {
    expect(picker).toContain('tpls.filter(t => t.status === "APPROVED")');
  });

  it("the guard is scoped to the picker, not satisfied by another tab", () => {
    // The file has three identical APPROVED filters. This pins that the
    // slice above really is the picker and really is small.
    expect(picker).toContain("SeqTemplatePicker");
    expect(picker).not.toContain("function SequencesTab");
    expect(picker.length).toBeLessThan(page.length / 10);
  });

  it("warns when the saved name is not approved on the selected number", () => {
    expect(picker).toContain("is not approved on this number");
  });

  it("clears the params when the template changes", () => {
    // The old values filled a different body's {{n}}. Carrying them over
    // puts a course name where a date belongs.
    expect(picker).toMatch(/onChange\(\{ templateName: t\?\.name \?\? "", languageCode: t\?\.language \?\? "", params: \[\] \}\)/);
  });

  it("still allows typing a name, for a template Meta has not listed yet", () => {
    expect(picker).toContain("Type a name instead");
  });
});

describe("a step's audience survives a save", () => {
  it("the editor reads it off the row", () => {
    expect(page).toMatch(/audience: st\.audience \?\? null/);
  });

  it("the save route resolves audiences rather than taking the body as given", () => {
    expect(route).toContain("resolveStepAudiences");
  });

  it("the route reads the stored steps to preserve from", () => {
    expect(route).toMatch(/getSequenceSteps\(body\.id[,)]/);   // (body.id, tenantId) since the multi-tenant port
  });

  it("setSequenceSteps is never called with the raw body steps", () => {
    // The regression this guards: `setSequenceSteps(id!, body.steps)` is a
    // one-line change that compiles, passes every other test, and wipes
    // every audience rule in the sequence.
    expect(route).not.toMatch(/setSequenceSteps\(id!, body\.steps\)/);
  });
});

describe("a media step can be uploaded, not just linked", () => {
  it("the step editor renders the media picker", () => {
    expect(page).toContain("<SeqMediaPicker");
  });

  it("offers an upload that posts to the shared upload route", () => {
    expect(media).toContain('fetch("/api/upload"');
    expect(media).toContain("FormData");
  });

  it("keeps the URL box — a hosted asset is a real answer", () => {
    expect(media).toMatch(/aria-label="Media URL"/);
  });

  it("shows the refusal text instead of failing silently", () => {
    // uploadguard returns prose written for whoever is standing here
    // ("SVG images can carry scripts — export it as a PNG"). The older
    // upload buttons drop it, leaving an empty field and no reason.
    expect(media).toContain("d.error");
    expect(media).toMatch(/setErr\(/);
  });

  it("narrows the file picker to what storage will actually accept", () => {
    // A refusal after the upload is worse than never offering the file.
    expect(media).toContain("MEDIA_ACCEPT[kind]");
  });

  it("the accept list matches uploadguard's allowed types", () => {
    // If uploadguard's list changes and this does not, the picker either
    // offers files that will be refused or hides ones that would work.
    const guard = readFileSync(join(process.cwd(), "src/lib/uploadguard.ts"), "utf8");
    const accept = page.slice(page.indexOf("const MEDIA_ACCEPT"), page.indexOf("function SeqMediaPicker"));
    for (const mime of accept.match(/[a-z]+\/[a-z0-9.+-]+/g) ?? []) {
      expect(guard, `${mime} is offered but uploadguard does not allow it`).toContain(`"${mime}"`);
    }
  });

  it("never offers SVG", () => {
    expect(media).not.toContain("svg");
    expect(page.slice(page.indexOf("const MEDIA_ACCEPT"), page.indexOf("function SeqMediaPicker"))).not.toContain("svg");
  });

  it("clears the file input so re-picking the same file still fires", () => {
    expect(media).toContain('e.currentTarget.value = ""');
  });

  it("exposes the caption, which the send path already supports", () => {
    expect(media).toMatch(/aria-label="Caption"/);
  });
});

describe("the preview shows the message, not the filename", () => {
  const preview = sourceOf("SequencePreview");

  it("loads the approved copy for the sequence's own number", () => {
    // Templates are WABA-scoped, so without the channel this shows another
    // account's copy — or none. Mentioning channelId in the URL is not
    // enough: the effect has to RE-RUN when the number changes, or picking
    // a different number leaves the previous account's templates on screen.
    expect(preview).toContain("api/admin/templates");
    expect(preview).toMatch(/\}, \[channelId\]\);/);
  });

  it("renders the body through previewParts rather than the template name", () => {
    // Anchored on the exact branch: `&& parts &&` reached via a disabled
    // condition would leave every one of these strings in the file while
    // rendering the filename fallback for every step.
    expect(preview).toContain("previewParts(tpl");
    expect(preview).toContain('{a.type === "template" && parts && <>');
    expect(preview).toContain('{a.type === "template" && !parts && <>');
    expect(preview).toContain("parts.body");
  });

  it("renders the quick-reply buttons", () => {
    // The buttons ARE the routing. An operator checking a drip step needs
    // to see them, not a filename the lead never sees.
    expect(preview).toContain("parts.buttons.map");
  });

  it("puts the timestamp above the button strip, as WhatsApp does", () => {
    const body = preview.indexOf("parts.body");
    const stampInBubble = preview.indexOf('10:30', body);
    const buttons = preview.indexOf("parts.buttons.map");
    expect(stampInBubble).toBeGreaterThan(-1);
    expect(stampInBubble).toBeLessThan(buttons);
  });

  it("still says something useful when there is nothing to preview", () => {
    expect(preview).toContain("no template chosen yet");
    expect(preview).toContain("not approved on this number");
  });
});
