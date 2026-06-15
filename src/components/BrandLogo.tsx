"use client";
import { useState } from "react";

// Full Talko AI logo lockup from public/brand/talkoail_logo.svg, sized by height
// (width auto-scales to its aspect ratio). Falls back to the supplied default
// if the file is missing/fails to load, so the UI never shows a broken image.
export function BrandLogo({ height = 32, className = "", fallback }: { height?: number; className?: string; fallback: React.ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/talkoail_logo.svg"
      alt="Talko AI"
      style={{ height, width: "auto" }}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
