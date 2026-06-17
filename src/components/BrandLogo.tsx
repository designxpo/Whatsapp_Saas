"use client";
import { useState } from "react";

// Talko AI logo: the "TALK + robot" mark from public/brand/talkoail_logo.svg,
// sized by height (width auto-scales), with the "AI" wordmark appended as text
// in the brand-blue gradient so the lockup reads "TALK [robot] AI". Falls back to
// the supplied default if the file is missing/fails to load (the fallback already
// includes its own "Talko AI" text, so no suffix is added there).
//
// suffix=false renders the image alone — use it if you swap in an SVG that
// already contains "AI", to avoid duplicating it.
export function BrandLogo({
  height = 32, className = "", fallback, suffix = true,
}: { height?: number; className?: string; fallback: React.ReactNode; suffix?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    <span className="inline-flex items-center" style={{ gap: Math.round(height * 0.14) }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/talkoail_logo.svg"
        alt="Talko AI"
        style={{ height, width: "auto" }}
        className={className}
        onError={() => setFailed(true)}
      />
      {suffix && (
        <span
          aria-hidden="true"
          className="font-extrabold leading-none tracking-tight bg-gradient-to-br from-[#0763e6] to-[#3aa3ff] bg-clip-text text-transparent"
          style={{ fontSize: Math.round(height * 0.55) }}
        >
          AI
        </span>
      )}
    </span>
  );
}
