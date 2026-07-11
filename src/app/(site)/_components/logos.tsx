"use client";

import { useState } from "react";

// Brand logo chip. Source order: an explicit `src` (self-hosted SVG/PNG in
// /public/brand/logos — immune to ad-blockers, no third-party CDN) → Simple
// Icons CDN (slug) → Iconify's "logos" set (iconify) → a plain wordmark, so it
// never shows a broken image. Glyph icons render with the brand name beside
// them; images that ARE a wordmark (wordmark: true) render alone.
export function BrandMark({ name, slug, iconify, src, wordmark }: { name: string; slug?: string; iconify?: string; src?: string; wordmark?: boolean }) {
  const sources: string[] = [];
  if (src) sources.push(src);
  if (slug) sources.push(`https://cdn.simpleicons.org/${slug}`);
  if (iconify) sources.push(`https://api.iconify.design/${iconify}.svg`);
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
        alt=""
        className="h-8 w-8 shrink-0 object-contain transition duration-300 hover:scale-110"
        loading="lazy"
        onError={() => setIdx(i => i + 1)}
      />
      <span className="text-[15px] font-bold text-slate-700">{name}</span>
    </span>
  );
}
