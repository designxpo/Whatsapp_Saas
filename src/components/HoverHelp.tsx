"use client";

import { useEffect } from "react";
import { installHoverHelp } from "@/lib/hover-help";

export function HoverHelp({ scope }: { scope: string }) {
  useEffect(() => installHoverHelp(), [scope]);
  return null;
}
