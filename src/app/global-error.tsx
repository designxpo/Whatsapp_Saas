"use client";

// Root fallback: an error in the root layout itself. Replaces the blank
// "Application error" page, and reloads once after a deploy (chunk-reload.ts).

import { useEffect } from "react";
import { isChunkLoadError, reloadForNewDeploy } from "@/lib/chunk-reload";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const chunk = isChunkLoadError(error);
  useEffect(() => { if (chunk) reloadForNewDeploy(); }, [chunk]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#f6f7fb", color: "#1f2937", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div role="alert" style={{ maxWidth: 420, padding: 24, borderRadius: 16, background: "#fff", border: "1px solid #e5e7eb" }}>
          <p style={{ fontWeight: 700, margin: 0 }}>{chunk ? "Talko was just updated" : "Something went wrong"}</p>
          <p style={{ fontSize: 14 }}>{chunk ? "Reloading to the latest version — nothing you saved is lost." : `The page hit an error${error.digest ? ` (ref ${error.digest})` : ""}.`}</p>
          <button onClick={() => (chunk ? window.location.reload() : reset())} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", fontWeight: 700, cursor: "pointer" }}>
            {chunk ? "Reload" : "Try again"}
          </button>
        </div>
      </body>
    </html>
  );
}
