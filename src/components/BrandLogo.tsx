"use client";
import { useState } from "react";

// Aspect ratio of the cropped lockup artwork (viewBox "8 58.5 432 110").
// Both <img> dimensions are pinned from this so the logo renders at an identical
// size in every browser — left to width:auto, Chrome and Safari compute the
// intrinsic width of an SVG-in-a-flex-item differently (Chrome ~1.6× larger).
const LOGO_RATIO = 432 / 110;

// Talko AI logo: the full horizontal lockup from public/brand/talkoai.svg, sized
// by height with the width derived from LOGO_RATIO (explicit, not auto — see
// above). Falls back to the supplied default if the file is missing/fails to load.
//
// suffix renders an extra "AI" text after the image — only needed if the artwork
// itself omits "AI". The current asset is a complete "Talko AI" lockup, so it
// defaults OFF to avoid printing "Talko AI AI".
export function BrandLogo({
  height = 32, className = "", fallback, suffix = false,
}: { height?: number; className?: string; fallback: React.ReactNode; suffix?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  const width = Math.round(height * LOGO_RATIO);
  return (
    <span className="inline-flex items-center" style={{ gap: Math.round(height * 0.14) }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/talkoai.svg"
        alt="Talko AI"
        width={width}
        height={height}
        style={{ height, width, objectFit: "contain", display: "block" }}
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
