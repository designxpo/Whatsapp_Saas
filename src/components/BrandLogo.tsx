"use client";
import { useState } from "react";

// Talko AI logo: the full horizontal lockup from public/brand/talkoai.svg,
// sized by height (width auto-scales). Falls back to the supplied default if the
// file is missing/fails to load.
//
// suffix renders an extra "AI" text after the image — only needed if the artwork
// itself omits "AI". The current asset is a complete "Talko AI" lockup, so it
// defaults OFF to avoid printing "Talko AI AI".
export function BrandLogo({
  height = 32, className = "", fallback, suffix = false,
}: { height?: number; className?: string; fallback: React.ReactNode; suffix?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    <span className="inline-flex items-center" style={{ gap: Math.round(height * 0.14) }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/talkoai.svg"
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
