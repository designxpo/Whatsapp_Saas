// Knowledge-base checks — saved questions a business expects its AI to get
// right, run on demand through the same reply path a customer gets (practice
// mode: nothing sent, nothing cached, not counted as a gap). A question passes
// when the answer includes every required word, none of the forbidden ones,
// and hands over to a person exactly when it should. The last result is kept.

import { tdb } from "./tenantdb";
import { generateReply, FALLBACK_REPLY } from "./llm";

export interface KbTest {
  id: string; question: string; mustInclude: string[]; mustAvoid: string[]; expectHandoff: boolean; source: string;
  lastRunAt: string | null; lastPassed: boolean | null; lastReply: string | null; lastDetail: string | null;
}
type Row = { id: string; question: string; must_include: string[] | null; must_avoid: string[] | null; expect_handoff: boolean; source: string; last_run_at: string | null; last_passed: boolean | null; last_reply: string | null; last_detail: string | null };

const missing = (e: { code?: string } | null | undefined) => !!e && ["42P01", "PGRST205", "42703", "PGRST204"].includes(e.code ?? "");
const toTest = (r: Row): KbTest => ({ id: r.id, question: r.question, mustInclude: r.must_include ?? [], mustAvoid: r.must_avoid ?? [], expectHandoff: r.expect_handoff, source: r.source,
  lastRunAt: r.last_run_at, lastPassed: r.last_passed, lastReply: r.last_reply, lastDetail: r.last_detail });
const words = (list: unknown) => (Array.isArray(list) ? list : []).map(w => String(w).trim()).filter(Boolean).slice(0, 10).map(w => w.slice(0, 60));

/** Pass/fail for one answer, with the reason in plain words. Pure. */
export function judgeAnswer(test: Pick<KbTest, "mustInclude" | "mustAvoid" | "expectHandoff">, answer: { reply: string | null; handedOver: boolean }): { passed: boolean; detail: string } {
  if (test.expectHandoff) {
    return answer.handedOver ? { passed: true, detail: "Handed over to a person, as it should." } : { passed: false, detail: "Answered by itself — this should have gone to a person." };
  }
  if (answer.handedOver || !answer.reply) return { passed: false, detail: "Handed over to a person instead of answering. Add this to your knowledge base." };
  const text = answer.reply.toLowerCase();
  const absent = test.mustInclude.filter(w => !text.includes(w.toLowerCase()));
  if (absent.length) return { passed: false, detail: `The answer didn't mention: ${absent.join(", ")}.` };
  const said = test.mustAvoid.filter(w => text.includes(w.toLowerCase()));
  if (said.length) return { passed: false, detail: `The answer said something it shouldn't: ${said.join(", ")}.` };
  return { passed: true, detail: test.mustInclude.length ? "Answered, with everything it should mention." : "Answered from your knowledge base." };
}

export async function listKbTests(tenantId: string): Promise<{ tests: KbTest[]; setupPending?: boolean }> {
  const { data, error } = await tdb(tenantId).from("wa_kb_tests").select("*").order("created_at", { ascending: true }).limit(200);
  if (error) return missing(error) ? { tests: [], setupPending: true } : Promise.reject(error);
  return { tests: ((data ?? []) as unknown as Row[]).map(toTest) };
}

export async function addKbTest(tenantId: string, input: { question?: unknown; mustInclude?: unknown; mustAvoid?: unknown; expectHandoff?: unknown }): Promise<{ test?: KbTest; error?: string; status?: number }> {
  const question = typeof input.question === "string" ? input.question.trim() : "";
  if (question.length < 3 || question.length > 500) return { error: "Write the question a customer would ask (3–500 characters).", status: 400 };
  const { data, error } = await tdb(tenantId).from("wa_kb_tests").insert({
    question, must_include: words(input.mustInclude), must_avoid: words(input.mustAvoid), expect_handoff: input.expectHandoff === true, source: "manual",
  }).select("*").single();
  if (error) {
    if (error.code === "23505") return { error: "That question is already saved.", status: 409 };
    return missing(error) ? { error: "Knowledge checks are still being set up for your workspace.", status: 503 } : { error: error.message, status: 500 };
  }
  return { test: toTest(data as unknown as Row) };
}

export async function deleteKbTest(tenantId: string, id: string): Promise<boolean> {
  const { data } = await tdb(tenantId).from("wa_kb_tests").delete().eq("id", id).select("id");
  return !!data?.length;
}

/** Run the given tests (or all) one by one, saving each result. */
export async function runKbTests(tenantId: string, ids?: string[]): Promise<KbTest[]> {
  const { tests } = await listKbTests(tenantId);
  const run = ids?.length ? tests.filter(t => ids.includes(t.id)) : tests;
  const out: KbTest[] = [];
  for (const t of run.slice(0, 25)) {
    let reply: string | null = null, handedOver = false, error: string | null = null;
    try {
      const r = await generateReply([{ role: "user", body: t.question }], undefined, null, tenantId, null, false, undefined, "whatsapp", undefined, { unscoped: true, practice: true });
      reply = r.reply; handedOver = r.escalate || !r.reply || r.reply.trim() === FALLBACK_REPLY;
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
    const verdict = error ? { passed: false, detail: `Couldn't run: ${error.slice(0, 160)}` } : judgeAnswer(t, { reply, handedOver });
    const patch = { last_run_at: new Date().toISOString(), last_passed: error ? null : verdict.passed, last_reply: reply?.slice(0, 2000) ?? null, last_detail: verdict.detail };
    await tdb(tenantId).from("wa_kb_tests").update(patch).eq("id", t.id);
    out.push({ ...t, lastRunAt: patch.last_run_at, lastPassed: patch.last_passed, lastReply: patch.last_reply, lastDetail: patch.last_detail });
  }
  return out;
}
