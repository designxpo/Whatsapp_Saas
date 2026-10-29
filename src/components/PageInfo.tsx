"use client";

// The explanation behind a screen, kept off the screen. A page title used to
// carry a paragraph under it, and every tab became a wall of text before any
// control. Now the title carries an eye: the paragraph opens in a side panel
// for whoever wants it, and the page shows only what you act on.
import { useState } from "react";
import { Eye } from "lucide-react";
import { Drawer } from "./overlay";

export function PageInfo({ title = "About this page", children }: { title?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="What is this page?" title="What is this page?"
        className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-ink-900 shrink-0">
        <Eye className="w-4 h-4" />
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title={title} width="md">
        <div className="text-sm text-slate-600 leading-relaxed space-y-3">{children}</div>
      </Drawer>
    </>
  );
}
