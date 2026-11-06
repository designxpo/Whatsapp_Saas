"use client";

// Last line of defence for the portal shell (anything outside a single tab,
// which TabErrorBoundary already covers). Replaces Next's blank
// "Application error" with a way back, and reloads once after a deploy.

import { useEffect } from "react";
import { isChunkLoadError, reloadForNewDeploy } from "@/lib/chunk-reload";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const chunk = isChunkLoadError(error);
  useEffect(() => {
    if (chunk) reloadForNewDeploy();
    else console.error("[portal] crashed:", error);
  }, [chunk, error]);
  return (
    <div role="alert" className="mx-auto mt-24 max-w-md space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-950">
      <p className="text-base font-bold">{chunk ? "Talko was just updated" : "Something went wrong"}</p>
      <p className="text-sm">{chunk ? "Reloading to the latest version — nothing you saved is lost." : "The portal hit an error. Try again, or reload the page."}</p>
      {!chunk && <p className="break-words rounded-lg bg-white/70 px-3 py-2 font-mono text-xs">{error.message}{error.digest ? ` (ref ${error.digest})` : ""}</p>}
      <div className="flex gap-2">
        <button onClick={() => reset()} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold">Try again</button>
        <button onClick={() => window.location.reload()} className="rounded-lg bg-amber-900 px-3 py-1.5 text-xs font-bold text-white">Reload</button>
      </div>
    </div>
  );
}
