-- Custom contact attributes (free-form key/value) for personalization and
-- segmentation beyond tags. Example: {"city":"Mumbai","plan":"pro","ltv":"high"}

alter table contacts add column if not exists attributes jsonb not null default '{}';
create index if not exists contacts_attributes_idx on contacts using gin (attributes);
