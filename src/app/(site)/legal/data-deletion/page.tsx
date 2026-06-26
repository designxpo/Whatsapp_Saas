import type { Metadata } from "next";
import { CheckCircle2, Clock } from "lucide-react";
import { Container, Glow, SectionTitle } from "../../_components/ui";
import { getDeletionStatus } from "@/lib/metadeletion";
import { LEGAL_META } from "../../_content/legal";

export const metadata: Metadata = {
  title: "Data deletion status — Talko AI",
  description: "Request the deletion of your data, or check the status of an existing request.",
};
export const dynamic = "force-dynamic";

const fmt = (s: string | null) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");

export default async function DataDeletionPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  const status = code ? await getDeletionStatus(code) : null;

  return (
    <>
      <section className="relative overflow-hidden">
        <Glow className="left-1/2 top-[-160px] -translate-x-1/2" />
        <Container className="relative pt-20 pb-4">
          <SectionTitle level={1} eyebrow="Data deletion"
            title="Your data deletion request"
            subtitle="We honour requests to delete personal data handled through Talko AI." />
        </Container>
      </section>

      <Container className="py-12">
        <div className="mx-auto max-w-2xl space-y-6">
          {code ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex items-center gap-3">
                {status?.status === "completed"
                  ? <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" />
                  : <Clock className="h-6 w-6 shrink-0 text-[#0783fd]" />}
                <div>
                  <p className="text-sm font-bold text-slate-900">
                    {status?.status === "completed" ? "Deletion complete" : "Request received"}
                  </p>
                  <p className="text-sm text-slate-500">
                    {status?.status === "completed"
                      ? "The data associated with this request has been deleted."
                      : "Your request has been received and is being processed."}
                  </p>
                </div>
              </div>
              <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-2 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2">
                <div className="flex justify-between sm:block">
                  <dt className="text-slate-400">Confirmation code</dt>
                  <dd className="font-mono text-slate-800">{code}</dd>
                </div>
                <div className="flex justify-between sm:block">
                  <dt className="text-slate-400">Status</dt>
                  <dd className="font-semibold capitalize text-slate-800">{status?.status ?? "received"}</dd>
                </div>
                {status?.createdAt && (
                  <div className="flex justify-between sm:block">
                    <dt className="text-slate-400">Requested</dt>
                    <dd className="text-slate-800">{fmt(status.createdAt)}</dd>
                  </div>
                )}
                {status?.completedAt && (
                  <div className="flex justify-between sm:block">
                    <dt className="text-slate-400">Completed</dt>
                    <dd className="text-slate-800">{fmt(status.completedAt)}</dd>
                  </div>
                )}
              </dl>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm leading-relaxed text-slate-600">
              <p className="font-bold text-slate-900">How to request data deletion</p>
              <p className="mt-3">You can request deletion of your personal data in either of these ways:</p>
              <ul className="mt-3 space-y-2 pl-1">
                <li className="flex gap-2.5"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#0783fd]" /><span>Remove the Talko AI app from your Facebook or Instagram account settings — Meta will notify us and we will delete the associated data.</span></li>
                <li className="flex gap-2.5"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#0783fd]" /><span>Email us at <a href={`mailto:${LEGAL_META.privacyEmail}`} className="font-semibold text-[#0783fd] hover:underline">{LEGAL_META.privacyEmail}</a> with your request.</span></li>
              </ul>
              <p className="mt-4">When a request is received you&apos;ll get a confirmation code; visit this page with that code to see its status. For more, see our <a href="/legal/privacy" className="font-semibold text-[#0783fd] hover:underline">Privacy Policy</a>.</p>
            </div>
          )}

          <p className="text-center text-xs text-slate-400">
            Questions? Contact <a href={`mailto:${LEGAL_META.privacyEmail}`} className="font-semibold text-[#0783fd] hover:underline">{LEGAL_META.privacyEmail}</a>.
          </p>
        </div>
      </Container>
    </>
  );
}
