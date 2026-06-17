-- Custom product-card button. WhatsApp's NATIVE catalog card renders its own
-- button ("View") which Meta controls and we can't rename. To allow an editable
-- button, a product can also be sent as a CUSTOM card (image + body + a button
-- you label) — these two columns hold that label and its link. Both nullable;
-- when unset the catalog falls back to the native card behaviour.
alter table wa_products add column if not exists button_text text;
alter table wa_products add column if not exists button_url text;
