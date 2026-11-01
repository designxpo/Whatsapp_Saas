export const maxDuration = 300;
import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, currentUser, DEFAULT_TENANT_ID } from "@/lib/auth";
import { exportTenantStream, exportContactData } from "@/lib/gdpr";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — download this workspace's personal data as JSON (GDPR / DPDP portability).
//   (no query)          the whole workspace, streamed page by page so a large
//                       workspace never has to fit in memory; a table cut short
//                       by the row cap or the time limit is marked truncated in
//                       the file's closing "summary".
//   ?contact=<id>       everything held about ONE person — a phone number, an
//                       Instagram/Messenger/web-chat id, or a conversation id —
//                       for a data-subject access request.
export async function GET(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const day = new Date().toISOString().slice(0, 10);
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const contact = new URL(req.url).searchParams.get("contact")?.trim();

    if (contact) {
      const data = await exportContactData(tid, contact);
      logActivity(await currentUser(), "gdpr.export_contact", contact);
      return new NextResponse(JSON.stringify(data, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="contact-export-${day}.json"`,
        },
      });
    }

    logActivity(await currentUser(), "gdpr.export", "workspace");
    // Stop paging 30s before the platform would cut the response off mid-file.
    const it = exportTenantStream(tid, { deadlineAt: Date.now() + (maxDuration - 30) * 1000 });
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        try {
          const { value, done } = await it.next();
          if (done) ctrl.close(); else ctrl.enqueue(enc.encode(value));
        } catch (e) { ctrl.error(e); }
      },
      async cancel() { await it.return(undefined); },
    });
    return new Response(body, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="data-export-${day}.json"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
