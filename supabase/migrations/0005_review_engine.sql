alter type public.finding_status
  add value if not exists 'superseded';

create table public.review_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  content_id uuid not null references public.contents(id) on delete cascade,
  triggered_by uuid references auth.users(id),
  model text not null,
  prompt_version text not null,
  retrieved jsonb not null default '[]'::jsonb,
  raw_output jsonb,
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.review_runs enable row level security;

create policy "review runs: members read"
on public.review_runs
for select to authenticated
using (
  public.user_role(org_id) is not null
);

create policy "review runs: members insert"
on public.review_runs
for insert to authenticated
with check (
  public.user_role(org_id) = 'creator'
  and triggered_by = auth.uid()
  and exists (
    select 1
    from public.contents c
    where c.id = review_runs.content_id
      and c.org_id = review_runs.org_id
      and c.created_by = auth.uid()
  )
);

alter table public.findings
  add column run_id uuid references public.review_runs(id) on delete set null,
  add column origin text check (origin in ('rule', 'ai')),
  add column rule_id text,
  add column confidence numeric,
  add column source_quote text,
  add column source_confidential boolean not null default false,
  add column suggestion_origin text not null default 'ai'
    check (suggestion_origin in ('ai', 'correction_history', 'human')),
  add column recommended_from_correction_id uuid
    references public.corrections(id) on delete set null;

alter table public.corrections
  add column finding_id uuid references public.findings(id) on delete set null,
  add column edited_by text check (edited_by in ('ai', 'human', 'mixed')),
  add column source_item_id uuid references public.vault_items(id) on delete set null,
  add column source_confidential boolean not null default false;

update public.findings f
set source_confidential = v.is_confidential
from public.vault_items v
where f.source_item_id = v.id;

update public.corrections c
set source_confidential = v.is_confidential
from public.vault_items v
where c.source_item_id = v.id;

create table public.finding_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organisations(id) on delete cascade,
  finding_id uuid not null references public.findings(id) on delete cascade,
  actor_id uuid references auth.users(id),
  actor_type text not null check (actor_type in ('system', 'ai', 'human')),
  event text not null check (
    event in (
      'raised',
      'refine_requested',
      'refined',
      'applied',
      'edited_then_applied',
      'dismissed',
      'reopened'
    )
  ),
  prompt text,
  before_text text,
  after_text text,
  note text,
  created_at timestamptz not null default now()
);

alter table public.finding_events enable row level security;

create policy "finding events: members read"
on public.finding_events
for select to authenticated
using (
  public.user_role(org_id) is not null
  and (
    public.user_role(org_id) = 'brand_manager'
    or exists (
      select 1
      from public.findings f
      where f.id = finding_events.finding_id
    )
  )
);

create policy "finding events: members insert"
on public.finding_events
for insert to authenticated
with check (
  public.user_role(org_id) = 'creator'
  and (actor_id is null or actor_id = auth.uid())
  and exists (
    select 1
    from public.findings f
    join public.contents c
      on c.id = f.content_id
     and c.org_id = f.org_id
    where f.id = finding_events.finding_id
      and f.org_id = finding_events.org_id
      and c.created_by = auth.uid()
  )
);

revoke update, delete on public.finding_events from authenticated;

drop policy if exists "findings: members" on public.findings;

create policy "findings: members read safe sources"
on public.findings
for select to authenticated
using (
  public.user_role(org_id) is not null
  and (
    public.user_role(org_id) = 'brand_manager'
    or not source_confidential
  )
);

create policy "findings: members create"
on public.findings
for insert to authenticated
with check (
  public.user_role(org_id) = 'creator'
  and not source_confidential
  and exists (
    select 1
    from public.contents c
    where c.id = findings.content_id
      and c.org_id = findings.org_id
      and c.created_by = auth.uid()
  )
  and (
    source_item_id is null
    or exists (
      select 1
      from public.vault_items v
      where v.id = findings.source_item_id
        and v.org_id = findings.org_id
        and not v.is_confidential
    )
  )
);

create policy "findings: members update"
on public.findings
for update to authenticated
using (
  public.user_role(org_id) = 'creator'
  and not source_confidential
  and exists (
    select 1
    from public.contents c
    where c.id = findings.content_id
      and c.org_id = findings.org_id
      and c.created_by = auth.uid()
  )
)
with check (
  public.user_role(org_id) = 'creator'
  and not source_confidential
  and exists (
    select 1
    from public.contents c
    where c.id = findings.content_id
      and c.org_id = findings.org_id
      and c.created_by = auth.uid()
  )
  and (
    source_item_id is null
    or exists (
      select 1
      from public.vault_items v
      where v.id = findings.source_item_id
        and v.org_id = findings.org_id
        and not v.is_confidential
    )
  )
);

drop policy if exists "corrections: members" on public.corrections;

create policy "corrections: members read safe sources"
on public.corrections
for select to authenticated
using (
  public.user_role(org_id) is not null
  and (
    public.user_role(org_id) = 'brand_manager'
    or not source_confidential
  )
);

create policy "corrections: creator insert"
on public.corrections
for insert to authenticated
with check (
  public.user_role(org_id) = 'creator'
  and not source_confidential
  and finding_id is not null
  and exists (
    select 1
    from public.findings f
    join public.contents c
      on c.id = f.content_id
     and c.org_id = f.org_id
    where f.id = corrections.finding_id
      and f.org_id = corrections.org_id
      and f.source_item_id is not distinct from corrections.source_item_id
      and not f.source_confidential
      and c.created_by = auth.uid()
  )
);

create index if not exists vault_items_embedding_hnsw_idx
  on public.vault_items using hnsw (embedding vector_cosine_ops);

create index if not exists corrections_embedding_hnsw_idx
  on public.corrections using hnsw (embedding vector_cosine_ops);

create function public.match_vault_items(
  org uuid,
  query_embedding vector(1536),
  match_count int,
  min_similarity float
)
returns table (
  id uuid,
  kind public.vault_kind,
  title text,
  body text,
  tags text[],
  valid_until date,
  is_confidential boolean,
  similarity float
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    v.id,
    v.kind,
    v.title,
    v.body,
    v.tags,
    v.valid_until,
    v.is_confidential,
    (1 - (v.embedding <=> query_embedding))::float as similarity
  from public.vault_items v
  where v.org_id = org
    and v.embedding is not null
    and 1 - (v.embedding <=> query_embedding) >= min_similarity
  order by v.embedding <=> query_embedding
  limit greatest(match_count, 0);
$$;

create function public.match_corrections(
  org uuid,
  query_embedding vector(1536),
  category text,
  match_count int,
  min_similarity float
)
returns table (
  id uuid,
  original_text text,
  suggested_text text,
  final_text text,
  outcome text,
  similarity float
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id,
    c.original_text,
    c.suggested_text,
    c.final_text,
    c.outcome,
    (1 - (c.embedding <=> query_embedding))::float as similarity
  from public.corrections c
  where c.org_id = org
    and c.category = $3
    and c.outcome in ('applied', 'edited')
    and c.embedding is not null
    and 1 - (c.embedding <=> $2) >= $5
  order by c.embedding <=> $2
  limit greatest($4, 0);
$$;

revoke all on function public.match_vault_items(uuid, vector, int, float)
  from public, anon;
revoke all on function public.match_corrections(uuid, vector, text, int, float)
  from public, anon;
grant execute on function public.match_vault_items(uuid, vector, int, float)
  to authenticated;
grant execute on function public.match_corrections(uuid, vector, text, int, float)
  to authenticated;

notify pgrst, 'reload schema';
