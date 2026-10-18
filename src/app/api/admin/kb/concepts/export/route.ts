// Download the library as an OKF bundle.
//
// The point of a vendor-neutral format is that the knowledge can leave, so
// this is deliberately a plain file download rather than an API anybody has to
// integrate with: a .tar.gz of Markdown, openable with tar, committable to
// git, readable by an agent that has never heard of this portal.
import { exportBundle } from "@/lib/okfbundle";
import { errorMessage } from "@/lib/errors";
import { currentTenantId } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const tenantId = await currentTenantId();
  if (!tenantId) return new Response("Unauthorized", { status: 401 });
  try {
    const tar = await exportBundle(tenantId);
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(new Uint8Array(tar), {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="okf-bundle-${stamp}.tar.gz"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: errorMessage(err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}
