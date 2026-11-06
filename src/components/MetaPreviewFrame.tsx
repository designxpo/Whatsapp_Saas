"use client";

import type { CSSProperties } from "react";
import { metaPreviewFrame } from "@/lib/meta-preview";

// Renders a Meta ad preview WITHOUT putting Meta's HTML into our origin: the
// Facebook preview iframe is rebuilt from its (validated) src. If the HTML has
// no such iframe, it is shown in an opaque-origin sandbox (scripts may run, but
// not as the portal — no allow-same-origin), so a preview still appears.
export function MetaPreviewFrame({ html, title, width, height, className, style }: {
  html: string; title: string;
  width?: number | string; height?: number | string;
  className?: string; style?: CSSProperties;
}) {
  const f = metaPreviewFrame(html);
  if (f) {
    return <iframe title={title} src={f.src} width={width} height={height} className={className} style={style} />;
  }
  return <iframe title={title} srcDoc={`<style>html,body{margin:0}</style>${html}`} width={width} height={height} className={className} style={style} sandbox="allow-scripts allow-popups" />;
}
