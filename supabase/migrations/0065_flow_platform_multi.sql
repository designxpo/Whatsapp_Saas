-- A flow can now run on ANY combination of channels (checkbox multi-select), so
-- wa_flows.platform stores a comma-separated SET of kinds, e.g.
-- "whatsapp,messenger,webchat" — alongside the single values + legacy "both"/"all".
-- That open-ended set can't be a fixed-value CHECK, so drop the constraint; the
-- app (lib/flowengine.platformKinds) validates and expands the value.
alter table wa_flows drop constraint if exists wa_flows_platform_check;
