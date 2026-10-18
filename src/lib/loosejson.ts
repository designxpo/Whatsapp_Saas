// Reading a JSON body from a client that mangled it on the way out.
//
// ── What LeadSquared actually sends ─────────────────────────────────────────
//
// Its Custom Lead Action takes a JSON body in a config box and then escapes
// it as though it were a string — every " becomes \" and every newline a
// literal \n — but sends it WITHOUT the enclosing quotes. The result is
// neither valid JSON nor a valid JSON string:
//
//   {\n  \"phone\": \"+91-8368872108\",\n  \"course\": \"\"\n}
//
// Measured on the live connector, 12 Oct 2026, after the probe was taught to
// record the structure of a body it could not parse. The same connector
// mangles the query string the same way, encoding the "=" in ?token=.
//
// ── Why we accept it rather than ask them to fix it ─────────────────────────
//
// There is nothing for an operator to fix. The configuration is correct in
// the box; the damage happens between the box and the wire. Refusing it means
// the button cannot work at all, so the choice is to parse it or not have the
// feature.
//
// Every recovery is tried only AFTER a normal parse has failed, so a
// well-formed body is never touched by any of this.

/**
 * Parse a body that should be JSON, tolerating two known manglings.
 *
 * Returns undefined when nothing yields an object — the caller still decides
 * what to do about that, and still validates whatever comes back.
 */
export function parseLooseJson(raw: string): unknown {
  const t = (raw ?? "").trim();
  if (!t) return undefined;

  // 1. It is simply JSON — the overwhelmingly common case, and the only one
  //    that should ever apply to a well-behaved caller.
  //
  //    If that yields a STRING rather than an object, the body was encoded
  //    twice: a JSON string whose contents are themselves JSON. Unwrapping
  //    here rather than in a later branch matters, because this parse
  //    SUCCEEDS on a double-encoded body and would otherwise return the
  //    inner text as the payload.
  try {
    const once = JSON.parse(t);
    if (typeof once !== "string") return once;
    try { return JSON.parse(once); } catch { return once; }
  } catch { /* fall through */ }

  // 2. Escaped as a string but sent without the quotes — LeadSquared's shape.
  //
  //    Wrapping it in quotes and parsing is how the escaping gets undone
  //    correctly: \" \\ \n \t \uXXXX all mean what JSON says they mean, which
  //    hand-rolled replacements get subtly wrong. Any REAL newline has to be
  //    escaped first, or the string literal is unterminated.
  if (t.includes('\\"')) {
    try {
      const asStringLiteral = `"${t.replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`;
      const unescaped = JSON.parse(asStringLiteral);
      if (typeof unescaped === "string") return JSON.parse(unescaped);
    } catch { /* fall through */ }
  }

  return undefined;
}

/**
 * The same, but guaranteeing a plain object.
 *
 * A body that parses to a string, a number or an array is not a payload, and
 * letting one through would only move the failure somewhere less obvious.
 */
export function parseLooseJsonObject(raw: string): Record<string, unknown> | undefined {
  const v = parseLooseJson(raw);
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}
