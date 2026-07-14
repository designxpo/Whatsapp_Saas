-- One-time data repair: contact/conversation names that are clearly not names.
-- Before the looksLikeName gate (shipped with 0070-era code), a chat-form name
-- field accepted ANY text — whole inquiry paragraphs became display names
-- ("Hi Team, thanks for your response. Please connect with our Strategy…").
-- Real names fit comfortably in 60 chars (the same cutoff the gate now uses);
-- longer values are junk. Nulling lets the next inbound message / profile
-- fetch / form answer repopulate them correctly. Applies across all tenants
-- (junk is junk regardless of workspace). Idempotent.

update contacts set name = null
where name is not null and length(name) > 60;

update wa_conversations set name = null
where name is not null and length(name) > 60;
