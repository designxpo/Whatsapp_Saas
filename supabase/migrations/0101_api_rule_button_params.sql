-- ── Per-message dynamic URL button parameters for API rules ───────────────────
-- An order-status notification's button ("Track your delivery", "View Order
-- Details") has to deep-link to THAT order, not a generic orders page. Meta
-- supports this: a template URL button declared as https://…/{{1}} takes a
-- parameter at send time.
--
--   {"type":"button","sub_type":"url","index":"0",
--    "parameters":[{"type":"text","text":"404-0952515-9776314"}]}
--
-- Each entry uses the SAME token syntax as `variables` ({{payload.order_id}},
-- {{contact.name}}, or a literal), and is resolved at event time alongside them.
-- Position in the array = the template's URL button index (0 = first).
--
-- Note: Meta REQUIRES a parameter for a {{1}} URL button. A template with one
-- and nothing to fill it is rejected at send time, which is why saveRule now
-- refuses that combination up front.

alter table wa_api_rules
  add column if not exists button_url_params jsonb not null default '[]'::jsonb;

-- Resolved values travel on the queued send, exactly like `variables` — the
-- payload that produced them may be hours stale by the time a delayed send
-- drains, and re-resolving then would silently substitute empty strings.
alter table wa_rule_sends
  add column if not exists button_url_params jsonb not null default '[]'::jsonb;

comment on column wa_api_rules.button_url_params is
  'Token-or-literal value per template URL button index, e.g. ["{{payload.order_id}}"]. Empty = template has no dynamic URL buttons.';
comment on column wa_rule_sends.button_url_params is
  'button_url_params resolved against the event payload at event time.';
