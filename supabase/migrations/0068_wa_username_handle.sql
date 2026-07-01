-- ── WhatsApp usernames (@handle) — identity groundwork ──────────────────────
-- A WhatsApp @handle is a NON-phone identity, exactly like an Instagram IGSID: we
-- key a conversation by it when the lead's number is hidden, then merge into their
-- numbered conversation once the number is known (mirrors the lead_phone pattern).
-- This adds the identity column + a per-tenant unique index. The whole username
-- feature stays dormant until the app writes handles (Track B, gated on Meta's
-- Cloud API exposing usernames), so this is safe to run ahead of that code.
--
-- Additive + idempotent.

alter table wa_conversations add column if not exists handle text;   -- WhatsApp @username, stored lowercased & without the leading @; null when unknown

-- One conversation per handle per tenant (partial: only rows that HAVE a handle).
create unique index if not exists wa_conversations_tenant_handle_idx
  on wa_conversations (tenant_id, lower(handle)) where handle is not null;
