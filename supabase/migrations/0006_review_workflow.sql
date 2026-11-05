alter table public.comments
  add column section_id uuid references public.content_sections(id) on delete cascade;

create index comments_content_created_at_idx
  on public.comments (content_id, created_at);

drop policy if exists "comments: members" on public.comments;

create policy "comments: org members read"
on public.comments
for select to authenticated
using (public.user_role(org_id) is not null);

create policy "comments: org members insert"
on public.comments
for insert to authenticated
with check (
  public.user_role(org_id) is not null
  and author_id = auth.uid()
  and not (section_id is not null and finding_id is not null)
  and exists (
    select 1
    from public.contents c
    where c.id = comments.content_id
      and c.org_id = comments.org_id
  )
  and (
    section_id is null
    or exists (
      select 1
      from public.content_sections cs
      where cs.id = comments.section_id
        and cs.content_id = comments.content_id
        and cs.org_id = comments.org_id
    )
  )
  and (
    finding_id is null
    or exists (
      select 1
      from public.findings f
      where f.id = comments.finding_id
        and f.content_id = comments.content_id
        and f.org_id = comments.org_id
    )
  )
);

create policy "comments: authors update"
on public.comments
for update to authenticated
using (
  public.user_role(org_id) is not null
  and author_id = auth.uid()
)
with check (
  public.user_role(org_id) is not null
  and author_id = auth.uid()
  and not (section_id is not null and finding_id is not null)
  and exists (
    select 1
    from public.contents c
    where c.id = comments.content_id
      and c.org_id = comments.org_id
  )
  and (
    section_id is null
    or exists (
      select 1
      from public.content_sections cs
      where cs.id = comments.section_id
        and cs.content_id = comments.content_id
        and cs.org_id = comments.org_id
    )
  )
  and (
    finding_id is null
    or exists (
      select 1
      from public.findings f
      where f.id = comments.finding_id
        and f.content_id = comments.content_id
        and f.org_id = comments.org_id
    )
  )
);

create policy "comments: authors delete"
on public.comments
for delete to authenticated
using (
  public.user_role(org_id) is not null
  and author_id = auth.uid()
);

create table public.content_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  content_id uuid not null references public.contents(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  event text not null check (
    event in ('submitted', 'changes_requested', 'approved', 'reopened')
  ),
  from_status public.content_status not null,
  to_status public.content_status not null,
  version_id uuid references public.content_versions(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create index content_events_content_created_at_idx
  on public.content_events (content_id, created_at desc);

alter table public.content_events enable row level security;

create policy "content events: org members read"
on public.content_events
for select to authenticated
using (public.user_role(org_id) is not null);

revoke insert, update, delete on public.content_events from anon, authenticated;

create or replace function public.guard_content_status_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status is distinct from old.status
     and current_setting('app.status_transition', true) is distinct from 'on' then
    raise exception 'Status can only change through transition_content';
  end if;
  return new;
end;
$$;

create trigger contents_status_transition_guard
before update on public.contents
for each row
execute function public.guard_content_status_transition();

create or replace function public.transition_content(
  p_content uuid,
  p_to public.content_status,
  p_note text default null
)
returns public.content_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_content public.contents%rowtype;
  v_role public.member_role;
  v_event text;
  v_version uuid;
  v_open_blockers integer;
  v_latest_run timestamptz;
  v_latest_version timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Sign in to change content status.';
  end if;

  select c.*
  into v_content
  from public.contents c
  where c.id = p_content
  for update;

  if not found then
    raise exception 'Content not found.';
  end if;

  v_role := public.user_role(v_content.org_id);
  if v_role is null then
    raise exception 'You are not a member of this organisation.';
  end if;

  if v_content.status in ('draft', 'changes_requested')
     and p_to = 'in_review'
     and v_content.created_by = auth.uid() then
    select max(rr.created_at)
    into v_latest_run
    from public.review_runs rr
    where rr.org_id = v_content.org_id
      and rr.content_id = v_content.id;

    select max(cv.created_at)
    into v_latest_version
    from public.content_versions cv
    where cv.org_id = v_content.org_id
      and cv.content_id = v_content.id;

    if v_latest_run is null
       or v_latest_version is null
       or v_latest_run <= v_latest_version then
      raise exception 'Run the AI review on the latest saved version first.';
    end if;
  end if;

  if v_content.status in ('draft', 'changes_requested')
     and p_to = 'in_review'
     and v_content.created_by = auth.uid() then
    select count(*)::integer
    into v_open_blockers
    from public.findings f
    where f.org_id = v_content.org_id
      and f.content_id = v_content.id
      and f.status = 'open'
      and f.severity = 'blocker';
    if v_open_blockers > 0
       and p_note is distinct from
           format('Submitted with %s open blockers', v_open_blockers) then
      raise exception 'Acknowledge the % open blocker(s) before submitting.', v_open_blockers;
    end if;
    v_event := 'submitted';
  elsif v_content.status = 'in_review'
     and p_to = 'changes_requested'
     and v_role in ('reviewer', 'brand_manager') then
    if nullif(btrim(p_note), '') is null then
      raise exception 'Add a note explaining the requested changes.';
    end if;
    v_event := 'changes_requested';
  elsif v_content.status = 'in_review'
     and p_to = 'approved'
     and v_role = 'brand_manager' then
    select count(*)::integer
    into v_open_blockers
    from public.findings f
    where f.org_id = v_content.org_id
      and f.content_id = v_content.id
      and f.status = 'open'
      and f.severity = 'blocker';
    if v_open_blockers > 0
       and p_note is distinct from
           format('Approved with %s open blockers', v_open_blockers) then
      raise exception 'Acknowledge the % open blocker(s) before approval.', v_open_blockers;
    end if;
    v_event := 'approved';
  elsif v_content.status = 'approved'
     and p_to = 'draft'
     and v_role = 'brand_manager' then
    if nullif(btrim(p_note), '') is null then
      raise exception 'Add a note explaining why the content is being reopened.';
    end if;
    v_event := 'reopened';
  else
    raise exception 'This status transition is not allowed for your role.';
  end if;

  select cv.id
  into v_version
  from public.content_versions cv
  where cv.org_id = v_content.org_id
    and cv.content_id = v_content.id
  order by cv.created_at desc
  limit 1;

  perform set_config('app.status_transition', 'on', true);

  update public.contents
  set status = p_to,
      updated_at = now()
  where id = v_content.id;

  insert into public.content_events (
    org_id,
    content_id,
    actor_id,
    event,
    from_status,
    to_status,
    version_id,
    note
  )
  values (
    v_content.org_id,
    v_content.id,
    auth.uid(),
    v_event,
    v_content.status,
    p_to,
    v_version,
    nullif(btrim(p_note), '')
  );

  return p_to;
end;
$$;

revoke all on function public.transition_content(uuid, public.content_status, text)
  from public, anon;
grant execute on function public.transition_content(uuid, public.content_status, text)
  to authenticated;

drop policy if exists "sections: members" on public.content_sections;

create policy "sections: org members read"
on public.content_sections
for select to authenticated
using (public.user_role(org_id) is not null);

create policy "sections: creators insert editable content"
on public.content_sections
for insert to authenticated
with check (
  public.user_role(org_id) = 'creator'
  and exists (
    select 1
    from public.contents c
    where c.id = content_sections.content_id
      and c.org_id = content_sections.org_id
      and c.created_by = auth.uid()
      and c.status in ('draft', 'changes_requested')
  )
);

create policy "sections: creators update editable content"
on public.content_sections
for update to authenticated
using (
  public.user_role(org_id) = 'creator'
  and exists (
    select 1
    from public.contents c
    where c.id = content_sections.content_id
      and c.org_id = content_sections.org_id
      and c.created_by = auth.uid()
      and c.status in ('draft', 'changes_requested')
  )
)
with check (
  public.user_role(org_id) = 'creator'
  and exists (
    select 1
    from public.contents c
    where c.id = content_sections.content_id
      and c.org_id = content_sections.org_id
      and c.created_by = auth.uid()
      and c.status in ('draft', 'changes_requested')
  )
);

create policy "sections: creators delete editable content"
on public.content_sections
for delete to authenticated
using (
  public.user_role(org_id) = 'creator'
  and exists (
    select 1
    from public.contents c
    where c.id = content_sections.content_id
      and c.org_id = content_sections.org_id
      and c.created_by = auth.uid()
      and c.status in ('draft', 'changes_requested')
  )
);

create or replace function public.list_content_comments(p_content uuid)
returns table (
  id uuid,
  org_id uuid,
  content_id uuid,
  section_id uuid,
  finding_id uuid,
  author_id uuid,
  body text,
  created_at timestamptz,
  author_email text,
  author_role text
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    cm.id,
    cm.org_id,
    cm.content_id,
    cm.section_id,
    cm.finding_id,
    cm.author_id,
    cm.body,
    cm.created_at,
    coalesce(u.email::text, 'Former user'),
    coalesce(m.role::text, 'former member')
  from public.comments cm
  join public.contents c
    on c.id = cm.content_id
   and c.org_id = cm.org_id
  join auth.users u on u.id = cm.author_id
  left join public.members m
    on m.org_id = cm.org_id
   and m.user_id = cm.author_id
  where cm.content_id = p_content
    and public.user_role(c.org_id) is not null
  order by cm.created_at asc;
$$;

create or replace function public.list_content_events(p_content uuid)
returns table (
  id uuid,
  org_id uuid,
  content_id uuid,
  actor_id uuid,
  event text,
  from_status public.content_status,
  to_status public.content_status,
  version_id uuid,
  note text,
  created_at timestamptz,
  actor_email text,
  actor_role text
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    ce.id,
    ce.org_id,
    ce.content_id,
    ce.actor_id,
    ce.event,
    ce.from_status,
    ce.to_status,
    ce.version_id,
    ce.note,
    ce.created_at,
    coalesce(u.email::text, 'Former user'),
    coalesce(m.role::text, 'former member')
  from public.content_events ce
  join public.contents c
    on c.id = ce.content_id
   and c.org_id = ce.org_id
  join auth.users u on u.id = ce.actor_id
  left join public.members m
    on m.org_id = ce.org_id
   and m.user_id = ce.actor_id
  where ce.content_id = p_content
    and public.user_role(c.org_id) is not null
  order by ce.created_at desc;
$$;

create or replace function public.list_review_queue(p_status public.content_status)
returns table (
  id uuid,
  title text,
  status public.content_status,
  platforms text[],
  creator_email text,
  updated_at timestamptz,
  submitted_at timestamptz,
  open_blockers bigint,
  comment_count bigint
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to view the review queue.';
  end if;
  if not exists (
    select 1
    from public.members m
    where m.user_id = auth.uid()
      and m.role in ('reviewer', 'brand_manager')
  ) then
    raise exception 'Only Reviewers and Brand Managers can view the review queue.';
  end if;
  if p_status not in ('in_review', 'changes_requested', 'approved') then
    raise exception 'Select a valid review queue status.';
  end if;

  return query
  select
    c.id,
    c.title,
    c.status,
    c.platforms,
    u.email::text,
    c.updated_at,
    (select max(ce.created_at)
     from public.content_events ce
     where ce.content_id = c.id
       and ce.event = 'submitted'),
    (select count(*)
     from public.findings f
     where f.content_id = c.id
       and f.status = 'open'
       and f.severity = 'blocker'),
    (select count(*)
     from public.comments cm
     where cm.content_id = c.id)
  from public.contents c
  join public.members caller
    on caller.org_id = c.org_id
   and caller.user_id = auth.uid()
  join auth.users u on u.id = c.created_by
  where c.status = p_status
    and caller.role in ('reviewer', 'brand_manager')
  order by c.updated_at desc;
end;
$$;

revoke all on function public.list_content_comments(uuid) from public, anon;
revoke all on function public.list_content_events(uuid) from public, anon;
revoke all on function public.list_review_queue(public.content_status) from public, anon;
grant execute on function public.list_content_comments(uuid) to authenticated;
grant execute on function public.list_content_events(uuid) to authenticated;
grant execute on function public.list_review_queue(public.content_status) to authenticated;

notify pgrst, 'reload schema';
