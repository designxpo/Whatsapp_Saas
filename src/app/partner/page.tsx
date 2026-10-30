import { redirect } from "next/navigation";
import { currentPartner } from "@/lib/partner-portal";
import { PartnerDashboard } from "./_dashboard";

export const dynamic = "force-dynamic";

export default async function PartnerHome() {
  // middleware already required a partner session cookie; this checks it is
  // still live and belongs to this address.
  if (!(await currentPartner())) redirect("/partner/login");
  return <PartnerDashboard />;
}
