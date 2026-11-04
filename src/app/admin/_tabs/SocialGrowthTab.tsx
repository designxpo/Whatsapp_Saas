"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  RefreshCw,
  ArrowRight,
  CheckCircle2,
  Clock3,
} from "lucide-react";
import { useVocab } from "@/lib/vocab-client";
import {
  CREATOR_PLAYBOOKS,
  campaignPostIds,
  minorUnitScale,
  type SocialCampaign,
  type SocialJourney,
  type SocialCommitment,
  type SocialOutcome,
  type SocialLink,
  type SocialVariant,
} from "@/lib/social-growth-policy";
import { SocialPostPicker } from "../_components/SocialPostPicker";
import { inp } from "../_shared";
import { Drawer } from "@/components/overlay";

type Report = {
  campaignId: string;
  variants: {
    variant: string;
    name: string;
    participants: number;
    converted: number;
    rate: number;
    revenue: Record<string, number>;
    manual: number;
    note: string;
  }[];
};
type Demand = {
  key: string;
  question: string;
  count: number;
  platforms: string[];
};
type Data = {
  campaigns: SocialCampaign[];
  journeys: SocialJourney[];
  outcomes: SocialOutcome[];
  commitments: SocialCommitment[];
  links: SocialLink[];
  reports: Report[];
  demand: { groups: Demand[]; setupNeeded?: string };
  channels: { id: string; name: string; kind: string; kb_tag?: string }[];
  team: { email: string; name: string }[];
  setupNeeded?: string;
  bounded: boolean;
};
const button =
  "rounded-control border border-line bg-white px-3 py-2 text-xs font-semibold text-ink-700 disabled:opacity-50";
const card = "rounded-card border border-line bg-white p-4 space-y-3";
const money = (cents: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
    cents / 100,
  );
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "Choose a due date";
const blank = (channel = ""): Partial<SocialCampaign> => ({
  name: "",
  audience: "business",
  channel_id: channel,
  post_id: null,
  post_ids: [],
  keyword: "",
  facts: "",
  questions: [],
  goal: "lead",
  status: "draft",
  expires_at: null,
  variants: [],
});

export default function SocialGrowthTab() {
  const { industry } = useVocab();
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [section, setSection] = useState("campaigns"),
    [form, setForm] = useState<Partial<SocialCampaign> | null>(null);
  const [answer, setAnswer] = useState<{
    gap: Demand;
    text: string;
    tag: string;
  } | null>(null);
  const [selectedJourney, setSelectedJourney] = useState<SocialJourney | null>(
    null,
  );
  const [outcome, setOutcome] = useState({
    kind: "lead",
    amount: "0",
    currency: "INR",
    reference: "",
  });
  const [promise, setPromise] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [cost, setCost] = useState(999),
    [margin, setMargin] = useState(500),
    [enquiries, setEnquiries] = useState(100),
    [conversion, setConversion] = useState(3);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/social-growth");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not load Social Growth");
      setData(d);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setNotice("");
    try {
      const r = await fetch("/api/admin/social-growth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not save");
      await load();
      setNotice("Saved");
      return d;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not save");
      return null;
    } finally {
      setBusy(false);
    }
  }
  const newCampaign = (preset?: (typeof CREATOR_PLAYBOOKS)[number]) => {
    setForm({
      ...blank(data?.channels[0]?.id),
      audience: preset || industry === "creator" ? "creator" : "business",
      ...(preset
        ? {
            name: preset.name,
            keyword: preset.keyword,
            questions: preset.questions,
            goal: preset.goal,
          }
        : {}),
    });
    setNotice("");
  };
  const campaignName = (id: string) =>
    data?.campaigns.find((c) => c.id === id)?.name || "Campaign";
  const overdue =
    data?.commitments.filter(
      (c) =>
        c.status === "open" && c.due_at && Date.parse(c.due_at) < Date.now(),
    ).length ?? 0;
  const creator = data?.campaigns.filter((c) => c.audience === "creator") ?? [];
  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-ink-900">
            Social Growth & Creator Studio
          </h2>
          <p className="mt-1 text-sm text-ink-500">
            Turn audience questions into offers, fulfilled promises and measured
            outcomes.
          </p>
        </div>
        <button className={button} onClick={() => void load()}>
          <RefreshCw className="mr-1 inline h-3.5 w-3.5" />
          Refresh
        </button>
      </div>
      <div className="rounded-card border border-brand-100 bg-brand-50 p-4 text-sm text-brand-900">
        Content <ArrowRight className="inline h-3 w-3" /> enquiry{" "}
        <ArrowRight className="inline h-3 w-3" /> relevant offer{" "}
        <ArrowRight className="inline h-3 w-3" /> outcome{" "}
        <ArrowRight className="inline h-3 w-3" /> better content
      </div>
      <nav aria-label="Social Growth sections" className="flex flex-wrap gap-2">
        {[
          ["campaigns", "Campaigns"],
          [
            "commitments",
            `Commitments${overdue ? ` · ${overdue} overdue` : ""}`,
          ],
          ["demand", "Audience demand"],
          ["experiments", "Experiments"],
          ["journeys", "Journeys"],
          ["creators", "Creator opportunities"],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSection(key)}
            className={`${button} ${section === key ? "!bg-ink-900 !text-white" : ""}`}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-control border border-line p-3 text-sm"
        >
          {notice}
        </p>
      )}
      {!data && !error && (
        <p className="animate-pulse text-sm text-ink-500">
          Loading campaigns and outcomes…
        </p>
      )}
      {data?.setupNeeded && (
        <p className={card}>
          Social Growth needs a workspace upgrade before campaigns can be
          created. Your existing automations continue to work.
        </p>
      )}
      {data?.bounded && (
        <p className="text-sm text-amber-700">
          This view is limited to the latest campaigns and records. Totals may
          be incomplete; do not use them to declare an experiment winner.
        </p>
      )}
      {data && !data.setupNeeded && (
        <>
          {section === "campaigns" && (
            <>
              <div className="flex justify-between items-center">
                <p className="text-sm text-ink-500">
                  Approved facts and qualification questions for a specific
                  account, post or keyword.
                </p>
                <button className={button} onClick={() => newCampaign()}>
                  <Plus className="inline h-4 w-4" /> New campaign
                </button>
              </div>
              {!data.campaigns.length && (
                <p className={card}>
                  Create a campaign to connect a social post or incoming keyword
                  to an offer. Start as a draft, add verified details, then
                  activate it.
                </p>
              )}
              {data.campaigns.map((c) => (
                <div className={card} key={c.id}>
                  <div className="flex justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{c.name}</h3>
                      <p className="text-xs text-ink-500">
                        {c.status} · {c.audience} ·{" "}
                        {
                          data.channels.find((ch) => ch.id === c.channel_id)
                            ?.name
                        }{" "}
                        · goal: {c.goal}
                        {c.variants.length ? " · experiment" : ""}
                      </p>
                    </div>
                    <button
                      className={button}
                      onClick={() => {
                        setForm(c);
                        setNotice("");
                      }}
                    >
                      Edit
                    </button>
                  </div>
                  <p className="text-xs text-ink-500">
                    {campaignPostIds(c).length
                      ? `${campaignPostIds(c).length} selected post${campaignPostIds(c).length === 1 ? "" : "s"}`
                      : "Keyword across account"}
                    {c.keyword ? ` · keyword “${c.keyword}”` : ""}
                    {c.expires_at ? ` · ends ${date(c.expires_at)}` : ""}
                  </p>
                  <p className="text-sm whitespace-pre-wrap line-clamp-3">
                    {c.facts || "Add approved offer facts before activating."}
                  </p>
                </div>
              ))}
            </>
          )}
          {section === "commitments" && (
            <>
              <p className="text-sm text-ink-500">
                Explicit promises in sent replies become suggestions. Review the
                evidence, choose an owner and set a due date. Overdue items
                alert your team here; no customer reminder is sent
                automatically.
              </p>
              {!data.commitments.length && (
                <p className={card}>
                  No commitments yet. With an active campaign, a reply such as
                  “I will send your quotation tomorrow” appears here for review.
                </p>
              )}
              {data.commitments.map((c) => (
                <CommitmentCard
                  key={c.id}
                  item={c}
                  team={data.team}
                  busy={busy}
                  save={(body) =>
                    act({ action: "commitment", id: c.id, ...body })
                  }
                />
              ))}
            </>
          )}
          {section === "demand" && (
            <>
              <p className="text-sm text-ink-500">
                Questions the AI could not answer in the last 30 days. Counts
                are question occurrences, not unique people or confirmed
                purchase intent.
              </p>
              {data.demand.setupNeeded && (
                <p className={card}>
                  Audience demand needs the knowledge-gap workspace upgrade.
                </p>
              )}
              {!data.demand.groups.length && (
                <p className={card}>
                  No unanswered questions recorded. This list fills from real
                  conversations, not generated market demand.
                </p>
              )}
              {data.demand.groups.map((g) => (
                <div className={card} key={g.key}>
                  <h3 className="font-semibold">{g.question}</h3>
                  <p className="text-xs text-ink-500">
                    {g.count} occurrences · {g.platforms.join(", ")}
                  </p>
                  <div className="flex gap-2">
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() => setAnswer({ gap: g, text: "", tag: "" })}
                    >
                      Approve an answer
                    </button>
                    <button
                      className={button}
                      onClick={() => {
                        newCampaign();
                        setForm({
                          ...blank(data.channels[0]?.id),
                          name: `Audience demand: ${g.question}`.slice(0, 100),
                          questions: [g.question],
                          audience:
                            industry === "creator" ? "creator" : "business",
                        });
                      }}
                    >
                      Create campaign brief
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
          {section === "experiments" && (
            <>
              <p className="text-sm text-ink-500">
                Instagram campaigns can compare two delivery options. Assignment
                is stable per participant; linked WhatsApp conversations do not
                count as new participants. Existing comment rules supply the
                resource and still enforce send limits.
              </p>
              {!data.reports.length && (
                <p className={card}>
                  Create a campaign and enable an experiment to start measuring
                  qualified leads, bookings or purchases.
                </p>
              )}
              {data.reports.map((report) => (
                <div className={card} key={report.campaignId}>
                  <h3 className="font-semibold">
                    {campaignName(report.campaignId)}
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr>
                          {[
                            "Variant",
                            "Enquiries",
                            "Goal reached",
                            "Conversion",
                            "Gross purchases",
                            "Evidence",
                          ].map((x) => (
                            <th key={x} className="p-2">
                              {x}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {report.variants.map((v) => (
                          <tr key={v.variant} className="border-t border-line">
                            <td className="p-2">{v.name}</td>
                            <td className="p-2">{v.participants}</td>
                            <td className="p-2">{v.converted}</td>
                            <td className="p-2">
                              {(v.rate * 100).toFixed(1)}%
                            </td>
                            <td className="p-2">
                              {Object.entries(v.revenue)
                                .map(([currency, amount]) =>
                                  money(amount, currency),
                                )
                                .join(" + ") || "—"}
                            </td>
                            <td className="p-2">{v.manual} manual records</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-ink-500">
                    {report.variants[0]?.note} Purchases use the latest tracked
                    enquiry within 30 days. Different currencies are kept
                    separate. Later refunds are not subtracted.
                  </p>
                </div>
              ))}
            </>
          )}
          {section === "journeys" && (
            <>
              <p className="text-sm text-ink-500">
                Track qualification and outcomes. A cross-channel link appears
                only after the customer starts WhatsApp using their personal
                handoff code.
              </p>
              {!data.journeys.length && (
                <p className={card}>
                  No campaign enquiries yet. Activate a campaign and receive a
                  matching comment or DM to create a journey.
                </p>
              )}
              {data.journeys.map((j) => (
                <div className={card} key={j.id}>
                  <div className="flex justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">
                        {campaignName(j.campaign_id)}
                      </h3>
                      <p className="text-xs text-ink-500">
                        {j.platform} · {j.contact_key} · {date(j.enrolled_at)}
                        {j.root_journey_id
                          ? " · continued from a linked channel"
                          : ""}
                      </p>
                    </div>
                    <button
                      className={button}
                      onClick={() => {
                        setSelectedJourney(j);
                        setPromise("");
                        setAnswers(j.answers ?? {});
                        setOutcome({
                          kind:
                            data.campaigns.find((c) => c.id === j.campaign_id)
                              ?.goal ?? "lead",
                          amount: "0",
                          currency: "INR",
                          reference: "",
                        });
                      }}
                    >
                      Review enquiry
                    </button>
                  </div>
                  {j.context?.length > 0 && (
                    <details>
                      <summary className="text-xs cursor-pointer">
                        Previous customer questions
                      </summary>
                      {j.context.map((line, i) => (
                        <p key={i} className="mt-2 text-sm whitespace-pre-wrap">
                          {line}
                        </p>
                      ))}
                    </details>
                  )}
                </div>
              ))}
              {data.links.map((l) => (
                <p key={l.handoff_id} className="text-xs text-ink-500">
                  Verified handoff: {l.source_conversation_id} →{" "}
                  {l.target_conversation_id} · {date(l.created_at)}
                </p>
              ))}
            </>
          )}
          {section === "creators" && (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                {CREATOR_PLAYBOOKS.map((p) => (
                  <div key={p.id} className={card}>
                    <h3 className="font-semibold">{p.name}</h3>
                    <p className="text-sm text-ink-500">{p.why}</p>
                    <button className={button} onClick={() => newCampaign(p)}>
                      Use this playbook
                    </button>
                  </div>
                ))}
              </div>
              <div className={card}>
                <h3 className="font-semibold">Your creator loop</h3>
                <p className="text-sm text-ink-500">
                  {creator.length} creator campaigns ·{" "}
                  {data.demand.groups.length} open question groups. Use repeated
                  questions to test a workshop, guide or service; use recorded
                  outcomes to decide what to create next.
                </p>
                <p className="text-xs">
                  Start with one approved offer and a real outcome. Partnerships
                  and affiliate offers need creator-supplied terms and
                  disclosures. No guaranteed sales or auto-generated brand
                  claims.
                </p>
              </div>
              <div className={card}>
                <h3 className="font-semibold">Would this pay for itself?</h3>
                <p className="text-xs text-ink-500">
                  A planning scenario using your assumptions, not a revenue
                  forecast. Enter all amounts in the same currency.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    ["Monthly tool cost", cost, setCost],
                    ["Contribution per sale after costs", margin, setMargin],
                    ["Monthly qualified enquiries", enquiries, setEnquiries],
                    ["Assumed conversion rate (%)", conversion, setConversion],
                  ].map(([label, value, set]) => (
                    <label key={String(label)} className="text-xs space-y-1">
                      <span>{String(label)}</span>
                      <input
                        className={`${inp} w-full`}
                        type="number"
                        min="0"
                        max={
                          label === "Assumed conversion rate (%)"
                            ? 100
                            : undefined
                        }
                        value={Number(value)}
                        onChange={(e) =>
                          (set as (n: number) => void)(
                            Math.max(0, Number(e.target.value)),
                          )
                        }
                      />
                    </label>
                  ))}
                </div>
                <p className="text-sm">
                  Break-even:{" "}
                  {margin > 0
                    ? `${Math.ceil(cost / margin)} additional sales per month`
                    : "enter a positive contribution per sale"}
                  . Scenario contribution after tool cost:{" "}
                  {(
                    ((enquiries * Math.min(100, conversion)) / 100) * margin -
                    cost
                  ).toFixed(2)}
                  .
                </p>
              </div>
              <div className={card}>
                <h3 className="font-semibold">What to prepare for next</h3>
                <p className="text-sm">
                  Our hypothesis: creators will increasingly buy tools that
                  preserve audience relationships and show income outcomes,
                  while retaining control over their voice. Test this with
                  paying pilot customers; do not treat it as a proven forecast.
                </p>
                <p className="text-xs text-ink-500">
                  Research:{" "}
                  <a
                    className="underline"
                    href="https://www.stateofcreate.co/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Patreon State of Create
                  </a>{" "}
                  ·{" "}
                  <a
                    className="underline"
                    href="https://www.creatoriq.com/press/releases/creatoriq-state-of-creators-report-2026"
                    target="_blank"
                    rel="noreferrer"
                  >
                    CreatorIQ 2026 survey
                  </a>
                  . These are vendor-sponsored surveys, not proof of demand for
                  Talko.
                </p>
              </div>
            </>
          )}
        </>
      )}
      <Drawer
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? "Edit social campaign" : "New social campaign"}
        width="lg"
      >
        {form && (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act({ action: "campaign", ...form })) setForm(null);
            }}
          >
            <label className="block text-xs space-y-1">
              Campaign name
              <input
                required
                className={`${inp} w-full`}
                value={form.name ?? ""}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs space-y-1">
                Audience
                <select
                  className={`${inp} w-full`}
                  value={form.audience}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      audience: e.target.value as "creator" | "business",
                    })
                  }
                >
                  <option value="business">Business customers</option>
                  <option value="creator">Creator audience</option>
                </select>
              </label>
              <label className="text-xs space-y-1">
                Connected account
                <select
                  required
                  className={`${inp} w-full`}
                  value={form.channel_id ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      channel_id: e.target.value,
                      post_id: null,
                      post_ids: [],
                      variants: [],
                    })
                  }
                >
                  <option value="">Select account</option>
                  {data?.channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ·{" "}
                      {c.kind === "instagram" ? "Instagram" : "Facebook"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <SocialPostPicker
              key={form.channel_id || "no-account"}
              channelId={form.channel_id || ""}
              value={campaignPostIds(form)}
              disabled={busy}
              onChange={(ids) =>
                setForm({ ...form, post_ids: ids, post_id: ids[0] ?? null })
              }
            />
            <label className="block text-xs space-y-1">
              Distinctive keyword (optional when posts are selected)
              <input
                className={`${inp} w-full`}
                value={form.keyword ?? ""}
                onChange={(e) => setForm({ ...form, keyword: e.target.value })}
              />
            </label>
            <label className="block text-xs space-y-1">
              Approved offer facts
              <textarea
                className={`${inp} w-full`}
                rows={5}
                maxLength={6000}
                placeholder="What is included, price, eligibility, available dates, approved links and any restrictions. Supply real facts before activation."
                value={form.facts ?? ""}
                onChange={(e) => setForm({ ...form, facts: e.target.value })}
              />
            </label>
            <label className="block text-xs space-y-1">
              Qualification questions (one per line, up to five)
              <textarea
                className={`${inp} w-full`}
                rows={3}
                value={(form.questions ?? []).join("\n")}
                onChange={(e) =>
                  setForm({
                    ...form,
                    questions: e.target.value.split("\n").slice(0, 5),
                  })
                }
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs space-y-1">
                Goal
                <select
                  className={`${inp} w-full`}
                  value={form.goal}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      goal: e.target.value as SocialCampaign["goal"],
                    })
                  }
                >
                  {["lead", "booking", "purchase", "sponsorship"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs space-y-1">
                Status
                <select
                  className={`${inp} w-full`}
                  value={form.status}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      status: e.target.value as SocialCampaign["status"],
                    })
                  }
                >
                  {["draft", "active", "paused"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-xs space-y-1">
              Offer deadline (optional; your local time)
              <input
                className={`${inp} w-full`}
                type="datetime-local"
                value={localInput(form.expires_at ?? null)}
                onChange={(e) =>
                  setForm({
                    ...form,
                    expires_at: e.target.value
                      ? new Date(e.target.value).toISOString()
                      : null,
                  })
                }
              />
            </label>
            {data?.channels.find((c) => c.id === form.channel_id)?.kind ===
              "instagram" && (
              <div className="space-y-2">
                <label className="text-xs flex gap-2 items-center">
                  <input
                    type="checkbox"
                    checked={!!form.variants?.length}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        variants: e.target.checked
                          ? [
                              {
                                id: "a",
                                name: "Immediate resource",
                                mode: "direct",
                              },
                              { id: "b", name: "Verify in DM", mode: "dm" },
                            ]
                          : [],
                      })
                    }
                  />
                  Compare two delivery options on matching comment rules
                </label>
                {form.variants?.map((v, i) => (
                  <div key={v.id} className="grid grid-cols-2 gap-2">
                    <input
                      aria-label={`Variant ${v.id} name`}
                      className={inp}
                      value={v.name}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          variants: form.variants!.map((x, n) =>
                            n === i ? { ...x, name: e.target.value } : x,
                          ),
                        })
                      }
                    />
                    <select
                      aria-label={`Variant ${v.id} delivery`}
                      className={inp}
                      value={v.mode}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          variants: form.variants!.map((x, n) =>
                            n === i
                              ? {
                                  ...x,
                                  mode: e.target.value as SocialVariant["mode"],
                                }
                              : x,
                          ),
                        })
                      }
                    >
                      <option value="direct">No follow requirement</option>
                      <option value="dm">Verify in DM</option>
                      <option value="comment">Verify on comment</option>
                    </select>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-ink-500">
              Active campaigns guide AI replies when AI is enabled. Existing
              comment rules deliver their configured resource. Experiments
              change only the follow requirement for matching Instagram comment
              rules. Targeting and variants lock once someone enters.
            </p>
            <button className={button} disabled={busy}>
              Save campaign
            </button>
          </form>
        )}
      </Drawer>
      <Drawer
        open={!!answer}
        onClose={() => setAnswer(null)}
        title="Approve an answer"
        width="lg"
      >
        {answer && (
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await act({
                  action: "answer_demand",
                  key: answer.gap.key,
                  answer: answer.text,
                  tag: answer.tag,
                })
              )
                setAnswer(null);
            }}
          >
            <p>{answer.gap.question}</p>
            <textarea
              required
              className={`${inp} w-full`}
              rows={5}
              value={answer.text}
              onChange={(e) => setAnswer({ ...answer, text: e.target.value })}
              aria-label="Approved knowledge answer"
            />
            <input
              className={`${inp} w-full`}
              placeholder="Knowledge tag (use the account's tag if knowledge is separated)"
              value={answer.tag}
              onChange={(e) => setAnswer({ ...answer, tag: e.target.value })}
            />
            <p className="text-xs text-ink-500">
              This saves approved knowledge for future replies. It does not
              message past enquirers.
            </p>
            <button className={button} disabled={busy}>
              Approve and save knowledge
            </button>
          </form>
        )}
      </Drawer>
      <Drawer
        open={!!selectedJourney}
        onClose={() => setSelectedJourney(null)}
        title="Review enquiry"
        width="lg"
      >
        {selectedJourney && (
          <div className="space-y-5">
            <form
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                await act({
                  action: "answers",
                  id: selectedJourney.id,
                  answers,
                });
              }}
            >
              <h3 className="font-semibold">Qualification notes</h3>
              {data?.campaigns
                .find((c) => c.id === selectedJourney.campaign_id)
                ?.questions.map((q) => (
                  <label key={q} className="block text-xs space-y-1">
                    {q}
                    <textarea
                      className={`${inp} w-full`}
                      value={answers[q] ?? ""}
                      onChange={(e) =>
                        setAnswers({ ...answers, [q]: e.target.value })
                      }
                    />
                  </label>
                ))}
              <button className={button} disabled={busy}>
                Save answers
              </button>
            </form>
            <form
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                await act({
                  action: "outcome",
                  journeyId: selectedJourney.id,
                  kind: outcome.kind,
                  amountCents: Math.round(
                    Number(outcome.amount) * minorUnitScale(outcome.currency),
                  ),
                  currency: outcome.currency,
                  reference: outcome.reference,
                });
              }}
            >
              <h3 className="font-semibold">Record a business outcome</h3>
              {data?.outcomes
                .filter(
                  (o) =>
                    o.journey_id ===
                    (selectedJourney.root_journey_id ?? selectedJourney.id),
                )
                .map((o) => (
                  <div
                    key={o.id}
                    className="flex justify-between gap-2 text-xs"
                  >
                    <span>
                      {o.kind} · {o.reference} · {o.evidence}
                      {o.kind === "purchase"
                        ? ` · ${money(o.amount_cents, o.currency)}`
                        : ""}
                    </span>
                    {o.evidence === "manual" && (
                      <button
                        type="button"
                        className="underline"
                        disabled={busy}
                        onClick={() =>
                          void act({ action: "remove_outcome", id: o.id })
                        }
                      >
                        Remove manual record
                      </button>
                    )}
                  </div>
                ))}
              <select
                aria-label="Outcome type"
                className={`${inp} w-full`}
                value={outcome.kind}
                onChange={(e) =>
                  setOutcome({ ...outcome, kind: e.target.value })
                }
              >
                {["lead", "booking", "purchase", "sponsorship"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
              <input
                required
                className={`${inp} w-full`}
                placeholder="Unique reference: booking, contract or receipt ID"
                value={outcome.reference}
                onChange={(e) =>
                  setOutcome({ ...outcome, reference: e.target.value })
                }
              />
              <div className="flex gap-2">
                <input
                  aria-label="Outcome amount"
                  type="number"
                  min="0"
                  step="0.01"
                  className={`${inp} min-w-0 flex-1`}
                  value={outcome.amount}
                  onChange={(e) =>
                    setOutcome({ ...outcome, amount: e.target.value })
                  }
                />
                <input
                  aria-label="Currency"
                  className={`${inp} w-24`}
                  maxLength={3}
                  value={outcome.currency}
                  onChange={(e) =>
                    setOutcome({
                      ...outcome,
                      currency: e.target.value.toUpperCase(),
                    })
                  }
                />
              </div>
              <p className="text-xs text-ink-500">
                Saved as manually reported. Payment-confirmed purchases arrive
                automatically from connected checkout webhooks. Reusing the same
                reference does not count twice.
              </p>
              <button className={button} disabled={busy}>
                Record outcome
              </button>
            </form>
            <form
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await act({
                    action: "commitment_candidate",
                    id: selectedJourney.conversation_id,
                    evidence: promise,
                  })
                )
                  setPromise("");
              }}
            >
              <h3 className="font-semibold">Capture a missed commitment</h3>
              <textarea
                required
                className={`${inp} w-full`}
                rows={3}
                placeholder="Paste the exact sent reply containing the promise"
                value={promise}
                onChange={(e) => setPromise(e.target.value)}
              />
              <p className="text-xs text-ink-500">
                Use this for wording or languages the automatic detector misses.
                The reply must exist in this conversation; review its owner and
                due date in Commitments.
              </p>
              <button className={button} disabled={busy}>
                Add for review
              </button>
            </form>
          </div>
        )}
      </Drawer>
    </div>
  );
}
function localInput(value: string | null) {
  if (!value) return "";
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function CommitmentCard({
  item: c,
  team,
  busy,
  save,
}: {
  item: SocialCommitment;
  team: { email: string; name: string }[];
  busy: boolean;
  save: (body: Record<string, unknown>) => Promise<unknown>;
}) {
  const [owner, setOwner] = useState(c.owner_email ?? ""),
    [due, setDue] = useState(localInput(c.due_at));
  const late =
    c.status === "open" && c.due_at && Date.parse(c.due_at) < Date.now();
  return (
    <div className={`${card} ${late ? "!border-amber-400" : ""}`}>
      <div className="flex gap-2 items-center">
        <Clock3 className="h-4 w-4" />
        <h3 className="font-semibold">{c.title}</h3>
        <span className="text-xs text-ink-500">
          {c.status}
          {late ? " · overdue" : ""}
        </span>
      </div>
      <blockquote className="border-l-2 border-line pl-3 text-sm text-ink-500">
        {c.evidence}
      </blockquote>
      {["needs_review", "open"].includes(c.status) && (
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Commitment owner"
            className={inp}
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          >
            <option value="">Choose owner</option>
            {team.map((u) => (
              <option value={u.email} key={u.email}>
                {u.name || u.email}
              </option>
            ))}
          </select>
          <input
            aria-label="Commitment due date"
            className={inp}
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
          <button
            className={button}
            disabled={busy || !owner || !due}
            onClick={() =>
              void save({
                status: "open",
                owner_email: owner,
                due_at: new Date(due).toISOString(),
              })
            }
          >
            {c.status === "needs_review" ? "Accept commitment" : "Update"}
          </button>
          {c.status === "open" && (
            <button
              className={button}
              disabled={busy}
              onClick={() => void save({ status: "done" })}
            >
              <CheckCircle2 className="inline h-3 w-3" /> Mark fulfilled
            </button>
          )}
          <button
            className={button}
            disabled={busy}
            onClick={() => void save({ status: "dismissed" })}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
