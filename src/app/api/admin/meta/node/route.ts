import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getNodeInsights, getNodeChildren, type DatePreset, type NodeInsights } from "@/lib/ads";

export const dynamic = "force-dynamic";

// GET ?id=&level=campaign|adset|ad&preset= — full analytics for one node plus
// its child cards (ad sets / ads). Powers the dedicated ad detail view.
export async function GET(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const levelRaw = url.searchParams.get("level");
  const level: NodeInsights["level"] = levelRaw === "adset" || levelRaw === "ad" ? levelRaw : "campaign";
  const presetRaw = url.searchParams.get("preset") ?? "last_7d";
  const preset: DatePreset = presetRaw === "today" || presetRaw === "last_30d" ? presetRaw : "last_7d";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const [node, children] = await Promise.all([
    getNodeInsights(id, level, preset),
    getNodeChildren(level, id, preset),
  ]);
  if (!node.ok) return NextResponse.json({ error: node.error }, { status: 502 });
  return NextResponse.json({ node: node.node, adsets: children.adsets, ads: children.ads });
}
