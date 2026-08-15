// Customer merge fields — the one {{token}} resolver shared by chatbot flows and
// broadcast personalization. A leaf module on purpose: flowengine imports
// ./whatsapp, so whatsapp.ts can't reach back into flowengine for this.

// Text can reference the customer with {{...}}: {{name}}, {{phone}}, {{email}},
// or any collected attribute ({{city}}, {{course}}). Unknown tokens resolve to ""
// so a raw placeholder never leaks to the customer.
export interface ContactVars { name?: string | null; phone?: string; email?: string | null; attributes?: Record<string, string> }
export function fillVars(text: string, c: ContactVars | null): string {
  // A brand-new caller with no contact row still gets tokens stripped — an empty
  // substitution beats greeting them with a literal "{{name}}".
  if (!text || !text.includes("{{")) return text;
  const cv = c ?? {};
  const attrs = cv.attributes ?? {};
  // Collected-attribute lookup, case-insensitive. Reserved tokens fall back to
  // it when the profile column is empty — an ask node saving attribute "email"
  // writes only to attributes, and {{email}} must still render what was asked.
  const attr = (k: string) => { const hit = Object.keys(attrs).find(x => x.toLowerCase() === k); return hit ? String(attrs[hit] ?? "") : ""; };
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, raw: string) => {
    const key = raw.trim().toLowerCase();
    if (key === "name" || key === "firstname" || key === "first_name") return (cv.name || attr("name")).trim().split(/\s+/)[0] || "";
    if (key === "fullname" || key === "full_name") return (cv.name || attr("name")).trim();
    if (key === "phone" || key === "mobile") return cv.phone || attr("phone") || attr("mobile");
    if (key === "email") return (cv.email || attr("email")).trim();
    return attr(key);
  });
}

// Meta rejects template parameters containing newlines, tabs or runs of spaces,
// and contact attributes are raw typed answers — so anything filled into a
// template body gets flattened first. Same rule canned.ts applies.
export function flattenForTemplate(s: string): string {
  return s.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
}
