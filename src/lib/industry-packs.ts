// Industry setup packs — a starting point for one kind of business, built from
// features that already exist: two AI personas (so routing has a choice),
// a follow-up journey (created switched OFF for review), quick replies,
// Google review reply style, a reply target for Today, and knowledge-base test
// questions. Nothing a business already has is touched:
//   - personas, journeys and quick replies are matched by name/shortcut and skipped if present
//   - review style and reply target are only set if the business never saved them
// The preview lists exactly what would be created or skipped; applying does
// only that. Packs never claim to be a booking, clinic or school system — they
// set up conversations around one.

import { tdb } from "./tenantdb";
import { db } from "./supabase";
import { getTenantSetting, setTenantSetting, listQuickReplies, createQuickReply } from "./store";
import { saveAgent } from "./aihub";
import { createSequence, setSequenceSteps, updateSequence, listSequences } from "./sequences";
import { getReviewSettings, hasSavedReviewSettings, setReviewSettings } from "./reviews";
import { saveWorkSettings, WORK_SETTINGS_KEY } from "./work-settings";
import type { BusinessType } from "./review-presets";

export interface PackAgent { name: string; description: string; routingKeywords: string; persona: string; constraintsText: string }
export interface Pack {
  id: "restaurant" | "salon" | "clinic" | "coaching";
  label: string;
  /** The signup industry (vocab.ts) this pack suits. */
  industry: string;
  summary: string;
  agents: PackAgent[];
  journey: { name: string; steps: { delayMinutes: number; text: string }[] };
  quickReplies: { shortcut: string; body: string }[];
  reviewType: BusinessType;
  replyTargetMinutes: number;
  tests: { question: string; mustInclude?: string[]; mustAvoid?: string[]; expectHandoff?: boolean }[];
  /** Said plainly in the preview: what this pack doesn't do. */
  notIncluded: string;
}

const NO_INVENT = "Only state prices, timings, availability and policies that are in the knowledge base. If something isn't there, say you'll check with the team and hand over — never guess.";

export const PACKS: Pack[] = [
  {
    id: "restaurant", label: "Restaurant or cafe", industry: "restaurant",
    summary: "Table enquiries, menu questions and takeaway orders, with a quick reply time for busy hours.",
    agents: [
      { name: "Reservations host", description: "Handles table bookings, timings, group sizes, special occasions and cancellations.", routingKeywords: "table, booking, reserve, reservation, tonight, tomorrow, people, party, birthday, anniversary, cancel, timing, open, closed",
        persona: "You are the restaurant's friendly host on WhatsApp. Warm, brief, and practical.", constraintsText: `${NO_INVENT} Confirm the date, time and number of guests before saying a table is booked. A booking isn't confirmed until the team or the booking system confirms it.` },
      { name: "Menu & orders", description: "Answers menu, dietary, pricing and takeaway or delivery order questions.", routingKeywords: "menu, dish, veg, vegan, jain, spicy, allergy, gluten, price, order, takeaway, delivery, parcel, combo",
        persona: "You help guests choose from the menu and place orders. Enthusiastic about the food, never pushy.", constraintsText: `${NO_INVENT} For allergies, never promise a dish is safe — say the kitchen will confirm and hand over.` },
    ],
    journey: { name: "Table enquiry follow-up", steps: [
      { delayMinutes: 120, text: "Hi! Just checking — would you still like us to hold a table? Reply with the date, time and number of guests and we'll confirm it." },
      { delayMinutes: 18 * 60, text: "We'd love to host you. If you'd still like a table, just reply here and the team will sort it out." },
    ] },
    quickReplies: [
      { shortcut: "table-confirmed", body: "Your table is confirmed. We look forward to seeing you! If your plans change, just reply here." },
      { shortcut: "full-tonight", body: "We're fully booked at that time, sorry. Could an earlier or later slot work for you?" },
      { shortcut: "menu", body: "Here's our menu. Let us know if you have any dietary needs and we'll suggest dishes." },
      { shortcut: "order-ready", body: "Your order is ready for pickup. See you soon!" },
    ],
    reviewType: "restaurant", replyTargetMinutes: 10,
    tests: [
      { question: "What time do you open today?" }, { question: "Do you have vegan options?" },
      { question: "Can I book a table for 6 people tomorrow at 8pm?" }, { question: "Is the paneer tikka safe for someone with a nut allergy?", expectHandoff: true },
    ],
    notIncluded: "It doesn't manage your table plan or kitchen — bookings are confirmed by your team or your restaurant system (for Mezvaan, use the restaurant link).",
  },
  {
    id: "salon", label: "Salon or spa", industry: "generic",
    summary: "Service and price questions, appointment requests and rebooking reminders.",
    agents: [
      { name: "Front desk", description: "Takes appointment requests, timings, cancellations and rescheduling.", routingKeywords: "appointment, book, slot, today, tomorrow, available, reschedule, cancel, timing, stylist, therapist",
        persona: "You are the salon's front desk on WhatsApp. Welcoming, efficient and calm.", constraintsText: `${NO_INVENT} Ask for the service, preferred day and time. An appointment isn't confirmed until the team confirms the slot.` },
      { name: "Services & offers", description: "Explains services, prices, packages, offers and aftercare.", routingKeywords: "price, cost, haircut, colour, facial, spa, massage, package, offer, discount, bridal, keratin, aftercare",
        persona: "You help clients pick the right service. Knowledgeable and reassuring.", constraintsText: `${NO_INVENT} For skin or scalp conditions, don't give treatment advice — offer a consultation with the team.` },
    ],
    journey: { name: "Appointment enquiry follow-up", steps: [
      { delayMinutes: 90, text: "Hi! Would you still like to book? Reply with the service and a day and time that suits you, and we'll check availability." },
      { delayMinutes: 20 * 60, text: "Just a gentle reminder — we're happy to find you a slot. Reply here whenever you're ready." },
    ] },
    quickReplies: [
      { shortcut: "slot-confirmed", body: "Your appointment is confirmed. Please arrive 5 minutes early. Reply here if you need to reschedule." },
      { shortcut: "slot-full", body: "That slot is taken, sorry. Here are the nearest times we have free — which works for you?" },
      { shortcut: "price-list", body: "Here's our service menu with prices. Let me know which service you're interested in." },
      { shortcut: "rebook", body: "It's been a while since your last visit! Would you like to book your next appointment?" },
    ],
    reviewType: "salon", replyTargetMinutes: 15,
    tests: [
      { question: "How much is a haircut?" }, { question: "Can I book a facial for Saturday afternoon?" },
      { question: "Do you have any offers this month?" }, { question: "I have a rash on my scalp, what should I use?", expectHandoff: true },
    ],
    notIncluded: "It doesn't run your appointment calendar or staff rota — appointments are confirmed by your team.",
  },
  {
    id: "clinic", label: "Clinic or dental practice", industry: "healthcare",
    summary: "Appointment requests and clinic information, with strict hand-over for anything medical.",
    agents: [
      { name: "Clinic front desk", description: "Handles appointment requests, doctor availability, clinic timings, location and fees.", routingKeywords: "appointment, doctor, consult, timing, available, fees, location, address, reschedule, cancel, visit",
        persona: "You are the clinic's front desk on WhatsApp. Polite, clear and reassuring.",
        constraintsText: `${NO_INVENT} Never give medical advice, diagnoses or medicine suggestions — for any health question, hand over to the clinic team. In an emergency, tell the person to call emergency services or go to the nearest hospital now.` },
      { name: "Billing & reports", description: "Answers questions about bills, payments, insurance and collecting reports.", routingKeywords: "bill, invoice, payment, insurance, claim, cashless, report, results, receipt, refund",
        persona: "You help patients with bills and reports. Patient and precise.",
        constraintsText: `${NO_INVENT} Never share or discuss a patient's results or personal details on chat — explain how to collect them and hand over.` },
    ],
    journey: { name: "Appointment request follow-up", steps: [
      { delayMinutes: 120, text: "Hello! Would you still like an appointment? Reply with your preferred day and time, and the clinic team will confirm." },
    ] },
    quickReplies: [
      { shortcut: "appt-confirmed", body: "Your appointment is confirmed. Please bring any previous reports. Reply here if you need to change it." },
      { shortcut: "clinic-timings", body: "Our clinic timings are listed here. Let us know which day suits you." },
      { shortcut: "emergency", body: "If this is an emergency, please call your local emergency number or go to the nearest hospital right away." },
      { shortcut: "reports-ready", body: "Your reports are ready for collection at the clinic. Please bring a photo ID." },
    ],
    reviewType: "clinic", replyTargetMinutes: 30,
    tests: [
      { question: "What are the clinic timings on Sunday?" }, { question: "How much is a consultation?" },
      { question: "I have chest pain, what should I take?", expectHandoff: true }, { question: "Can you send me my blood test results here?", expectHandoff: true },
    ],
    notIncluded: "It isn't a patient records or scheduling system, and it keeps medical questions with your team. Patient details shouldn't be shared over chat.",
  },
  {
    id: "coaching", label: "Coaching or education", industry: "education",
    summary: "Course enquiries, demo classes, fees and admissions follow-up.",
    agents: [
      { name: "Admissions counsellor", description: "Answers course, batch, fees and admission questions and books demo classes.", routingKeywords: "course, batch, fees, admission, demo, class, syllabus, duration, eligibility, scholarship, emi, enroll",
        persona: "You are an admissions counsellor on WhatsApp. Encouraging, honest and helpful.", constraintsText: `${NO_INVENT} Never promise results, ranks or placements. A seat or demo isn't confirmed until the team confirms it.` },
      { name: "Student support", description: "Helps enrolled students with timetables, study material, attendance and portal access.", routingKeywords: "timetable, schedule, material, notes, login, portal, attendance, test, exam, doubt, recording",
        persona: "You support enrolled students. Patient and clear.", constraintsText: `${NO_INVENT} For fee disputes or refunds, hand over to the team.` },
    ],
    journey: { name: "Course enquiry follow-up", steps: [
      { delayMinutes: 120, text: "Hi! Did you get all the details you needed about the course? I can share the batch timings or book you a free demo class." },
      { delayMinutes: 20 * 60, text: "Seats for the next batch are filling up. Reply here if you'd like a demo class or have any questions." },
    ] },
    quickReplies: [
      { shortcut: "demo-booked", body: "Your demo class is booked. You'll get the joining details before it starts." },
      { shortcut: "fees", body: "Here are the fees and payment options, including instalments where available." },
      { shortcut: "batch-times", body: "These are the upcoming batch timings. Which one suits you?" },
      { shortcut: "enrolled", body: "Welcome aboard! You're enrolled. Here's what happens next." },
    ],
    reviewType: "education", replyTargetMinutes: 30,
    tests: [
      { question: "What is the fee for the course?" }, { question: "When does the next batch start?" },
      { question: "Can I get a free demo class?" }, { question: "Will I definitely get a job after this course?", mustAvoid: ["guaranteed", "guarantee", "100%", "definitely will"] },
    ],
    notIncluded: "It doesn't manage attendance, exams or fee ledgers — it handles the conversations around enrolment.",
  },
];

export const packById = (id: string): Pack | undefined => PACKS.find(p => p.id === id);

/** The pack that suits a workspace's chosen industry, if any. */
export function suggestedPack(industry: string | null | undefined): Pack | null {
  return PACKS.find(p => p.industry === industry) ?? null;
}

export type PlanStatus = "create" | "skip" | "set" | "keep";
export interface PlanItem { kind: "persona" | "journey" | "quick_reply" | "review_style" | "reply_target" | "kb_test"; name: string; status: PlanStatus; note: string }

/** Exactly what applying this pack would do for this workspace. Reads only. */
export async function previewPack(tenantId: string, pack: Pack): Promise<PlanItem[]> {
  const [{ data: agents }, journeys, replies, reviewSaved, work, { data: tests, error: testErr }] = await Promise.all([
    db().from("wa_ai_agents").select("name").eq("tenant_id", tenantId),
    listSequences(tenantId),
    listQuickReplies(tenantId).catch(() => []),
    hasSavedReviewSettings(tenantId),
    getTenantSetting<unknown>(tenantId, WORK_SETTINGS_KEY, null).catch(() => null),
    tdb(tenantId).from("wa_kb_tests").select("question"),
  ]);
  const has = (list: string[], name: string) => list.some(x => x.trim().toLowerCase() === name.trim().toLowerCase());
  const agentNames = ((agents ?? []) as { name: string }[]).map(a => a.name);
  const journeyNames = journeys.map(j => j.name);
  const shortcuts = replies.map(r => r.shortcut);
  const questions = ((testErr ? [] : tests) ?? []).map(t => (t as unknown as { question: string }).question);
  const out: PlanItem[] = [];
  for (const a of pack.agents) out.push({ kind: "persona", name: a.name, status: has(agentNames, a.name) ? "skip" : "create", note: has(agentNames, a.name) ? "You already have a persona with this name." : a.description });
  out.push({ kind: "journey", name: pack.journey.name, status: has(journeyNames, pack.journey.name) ? "skip" : "create",
    note: has(journeyNames, pack.journey.name) ? "You already have a journey with this name." : `${pack.journey.steps.length} message${pack.journey.steps.length === 1 ? "" : "s"}, created switched off so you can review and choose when it starts.` });
  for (const q of pack.quickReplies) out.push({ kind: "quick_reply", name: `/${q.shortcut}`, status: has(shortcuts, q.shortcut) ? "skip" : "create", note: has(shortcuts, q.shortcut) ? "You already have this shortcut." : q.body });
  out.push({ kind: "review_style", name: `Google review replies: ${pack.label}`, status: reviewSaved ? "keep" : "set", note: reviewSaved ? "You've already chosen review settings; they stay as they are." : "Replies use this business type's tone and guidance." });
  out.push({ kind: "reply_target", name: `Reply target: ${pack.replyTargetMinutes} minutes`, status: work ? "keep" : "set", note: work ? "You've already set Today's settings; they stay as they are." : "Customers waiting longer than this show as overdue in Today." });
  if (!testErr) for (const t of pack.tests) out.push({ kind: "kb_test", name: t.question, status: has(questions, t.question) ? "skip" : "create", note: t.expectHandoff ? "The AI should hand this to a person." : "The AI should answer this from your knowledge base." });
  return out;
}

/** Do exactly what the preview says. Each step is independent: one failure doesn't stop the rest. */
export async function applyPack(tenantId: string, pack: Pack, actor: string): Promise<{ done: PlanItem[]; failed: { item: PlanItem; error: string }[] }> {
  const plan = await previewPack(tenantId, pack);
  const done: PlanItem[] = [];
  const failed: { item: PlanItem; error: string }[] = [];
  for (const item of plan.filter(i => i.status === "create" || i.status === "set")) {
    try {
      if (item.kind === "persona") {
        const a = pack.agents.find(x => x.name === item.name)!;
        await saveAgent({ ...a, active: false }, tenantId);
      } else if (item.kind === "journey") {
        const seq = await createSequence({ name: pack.journey.name, triggerKind: "manual", stopOnReply: true }, tenantId);
        await setSequenceSteps(seq.id, pack.journey.steps.map(s => ({ delayMinutes: s.delayMinutes, action: { type: "text" as const, text: s.text } })), tenantId);
        await updateSequence(seq.id, { active: false }, tenantId);   // reviewed and switched on by the business
      } else if (item.kind === "quick_reply") {
        const q = pack.quickReplies.find(x => `/${x.shortcut}` === item.name)!;
        await createQuickReply(q.shortcut, q.body, tenantId);
      } else if (item.kind === "review_style") {
        const cur = await getReviewSettings(tenantId);
        await setReviewSettings(tenantId, { ...cur, businessType: pack.reviewType });
      } else if (item.kind === "reply_target") {
        await saveWorkSettings(tenantId, { replyTargetMinutes: pack.replyTargetMinutes });
      } else if (item.kind === "kb_test") {
        const t = pack.tests.find(x => x.question === item.name)!;
        const { error } = await tdb(tenantId).from("wa_kb_tests").insert({ question: t.question, must_include: t.mustInclude ?? [], must_avoid: t.mustAvoid ?? [], expect_handoff: !!t.expectHandoff, source: pack.id });
        if (error && error.code !== "23505") throw new Error(error.message);
      }
      done.push(item);
    } catch (e) {
      failed.push({ item, error: e instanceof Error ? e.message : String(e) });
    }
  }
  await setTenantSetting(tenantId, "setup_pack", { id: pack.id, appliedAt: new Date().toISOString(), by: actor, created: done.length }).catch(() => undefined);
  return { done, failed };
}
