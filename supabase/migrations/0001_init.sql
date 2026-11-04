-- Extensions
create extension if not exists vector;

-- Enums
create type member_role as enum ('creator', 'reviewer', 'brand_manager');
create type vault_kind as enum ('guideline', 'fact', 'term', 'asset');
create type content_status as enum ('draft', 'in_review', 'changes_requested', 'approved');
create type finding_status as enum ('open', 'applied', 'dismissed');

-- Organisations and members
create table organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table members (
  org_id uuid not null references organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role member_role not null default 'creator',
  primary key (org_id, user_id)
);

-- Helper: current user's role in an org (security definer avoids RLS recursion)
create or replace function public.user_role(org uuid)
returns member_role
language sql stable security definer set search_path = public as $$
  select role from members where org_id = org and user_id = auth.uid()
$$;

-- Creator of an org becomes its Brand Manager
create or replace function public.add_creator_as_manager()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into members (org_id, user_id, role)
  values (new.id, new.created_by, 'brand_manager');
  return new;
end $$;

create trigger on_org_created
after insert on organisations
for each row execute function public.add_creator_as_manager();

-- Vault (guidelines, approved facts, terms, assets)
create table vault_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id) on delete cascade,
  kind vault_kind not null,
  title text not null,
  body text,
  asset_path text,
  owner text,
  valid_until date,
  is_confidential boolean not null default false,
  embedding vector(1536),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Content workspace
create table contents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id) on delete cascade,
  title text not null,
  status content_status not null default 'draft',
  platforms text[] not null default '{}',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table content_sections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id) on delete cascade,
  content_id uuid not null references contents(id) on delete cascade,
  position int not null default 0,
  type text not null check (type in ('text', 'image')),
  body text,
  image_path text
);

create table content_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id) on delete cascade,
  content_id uuid not null references contents(id) on delete cascade,
  snapshot jsonb not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Findings and comments
create table findings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id) on delete cascade,
  content_id uuid not null references contents(id) on delete cascade,
  section_id uuid references content_sections(id) on delete cascade,
  category text not null,
  severity text not null,
  excerpt text,
  reason text not null,
  source_item_id uuid references vault_items(id) on delete set null,
  source_label text,
  suggestion text,
  status finding_status not null default 'open',
  dismiss_reason text,
  created_at timestamptz not null default now()
);

create table comments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id) on delete cascade,
  content_id uuid not null references contents(id) on delete cascade,
  finding_id uuid references findings(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  body text not null,
  created_at timestamptz not null default now()
);

-- Correction history (used to recommend fixes from the 2nd occurrence)
create table corrections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id) on delete cascade,
  category text not null,
  original_text text not null,
  suggested_text text,
  final_text text,
  outcome text not null check (outcome in ('applied', 'edited', 'rejected')),
  reviewer_note text,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

-- Row Level Security
alter table organisations     enable row level security;
alter table members           enable row level security;
alter table vault_items       enable row level security;
alter table contents          enable row level security;
alter table content_sections  enable row level security;
alter table content_versions  enable row level security;
alter table findings          enable row level security;
alter table comments          enable row level security;
alter table corrections       enable row level security;

create policy "org: members read" on organisations
  for select using (user_role(id) is not null);
create policy "org: anyone signed in can create" on organisations
  for insert with check (created_by = auth.uid());

create policy "members: read own org" on members
  for select using (user_role(org_id) is not null);
create policy "members: manager manages" on members
  for all using (user_role(org_id) = 'brand_manager')
  with check (user_role(org_id) = 'brand_manager');

-- Vault: only the Brand Manager writes; confidential rows only visible to them
create policy "vault: read" on vault_items
  for select using (
    user_role(org_id) = 'brand_manager'
    or (user_role(org_id) is not null and not is_confidential)
  );
create policy "vault: manager writes" on vault_items
  for all using (user_role(org_id) = 'brand_manager')
  with check (user_role(org_id) = 'brand_manager');

-- Contents
create policy "contents: members read" on contents
  for select using (user_role(org_id) is not null);
create policy "contents: members create" on contents
  for insert with check (user_role(org_id) is not null and created_by = auth.uid());
create policy "contents: owner or reviewers update" on contents
  for update using (
    created_by = auth.uid() or user_role(org_id) in ('reviewer', 'brand_manager')
  );

-- Child tables: members of the org
create policy "sections: members" on content_sections
  for all using (user_role(org_id) is not null) with check (user_role(org_id) is not null);
create policy "versions: members" on content_versions
  for all using (user_role(org_id) is not null) with check (user_role(org_id) is not null);
create policy "findings: members" on findings
  for all using (user_role(org_id) is not null) with check (user_role(org_id) is not null);
create policy "comments: members" on comments
  for all using (user_role(org_id) is not null) with check (user_role(org_id) is not null);
create policy "corrections: members" on corrections
  for all using (user_role(org_id) is not null) with check (user_role(org_id) is not null);