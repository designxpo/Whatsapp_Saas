import { getAutoSend, scheduleSend, type AutoTrigger } from "./store";

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
}): Promise<boolean> {
  if (!params.phone?.trim()) return false;
  const config = await getAutoSend(params.trigger, params.triggerKey);
  if (!config) return false;
  const sendAfter = new Date(Date.now() + delayMs(config.delayValue, config.delayUnit)).toISOString();
  await scheduleSend({
    campaignId: config.id,
    contactId: params.contactId,
    phone: params.phone,
    recipientName: params.name,
    trigger: params.trigger,
    sendAfter,
  });
  return true;
}
