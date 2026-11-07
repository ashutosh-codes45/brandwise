-- Fixes "Could not load insights_patterns: function max(boolean) does not exist"
-- on /insights. PostgreSQL has no max()/min() aggregate for boolean.
--
-- AUDIT: every migration in supabase/migrations was searched for max()/min()
-- applied to a boolean expression, across all insights_* functions.
--
--   * insights_patterns  -> CHANGED
--       line changed:  bool_or(coalesce(vi.is_confidential, f.source_confidential)) as is_confidential
--       was:           max(coalesce(vi.is_confidential, f.source_confidential)) as is_confidential
--                      (0008_insights.sql line 549; newest definition 0013 line 567)
--
--   * insights_summary, insights_needs_attention, insights_top_sources,
--     insights_origin_split, insights_trend  -> NOT changed (no boolean aggregate).
--       Their only max() calls are on text/timestamptz and are valid:
--       max(f.excerpt), max(vi.title), max(rr.created_at) / max(cv.created_at) /
--       max(ce.created_at). Where confidentiality is aggregated they already use
--       bool_or(coalesce(vi.is_confidential, f.source_confidential)).
--
--   * No min() over a boolean exists anywhere in the migrations.
--
-- Only the boolean aggregate is replaced: bool_or(x) == "any true", the same
-- semantics already used in the group_label CASE in this query. The explicit
-- casts, security-definer membership check, thresholds and confidential-title
-- masking are unchanged from 0013 (the newest definition of this function).
--
-- Run this in the Supabase SQL Editor (it also reloads the PostgREST schema).

drop function if exists public.insights_patterns(uuid, int, boolean);

create or replace function public.insights_patterns(
  org uuid,
  p_days int,
  p_mine boolean
)
returns table (
  category text,
  rule_id text,
  source_item_id uuid,
  label text,
  occurrences bigint,
  distinct_contents bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.member_role;
begin
  v_role := public.user_role(org);
  if v_role is null then
    raise exception 'You are not a member of this organisation.';
  end if;

  return query
  with selected_findings as (
    select f.*
    from public.findings f
    join public.contents c on c.id = f.content_id and c.org_id = f.org_id
    where f.org_id = org
      and (not coalesce(p_mine, false) or c.created_by = auth.uid())
      and (p_days is null or f.created_at >= now() - make_interval(days => p_days))
  ),
  grouped_findings as (
    select
      f.category,
      f.rule_id as grouped_rule_id,
      case when f.rule_id is null then f.source_item_id else null::uuid end as grouped_source_id,
      count(*) as occurrences,
      count(distinct f.content_id) as distinct_contents,
      case
        when bool_or(coalesce(vi.is_confidential, f.source_confidential))
          and v_role <> 'brand_manager'
          then 'Confidential source'
        when f.rule_id = 'term_avoid'
          and (v_role = 'brand_manager' or not coalesce(bool_or(coalesce(vi.is_confidential, f.source_confidential)), false))
          then 'Avoided term: ' || coalesce(max(f.excerpt), 'unknown term')
        when f.rule_id is not null
          then 'Rule: ' || initcap(replace(f.rule_id, '_', ' '))
        else coalesce(max(vi.title), 'Vault source')
      end as group_label,
      bool_or(coalesce(vi.is_confidential, f.source_confidential)) as is_confidential
    from selected_findings f
    left join public.vault_items vi
      on vi.id = f.source_item_id
     and vi.org_id = org
    where f.rule_id is not null or f.source_item_id is not null
    group by f.category,
      f.rule_id,
      case when f.rule_id is null then f.source_item_id else null::uuid end
    having count(*) >= 2
  )
  select
    gf.category::text,
    gf.grouped_rule_id::text,
    (case when gf.grouped_source_id is null or v_role = 'brand_manager' or not coalesce(gf.is_confidential, false)
      then gf.grouped_source_id else null end)::uuid,
    gf.group_label::text,
    gf.occurrences::bigint,
    gf.distinct_contents::bigint
  from grouped_findings gf
  order by gf.occurrences desc, gf.distinct_contents desc, gf.category
  limit 8;
end;
$$;

notify pgrst, 'reload schema';
