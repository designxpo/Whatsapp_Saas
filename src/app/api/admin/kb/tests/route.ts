import { NextResponse } from "next/server";
import { aiGate } from "@/lib/ai-gate";
import { addKbTest, deleteKbTest, listKbTests, runKbTests } from "@/lib/kb-tests";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await aiGate("admin"); if (!g.ok) return g.res;
  try { return NextResponse.json(await listKbTests(g.tid)); }
  catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}

// POST { action: "add", question, mustInclude?, mustAvoid?, expectHandoff? } | { action: "run", ids? }
export async function POST(req: Request) {
  const g = await aiGate("admin"); if (!g.ok) return g.res;
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    if (b.action === "add") {
      const r = await addKbTest(g.tid, b);
      return r.error ? NextResponse.json({ error: r.error }, { status: r.status ?? 400 }) : NextResponse.json({ test: r.test });
    }
    if (b.action === "run") {
      const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string") : undefined;
      return NextResponse.json({ results: await runKbTests(g.tid, ids) });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}

export async function DELETE(req: Request) {
  const g = await aiGate("admin"); if (!g.ok) return g.res;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  return (await deleteKbTest(g.tid, id)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
