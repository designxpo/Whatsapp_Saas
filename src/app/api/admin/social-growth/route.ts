import { NextResponse } from "next/server";
import { currentUser, DEFAULT_TENANT_ID } from "@/lib/auth";
import { guardFeature, accountCanSend } from "@/lib/feature-guard";
import { listGaps, answerGap } from "@/lib/ai-gaps";
import {
  socialDashboard,
  removeManualOutcome,
  captureCommitment,
  saveSocialCampaign,
  reviewCommitment,
  recordSocialOutcome,
  updateJourneyAnswers,
} from "@/lib/social-growth";
import { tdb } from "@/lib/tenantdb";
import { errorMessage } from "@/lib/errors";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
type SocialAccess =
  | { ok: false; response: Response }
  | {
      ok: true;
      tid: string;
      user: NonNullable<Awaited<ReturnType<typeof currentUser>>>;
    };
async function access(): Promise<SocialAccess> {
  const user = await currentUser();
  if (!user || user.role !== "admin")
    return {
      ok: false,
      response: NextResponse.json({ error: "Admins only" }, { status: 403 }),
    };
  const tid = user.tenantId || DEFAULT_TENANT_ID;
  const blocked = await guardFeature(tid, "growth");
  if (blocked) return { ok: false, response: blocked };
  return { ok: true, tid, user };
}
export async function GET() {
  const auth = await access();
  if (!auth.ok) return auth.response;
  try {
    const [dashboard, demand, channels, team] = await Promise.all([
      socialDashboard(auth.tid),
      listGaps(auth.tid, 30),
      tdb(auth.tid)
        .from("wa_channels")
        .select("id,name,kind,kb_tag")
        .in("kind", ["instagram", "messenger"]),
      tdb(auth.tid).from("wa_users").select("email,name").eq("active", true),
    ]);
    if (channels.error || team.error)
      throw new Error(channels.error?.message || team.error?.message);
    return NextResponse.json({
      ...dashboard,
      demand,
      channels: (
        (channels.data ?? []) as unknown as {
          id: string;
          name: string;
          kind: string;
          kb_tag?: string;
        }[]
      ).map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        kb_tag: c.kb_tag,
      })),
      team: (
        (team.data ?? []) as unknown as { email: string; name: string }[]
      ).map((u) => ({ email: u.email, name: u.name })),
    });
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
  }
}
export async function POST(req: Request) {
  const auth = await access();
  if (!auth.ok) return auth.response;
  if (!(await accountCanSend(auth.tid)))
    return NextResponse.json(
      { error: "Reactivate your workspace to make changes" },
      { status: 402 },
    );
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const id = typeof body.id === "string" ? body.id : "";
    switch (body.action) {
      case "campaign":
        return NextResponse.json({
          campaign: await saveSocialCampaign(auth.tid, body),
        });
      case "commitment_candidate":
        await captureCommitment(auth.tid, id, String(body.evidence ?? ""));
        return NextResponse.json({ ok: true });
      case "commitment":
        return NextResponse.json({
          commitment: await reviewCommitment(
            auth.tid,
            id,
            body,
            auth.user.email,
          ),
        });
      case "outcome": {
        // External callers cannot claim payment verification. Only signed gateway hooks can.
        await recordSocialOutcome(auth.tid, {
          journeyId: String(body.journeyId ?? ""),
          kind: String(body.kind ?? ""),
          amountCents: Number(body.amountCents ?? 0),
          currency: String(body.currency ?? "INR").toUpperCase(),
          reference: String(body.reference ?? ""),
          eventKey: `manual:${String(body.journeyId)}:${String(body.kind)}:${String(body.reference).trim()}`,
          evidence: "manual",
        });
        return NextResponse.json({ ok: true });
      }
      case "remove_outcome":
        await removeManualOutcome(auth.tid, id);
        return NextResponse.json({ ok: true });
      case "answers":
        await updateJourneyAnswers(auth.tid, id, body.answers);
        return NextResponse.json({ ok: true });
      case "demand_campaign": {
        const { groups } = await listGaps(auth.tid, 30);
        const gap = groups.find((g) => g.key === body.key);
        if (!gap) throw new Error("Demand evidence no longer available");
        return NextResponse.json({
          campaign: await saveSocialCampaign(auth.tid, {
            name: `Audience demand: ${gap.question}`.slice(0, 100),
            channel_id: body.channel_id,
            audience: body.audience,
            questions: [gap.question],
            goal: "lead",
            status: "draft",
            facts: "",
          }),
        });
      }
      case "answer_demand": {
        const result = await answerGap(
          auth.tid,
          String(body.key ?? ""),
          String(body.answer ?? ""),
          auth.user.email,
          typeof body.tag === "string" ? body.tag : null,
        );
        if (result.error) throw new Error(result.error);
        return NextResponse.json(result);
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 400 });
  }
}
