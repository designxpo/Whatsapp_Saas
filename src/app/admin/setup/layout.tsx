// System setup describes how the platform itself is run: its migrations,
// environment variable names and connectivity. Only the platform owner sees
// it; anyone else is sent back to the portal. The APIs behind it re-check on
// their own, because a layout protects only what renders through it.

import { redirect } from "next/navigation";
import { isPlatformOwner } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SetupLayout({ children }: { children: React.ReactNode }) {
  if (!(await isPlatformOwner())) redirect("/admin");
  return children;
}
