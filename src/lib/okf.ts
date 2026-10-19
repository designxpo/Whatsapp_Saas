import { factsFor, parseTables } from "./okffacts";
// Open Knowledge Format (OKF v0.1 — Google Cloud, 12 June 2026).
//
// A bundle is a directory of Markdown files. One file is one concept, the file
// PATH is that concept's identity, and concepts link to each other with
// ordinary Markdown links. The YAML front matter requires exactly one field,
// `type`; `title`, `description`, `resource`, `tags` and `timestamp` are
// reserved and optional. Everything else belongs to whoever wrote the file.
//
// ── Why this exists alongside the vector index ───────────────────────────────
//
// Retrieval is not being removed. The bundle becomes the thing people EDIT and
// review — diffable, addressable, no embedding in the loop — and the pgvector
// index becomes a build artifact generated from it, which can be thrown away
// and rebuilt. That ordering is what makes the move safe: the answer path is
// unchanged on the day the knowledge moves, so a bad decomposition shows up as
// a worse eval score rather than as wrong answers to real leads.
//
// ── No SDK, deliberately ─────────────────────────────────────────────────────
//
// The spec ships no runtime and no library, and the front matter it reserves is
// six scalar fields plus a string list. That is parsed here rather than by
// pulling in a YAML dependency: a general YAML parser would accept anchors,
// nested maps and multi-document files that OKF never uses, and would turn a
// typo into a surprising object instead of a clear error.

/** The fields OKF v0.1 reserves. Anything else is the producer's own. */
const RESERVED = ["type", "title", "description", "resource", "tags", "timestamp"] as const;

export interface OkfConcept {
  /** Path within the bundle, e.g. "courses/data-analytics.md". The identity. */
  path: string;
  /** The only required field. The producer decides what types exist. */
  type: string;
  title?: string;
  description?: string;
  resource?: string;
  tags?: string[];
  timestamp?: string;
  /** Front-matter fields the spec does not reserve, kept verbatim. */
  extra?: Record<string, string>;
  /** Markdown body, exactly as written. */
  body: string;
}

// ── Front matter ─────────────────────────────────────────────────────────────

/** Strip one layer of matching quotes a hand-written file may carry. */
const unquote = (s: string): string => {
  const t = s.trim();
  return (t.startsWith('"') && t.endsWith('"') && t.length > 1) ||
         (t.startsWith("'") && t.endsWith("'") && t.length > 1) ? t.slice(1, -1) : t;
};

const parseInlineTags = (v: string): string[] =>
  v.replace(/^\[|\]$/g, "").split(",").map(unquote).filter(Boolean);

/**
 * Read one concept file.
 *
 * Returns the concept, or null plus the reasons it is not one. Never throws:
 * a bundle is usually read in bulk, and one malformed file must be reportable
 * rather than fatal to the whole build.
 */
export function parseConcept(path: string, raw: string): { concept: OkfConcept | null; errors: string[] } {
  const errors: string[] = [];
  const text = String(raw ?? "").replace(/^﻿/, "").replace(/\r\n/g, "\n");

  // Front matter is the FIRST line only. A "---" further down is a horizontal
  // rule in somebody's body text and must stay there.
  if (!text.startsWith("---\n")) {
    return { concept: null, errors: [`${path}: no front matter — an OKF concept opens with "---"`] };
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { concept: null, errors: [`${path}: front matter is never closed`] };

  const head = text.slice(4, end);
  const body = text.slice(end + 4).replace(/^\n+/, "").replace(/\s+$/, "");

  const fields: Record<string, string> = {};
  let tags: string[] | undefined;
  let blockKey: string | null = null;       // the key a "- item" list belongs to

  for (const line of head.split("\n")) {
    if (!line.trim()) continue;
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && blockKey === "tags") { (tags ??= []).push(unquote(item[1])); continue; }
    // Only split on the FIRST colon: "title: Fees: what they cover" is one value.
    const m = line.match(/^([A-Za-z_][\w.-]*)\s*:\s?(.*)$/);
    if (!m) continue;                        // not a field line; ignore rather than guess
    const [, key, rest] = m;
    blockKey = key;
    if (key === "tags") {
      tags = rest.trim().startsWith("[") ? parseInlineTags(rest) : (rest.trim() ? [unquote(rest)] : undefined);
      continue;
    }
    fields[key] = unquote(rest);
  }

  const type = (fields.type ?? "").trim();
  if (!type) errors.push(`${path}: missing the required "type" field`);
  if (errors.length) return { concept: null, errors };

  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!(RESERVED as readonly string[]).includes(k)) extra[k] = v;
  }

  const concept: OkfConcept = { path, type, body };
  if (fields.title) concept.title = fields.title;
  if (fields.description) concept.description = fields.description;
  if (fields.resource) concept.resource = fields.resource;
  if (tags?.length) concept.tags = tags;
  if (fields.timestamp) concept.timestamp = fields.timestamp;
  if (Object.keys(extra).length) concept.extra = extra;
  return { concept, errors: [] };
}

/** Write a concept back out. parseConcept(serialiseConcept(c)) === c. */
export function serialiseConcept(c: OkfConcept): string {
  const lines = ["---", `type: ${c.type}`];
  // Reserved fields in spec order, then the producer's own — so a diff of two
  // concepts lines up instead of reordering.
  if (c.title?.trim()) lines.push(`title: ${c.title.trim()}`);
  if (c.description?.trim()) lines.push(`description: ${c.description.trim()}`);
  if (c.resource?.trim()) lines.push(`resource: ${c.resource.trim()}`);
  if (c.tags?.length) lines.push(`tags: [${c.tags.join(", ")}]`);
  if (c.timestamp?.trim()) lines.push(`timestamp: ${c.timestamp.trim()}`);
  for (const [k, v] of Object.entries(c.extra ?? {})) lines.push(`${k}: ${v}`);
  lines.push("---", "", c.body.replace(/\s+$/, ""));
  return lines.join("\n");
}

// ── Addresses ────────────────────────────────────────────────────────────────

/**
 * A stable address for a concept, derived from its name.
 *
 * "&" becomes "and" rather than vanishing, so "Pricing & Payment" and "Pricing
 * and Payment" land on the same file instead of two near-identical ones.
 *
 * Path separators are flattened, so a title can never climb out of the bundle.
 *
 * Bounded length. Run over the real corpus, blog-article headings produced
 * ninety-character filenames ("4-what-is-the-difference-between-cognitive-
 * analytics-predictive-and-prescriptive-analytics"), which overflow tar's
 * 100-byte name field — and would be a poor address even if they fitted,
 * since the path is what a person types and an agent follows. Trimmed at a
 * word boundary so the result still reads as words rather than a cut-off
 * syllable.
 */
const MAX_SLUG = 60;

export function conceptSlug(name: string): string {
  const s = String(name ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!s) return "untitled";
  if (s.length <= MAX_SLUG) return s;
  const cut = s.slice(0, MAX_SLUG);
  const lastDash = cut.lastIndexOf("-");
  return (lastDash > MAX_SLUG / 2 ? cut.slice(0, lastDash) : cut).replace(/-+$/, "");
}

/** The links a body points at, excluding anything that leaves the bundle. */
export function conceptLinks(body: string): string[] {
  const out: string[] = [];
  for (const m of String(body ?? "").matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const href = m[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#") || href.startsWith("//")) continue;
    out.push(href);
  }
  return out;
}

/** Resolve a link found in `from` against the bundle root. */
function resolveLink(from: string, href: string): string {
  const base = from.split("/").slice(0, -1);
  const parts = href.split("/");
  const stack = href.startsWith("/") ? [] : [...base];
  for (const p of parts) {
    if (!p || p === ".") continue;
    if (p === "..") stack.pop();
    else stack.push(p);
  }
  return stack.join("/");
}

/**
 * Everything wrong with a bundle, as a list a build can print and fail on.
 *
 * Two concepts at one address, and links that point at nothing, are the two
 * faults that make a bundle unnavigable — and an agent following a dead link
 * does not error, it simply answers without the thing it went looking for.
 */
export function validateBundle(concepts: OkfConcept[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const c of concepts) {
    if (seen.has(c.path)) errors.push(`duplicate concept path: ${c.path}`);
    seen.add(c.path);
    if (!c.type?.trim()) errors.push(`${c.path}: missing the required "type" field`);
  }
  for (const c of concepts) {
    for (const href of conceptLinks(c.body)) {
      const target = resolveLink(c.path, href);
      if (!seen.has(target)) errors.push(`${c.path}: link to ${target} matches no concept`);
    }
  }
  return errors;
}

// ── index.md ─────────────────────────────────────────────────────────────────

/**
 * The entry point. An agent reads this, scopes to a topic, then opens only the
 * concepts it needs — which is the whole reason a 367k-token corpus can be
 * navigated without being loaded.
 *
 * Descriptions are included deliberately: an index of bare links tells the
 * agent nothing about what to open, so it opens everything and the saving is
 * lost.
 */
export function buildIndex(title: string, concepts: OkfConcept[]): string {
  const byType = new Map<string, OkfConcept[]>();
  for (const c of concepts) {
    const list = byType.get(c.type) ?? [];
    list.push(c);
    byType.set(c.type, list);
  }
  const out = [`# ${title}`, "", `${concepts.length} concepts.`, ""];
  for (const type of [...byType.keys()].sort()) {
    out.push(`## ${type}`, "");
    for (const c of byType.get(type)!.sort((a, b) => a.path.localeCompare(b.path))) {
      const label = c.title?.trim() || c.path;
      const desc = c.description?.trim();
      out.push(`- [${label}](${c.path})${desc ? ` — ${desc}` : ""}`);
    }
    out.push("");
  }
  return out.join("\n").replace(/\s+$/, "") + "\n";
}

/** The directory a concept lives in — its area. */
const areaOf = (path: string): string => path.includes("/") ? path.split("/").slice(0, -1).join("/") : "";

/**
 * A root index of AREAS, plus one index per area listing its own concepts.
 *
 * One flat index over the real corpus came to 130,000 characters — 33k tokens
 * spent before the agent has opened a single concept, which is more than most
 * answers cost and defeats the point of navigating rather than loading. The
 * spec allows an index.md per directory precisely so the entry point can stay
 * small; the root says what exists and how big it is, and the agent pays for
 * detail only in the one area it chooses.
 *
 * Area-index links are relative to the area, so an index is correct wherever
 * the bundle is mounted.
 */
export function buildIndexes(
  title: string,
  concepts: OkfConcept[],
): { root: string; areas: Record<string, string> } {
  const byArea = new Map<string, OkfConcept[]>();
  for (const c of concepts) {
    const a = areaOf(c.path);
    const list = byArea.get(a) ?? [];
    list.push(c);
    byArea.set(a, list);
  }

  const root = [`# ${title}`, "", `${concepts.length} concepts in ${byArea.size} areas. Open an area to see its concepts.`, ""];
  const areas: Record<string, string> = {};

  for (const area of [...byArea.keys()].sort()) {
    const list = byArea.get(area)!;
    const types = [...new Set(list.map(c => c.type))].sort().join(", ");
    root.push(`- [${area || "(root)"}](${area ? `${area}/index.md` : "index.md"}) — ${list.length} concepts · ${types}`);

    // Inside an area index, address concepts relative to the area itself.
    const rel = list.map(c => ({ ...c, path: area ? c.path.slice(area.length + 1) : c.path }));
    if (area) areas[`${area}/index.md`] = buildIndex(area, rel);
  }
  return { root: root.join("\n").replace(/\s+$/, "") + "\n", areas };
}

// ── Decomposition ────────────────────────────────────────────────────────────

/**
 * Split an existing KB document into concepts, one per heading.
 *
 * This is the whole migration in one function, and the quality of the bundle
 * is decided here. Headings are the only honest boundary available: they are
 * what the author already chose as "this is one topic", whereas the 1000-char
 * windows the vector index uses are an artifact of embedding size and cut
 * through the middle of answers.
 *
 * Text above the first heading is kept as its own concept rather than dropped —
 * it is usually the document's own introduction, and losing it silently is how
 * a migration quietly removes knowledge.
 */
/**
 * The largest a concept may be before it stops being one.
 *
 * Four of the ten live documents are PDFs whose heading markup did not survive
 * extraction, so splitting on headings gave each ONE concept — 174,437
 * characters in the worst case. That is the original blob with front matter on
 * top: an agent cannot navigate it and loading it costs more than the answer.
 */
const MAX_CONCEPT_CHARS = 8000;

/**
 * Break an over-long section on paragraph boundaries, never mid-sentence.
 *
 * A markdown table has no blank line inside it, so it arrives here as a single
 * paragraph and survives whole. That is load-bearing rather than lucky: half a
 * fee table is a column of figures with no item beside them, which is
 * exactly how a price gets quoted against the wrong product.
 */
function splitOversized(body: string): string[] {
  const paras = body.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const out: string[] = [];
  let buf = "";
  for (const p of paras) {
    if (buf && buf.length + p.length + 2 > MAX_CONCEPT_CHARS) { out.push(buf); buf = p; }
    else buf = buf ? `${buf}\n\n${p}` : p;
    // A single paragraph over the limit is rare and splitting it would cut a
    // sentence, so it is allowed through oversized and reported instead.
    while (buf.length > MAX_CONCEPT_CHARS && buf.includes("\n\n")) {
      const cut = buf.lastIndexOf("\n\n", MAX_CONCEPT_CHARS);
      if (cut <= 0) break;
      out.push(buf.slice(0, cut).trim());
      buf = buf.slice(cut).trim();
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.length ? out : [body];
}

export function decompose(
  doc: { title: string; tag?: string | null },
  text: string,
  opts: { type: string; area: string },
): OkfConcept[] {
  const clean = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!clean) return [];

  // Split on markdown headings, keeping the heading with the text beneath it.
  const sections: { heading: string | null; body: string }[] = [];
  let heading: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join("\n").trim();
    if (heading || body) sections.push({ heading, body });
    buf = [];
  };
  for (const line of clean.split("\n")) {
    const m = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (m) { flush(); heading = m[1].trim(); continue; }
    buf.push(line);
  }
  flush();

  const tags = doc.tag?.trim() ? [doc.tag.trim()] : undefined;
  const used = new Set<string>();
  const out: OkfConcept[] = [];

  const address = (name: string): string => {
    let slug = conceptSlug(name);
    // Two sections under one heading must not collide — the second would
    // otherwise overwrite the first and the loss would be silent.
    if (used.has(slug)) {
      let n = 2;
      while (used.has(`${slug}-${n}`)) n++;
      slug = `${slug}-${n}`;
    }
    used.add(slug);
    return `${opts.area}/${slug}.md`;
  };

  for (const s of sections) {
    if (!s.heading && !s.body) continue;
    const name = s.heading ?? doc.title;

    // Oversized, or never had a heading to split on in the first place. Both
    // are flagged: the split is a migration shortcut, not a structure somebody
    // chose, and whoever gives these real headings needs to find them again.
    const parts = s.body.length > MAX_CONCEPT_CHARS ? splitOversized(s.body) : [s.body];
    const shortcut = parts.length > 1;

    parts.forEach((body, i) => {
      const partName = shortcut ? `${name} (part ${i + 1} of ${parts.length})` : name;
      out.push({
        path: address(partName),
        type: opts.type,
        title: partName,
        ...(tags ? { tags } : {}),
        extra: {
          source: doc.title,
          ...(shortcut ? { needs_review: "split without headings" } : {}),
          // Prices, durations and rates lifted into typed fields. In prose
          // these are unverifiable; as fields an answer either agrees with
          // them or does not, which is what makes a wrong figure detectable
          // rather than merely unlikely.
          ...factsFor(body, { subject: partName }),
          ...(parseTables(body).length ? { tables: String(parseTables(body).length) } : {}),
        },
        body,
      });
    });
  }
  return out;
}

// ── What a human still has to fix ────────────────────────────────────────────

export interface OkfReport {
  total: number;
  /** Too big to be one concept — usually an unsplittable wall of text. */
  oversized: string[];
  /** Too small to answer anything — extraction debris, headers, page numbers. */
  tiny: string[];
  /** Split mechanically because the source had no headings. */
  needsReview: string[];
}

/**
 * The state of a bundle, as a build can print it.
 *
 * Separate from validateBundle: those are errors that make a bundle
 * unnavigable, these are quality problems that make it unhelpful. A migration
 * is finished when this report is boring, and reporting it is what stops
 * "1,477 concepts" being mistaken for success.
 */
export function bundleReport(concepts: OkfConcept[]): OkfReport {
  const TINY = 80;
  return {
    total: concepts.length,
    oversized: concepts.filter(c => conceptToText(c).length > MAX_CONCEPT_CHARS).map(c => c.path),
    tiny: concepts.filter(c => conceptToText(c).trim().length < TINY).map(c => c.path),
    needsReview: concepts.filter(c => c.extra?.needs_review).map(c => c.path),
  };
}

// ── Feeding the derived index ────────────────────────────────────────────────

/**
 * Render a concept as the plain text the existing ingest path embeds.
 *
 * The title and description are folded into the text on purpose. Retrieval
 * today ranks against a "[Document › Section]" header on every chunk, and that
 * header is a real part of why a fees answer is not applied to the wrong
 * course — dropping it while also changing the chunk boundaries would move two
 * variables at once and make a bad eval impossible to attribute.
 */
export function conceptToText(c: OkfConcept): string {
  const head = [c.title?.trim(), c.description?.trim()].filter(Boolean).join(" — ");
  return [head ? `[${head}]` : "", c.body.trim()].filter(Boolean).join("\n\n");
}
