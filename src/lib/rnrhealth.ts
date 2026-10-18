import { DEFAULT_TENANT_ID } from "./tenant";
// Is the stage drip actually going to work?
//
// ── Why this is a health check and not a page ──────────────────────────────
//
// Every link in this chain has broken at least once, each in a way that
// looked like nothing at all:
//
//   · the stage_drips row was written with the wrong key, so the map parsed
//     to empty and the poll reported "no rule matches this stage"
//   · the poll sat in observe mode for days while everyone believed it was
//     live, because nothing said which it was
//   · the drip log field was never configured, so four weeks of conversation
//     went nowhere and the field read empty
//   · a template can be paused by Meta overnight and the step just skips
//
// None of those raises an error. A drip that is not running produces exactly
// the same silence as a drip with nobody on it, which is why this has to be
// asserted rather than assumed — and asserted where somebody already looks,
// next to the cron and webhook checks, with the same alerting behind it.
//
// Every check answers one question: if a counsellor moved a lead to the
// hand-off stage right now, what would stop it reaching them?

import { getStagePoll } from "./stagepoll";
import { getStageDrips } from "./stagedrips";
import { listSequences, getSequenceSteps } from "./sequences";
import { credsFor, getChannel } from "./channels";
import { fetchTemplates } from "./whatsapp";
import { DRIP_LOG_FIELD } from "./driplog";
import { rnrSteps } from "./rnrseed";
import { audienceFingerprint } from "./seqaudience";

export interface DripCheck {
  key: string;
  label: string;
  ok: boolean;
  warn?: boolean;
  detail: string;
}

const LABEL = "Stage drip";

/**
 * The whole chain, in the order a lead travels it.
 *
 * Never throws: a health page that dies tells you less than one reporting a
 * check it could not run.
 */
export async function checkStageDrip(tenantId = DEFAULT_TENANT_ID): Promise<DripCheck[]> {
  const out: DripCheck[] = [];
  try {
    const poll = await getStagePoll(tenantId);

    // 1. The trigger. Off and observe are DIFFERENT states and both look
    //    identical from the outside — which is how a week went by.
    if (!poll.enabled) {
      out.push({
        key: "rnr-poll", label: LABEL, ok: true, warn: true,
        detail: "Stage poll is OFF — no lead will ever be enrolled. Turn it on in Sequences → Stage poll.",
      });
    } else if (!poll.stage.trim()) {
      out.push({
        key: "rnr-poll", label: LABEL, ok: false,
        detail: "Stage poll is on but watches NO stage, so it does nothing. Set the hand-off stage in Sequences → Stage poll.",
      });
    } else if (poll.mode !== "apply") {
      out.push({
        key: "rnr-poll", label: LABEL, ok: true, warn: true,
        detail: `Watching "${poll.stage}" but NOT enrolling — observe mode. ${poll.lastCandidates ?? 0} candidate(s) seen on the last pass. Press Go live when the list looks right.`,
      });
    } else {
      out.push({
        key: "rnr-poll", label: LABEL, ok: true,
        detail: `Live on "${poll.stage}" · ${poll.lastApplied ?? 0} enrolled on the last pass, up to ${poll.maxPerRun} per pass.`,
      });
    }

    // A pass that errored is worse than one that found nobody.
    if (poll.lastError) {
      out.push({ key: "rnr-poll-error", label: LABEL, ok: false, detail: `Last pass failed: ${poll.lastError}` });
    }

    // Stale: enabled, but the cron has not run it. The drip cannot start and
    // nothing else would say so.
    const lastRun = poll.lastRunAt ? Date.parse(poll.lastRunAt) : 0;
    if (poll.enabled && lastRun && Date.now() - lastRun > 30 * 60_000) {
      out.push({
        key: "rnr-poll-stale", label: LABEL, ok: false,
        detail: `Stage poll has not run since ${new Date(lastRun).toLocaleString()} — the cron may be down.`,
      });
    }

    // 2. The map. A rule stored in the wrong shape parses to nothing, and the
    //    poll then reports "no rule matches this stage" as if that were a
    //    fact about the lead.
    const drips = await getStageDrips(tenantId);
    const rule = poll.stage.trim()
      ? drips.find(d => d.stage.trim().toLowerCase() === poll.stage.trim().toLowerCase())
      : undefined;
    if (poll.stage.trim() && !rule) {
      out.push({
        key: "rnr-map", label: LABEL, ok: false,
        detail: `No sequence is mapped to "${poll.stage}" — leads would be picked up and then nothing would start. Add the rule in Sequences → Auto-drip by LeadSquared stage.`,
      });
      return out;   // nothing below can be checked without a sequence
    }
    if (!rule) return out;

    // 3. The sequence itself.
    const seqs = await listSequences(tenantId).catch(() => []);
    const seq = seqs.find(s => s.id === rule.sequenceId);
    if (!seq) {
      out.push({ key: "rnr-seq", label: LABEL, ok: false, detail: `"${poll.stage}" maps to a sequence that no longer exists. Re-pick it in Sequences → Auto-drip by LeadSquared stage.` });
      return out;
    }
    if (!seq.active) {
      out.push({ key: "rnr-seq", label: LABEL, ok: false, detail: `"${seq.name}" is INACTIVE — enrolled leads would never be sent anything.` });
    }

    const steps = await getSequenceSteps(seq.id, tenantId).catch(() => []);
    if (!steps.length) {
      out.push({ key: "rnr-steps", label: LABEL, ok: false, detail: `"${seq.name}" has no steps — a lead would be enrolled into an empty journey.` });
      return out;
    }

    // 4. The audience rules, against the programme table they came from.
    //
    //    The course lists inside wa_sequence_steps are a FROZEN COPY, taken
    //    from PROGRAMMES at the moment the sequence was seeded. Adding a
    //    course to that table regenerates the constants in code and changes
    //    NOTHING about the live drip until the sequence is re-seeded.
    //
    //    So the fix looks applied — the table has the course, the tests pass,
    //    the audience lists in code are right — and the step still reaches
    //    nobody, for exactly as long as it takes somebody to notice. Of all
    //    the silent links in this chain this is the one most likely to be
    //    pulled next, because 17 courses are waiting to be added to it.
    const expected = new Map(
      rnrSteps({ channelId: seq.channelId ?? "" }).map(t => [t.templateName, t.audience] as const),
    );
    const drifted = steps.flatMap(st => {
      const tpl = (st.action as { templateName?: string })?.templateName;
      if (!tpl) return [];
      const want = expected.get(tpl);
      // A step the seeder does not own — hand-added, or a library change —
      // is not drift, and calling it drift would cry wolf forever.
      if (want === undefined) return [];
      return audienceFingerprint(want) === audienceFingerprint(st.audience) ? [] : [tpl];
    });
    if (drifted.length) {
      out.push({
        key: "rnr-audience", label: LABEL, ok: false,
        detail: `${drifted.join(", ")} ${drifted.length === 1 ? "is" : "are"} running an OLD audience rule — the course list changed in code but the sequence was never rebuilt. Re-seed it in Sequences → Build the RNR drip.`,
      });
    }

    // 5. The templates, on the number that will actually send them.
    //
    //    Templates are WABA-SCOPED: an approved template on one business
    //    account does not exist on another, and the send fails at the moment
    //    it is tried rather than when the sequence is built.
    const channel = seq.channelId ? await getChannel(seq.channelId, tenantId).catch(() => null) : null;
    const creds = await credsFor(seq.channelId, tenantId).catch(() => undefined);
    if (!creds) {
      out.push({ key: "rnr-number", label: LABEL, ok: false, detail: `"${seq.name}" has no usable WhatsApp number — nothing can be sent.` });
      return out;
    }

    const wanted = steps
      .map(s => (s.action as { type?: string; templateName?: string })?.templateName)
      .filter((n): n is string => !!n);
    if (wanted.length) {
      try {
        const live = await fetchTemplates(creds);
        const byName = new Map(live.map(t => [t.name, t.status]));
        const bad = wanted
          .map(n => ({ n, status: byName.get(n) }))
          .filter(x => x.status !== "APPROVED");
        out.push(bad.length
          ? {
              key: "rnr-templates", label: LABEL, ok: false,
              detail: `On ${channel?.name ?? "the sending number"}: ${bad.map(b => `${b.n} is ${b.status ?? "MISSING"}`).join(", ")}. Those steps will be skipped.`,
            }
          : {
              key: "rnr-templates", label: LABEL, ok: true,
              detail: `${wanted.length}/${wanted.length} templates approved on ${channel?.name ?? "the sending number"}.`,
            });
      } catch (e) {
        out.push({ key: "rnr-templates", label: LABEL, ok: true, warn: true, detail: `Could not read templates from Meta: ${e instanceof Error ? e.message : String(e)}` });
      }
    }

    // 6. The drip log. Configured in an env var, so it ships inert — which
    //    means "working" and "writing to nothing" look the same.
    if (!DRIP_LOG_FIELD()) {
      out.push({
        key: "rnr-driplog", label: LABEL, ok: true, warn: true,
        detail: "Drip conversations are NOT reaching LeadSquared — LSQ_RNR_RESPONSE_FIELD is unset. The portal keeps its own copy either way.",
      });
    }
  } catch (e) {
    out.push({ key: "rnr-check", label: LABEL, ok: true, warn: true, detail: `Could not check the stage drip: ${e instanceof Error ? e.message : String(e)}` });
  }
  return out;
}
