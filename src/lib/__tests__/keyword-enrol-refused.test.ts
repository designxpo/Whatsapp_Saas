// A keyword that is NOT enrolled must not silence the reply.
//
// enroll() refuses a lead who is already on another journey ("one journey at a
// time") or who has finished this one. Both inbound webhooks used to call it
// and carry on as though it had worked: WhatsApp set `sequenceTriggered = true`
// and Instagram returned, and either way the AI reply was suppressed for a drip
// that never started. The person who typed the word got nothing back.
//
// Source-level, like the other webhook guards here: the webhooks are too wide
// to drive end to end, and what regresses is one unchecked line.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("a refused keyword enrolment still gets an answer", () => {
  it("WhatsApp only claims the thread when enroll() says it enrolled", () => {
    const src = read("src/app/api/webhooks/whatsapp/route.ts");
    expect(src).toMatch(/sequenceTriggered = res\.enrolled/);
    expect(src).not.toMatch(/await enroll\(seq\.id[^;]*;\s*sequenceTriggered = true/);
  });

  it("Instagram only returns early when enroll() says it enrolled", () => {
    const src = read("src/app/api/webhooks/instagram/route.ts");
    expect(src).toMatch(/if \(res\.enrolled\) return;/);
    expect(src).not.toMatch(/if \(kwSeq\) \{ await enroll\(kwSeq\.id[^}]*return; \}/);
  });
});
