-- Defense-in-depth: enable Row Level Security on every application table.
--
-- The app connects with the Supabase SERVICE ROLE, which has BYPASSRLS — so
-- enabling RLS does NOT change app behaviour. What it DOES do is deny-by-default
-- for the anon / authenticated roles that back the public PostgREST API: with
-- RLS enabled and no permissive policy, a direct REST call using the project's
-- (public) anon key returns zero rows instead of leaking tenant data.
--
-- App-layer tenant scoping (.eq("tenant_id", tid) everywhere) remains the
-- primary guard; this is the backstop for accidental direct-API exposure.
--
-- Idempotent: guarded by to_regclass so re-running or missing tables is safe.

do $$
declare
  t text;
  tables text[] := array[
    'contacts','kb_chunks','kb_documents',
    'wa_activity_log','wa_ad_campaign_map','wa_ad_drafts','wa_ad_flow_triggers',
    'wa_ad_rules','wa_ai_agents','wa_ai_functions','wa_ai_prompts','wa_api_rules',
    'wa_campaigns','wa_carts','wa_channels','wa_conv_messages','wa_conversations',
    'wa_flow_sessions','wa_flows','wa_form_responses','wa_growth_tools',
    'wa_ig_comment_log','wa_ig_comment_rules','wa_ig_follow_gates','wa_links',
    'wa_login_attempts','wa_optouts','wa_orders','wa_portal_campaigns','wa_products',
    'wa_quick_replies','wa_router_events','wa_rule_sends','wa_scheduled_sends',
    'wa_semantic_cache','wa_send_log','wa_send_queue','wa_sequence_enrollments',
    'wa_sequence_steps','wa_sequences','wa_settings','wa_template_meta','wa_users',
    'wa_webhook_dedup'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security;', t);
    end if;
  end loop;
end $$;
