"use client";
import { useState } from "react";

// Renders the uploaded brand mark from /brand/logo.svg. If it isn't uploaded
// yet (or fails to load), it falls back to the provided default icon so the UI
// never shows a broken image. Drop a square SVG at public/brand/logo.svg.
export function BrandMark({ size = 36, className = "", fallback }: { size?: number; className?: string; fallback: React.ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/logo.svg"
      alt="Talko AI"
      width={size}
      height={size}
      style={{ width: size, height: size, objectFit: "contain" }}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
