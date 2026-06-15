-- Mark conversations that originate from an Instagram COMMENT (the AI public-
-- reply flow) so the inbox can show them in a separate "Comments" section,
-- distinct from real DM chats. A DM interaction flips this back to false.
alter table wa_conversations add column if not exists is_comment boolean default false;
