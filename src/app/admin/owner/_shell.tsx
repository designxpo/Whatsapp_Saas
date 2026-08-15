"use client";

// Owner console shell — sidebar, header, and the ⌘K palette.
//
// Navigation is real routing, not tab state: at fleet scale an operator needs to
// send someone a link to a filtered view, and to use the back button after
// drilling into a queue. The old portal held all six sections in one component's
// useState, so no view had an address.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ShieldCheck, LayoutDashboard, Users, CreditCard, Activity, Megaphone, Inbox,
  TrendingUp, LogIn, LogOut, Settings, Search, CornerDownLeft, Loader2,
} from "lucide-react";
import { Badge, useDebounced, useLatest } from "./_ui";

const NAV = [
  { href: "/admin/owner", label: "Today", icon: LayoutDashboard, exact: true },
  { href: "/admin/owner/tenants", label: "Tenants", icon: Users },
  { href: "/admin/owner/revenue", label: "Revenue", icon: TrendingUp },
  { href: "/admin/owner/health", label: "Health", icon: Activity },
  { href: "/admin/owner/waitlist", label: "Waitlist", icon: Inbox },
  { href: "/admin/owner/plans", label: "Plans & pricing", icon: CreditCard },
  { href: "/admin/owner/platform", label: "Platform", icon: Megaphone },
];

export function OwnerShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // ⌘K / Ctrl-K from anywhere in the console. "/" too, unless the operator is
  // already typing into something.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? "");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault(); setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  return (
    <main className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-[1500px] flex flex-col md:flex-row md:gap-6 p-4 md:p-6">
        <aside className="md:w-56 shrink-0 md:sticky md:top-6 md:self-start">
          <div className="flex items-center gap-2 px-1 mb-3">
            <ShieldCheck className="w-5 h-5 text-brand-dark" />
            <span className="text-sm font-extrabold text-brand-dark">Owner Console</span>
          </div>

          <button onClick={() => setPaletteOpen(true)}
            className="w-full mb-3 flex items-center gap-2 rounded-control border border-line bg-white px-3 py-2 text-xs text-ink-400 hover:border-brand-500 transition-colors">
            <Search className="w-3.5 h-3.5" />
            <span className="flex-1 text-left">Find a tenant…</span>
            <kbd className="text-[10px] font-bold text-ink-400 bg-canvas border border-line rounded px-1">⌘K</kbd>
          </button>

          <nav className="flex md:flex-col gap-1 overflow-x-auto pb-2 md:pb-0">
            {NAV.map(n => {
              const A = n.icon;
              const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href}
                  className={`flex items-center gap-2 rounded-control px-3 py-2 text-xs font-bold whitespace-nowrap transition ${active ? "bg-ink-950 text-white" : "text-ink-600 hover:bg-white"}`}>
                  <A className="w-4 h-4 shrink-0" /> {n.label}
                </Link>
              );
            })}
          </nav>

          <div className="hidden md:flex flex-col gap-1 mt-4 pt-4 border-t border-line">
            <a href="/admin" className="flex items-center gap-2 rounded-control px-3 py-2 text-xs font-bold text-ink-600 hover:bg-white"><LogIn className="w-4 h-4" /> App dashboard</a>
            <a href="/admin/setup" className="flex items-center gap-2 rounded-control px-3 py-2 text-xs font-bold text-ink-600 hover:bg-white"><Settings className="w-4 h-4" /> System setup</a>
            <button onClick={async () => { await fetch("/api/admin/logout", { method: "POST" }).catch(() => {}); router.push("/login"); }}
              className="flex items-center gap-2 rounded-control px-3 py-2 text-xs font-bold text-ink-600 hover:bg-white"><LogOut className="w-4 h-4" /> Log out</button>
          </div>
        </aside>

        <div className="flex-1 min-w-0">{children}</div>
      </div>

      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </main>
  );
}

// ── Command palette ───────────────────────────────────────────────────────────
// The answer to "a support message just arrived, who is this?". One keystroke,
// type any fragment of a company, email, phone or slug, hit enter. Nothing in the
// product did this before — finding an account meant loading every tenant and
// filtering in the browser.

type Hit = { id: string; company: string | null; name: string; ownerEmail: string | null; plan: string; status: string };

function CommandPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(0);
  const debounced = useDebounced(q, 200);
  const latest = useLatest();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounced.trim().length < 2) { setHits([]); return; }
    const seq = latest.next();
    setBusy(true);
    fetch(`/api/owner/tenants?q=${encodeURIComponent(debounced)}&limit=8`)
      .then(r => r.json())
      .then(d => { if (latest.isCurrent(seq)) { setHits(d.tenants ?? []); setSel(0); } })
      .catch(() => { if (latest.isCurrent(seq)) setHits([]); })
      .finally(() => { if (latest.isCurrent(seq)) setBusy(false); });
  }, [debounced, latest]);

  const go = useCallback((h: Hit) => {
    router.push(`/admin/owner/tenants?open=${h.id}`);
    onClose();
  }, [router, onClose]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setSel(s => Math.min(s + 1, hits.length - 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
      if (e.key === "Enter" && hits[sel]) { e.preventDefault(); go(hits[sel]); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [hits, sel, go, onClose]);

  return (
    <div className="fixed inset-0 z-[70] bg-ink-950/40 flex items-start justify-center p-4 pt-[12vh] u-fade-in" onClick={onClose}>
      <div className="w-full max-w-xl bg-white rounded-card border border-line shadow-2xl overflow-hidden u-scale-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 border-b border-line">
          <Search className="w-4 h-4 text-ink-400 shrink-0" />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)}
            placeholder="Company, email, phone, or workspace slug…"
            className="flex-1 py-3.5 text-sm bg-transparent text-ink-900 placeholder:text-ink-400 outline-none" />
          {busy && <Loader2 className="w-4 h-4 animate-spin text-ink-400 shrink-0" />}
        </div>

        <div ref={listRef} className="max-h-80 overflow-y-auto">
          {q.trim().length < 2 && (
            <p className="px-4 py-6 text-[13px] text-ink-600">Type at least two characters. Searches company name, owner email, phone and slug.</p>
          )}
          {q.trim().length >= 2 && !busy && !hits.length && (
            <p className="px-4 py-6 text-[13px] text-ink-600">No tenant matches “{q.trim()}”.</p>
          )}
          {hits.map((h, i) => (
            <button key={h.id} onMouseEnter={() => setSel(i)} onClick={() => go(h)}
              className={`w-full text-left px-4 py-2.5 flex items-center gap-3 border-b border-line last:border-0 ${i === sel ? "bg-brand-50" : "hover:bg-canvas"}`}>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold text-ink-900 truncate">{h.company || h.name}</p>
                <p className="text-[11px] text-ink-600 truncate font-mono">{h.ownerEmail ?? "no email on file"}</p>
              </div>
              <Badge tone={h.status === "suspended" ? "bad" : h.status === "active" ? "ok" : "info"}>{h.plan}</Badge>
              {i === sel && <CornerDownLeft className="w-3.5 h-3.5 text-ink-400 shrink-0" />}
            </button>
          ))}
        </div>

        <div className="px-4 py-2 bg-canvas border-t border-line flex items-center gap-3 text-[10px] text-ink-400">
          <span><kbd className="font-bold">↑↓</kbd> move</span>
          <span><kbd className="font-bold">↵</kbd> open</span>
          <span><kbd className="font-bold">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
