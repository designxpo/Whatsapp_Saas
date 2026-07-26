import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { extractText } from "@/lib/kb";
import { runChat, providerSupportsMedia } from "@/lib/ai/chat";
import { resolveTenantAi, AiKeyMissingError } from "@/lib/ai/keys";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024;   // 15MB — brief docs, not media libraries

// POST (multipart) — read a client's prepared ad brief into plain text so the
// chat/planner can build the campaign from it. PDF / Word / text extract locally;
// an image (screenshot of a plan) is transcribed by the tenant's own vision model.
// Returns { text }. Never publishes anything.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Attach a file to read." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "That file is too large (max 15MB)." }, { status: 400 });

  const name = file.name.toLowerCase();
  const mime = file.type || "";
  try {
    // PDF / Word / plain text → extract locally (reuses the KB pipeline).
    if (mime === "application/pdf" || name.endsWith(".pdf")) {
      const text = await extractText("pdf", { buffer: Buffer.from(await file.arrayBuffer()) });
      return NextResponse.json({ text: text.slice(0, 12000) });
    }
    if (/word|officedocument/.test(mime) || name.endsWith(".docx") || name.endsWith(".doc")) {
      const text = await extractText("docx", { buffer: Buffer.from(await file.arrayBuffer()) });
      return NextResponse.json({ text: text.slice(0, 12000) });
    }
    if (mime.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md")) {
      return NextResponse.json({ text: (await file.text()).slice(0, 12000) });
    }

    // Image (screenshot of a plan) → transcribe with the tenant's vision model.
    if (mime.startsWith("image/")) {
      const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
      let ai;
      try { ai = await resolveTenantAi(tid); }
      catch (err) { if (err instanceof AiKeyMissingError) return NextResponse.json({ error: "Add your AI key first (AI Hub) so I can read images." }, { status: 400 }); throw err; }
      if (!providerSupportsMedia(ai.provider, mime)) return NextResponse.json({ error: "Your AI model can't read images — upload the brief as a PDF or paste the text instead." }, { status: 400 });
      const data = Buffer.from(await file.arrayBuffer()).toString("base64");
      const res = await runChat({
        provider: ai.provider, apiKey: ai.apiKey, model: ai.model,
        system: "You read a screenshot/image of an advertising brief or plan and transcribe it into clear, structured plain text (goal, offer, budget, audience, creative notes, any copy). Output ONLY the transcribed brief — no preamble.",
        turns: [{ role: "user", text: "Transcribe this ad brief into structured text:", media: [{ mimeType: mime, data }] }],
        maxTokens: 1200, timeoutMs: 45000,
      });
      const text = (res.text ?? "").trim();
      if (!text) return NextResponse.json({ error: "Couldn't read anything from that image — try a clearer screenshot or a PDF." }, { status: 400 });
      return NextResponse.json({ text: text.slice(0, 12000) });
    }

    return NextResponse.json({ error: "Unsupported file — upload a PDF, Word doc, text file, or an image." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: `Couldn't read that file: ${errorMessage(err)}` }, { status: 500 });
  }
}
