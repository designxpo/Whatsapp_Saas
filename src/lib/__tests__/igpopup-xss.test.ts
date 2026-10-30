// The Instagram login popup's result page puts its result into a <script>.
//
// The error text can come straight off the callback's query string
// (error_description), so anyone can write it into a link and send it to a
// signed-in admin. JSON.stringify does not escape "<", so a description of
// "</script><script>…" ended the block and ran the rest as that admin.
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/auth", () => ({ requireRoleAdmin: async () => true, currentUser: async () => null }));
import { popupHtml } from "@/lib/igpopup";

const ATTACK = "</script><script>fetch('/api/admin/team',{method:'POST'})</script>";

describe("Instagram popup result page", () => {
  it("cannot be closed early by the error text", () => {
    const html = popupHtml({ ok: false, error: `Instagram refused the connection (${ATTACK}).` });
    const script = html.slice(html.indexOf("<script>") + "<script>".length, html.indexOf("</script>"));
    // Exactly one closing tag: its own.
    expect(html.match(/<\/script/gi)).toHaveLength(1);
    expect(html.match(/<script>/gi)).toHaveLength(1);
    expect(script).not.toContain("<");
  });

  it("still hands the opener the exact text", () => {
    const html = popupHtml({ ok: false, error: ATTACK + "   & >" });
    const literal = html.match(/postMessage\((\{.*\}), window\.location\.origin\)/)![1];
    expect(JSON.parse(literal).error).toBe(ATTACK + "   & >");
  });
});
