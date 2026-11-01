"use client";

import { useState } from "react";

// Brand logo chip. Only ever loads the self-hosted file in /public/brand/logos
// — no icon CDN fallback, so a visitor's IP never goes to a third party just to
// draw a logo. If the file is missing or fails, the name renders as a plain
// wordmark instead of a broken image. Glyph icons render with the brand name
// beside them; images that ARE a wordmark (wordmark: true) render alone.
export function BrandMark({ name, src, wordmark }: { name: string; src?: string; wordmark?: boolean }) {
  const sources: string[] = src ? [src] : [];
  const [idx, setIdx] = useState(0);
  if (idx >= sources.length) {
    return <span className="whitespace-nowrap text-lg font-extrabold text-slate-600">{name}</span>;
  }
  if (wordmark) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={sources[idx]}
        alt={name}
        title={name}
        width={120}
        height={32}
        className="h-8 w-auto max-w-[150px] object-contain transition duration-300 hover:scale-105"
        loading="lazy"
        onError={() => setIdx(i => i + 1)}
      />
    );
  }
  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap" title={name}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={sources[idx]}
        alt={`${name} logo`}
        width={32}
        height={32}
        className="h-8 w-8 shrink-0 object-contain transition duration-300 hover:scale-110"
        loading="lazy"
        onError={() => setIdx(i => i + 1)}
      />
      <span className="text-[15px] font-bold text-slate-700">{name}</span>
    </span>
  );
}
