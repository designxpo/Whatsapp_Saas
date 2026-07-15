-- Multi-number flow scoping. Until now a flow could target at most ONE channel
-- (wa_flows.channel_id) OR every channel of its platform(s). Tenants running
-- several WhatsApp numbers (or IG/FB accounts) need to say "run this flow on
-- these specific numbers" — a set, not a single value.
--
-- channel_ids supersedes channel_id: NULL/empty = every channel of the flow's
-- platform(s) (unchanged default); a non-empty array = only those channels.
-- channel_id is kept in sync (single selection → that id, else null) so any
-- legacy reader still behaves. Backfill existing single-channel flows.
-- Column change is global; wa_flows rows stay tenant-scoped as before.

alter table wa_flows add column if not exists channel_ids text[];

comment on column wa_flows.channel_ids is
  'Channels (numbers/accounts) this flow runs on. NULL/empty = every channel of the flow''s platform(s). Supersedes the single channel_id.';

update wa_flows
set channel_ids = array[channel_id]
where channel_id is not null
  and (channel_ids is null or cardinality(channel_ids) = 0);
