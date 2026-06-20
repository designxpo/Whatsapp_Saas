"use client";

import { useState } from "react";

// Full-colour brand logo. Source order: an explicit local/remote `src` (e.g. an
// official SVG dropped in /public/brand) → Simple Icons CDN (slug) → Iconify's
// "logos" set (iconify, for brands Simple Icons dropped) → a wordmark, so it
// never shows a broken image.
export function BrandMark({ name, slug, iconify, src }: { name: string; slug?: string; iconify?: string; src?: string }) {
  const sources: string[] = [];
  if (src) sources.push(src);
  if (slug) sources.push(`https://cdn.simpleicons.org/${slug}`);
  if (iconify) sources.push(`https://api.iconify.design/${iconify}.svg`);
  const [idx, setIdx] = useState(0);
  if (idx >= sources.length) {
    return <span className="whitespace-nowrap text-lg font-extrabold text-slate-600">{name}</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={sources[idx]}
      alt={name}
      title={name}
      className="h-10 w-auto max-w-[150px] object-contain transition duration-300 hover:scale-110"
      loading="lazy"
      onError={() => setIdx(i => i + 1)}
    />
  );
}
