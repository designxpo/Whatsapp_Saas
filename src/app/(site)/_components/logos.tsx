"use client";

import { useState } from "react";

// Brand logo, grayscale at rest → full colour on hover (matches the strip).
// Tries the Simple Icons CDN first (slug), then Iconify's "logos" set (iconify)
// for brands Simple Icons dropped, then falls back to a wordmark — so it never
// shows a broken image.
export function BrandMark({ name, slug, iconify }: { name: string; slug?: string; iconify?: string }) {
  const sources: string[] = [];
  if (slug) sources.push(`https://cdn.simpleicons.org/${slug}`);
  if (iconify) sources.push(`https://api.iconify.design/${iconify}.svg`);
  const [idx, setIdx] = useState(0);
  if (idx >= sources.length) {
    return <span className="whitespace-nowrap text-lg font-extrabold text-slate-400">{name}</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={sources[idx]}
      alt={name}
      title={name}
      className="h-8 w-auto opacity-60 grayscale transition duration-300 hover:opacity-100 hover:grayscale-0"
      loading="lazy"
      onError={() => setIdx(i => i + 1)}
    />
  );
}
