import { getAutoSend, scheduleSend, type AutoTrigger } from "./store";

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";

function delayMs(value: number, unit: "minutes" | "hours" | "days"): number {
  const mult = unit === "days" ? 86_400_000 : unit === "hours" ? 3_600_000 : 60_000;
  return Math.max(0, value) * mult;
}

// Fires an event-triggered automation for one contact: if a matching enabled
// auto-send config exists, enqueue a per-recipient scheduled send (after delay).
export async function fireTrigger(params: {
  trigger: AutoTrigger;
  triggerKey: string | null;
  contactId: string | null;
  phone: string;
  name: string;
}, tenantId = DEFAULT_TENANT_ID): Promise<boolean> {
  if (!params.phone?.trim()) return false;
  const config = await getAutoSend(params.trigger, params.triggerKey, tenantId);
  if (!config) return false;
  const sendAfter = new Date(Date.now() + delayMs(config.delayValue, config.delayUnit)).toISOString();
  await scheduleSend({
    campaignId: config.id,
    contactId: params.contactId,
    phone: params.phone,
    recipientName: params.name,
    trigger: params.trigger,
    sendAfter,
  }, tenantId);
  return true;
}
