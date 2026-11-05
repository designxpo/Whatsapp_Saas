// Live Chat labels which of our numbers a message went through. Numbers are
// often named after the person who works them, and "via Kushal" under the
// CUSTOMER's message read as though Kushal had written it.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync(`${process.cwd()}/src/app/admin/_tabs/LiveChatTab.tsx`, "utf8");

describe("the number a chat message went through", () => {
  it("says received on / sent from, and that it is a number or account", () => {
    expect(SRC).toMatch(/m\.role === "user" \? "received on" : "sent from"/);
    expect(SRC).toMatch(/=== "whatsapp" \? "number" : "account"/);
  });
  it("never the bare 'via <name>' that read like an author", () => {
    expect(SRC).not.toMatch(/· via \{channelName/);
  });
});
