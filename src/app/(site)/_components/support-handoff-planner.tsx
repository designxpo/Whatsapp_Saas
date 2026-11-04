"use client";

import { useState } from "react";
import { ArrowRight, Check, Clipboard, RotateCcw } from "lucide-react";

const TASKS = {
  routine: "Routine question",
  record: "Booking or order task",
  exception: "Dispute or sensitive issue",
};
const TASK_DETAILS = {
  routine: "For example, opening hours or what a course includes.",
  record: "A task that reads or changes a specific booking or order.",
  exception: "A disputed charge, sensitive complaint or policy exception.",
};
type Task = keyof typeof TASKS;

export function SupportHandoffPlanner() {
  const [task, setTask] = useState<Task>("routine");
  const [approved, setApproved] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [humanRequested, setHumanRequested] = useState(false);
  const [owner, setOwner] = useState(true);
  const [copyStatus, setCopyStatus] = useState("");

  const human = humanRequested || task === "exception";
  const prepare = !human && (!approved || !owner);
  const needsConnection = !human && !prepare && task === "record" && !authorized;
  const title = human ? "Human-led support"
    : prepare ? "Prepare the fallback before automating"
      : needsConnection ? "Collect context, then hand over"
        : task === "record" ? "Approved workflow + confirmed result"
          : "AI answer + human fallback";
  const description = human
    ? "Route this to a person. AI can help organize the context or draft a reply, but it should not decide the outcome or make the customer try again."
    : prepare
      ? "Keep this supervised until you have approved information and a named person responsible for exceptions. Avoid promising an answer or a transfer your team cannot provide."
      : needsConnection
        ? "A general answer cannot establish what happened to a particular order. Collect only the necessary reference and send the conversation to the teammate who can verify it."
        : task === "record"
          ? "Use only the connected system’s permitted actions, with appropriate identity checks. Report success after the system confirms completion; route errors to the owner."
          : "Let AI answer from the approved information. Hand over when the answer is missing, disputed or the customer asks for a person.";
  const checklist = [
    ...(human ? ["Assign a person and carry over the conversation history."] : []),
    ...(!approved ? ["Write and approve the answer or policy first."] : []),
    ...(!owner ? ["Name an escalation owner and publish an honest response window."] : []),
    ...(task === "record" ? [authorized ? "Test authorization, identity checks and failure responses." : "Verify the record manually; do not claim an action is complete."] : []),
    ...(task === "routine" && !human ? ["Test missing answers, disagreement and a request for a person."] : []),
    "Review repeat contacts and confirmed outcomes during a limited pilot.",
  ];

  async function copy() {
    try {
      await navigator.clipboard.writeText([
        `Task: ${TASKS[task]}`, `Starting route: ${title}`, description,
        ...checklist.map(item => `• ${item}`),
        "Planning guidance from Talko AI; configure and test separately.",
      ].join("\n"));
      setCopyStatus("Plan copied.");
    } catch {
      setCopyStatus("Copy is unavailable in this browser. You can select the plan text below.");
    }
  }
  function reset() {
    setTask("routine"); setApproved(true); setAuthorized(false);
    setHumanRequested(false); setOwner(true); setCopyStatus("");
  }

  return (
    <section aria-labelledby="handoff-planner-title" className="not-prose my-8 scroll-mt-28 overflow-hidden rounded-2xl border border-[#0783fd]/25 bg-white shadow-[0_16px_40px_-28px_rgba(7,131,253,0.4)]" onChange={() => setCopyStatus("")}>
      <div className="border-b border-slate-200 bg-gradient-to-r from-[#0783fd]/10 to-[#00b8d9]/10 p-5">
        <p className="text-xs font-bold uppercase tracking-wider text-[#026cd4]">Make the call</p>
        <h3 id="handoff-planner-title" className="mt-2 text-lg font-bold text-slate-900">What should handle this support task?</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">Choose a task and its safeguards. Your answers stay in this page; the planner does not access your account.</p>
      </div>
      <div className="grid gap-6 p-5 sm:p-6 md:grid-cols-2">
        <div className="space-y-5">
          <div>
            <label htmlFor="handoff-task" className="block text-sm font-bold text-slate-800">Which task are you considering?</label>
            <select id="handoff-task" aria-describedby="handoff-task-detail" value={task} onChange={event => setTask(event.target.value as Task)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0783fd]">
              {Object.entries(TASKS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <p id="handoff-task-detail" className="mt-2 text-xs leading-relaxed text-slate-500">{TASK_DETAILS[task]}</p>
          </div>
          <fieldset className="space-y-3">
            <legend className="mb-3 text-sm font-bold text-slate-800">What is in place for this task?</legend>
            {[
              { id: "approved", text: "We have current, approved answers or policies.", value: approved, change: setApproved },
              { id: "owner", text: "A named teammate owns exceptions and follow-up.", value: owner, change: setOwner },
              { id: "requested", text: "The customer has asked to speak to a person.", value: humanRequested, change: setHumanRequested },
              ...(task === "record" ? [{ id: "authorized", text: "An authorized integration can verify or complete this task.", value: authorized, change: setAuthorized }] : []),
            ].map(input => (
              <label key={input.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 text-sm leading-relaxed text-slate-700">
                <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[#0783fd]" checked={input.value} onChange={event => input.change(event.target.checked)} />
                <span>{input.text}</span>
              </label>
            ))}
          </fieldset>
          <button type="button" onClick={reset} className="inline-flex items-center gap-2 text-xs font-semibold text-[#026cd4] hover:underline"><RotateCcw size={14} aria-hidden /> Reset answers</button>
        </div>
        <div className="rounded-xl border border-[#0783fd]/20 bg-[#f4faff] p-5">
          <div role="status" aria-live="polite" aria-atomic="true">
            <p className="text-xs font-bold uppercase tracking-wide text-[#026cd4]">Suggested starting route</p>
            <h4 className="mt-3 text-lg font-bold text-slate-900">{title}</h4>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">{description}</p>
            <ol className="mt-5 space-y-3">
              {checklist.map(item => <li key={item} className="flex items-start gap-2 text-sm leading-relaxed text-slate-700"><Check className="mt-1 h-4 w-4 shrink-0 text-[#026cd4]" aria-hidden /><span>{item}</span></li>)}
            </ol>
          </div>
          <button type="button" onClick={() => void copy()} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-[#0783fd] to-[#00b8d9] px-4 py-2.5 text-sm font-bold !text-white transition-shadow hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-[#026cd4] focus:ring-offset-2"><Clipboard size={15} aria-hidden /> Copy this plan <ArrowRight size={15} aria-hidden /></button>
          <p role="status" className="mt-2 text-xs leading-relaxed text-slate-600">{copyStatus}</p>
          <p className="mt-4 text-xs leading-relaxed text-slate-500">This is a planning guide, not a model evaluation or an automatic account setting.</p>
        </div>
      </div>
    </section>
  );
}
