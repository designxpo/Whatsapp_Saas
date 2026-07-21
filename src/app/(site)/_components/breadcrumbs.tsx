import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { JsonLd } from "./json-ld";
import { SITE_URL } from "@/lib/siteurl";

export type Crumb = { name: string; href: string };

// One source of truth for both the visible breadcrumb trail and its
// BreadcrumbList JSON-LD — they can never drift. Server component; drop it
// near the top of a deep page. `items` should start at "Home".
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: `${SITE_URL}${it.href === "/" ? "" : it.href}`,
    })),
  };
  return (
    <>
      <JsonLd data={schema} />
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          {items.map((it, i) => {
            const last = i === items.length - 1;
            return (
              <li key={it.href} className="flex items-center gap-1.5">
                {i > 0 && <ChevronRight className="h-3 w-3 text-slate-300" aria-hidden="true" />}
                {last
                  ? <span aria-current="page" className="font-semibold text-slate-700">{it.name}</span>
                  : <Link href={it.href} className="transition-colors hover:text-[#0783fd]">{it.name}</Link>}
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
