"use client";

// Search: jump to any screen, Settings section or common action by typing.
// Opened from the header's search button or with ⌘K / Ctrl+K.
//
// A combobox over a listbox (WAI-ARIA 1.2): focus stays in the text box, the
// arrow keys move the highlighted result (announced via aria-activedescendant),
// Enter opens it, Escape closes the dialog. The list only ever holds what this
// person may open — paletteEntries() applies the same plan and role rules as
// the menu.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowRight, CornerDownLeft, Search } from "lucide-react";
import { Modal } from "@/components/overlay";
import { filterPalette, type PaletteEntry, type PaletteGroup } from "./shell-logic";

const GROUP_ORDER: PaletteGroup[] = ["Suggested", "Actions", "Go to", "Settings"];

export function CommandPalette({ open, onClose, entries, onPick }: {
  open: boolean; onClose: () => void; entries: PaletteEntry[]; onPick: (e: PaletteEntry) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) { setQuery(""); setActive(0); } }, [open]);

  // Results in display order: grouped when browsing, ranked when searching.
  const results = useMemo(() => {
    const hits = filterPalette(entries, query);
    if (query.trim()) return hits;
    return GROUP_ORDER.flatMap(g => hits.filter(e => e.group === g));
  }, [entries, query]);
  useEffect(() => { setActive(0); }, [query]);

  // Keep the highlighted row in view as the arrows move it.
  useEffect(() => {
    if (!open) return;
    document.getElementById(optionId(active))?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(i => (results.length ? (i + 1) % results.length : 0)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(i => (results.length ? (i - 1 + results.length) % results.length : 0)); }
    else if (e.key === "Home" && results.length) { e.preventDefault(); setActive(0); }
    else if (e.key === "End" && results.length) { e.preventDefault(); setActive(results.length - 1); }
    else if (e.key === "Enter") { e.preventDefault(); const hit = results[active]; if (hit) onPick(hit); }
  }

  // Group headings only while browsing; a ranked search is one list.
  const grouped = !query.trim();
  let index = -1;
  const sections = grouped
    ? GROUP_ORDER.map(g => ({ group: g, items: results.filter(e => e.group === g) })).filter(s => s.items.length)
    : [{ group: null as PaletteGroup | null, items: results }];

  return (
    <Modal open={open} onClose={onClose} title="Search" subtitle="Jump to a screen, a setting or an action" size="md">
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-500 pointer-events-none" aria-hidden />
          <input
            type="text" role="combobox" aria-expanded={results.length > 0} aria-controls={listId} aria-autocomplete="list"
            aria-activedescendant={results.length ? optionId(active) : undefined} aria-label="Search screens, settings and actions"
            value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKeyDown}
            placeholder="Try “templates”, “team” or “import”" autoComplete="off" spellCheck={false}
            className="w-full h-11 pl-9 pr-3 rounded-control border border-line bg-white text-[15px] text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600"
          />
        </div>
        {!results.length && <p role="status" className="px-2 py-6 text-center text-sm text-ink-500">Nothing matches “{query.trim()}”. Try another word.</p>}
        <div ref={list} id={listId} role="listbox" aria-label="Results" className="max-h-[min(60vh,420px)] overflow-y-auto overscroll-contain -mx-1 px-1">
          {sections.map(s => (
            <div key={s.group ?? "all"} role="group" aria-label={s.group ?? "Results"} className="mb-2 last:mb-0">
              {s.group && <p aria-hidden className="px-2 pt-1 pb-1 text-[12px] font-bold text-ink-500 uppercase tracking-[0.06em]">{s.group}</p>}
              {s.items.map(e => {
                index += 1;
                const i = index;
                const on = i === active;
                return (
                  <div key={e.id} id={optionId(i)} role="option" aria-selected={on}
                    onMouseMove={() => { if (!on) setActive(i); }}
                    onMouseDown={ev => ev.preventDefault()}
                    onClick={() => onPick(e)}
                    className={`flex items-center gap-3 min-h-11 px-3 py-2 rounded-control cursor-pointer ${on ? "bg-brand-50 text-ink-900" : "text-ink-700"}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-semibold truncate">{e.label}</span>
                      {e.hint && <span className="block text-[12px] text-ink-500 truncate">{e.hint}</span>}
                    </span>
                    {on ? <CornerDownLeft className="w-4 h-4 text-brand-700 shrink-0" aria-hidden /> : <ArrowRight className="w-4 h-4 text-ink-400 shrink-0" aria-hidden />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <p className="hidden sm:block text-[12px] text-ink-500">↑ ↓ to move · Enter to open · Esc to close</p>
      </div>
    </Modal>
  );
}
