create index if not exists vault_items_text_search_idx
  on public.vault_items using gin (
    to_tsvector(
      'english',
      title || ' ' || coalesce(body, '') || ' ' || array_to_string(tags, ' ')
    )
  );

create or replace function public.search_vault_text(
  org uuid,
  q text,
  match_count int
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
    ts_rank(
      to_tsvector(
        'english',
        v.title || ' ' || coalesce(v.body, '') || ' ' || array_to_string(v.tags, ' ')
      ),
      websearch_to_tsquery('english', q)
    )::float as similarity
  from public.vault_items v
  where v.org_id = org
    and to_tsvector(
      'english',
      v.title || ' ' || coalesce(v.body, '') || ' ' || array_to_string(v.tags, ' ')
    ) @@ websearch_to_tsquery('english', q)
  order by similarity desc
  limit greatest(match_count, 0);
$$;

revoke all on function public.search_vault_text(uuid, text, int)
  from public, anon;
grant execute on function public.search_vault_text(uuid, text, int)
  to authenticated;

notify pgrst, 'reload schema';
