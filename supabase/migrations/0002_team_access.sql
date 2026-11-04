create table public.invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  code text not null unique,
  role public.member_role not null check (role in ('creator', 'reviewer')),
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by uuid references auth.users(id),
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.invites enable row level security;

create policy "invites: managers read" on public.invites
  for select to authenticated
  using (public.user_role(org_id) = 'brand_manager');

create policy "invites: managers create" on public.invites
  for insert to authenticated
  with check (
    public.user_role(org_id) = 'brand_manager'
    and created_by = auth.uid()
  );

create policy "invites: managers delete" on public.invites
  for delete to authenticated
  using (public.user_role(org_id) = 'brand_manager');

create function public.list_members(org uuid)
returns table (user_id uuid, email text, role public.member_role)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.members m
    where m.org_id = org
      and m.user_id = auth.uid()
      and m.role = 'brand_manager'
  ) then
    raise exception 'Only a Brand Manager can list organisation members.';
  end if;

  return query
    select m.user_id, u.email::text, m.role
    from public.members m
    join auth.users u on u.id = m.user_id
    where m.org_id = org
    order by u.email;
end;
$$;

create function public.add_member_by_email(
  org uuid,
  member_email text,
  member_role public.member_role
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_user_id uuid;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.members m
    where m.org_id = org
      and m.user_id = auth.uid()
      and m.role = 'brand_manager'
  ) then
    raise exception 'Only a Brand Manager can add organisation members.';
  end if;

  select u.id into target_user_id
  from auth.users u
  where lower(u.email) = lower(trim(member_email))
  limit 1;

  if target_user_id is null then
    raise exception 'No account found. Ask them to sign up first, or send an invite code.';
  end if;

  insert into public.members (org_id, user_id, role)
  values (org, target_user_id, member_role)
  on conflict (org_id, user_id)
  do update set role = excluded.role;
end;
$$;

create function public.create_invite(
  org uuid,
  invite_role public.member_role
)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  invite_code text;
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  index integer;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.members m
    where m.org_id = org
      and m.user_id = auth.uid()
      and m.role = 'brand_manager'
  ) then
    raise exception 'Only a Brand Manager can create invite codes.';
  end if;

  if invite_role not in ('creator', 'reviewer') then
    raise exception 'Invite codes can only grant the Creator or Reviewer role.';
  end if;

  loop
    invite_code := '';
    for index in 1..8 loop
      invite_code := invite_code
        || substr(alphabet, floor(random() * length(alphabet))::integer + 1, 1);
    end loop;

    insert into public.invites (org_id, code, role, created_by)
    values (org, invite_code, invite_role, auth.uid())
    on conflict (code) do nothing;

    exit when found;
  end loop;

  return invite_code;
end;
$$;

create function public.redeem_invite(invite_code text)
returns public.member_role
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  invite_record public.invites%rowtype;
  redeemer_id uuid := auth.uid();
begin
  if redeemer_id is null then
    raise exception 'Sign in before redeeming an invite code.';
  end if;

  select i.* into invite_record
  from public.invites i
  where upper(i.code) = upper(trim(invite_code))
  for update;

  if not found then
    raise exception 'Invite code is invalid.';
  end if;
  if invite_record.used_at is not null or invite_record.used_by is not null then
    raise exception 'Invite code has already been used.';
  end if;
  if invite_record.expires_at <= now() then
    raise exception 'Invite code has expired.';
  end if;

  insert into public.members (org_id, user_id, role)
  values (invite_record.org_id, redeemer_id, invite_record.role);

  update public.invites
  set used_by = redeemer_id, used_at = now()
  where id = invite_record.id;

  return invite_record.role;
end;
$$;

create function public.prevent_last_brand_manager_removal()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  other_manager_count integer;
begin
  if old.role <> 'brand_manager' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE'
    and new.org_id = old.org_id
    and new.role = 'brand_manager' then
    return new;
  end if;

  perform 1
  from public.organisations o
  where o.id = old.org_id
  for update;

  if not found then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  select count(*) into other_manager_count
  from public.members m
  where m.org_id = old.org_id
    and m.role = 'brand_manager'
    and m.user_id <> old.user_id;

  if other_manager_count = 0 then
    raise exception 'An organisation must have at least one Brand Manager.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger prevent_last_brand_manager_removal
before update or delete on public.members
for each row
execute function public.prevent_last_brand_manager_removal();

revoke all on function public.list_members(uuid) from public, anon;
revoke all on function public.add_member_by_email(uuid, text, public.member_role) from public, anon;
revoke all on function public.create_invite(uuid, public.member_role) from public, anon;
revoke all on function public.redeem_invite(text) from public, anon;
grant execute on function public.list_members(uuid) to authenticated;
grant execute on function public.add_member_by_email(uuid, text, public.member_role) to authenticated;
grant execute on function public.create_invite(uuid, public.member_role) to authenticated;
grant execute on function public.redeem_invite(text) to authenticated;
