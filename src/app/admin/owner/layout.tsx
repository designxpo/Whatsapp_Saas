import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { isPlatformOwner } from "@/lib/auth";
import { OwnerShell } from "./_shell";

export const dynamic = "force-dynamic";

// Guard the whole console in one place. Previously every section rendered first
// and each fetch discovered the 403 on its own, so a non-owner briefly saw the
// chrome of a portal they can't use.
export default async function OwnerLayout({ children }: { children: ReactNode }) {
  if (!(await isPlatformOwner())) redirect("/admin");
  return <OwnerShell>{children}</OwnerShell>;
}
