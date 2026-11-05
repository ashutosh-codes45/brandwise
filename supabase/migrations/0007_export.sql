create table public.export_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  content_id uuid not null references public.contents(id) on delete cascade,
  version_id uuid references public.content_versions(id) on delete set null,
  platform text not null,
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index export_events_content_created_at_idx
  on public.export_events (content_id, created_at desc);

alter table public.export_events enable row level security;

create policy "export events: org members read"
on public.export_events
for select to authenticated
using (public.user_role(org_id) is not null);

revoke insert, update, delete on public.export_events from anon, authenticated;
grant select on public.export_events to authenticated;

create or replace function public.log_export(
  p_content uuid,
  p_platform text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_version uuid;
  v_export uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to record an export.';
  end if;

  select c.org_id
  into v_org
  from public.contents c
  where c.id = p_content
    and c.status = 'approved'
    and p_platform = any(c.platforms);

  if not found then
    raise exception 'Only approved content can be exported';
  end if;

  if public.user_role(v_org) is null then
    raise exception 'Only approved content can be exported';
  end if;

  select ce.version_id
  into v_version
  from public.content_events ce
  where ce.content_id = p_content
    and ce.org_id = v_org
    and ce.event = 'approved'
  order by ce.created_at desc
  limit 1;

  if v_version is null then
    raise exception 'No approved version is available for export.';
  end if;

  insert into public.export_events (
    org_id, content_id, version_id, platform, actor_id
  )
  values (
    v_org, p_content, v_version, p_platform, auth.uid()
  )
  returning id into v_export;

  return v_export;
end;
$$;

revoke all on function public.log_export(uuid, text) from public, anon;
grant execute on function public.log_export(uuid, text) to authenticated;

create or replace function public.list_export_events(p_content uuid)
returns table (
  id uuid,
  platform text,
  actor_email text,
  actor_role text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    ee.id,
    ee.platform,
    coalesce(u.email::text, 'Former user'),
    coalesce(m.role::text, 'former member'),
    ee.created_at
  from public.export_events ee
  left join auth.users u on u.id = ee.actor_id
  left join public.members m
    on m.user_id = ee.actor_id
   and m.org_id = ee.org_id
  where ee.content_id = p_content
    and public.user_role(ee.org_id) is not null
  order by ee.created_at desc;
$$;

revoke all on function public.list_export_events(uuid) from public, anon;
grant execute on function public.list_export_events(uuid) to authenticated;

notify pgrst, 'reload schema';
