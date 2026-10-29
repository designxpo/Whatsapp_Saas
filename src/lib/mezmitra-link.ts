import crypto from "crypto";
import { createApiKey, revokeApiKey } from "./apikeys";
import { createIntegration, getIntegrationSecret, listIntegrations, verifyIntegration, type Integration } from "./integrations";
import { completeLink, LINK_KEY_RE, mezmitraBase, unlink, whoami } from "./mezmitra";
import { getTenant } from "./tenants";
import { errorMessage } from "./errors";

// Linking a tenant's Talko workspace with its Mezmitra restaurant, both ways, in
// one paste. The owner makes a link key in Mezmitra (shown once) and pastes it
// here. Then:
//   1. Mezmitra confirms the key and that it is still waiting to be linked.
//   2. We mint a Talko API key just for Mezmitra (so it can send /api/events)
//      and a random secret we sign opt-out webhooks with.
//   3. Mezmitra stores both (encrypted) and marks the link active. It accepts
//      this exactly once per key, so a leaked key cannot re-point events.
//   4. We save the connection; the key is encrypted at rest like every secret.
// Any failure undoes what was done, so a half-made link never lingers.

type ConnectResult = { ok: true; integration: Integration } | { ok: false; status: number; error: string };

export async function connectMezmitra(tenantId: string, key: string): Promise<ConnectResult> {
  if (!mezmitraBase()) return { ok: false, status: 400, error: "The Mezmitra link isn't set up on this server yet." };
  if (!LINK_KEY_RE.test(key)) return { ok: false, status: 400, error: "Paste the whole link key from Mezmitra — it starts with mzk_." };
  const existing = (await listIntegrations(tenantId)).find(i => i.kind === "mezmitra");
  if (existing) return { ok: false, status: 409, error: "This workspace is already linked to Mezmitra. Remove that connection first." };

  const who = await whoami(key);
  if (!who.ok) {
    return { ok: false, status: 400, error: who.status === 401 ? "Mezmitra didn't accept that key. Keys work for one day and only once — make a new one in Mezmitra." : who.message };
  }
  if (who.data.link.status !== "pending") return { ok: false, status: 400, error: "That key was already used. Make a new one in Mezmitra (Settings → Talko AI)." };

  const tenant = await getTenant(tenantId).catch(() => null);
  const account = (tenant?.name || "Talko AI workspace").slice(0, 120);
  const { key: apiKey, row } = await createApiKey(tenantId, `Mezmitra link (${who.data.tenant.name})`.slice(0, 80));
  const webhookSecret = crypto.randomBytes(32).toString("base64url");
  try {
    const linked = await completeLink(key, { apiKey, webhookSecret, account });
    if (!linked.ok) throw new Error(linked.message);
    const webhookPath = String(linked.data.webhook_path ?? "");
    if (!/^\/v1\/talko\/webhooks\/[0-9a-f-]{36}$/.test(webhookPath)) throw new Error("Mezmitra answered with an unexpected webhook address.");
    try {
      const { integration } = await createIntegration({
        kind: "mezmitra",
        name: `Mezmitra — ${who.data.tenant.name}`.slice(0, 120),
        config: { mezmitraTenant: who.data.tenant.name, apiKeyId: row.id, webhookPath, defaultOutletId: null },
        events: ["contact.optout"],
        secret: key,
        webhookSecret,
      }, tenantId);
      await verifyIntegration(integration.id, tenantId).catch(() => undefined);
      return { ok: true, integration };
    } catch (err) {
      // Mezmitra holds our key now: take it back and drop the link there too.
      await unlink(key).catch(() => undefined);
      throw err;
    }
  } catch (err) {
    await revokeApiKey(row.id, tenantId).catch(() => undefined);
    return { ok: false, status: 502, error: `Couldn't finish linking: ${errorMessage(err)}`.slice(0, 300) };
  }
}

// Removing the connection: revoke the API key Mezmitra holds (it can no longer
// send events) and tell Mezmitra to drop the link (our key stops working).
// Best-effort on Mezmitra's side — the revoke here is what matters.
export async function disconnectMezmitra(tenantId: string, integration: Integration): Promise<void> {
  const apiKeyId = String(integration.config.apiKeyId ?? "");
  if (apiKeyId) await revokeApiKey(apiKeyId, tenantId).catch(() => undefined);
  const key = await getIntegrationSecret(integration.id, tenantId).catch(() => null);
  if (key) await unlink(key).catch(() => undefined);
}
