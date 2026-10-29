"use client";

// The explanation behind a screen, kept off the screen. A title or section
// label used to carry a paragraph, and every tab became a wall of text before
// any control. Now the label carries a small eye, quiet until you reach for it:
// the paragraph opens in a side panel for whoever wants it, and the page shows
// only what you act on.
//
// Wrap the label and the eye in `group` so the eye brightens with the label.
import { useState } from "react";
import { Eye } from "lucide-react";
import { Drawer } from "./overlay";

export function PageInfo({ title = "About this", children }: { title?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="More about this" title="More about this"
        className="shrink-0 p-1 -m-0.5 rounded-md text-slate-300 opacity-70 transition-[opacity,color,transform] duration-200 ease-out hover:text-brand-700 hover:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:text-brand-700 active:scale-90 motion-reduce:transition-none">
        <Eye className="w-3.5 h-3.5" />
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title={title} width="md">
        <div className="text-sm text-slate-600 leading-relaxed space-y-3">{children}</div>
      </Drawer>
    </>
  );
}
