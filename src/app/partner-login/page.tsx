// A partner's sign-in page. Reached only through middleware, which rewrites
// /login on a partner's address to this route, so Talko's own /login (a
// prebuilt static page) is never touched. Shows the same sign-in form, wrapped
// in the partner's brand; any other address gets a 404.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requestBrand } from "@/lib/brand-server";
import { partnerMetadata } from "@/lib/brand-metadata";
import { BrandProvider } from "@/components/BrandContext";
import LoginPage from "../login/page";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { brand } = await requestBrand();
  return brand.partnerId ? partnerMetadata(brand, "Sign in") : {};
}

export default async function PartnerLoginPage() {
  const { brand } = await requestBrand();
  if (!brand.partnerId) notFound();
  return <BrandProvider brand={brand}><LoginPage /></BrandProvider>;
}
