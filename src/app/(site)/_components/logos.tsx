"use client";

import { useState } from "react";

// Brand logo via the Simple Icons CDN (monochrome slate to match the strip).
// Falls back to the brand name as a wordmark if there's no slug or the icon
// fails to load, so the strip never shows a broken image.
export function BrandMark({ name, slug }: { name: string; slug?: string }) {
  const [failed, setFailed] = useState(false);
  if (!slug || failed) {
    return <span className="whitespace-nowrap text-lg font-extrabold text-slate-400">{name}</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://cdn.simpleicons.org/${slug}`}
      alt={name}
      title={name}
      className="h-8 w-auto opacity-60 grayscale transition duration-300 hover:opacity-100 hover:grayscale-0"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
