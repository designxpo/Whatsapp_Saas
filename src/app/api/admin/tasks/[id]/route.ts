import { NextResponse } from "next/server";
import { workContext } from "@/lib/work-access";
import { updateTask, type TaskStatus } from "@/lib/tasks";

export const dynamic = "force-dynamic";

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

// PATCH { status?, title?, notes?, dueAt?, assigneeId? } — only on a task this person may see.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await workContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const r = await updateTask(ctx.v, ctx.myId, id, {
    status: str(b.status) as TaskStatus | undefined, title: str(b.title), notes: str(b.notes),
    dueAt: b.dueAt === null ? null : str(b.dueAt), assigneeId: b.assigneeId === null ? null : str(b.assigneeId),
  });
  return r.error ? NextResponse.json({ error: r.error }, { status: r.status ?? 400 }) : NextResponse.json({ task: r.task });
}
