// Wraps untrusted text — knowledge-base chunks, a remembered customer profile —
// in a named block the runtime policy (prompts/runtime-policy.ts) tells the
// model to treat as data.
//
// Defence in depth, not a boundary: fencing makes an injected instruction
// easier for the model to recognise as data; it does not make it impossible to
// obey. What bounds the damage is in code (see runtime-policy.ts).
//
// The fence must not be closable from inside. Invisible and format characters
// are removed first (so "</­knowledge-base>" cannot read as a closing tag
// — the same lesson as mcp/untrusted.ts), then any opening or closing tag of
// either fence name is neutralised.

export type FenceName = "knowledge-base" | "customer-profile";

const TAG_RE = /<\s*\/?\s*(knowledge-base|customer-profile)\b/gi;

export function fenceData(name: FenceName, text: string): string {
  const body = String(text ?? "")
    .replace(/[\p{Default_Ignorable_Code_Point}\p{Cf}]/gu, "")
    .replace(TAG_RE, (_m, n: string) => `&lt;${n}`);
  return `<${name}>\n${body}\n</${name}>`;
}
