-- One-time data repair: contact/conversation names that are clearly not names.
-- Before the looksLikeName gate (shipped with 0070-era code), a chat-form name
-- field accepted ANY text — whole inquiry paragraphs became display names
-- ("Hi Team, thanks for your response. Please connect with our Strategy…").
-- Real names fit comfortably in 60 chars (the same cutoff the gate now uses).
--
-- contacts.name is NOT NULL, so junk becomes the name captured in the
-- contact's own attributes when a sane one exists (the chat-form saved it
-- there too), else '' — the app's "no name yet" value (landCapturedLead
-- fills an empty name from the next chat). Conversations allow null, and a
-- null name self-heals from the next profile fetch / message. Applies
-- across all tenants (junk is junk regardless of workspace). Idempotent.

update contacts
set name = case
  when length(trim(coalesce(attributes->>'name', ''))) between 1 and 60
    then trim(attributes->>'name')
  else ''
end
where length(name) > 60;

update wa_conversations set name = null
where name is not null and length(name) > 60;
