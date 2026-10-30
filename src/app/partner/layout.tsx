// The partner dashboard (white-label, Phase 3): where a partner's own staff
// manage their customers, at `<slug>.<base>/partner`. Exists only on a
// partner's address; anywhere else it is a 404 (middleware.ts also keeps it
// off Talko's hosts). Everything inside shows the partner's brand.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requestBrand } from "@/lib/brand-server";
import { partnerMetadata } from "@/lib/brand-metadata";
import { BrandProvider } from "@/components/BrandContext";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { brand } = await requestBrand();
  return brand.partnerId ? partnerMetadata(brand, "Partner dashboard") : {};
}

export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const { brand } = await requestBrand();
  if (!brand.partnerId) notFound();
  return <BrandProvider brand={brand}>{children}</BrandProvider>;
}
