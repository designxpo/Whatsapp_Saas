export const maxDuration = 60;
import { NextResponse } from "next/server";
import { transformText } from "@/lib/llm";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST — "Generate Agent Prompt": turns a short description into a structured
// WhatsApp persona prompt (like the Xbot generator, tuned for our pipeline).
export async function POST(req: Request) {
  let body: { name?: string; description?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const name = body.name?.trim() || "Assistant";
  const description = body.description?.trim();
  if (!description) return NextResponse.json({ error: "description required" }, { status: 400 });

  const instruction = [
    `Write a system prompt for a WhatsApp business assistant named "${name}".`,
    "Structure it with these plain-text sections: PERSONA & ROLE, GENERAL BEHAVIOR, CONVERSATION FLOW, DATA RULES.",
    "GENERAL BEHAVIOR must include: speak like a human on WhatsApp; detect the visitor's language (Hindi/Hinglish/English) and reply similarly; keep messages short (max ~30 words unless summarizing); be polite and friendly; move the conversation toward its goal without rushing.",
    "CONVERSATION FLOW should be numbered steps derived from the description.",
    "Do not include markdown headers (#) — uppercase section titles and bullet points only.",
    "Base everything on this description of the agent's job:",
  ].join("\n");

  try {
    const persona = await transformText(instruction, description);
    if (!persona) return NextResponse.json({ error: "Generation returned empty text — try again" }, { status: 502 });
    return NextResponse.json({ persona });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
