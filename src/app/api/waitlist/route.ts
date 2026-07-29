import { NextResponse } from "next/server";
import { createWaitlistEntry } from "@/lib/waitlist";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST — PUBLIC (no auth). A prospect submits the marketing waitlist form.
// `website` is a honeypot: real users never fill it, bots do — we accept the
// request (so the bot sees success) but silently drop it.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (typeof body.website === "string" && body.website.trim()) {
    return NextResponse.json({ success: true });   // honeypot tripped — pretend success, store nothing
  }

  try {
    const entry = await createWaitlistEntry({
      name: body.name as string,
      email: body.email as string,
      phone: (body.phone as string) ?? null,
      company: (body.company as string) ?? null,
      plan: (body.plan as string) ?? null,
      channels: Array.isArray(body.channels) ? (body.channels as string[]) : [],
      message: (body.message as string) ?? null,
      source: "marketing",
    });
    if (!entry) return NextResponse.json({ error: "Please enter your name and a valid email." }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
