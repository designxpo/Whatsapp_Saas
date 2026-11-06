"use client";

// Keeps one broken screen from taking down the whole portal. If a tab throws
// while rendering, the menu stays and this card replaces only that tab, with
// the error's message (so it can be reported) and a way out. A failure to load
// the screen's code after a deploy reloads the page once instead (chunk-reload.ts).

import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { isChunkLoadError, reloadForNewDeploy } from "@/lib/chunk-reload";

type Props = { children?: ReactNode; title: string; onHome?: () => void };
type State = { error: Error | null; reloading: boolean };

export class TabErrorBoundary extends Component<Props, State> {
  state: State = { error: null, reloading: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error) {
    if (isChunkLoadError(error) && reloadForNewDeploy()) { this.setState({ reloading: true }); return; }
    console.error("[portal] screen crashed:", error);
  }

  render() {
    const { error, reloading } = this.state;
    if (!error) return this.props.children;
    const chunk = isChunkLoadError(error);
    return (
      <div role="alert" className="mx-auto mt-6 max-w-xl space-y-3 rounded-card border border-amber-200 bg-amber-50 p-5 text-amber-950">
        <p className="flex items-center gap-2 text-sm font-bold"><AlertTriangle className="h-4 w-4" />
          {reloading ? "Updating to the latest version…" : chunk ? "Talko was just updated" : `${this.props.title} couldn't open`}
        </p>
        <p className="text-[13px]">
          {chunk ? "This page was opened before the latest update. Reload to continue — nothing you saved is lost."
            : "Something went wrong showing this screen. The rest of the portal still works. Reload to try again; if it keeps happening, send us the message below."}
        </p>
        {!chunk && <p className="break-words rounded-control bg-white/70 px-3 py-2 font-mono text-[11px] text-amber-900">{error.message || String(error)}</p>}
        <div className="flex flex-wrap gap-2">
          <button onClick={() => window.location.reload()} className="inline-flex items-center gap-1.5 rounded-control bg-amber-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-800"><RefreshCw className="h-3.5 w-3.5" /> Reload</button>
          {this.props.onHome && <button onClick={() => { this.setState({ error: null }); this.props.onHome!(); }} className="rounded-control border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-100">Go to Home</button>}
        </div>
      </div>
    );
  }
}
