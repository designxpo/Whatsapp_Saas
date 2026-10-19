import { NextResponse } from "next/server";
import { currentUser, DEFAULT_TENANT_ID } from "@/lib/auth";
import { getVocabState, saveVocab } from "@/lib/vocabstore";
import { INDUSTRY_PACKS, GENERIC_VOCAB, resolveVocab } from "@/lib/vocab";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — the workspace's resolved terms, plus the industry packs for the picker.
// Readable by anyone signed in: every screen needs the words.
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const state = await getVocabState(user.tenantId || DEFAULT_TENANT_ID);
    return NextResponse.json({
      ...state,
      industries: INDUSTRY_PACKS.map(p => ({ id: p.id, label: p.label, vocab: resolveVocab(p.id) })),
      defaults: GENERIC_VOCAB,
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// PUT { industry?, overrides? } — admin only; renaming terms changes what
// everyone on the team sees. Overrides are replaced wholesale (send {} to reset).
export async function PUT(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Only an admin can change the workspace terminology." }, { status: 403 });
  let body: { industry?: unknown; overrides?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    return NextResponse.json(await saveVocab(user.tenantId || DEFAULT_TENANT_ID, body));
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
