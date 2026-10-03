// The nightly content pipeline: research → select → write → review → PR.
//
//   node --experimental-strip-types scripts/content-pipeline/run.ts
//
// It opens a pull request. It does NOT publish. That is the one deliberate
// departure from the automation this was modelled on, and it is not timidity:
// Google's scaled content abuse policy is aimed precisely at sites that
// generate pages on a schedule without human judgement in the loop, and
// thetalko.in is four months old with almost no backlinks — the profile with
// the least margin for a manual action. A PR costs a two-minute review and
// removes the entire category of risk.
//
// Everything before the PR is fully automatic, which is where the leverage was.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { findGaps, type Gap } from "../../src/lib/contentgaps.ts";
import { crawlAll, crawlOurs } from "./crawl.ts";
import { checkDraft, type Draft, type Issue } from "./review.ts";
import { draftPost, reviseDraft, factCheck } from "./write.ts";

const SITE_CONTENT = "src/app/(site)/_content/site.ts";
const MAX_REVISIONS = 2;
/** Terms that mark a topic as something we can write from real experience. */
const RELEVANCE = [
  "whatsapp", "instagram", "messenger", "facebook", "youtube", "chatbot", "broadcast",
  "template", "automation", "inbox", "api", "message", "dm", "comment", "review",
  "catalog", "opt", "webhook", "crm", "lead", "conversation", "reply", "meta",
];

const sh = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: "utf8" }).trim();

/** Three recent posts, as the voice sample the writer imitates. */
async function voiceSamples(): Promise<string> {
  const src = await readFile(SITE_CONTENT, "utf8");
  const paras = [...src.matchAll(/^\s*p\("((?:[^"\\]|\\.){240,})"\),$/gm)].map(m => m[1]);
  return paras.slice(0, 6).map(s => `- ${s.replace(/\\"/g, '"')}`).join("\n");
}

async function existingSlugs(): Promise<string[]> {
  const src = await readFile(SITE_CONTENT, "utf8");
  return [...src.matchAll(/^\s*slug: "([a-z0-9-]+)",$/gm)].map(m => m[1]);
}

/** Render a Draft as the PostBlock literal site.ts expects. */
function toPostLiteral(d: Draft): string {
  const q = (s: string) => JSON.stringify(s);
  const blocks = d.body.map(b => {
    if (b.type === "h2") return `      h2(${q(b.text ?? "")}),`;
    if (b.type === "h3") return `      { type: "h3", text: ${q(b.text ?? "")} },`;
    if (b.type === "list") return `      list([${(b.items ?? []).map(q).join(", ")}]),`;
    if (b.type === "callout") {
      const c = b as unknown as { tone: string; title: string; text: string };
      return `      { type: "callout", tone: ${q(c.tone)}, title: ${q(c.title)}, text: ${q(c.text)} },`;
    }
    return `      p(${q(b.text ?? "")}),`;
  }).join("\n");
  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return `  {
    slug: ${q(d.slug)},
    title: ${q(d.title)},
    excerpt: ${q(d.excerpt)},
    date: ${q(date)}, category: ${q(d.category)}, readTime: ${q(d.readTime)},
    body: [
${blocks}
    ],
    faqs: [
${(d.faqs ?? []).map(f => `      { q: ${q(f.q)}, a: ${q(f.a)} },`).join("\n")}
    ],
    sources: [
${(d.sources ?? []).map(s => `      { label: ${q(s.label)}, href: ${q(s.href)}${s.note ? `, note: ${q(s.note)}` : ""} },`).join("\n")}
    ],
  },
`;
}

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry-run");
  await mkdir("tmp/content-pipeline", { recursive: true });

  // ── 1. Research
  const [competitors, ours] = await Promise.all([crawlAll(), crawlOurs()]);
  const gaps = findGaps(competitors, ours, { minCompetitors: 2, relevanceTerms: RELEVANCE });
  await writeFile("tmp/content-pipeline/gaps.json", JSON.stringify(gaps.slice(0, 40), null, 2));
  console.log(`[gaps] ${gaps.length} topics competitors cover and we do not`);
  if (!gaps.length) { console.log("[done] no gaps found — nothing to write."); return; }

  // ── 2. Select
  const chosen: Gap = gaps[0];
  console.log(`[pick] ${chosen.label}  (${chosen.covered.length} competitors, score ${chosen.score})`);
  if (dry) {
    console.log(gaps.slice(0, 12).map(g =>
      `  ${String(g.score).padStart(6)}  ${g.covered.length}x  ${g.label}` +
      (g.penalties.length ? `\n          ↳ ${g.penalties.map(x => x.reason).join("; ")}` : "")
    ).join("\n"));
    return;
  }

  // ── 3/4. Write, then review until it passes or we run out of patience.
  const slugs = await existingSlugs();
  let draft = await draftPost(chosen, await voiceSamples());
  let issues: Issue[] = [];
  for (let round = 0; round <= MAX_REVISIONS; round++) {
    issues = [...checkDraft(draft, slugs), ...(round === 0 ? [] : [])];
    if (round === 0) issues.push(...await factCheck(draft));
    console.log(`[review] round ${round + 1}: ${issues.length ? issues.map(i => i.rule).join(", ") : "clean"}`);
    if (!issues.length) break;
    if (round === MAX_REVISIONS) {
      console.log("[review] still failing after revisions — opening the PR as a draft with the findings.");
      break;
    }
    draft = await reviseDraft(draft, issues);
  }

  // ── 5. Insert and open a PR.
  const src = await readFile(SITE_CONTENT, "utf8");
  const anchor = "export const POSTS: Post[] = [\n";
  await writeFile(SITE_CONTENT, src.replace(anchor, anchor + toPostLiteral(draft)));

  const branch = `content/${draft.slug}`;
  sh("git", ["checkout", "-b", branch]);
  sh("git", ["add", SITE_CONTENT]);
  sh("git", ["commit", "-m", `content(blog): ${draft.title}\n\nDrafted by the nightly content pipeline. Review before merging.`]);
  sh("git", ["push", "-u", "origin", branch]);

  const body = `## ${draft.title}

Drafted by the nightly content pipeline. **Not published** — merging publishes it.

### Why this topic
Competitors already covering it: **${chosen.covered.join(", ")}** (${chosen.covered.length} of ${competitors.length}).
${chosen.examples.map(u => `- ${u}`).join("\n")}

> Competitor consensus is a *proxy* for demand, not a volume figure. Nothing here
> has search-volume data behind it — that needs a paid keyword API. Treat the
> ranking as "several competitors thought this was worth writing", no more.
${chosen.penalties.length
  ? `\nThis topic was still marked down for: ${chosen.penalties.map(x => x.reason).join("; ")}. It won anyway, which means everything else scored worse — worth a harder look before merging.`
  : ""}
### Runners-up
${gaps.slice(1, 5).map(g => `- \`${g.score}\` ${g.label}${g.penalties.length ? ` — _${g.penalties.map(x => x.reason).join("; ")}_` : ""}`).join("\n")}

### Review status
${issues.length
  ? `⚠️ **${issues.length} unresolved after ${MAX_REVISIONS} revisions** — read these before merging:\n${issues.map(i => `- **${i.rule}** — ${i.detail}`).join("\n")}`
  : "✅ Passed every automated check. Still read it: the checks test structure and citation, not whether the argument is any good."}

### Before you merge
- [ ] Every figure is correct and sourced
- [ ] It says something the competitor posts above do not
- [ ] It sounds like us`;

  await writeFile("tmp/content-pipeline/pr-body.md", body);
  const url = sh("gh", ["pr", "create", "--title", `content(blog): ${draft.title}`, "--body-file", "tmp/content-pipeline/pr-body.md", "--base", "main", "--head", branch, ...(issues.length ? ["--draft"] : [])]);
  console.log(`[pr] ${url}`);
}

main().catch(err => { console.error("[pipeline] failed:", err?.message ?? err); process.exit(1); });
