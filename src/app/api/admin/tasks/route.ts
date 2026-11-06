import { NextResponse } from "next/server";
import { workContext } from "@/lib/work-access";
import { createTask, listTasks, type TaskInput, type TaskStatus } from "@/lib/tasks";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const idOrNull = (v: unknown) => (v === null ? null : typeof v === "string" && v ? v : undefined);

// GET ?contactId=&conversationId=&status=open|done|all — tasks this person may see.
export async function GET(req: Request) {
  const ctx = await workContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const status = (q.get("status") ?? "open") as TaskStatus | "all";
  if (!["open", "done", "cancelled", "all"].includes(status)) return NextResponse.json({ error: "Unknown status" }, { status: 400 });
  try {
    return NextResponse.json(await listTasks(ctx.v, ctx.myId, { contactId: q.get("contactId") ?? undefined, conversationId: q.get("conversationId") ?? undefined, status }));
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST { title, notes?, dueAt?, assigneeId?, contactId?, conversationId?, orderId? }
export async function POST(req: Request) {
  const ctx = await workContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const input: TaskInput = {
    title: str(b.title), notes: str(b.notes), dueAt: b.dueAt === null ? null : str(b.dueAt),
    assigneeId: idOrNull(b.assigneeId), contactId: idOrNull(b.contactId), conversationId: idOrNull(b.conversationId), orderId: idOrNull(b.orderId),
  };
  const r = await createTask(ctx.v, ctx.myId, input);
  return r.error ? NextResponse.json({ error: r.error }, { status: r.status ?? 400 }) : NextResponse.json({ task: r.task });
}
