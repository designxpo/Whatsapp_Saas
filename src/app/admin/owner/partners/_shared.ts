// Shapes and labels shared by the Partners page and its drawer.
import type { Tone } from "../_ui";

export type PartnerKind = "private" | "reseller";
export type PartnerTier = "standard" | "pro";
export type PartnerStatus = "onboarding" | "active" | "paused" | "closed";
export type PartnerRow = {
  id: string; name: string; slug: string; kind: PartnerKind; tier: PartnerTier; status: PartnerStatus;
  contactName: string | null; contactEmail: string | null; contactPhone: string | null;
  allowedPlans: string[]; setupFeeCents: number; monthlyFeeCents: number; depositCents: number;
  wholesalePct: number | null; graceDays: number; notes: string | null; createdAt: string; workspaceCount?: number;
};

export const KIND_LABEL: Record<PartnerKind, string> = { private: "Private Label", reseller: "Reseller" };
export const STATUS_TONE: Record<PartnerStatus, Tone> = { onboarding: "info", active: "ok", paused: "warn", closed: "muted" };
