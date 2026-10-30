"use client";

// The brand a page shows. Defaults to Talko, so every page that never gets a
// provider (the marketing site, Talko's own login, the current portal) renders
// exactly as before; only a partner's portal wraps its pages in a provider.
import { createContext, useContext } from "react";
import { TALKO_BRAND, type Brand } from "@/lib/whitelabel";

const BrandContext = createContext<Brand>(TALKO_BRAND);

export function BrandProvider({ brand, children }: { brand: Brand; children: React.ReactNode }) {
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}

export function useBrand(): Brand {
  return useContext(BrandContext);
}
