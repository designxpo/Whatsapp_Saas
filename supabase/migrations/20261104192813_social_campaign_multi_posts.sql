-- Multi-post targeting. Keep the legacy field aligned for rolling deployments.
alter table public.wa_social_campaigns
 add column post_ids text[] not null default '{}';
update public.wa_social_campaigns set post_ids=array[post_id]
 where post_id is not null and btrim(post_id) <> '';
alter table public.wa_social_campaigns add constraint social_campaign_post_ids_valid
 check (cardinality(post_ids) <= 200 and array_position(post_ids,null) is null
        and (cardinality(post_ids)=0 or (array_ndims(post_ids)=1 and array_lower(post_ids,1)=1)));

create function public.sync_social_campaign_posts() returns trigger
 language plpgsql security invoker set search_path = '' as $$
begin
 if TG_OP='INSERT' then
   if cardinality(new.post_ids)>0 then new.post_id:=new.post_ids[1];
   elsif new.post_id is not null and btrim(new.post_id)<>'' then new.post_ids:=array[new.post_id];
   end if;
 elsif new.post_ids is distinct from old.post_ids then
   new.post_id:=new.post_ids[1];
 elsif new.post_id is distinct from old.post_id then
   new.post_ids:=case when new.post_id is null or btrim(new.post_id)='' then '{}'::text[] else array[new.post_id] end;
 end if;
 return new;
end;
$$;
revoke execute on function public.sync_social_campaign_posts() from public,anon,authenticated;
grant execute on function public.sync_social_campaign_posts() to service_role;
create trigger sync_social_campaign_posts before insert or update of post_id,post_ids
 on public.wa_social_campaigns for each row execute function public.sync_social_campaign_posts();
-- Existing tenant RLS and grants are unchanged. The existing active-account index
-- narrows candidates before the server checks post membership, so no GIN index is needed.
