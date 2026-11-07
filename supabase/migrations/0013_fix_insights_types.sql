-- Fixes "structure of query does not match function result type" on /insights.
--
-- The insights_* functions declared bigint/numeric columns but returned
-- expressions whose type differed (notably sum(bigint) yields numeric, while
-- the column was declared bigint). plpgsql's RETURN QUERY requires the query
-- result types to match the declared output columns, so every returned
-- expression is now cast explicitly to the declared type.
--
-- Logic, thresholds, security-definer membership checks and confidential-title
-- masking are unchanged from 0008_insights.sql.

drop function if exists public.insights_summary(uuid, int, boolean);
drop function if exists public.insights_needs_attention(uuid, int, boolean);
drop function if exists public.insights_top_sources(uuid, int, boolean);
drop function if exists public.insights_patterns(uuid, int, boolean);
drop function if exists public.insights_origin_split(uuid, int, boolean);
drop function if exists public.insights_trend(uuid, int, boolean);

create or replace function public.insights_summary(
  org uuid,
  p_days int,
  p_mine boolean
)
returns table (
  contents_checked bigint,
  findings_raised bigint,
  blockers_raised bigint,
  fixes_applied bigint,
  fixes_edited bigint,
  fixes_rejected bigint,
  acceptance_rate numeric,
  dropped_uncited bigint,
  approvals bigint,
  avg_blockers_per_first_review numeric
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
  with scoped_contents as (
    select c.id
    from public.contents c
    where c.org_id = org
      and (not coalesce(p_mine, false) or c.created_by = auth.uid())
  ),
  selected_runs as (
    select rr.*
    from public.review_runs rr
    join scoped_contents sc on sc.id = rr.content_id
    where rr.org_id = org
      and (p_days is null or rr.created_at >= now() - make_interval(days => p_days))
  ),
  all_scoped_findings as (
    select f.*
    from public.findings f
    join scoped_contents sc on sc.id = f.content_id
    where f.org_id = org
  ),
  selected_findings as (
    select f.*
    from all_scoped_findings f
    where p_days is null or f.created_at >= now() - make_interval(days => p_days)
  ),
  selected_corrections as (
    select cr.outcome
    from public.corrections cr
    join all_scoped_findings f on f.id = cr.finding_id
    where cr.org_id = org
      and (p_days is null or cr.created_at >= now() - make_interval(days => p_days))
  ),
  first_runs as (
    select rr.id, rr.content_id
    from (
      select
        rr.id,
        rr.content_id,
        rr.created_at,
        row_number() over (
          partition by rr.content_id
          order by rr.created_at, rr.id
        ) as run_number
      from public.review_runs rr
      join scoped_contents sc on sc.id = rr.content_id
      where rr.org_id = org
    ) rr
    where rr.run_number = 1
      and (p_days is null or rr.created_at >= now() - make_interval(days => p_days))
  ),
  first_run_blockers as (
    select fr.content_id, count(f.id) filter (where f.severity = 'blocker') as blockers
    from first_runs fr
    left join public.findings f
      on f.run_id = fr.id
     and f.org_id = org
     and f.severity = 'blocker'
    group by fr.content_id
  ),
  totals as (
    select
      (select count(distinct rr.content_id) from selected_runs rr)::bigint as contents_checked,
      (select count(*) from selected_findings)::bigint as findings_raised,
      (select count(*) from selected_findings f where f.severity = 'blocker')::bigint as blockers_raised,
      (select count(*) from selected_corrections cr where cr.outcome = 'applied')::bigint as fixes_applied,
      (select count(*) from selected_corrections cr where cr.outcome = 'edited')::bigint as fixes_edited,
      (select count(*) from selected_corrections cr where cr.outcome = 'rejected')::bigint as fixes_rejected,
      (
        select coalesce(sum(
          coalesce((rr.stats -> 'drop_reasons' ->> 'missing_source')::bigint, 0)
          + coalesce((rr.stats -> 'drop_reasons' ->> 'source_not_retrieved_for_section')::bigint, 0)
        ), 0)::bigint
        from selected_runs rr
      ) as dropped_uncited,
      (
        select count(*)
        from public.content_events ce
        join scoped_contents sc on sc.id = ce.content_id
        where ce.org_id = org
          and ce.event = 'approved'
          and (p_days is null or ce.created_at >= now() - make_interval(days => p_days))
      )::bigint as approvals,
      (select avg(frb.blockers::numeric) from first_run_blockers frb)::numeric as avg_blockers_per_first_review
    from (select 1) as one_row
  )
  select
    totals.contents_checked::bigint,
    totals.findings_raised::bigint,
    totals.blockers_raised::bigint,
    totals.fixes_applied::bigint,
    totals.fixes_edited::bigint,
    totals.fixes_rejected::bigint,
    round(
      (totals.fixes_applied + totals.fixes_edited)::numeric
      / nullif(totals.fixes_applied + totals.fixes_edited + totals.fixes_rejected, 0),
      4
    )::numeric,
    totals.dropped_uncited::bigint,
    totals.approvals::bigint,
    round(totals.avg_blockers_per_first_review, 2)::numeric
  from totals;
end;
$$;

create or replace function public.insights_needs_attention(
  org uuid,
  p_days int,
  p_mine boolean
)
returns table (
  suggestion_type text,
  vault_item_id uuid,
  vault_item_title text,
  evidence jsonb,
  message text,
  evidence_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.member_role;
  c_min_citations constant integer := 3;
  c_min_edited constant integer := 3;
  c_min_distinct_contents constant integer := 3;
  c_min_never_cited_age_days constant integer := 14;
  c_min_rejection_rate constant numeric := 0.5;
begin
  v_role := public.user_role(org);
  if v_role is null then
    raise exception 'You are not a member of this organisation.';
  end if;

  return query
  with   all_scoped_findings as (
    select f.*
    from public.findings f
    join public.contents c on c.id = f.content_id and c.org_id = f.org_id
    where f.org_id = org
      and (not coalesce(p_mine, false) or c.created_by = auth.uid())
  ),
  scoped_findings as (
    select f.*
    from all_scoped_findings f
    where p_days is null or f.created_at >= now() - make_interval(days => p_days)
  ),
  source_citations as (
    select f.source_item_id, count(*) as times_cited
    from scoped_findings f
    where f.source_item_id is not null
    group by f.source_item_id
  ),
  source_decisions as (
    select
      f.source_item_id,
      count(*) as outcome_count,
      count(*) filter (where cr.outcome = 'rejected') as rejected_count
    from all_scoped_findings f
    join public.corrections cr
      on cr.finding_id = f.id
     and cr.org_id = org
    where f.source_item_id is not null
      and (p_days is null or cr.created_at >= now() - make_interval(days => p_days))
    group by f.source_item_id
  ),
  edited_sources as (
    select cr.source_item_id, count(*) as edited_count
    from public.corrections cr
    join all_scoped_findings f on f.id = cr.finding_id
    where cr.org_id = org
      and cr.source_item_id is not null
      and cr.outcome = 'edited'
      and (p_days is null or cr.created_at >= now() - make_interval(days => p_days))
    group by cr.source_item_id
  ),
  expired_sources as (
    select f.source_item_id, count(*) as times_cited
    from scoped_findings f
    join public.vault_items vi
      on vi.id = f.source_item_id
     and vi.org_id = org
    where vi.valid_until < current_date
    group by f.source_item_id
  ),
  repeated_sources as (
    select f.category, f.source_item_id, count(*) as occurrences,
      count(distinct f.content_id) as distinct_contents
    from scoped_findings f
    where f.source_item_id is not null
    group by f.category, f.source_item_id
    having count(distinct f.content_id) >= c_min_distinct_contents
  ),
  repeated_rules as (
    select f.rule_id, count(*) as occurrences,
      count(distinct f.content_id) as distinct_contents
    from scoped_findings f
    where f.rule_id is not null
    group by f.rule_id
    having count(distinct f.content_id) >= c_min_distinct_contents
  ),
  uncited_items as (
    select vi.id, vi.title, vi.is_confidential,
      floor(extract(epoch from (now() - vi.created_at)) / 86400)::bigint as age_days
    from public.vault_items vi
    where vi.org_id = org
      and vi.kind <> 'asset'
      and vi.created_at < now() - make_interval(days => c_min_never_cited_age_days)
      and not exists (
        select 1
        from public.findings f
        join public.contents c on c.id = f.content_id and c.org_id = f.org_id
        where f.org_id = org
          and f.source_item_id = vi.id
          and (not coalesce(p_mine, false) or c.created_by = auth.uid())
      )
  ),
  suggestions as (
    select
      'often_rejected'::text as suggestion_type,
      vi.id as item_id,
      case when v_role = 'brand_manager' or not vi.is_confidential
        then vi.title else 'Confidential source' end as item_title,
      jsonb_build_object(
        'times_cited', sc.times_cited,
        'rejected', sd.rejected_count,
        'outcomes', sd.outcome_count,
        'rejection_rate', round(sd.rejected_count::numeric / nullif(sd.outcome_count, 0), 4),
        'sample_size', sd.outcome_count
      ) as evidence,
      'Often dismissed. The rule may be unclear or too broad.'::text as message,
      sc.times_cited as evidence_count
    from source_citations sc
    join source_decisions sd on sd.source_item_id = sc.source_item_id
    join public.vault_items vi on vi.id = sc.source_item_id and vi.org_id = org
    where sc.times_cited >= c_min_citations
      and sd.rejected_count::numeric / nullif(sd.outcome_count, 0) >= c_min_rejection_rate

    union all

    select
      'often_rewritten',
      vi.id,
      case when v_role = 'brand_manager' or not vi.is_confidential
        then vi.title else 'Confidential source' end,
      jsonb_build_object('edited', es.edited_count, 'sample_size', es.edited_count),
      'Suggested fixes are often rewritten. Add preferred wording or an example.',
      es.edited_count
    from edited_sources es
    join public.vault_items vi on vi.id = es.source_item_id and vi.org_id = org
    where es.edited_count >= c_min_edited

    union all

    select
      'expired_still_cited',
      vi.id,
      case when v_role = 'brand_manager' or not vi.is_confidential
        then vi.title else 'Confidential source' end,
      jsonb_build_object(
        'times_cited', ex.times_cited,
        'valid_until', vi.valid_until
      ),
      'Expired item still being matched. Update or retire it.',
      ex.times_cited
    from expired_sources ex
    join public.vault_items vi on vi.id = ex.source_item_id and vi.org_id = org

    union all

    select
      'repeat_mistake',
      vi.id,
      case when v_role = 'brand_manager' or not vi.is_confidential
        then vi.title else 'Confidential source' end,
      jsonb_build_object(
        'category', rs.category,
        'occurrences', rs.occurrences,
        'distinct_contents', rs.distinct_contents
      ),
      'Repeated mistake. Consider a clearer guideline or a template.',
      rs.occurrences
    from repeated_sources rs
    join public.vault_items vi on vi.id = rs.source_item_id and vi.org_id = org

    union all

    select
      'repeat_mistake',
      null::uuid,
      'Rule: ' || initcap(replace(rr.rule_id, '_', ' ')),
      jsonb_build_object(
        'rule_id', rr.rule_id,
        'occurrences', rr.occurrences,
        'distinct_contents', rr.distinct_contents
      ),
      'Repeated mistake. Consider a clearer guideline or a template.',
      rr.occurrences
    from repeated_rules rr

    union all

    select
      'never_cited',
      ui.id,
      case when v_role = 'brand_manager' or not ui.is_confidential
        then ui.title else 'Confidential source' end,
      jsonb_build_object('times_cited', 0, 'age_days', ui.age_days),
      'Never matched in a review. Check relevance or wording.',
      0::bigint
    from uncited_items ui
  )
  select
    s.suggestion_type::text,
    (case when v_role = 'brand_manager' or not vi.is_confidential then s.item_id else null end)::uuid,
    s.item_title::text,
    s.evidence::jsonb,
    s.message::text,
    s.evidence_count::bigint
  from suggestions s
  left join public.vault_items vi on vi.id = s.item_id and vi.org_id = org
  order by
    case s.suggestion_type
      when 'expired_still_cited' then 1
      when 'repeat_mistake' then 2
      when 'often_rejected' then 3
      when 'often_rewritten' then 4
      when 'never_cited' then 5
      else 6
    end,
    s.evidence_count desc
  limit 8;
end;
$$;

create or replace function public.insights_top_sources(
  org uuid,
  p_days int,
  p_mine boolean
)
returns table (
  source_kind text,
  source_item_id uuid,
  rule_id text,
  label text,
  times_cited bigint,
  applied bigint,
  edited bigint,
  rejected bigint,
  acceptance_rate numeric,
  sample_size bigint
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
  with   all_scoped_findings as (
    select f.*
    from public.findings f
    join public.contents c on c.id = f.content_id and c.org_id = f.org_id
    where f.org_id = org
      and (not coalesce(p_mine, false) or c.created_by = auth.uid())
  ),
  selected_findings as (
    select f.*
    from all_scoped_findings f
    where p_days is null or f.created_at >= now() - make_interval(days => p_days)
  ),
  item_citations as (
    select f.source_item_id, count(*) as times_cited
    from selected_findings f
    where f.source_item_id is not null
    group by f.source_item_id
  ),
  item_outcomes as (
    select
      f.source_item_id,
      count(*) filter (where cr.outcome = 'applied') as applied,
      count(*) filter (where cr.outcome = 'edited') as edited,
      count(*) filter (where cr.outcome = 'rejected') as rejected
    from all_scoped_findings f
    join public.corrections cr
      on cr.finding_id = f.id
     and cr.org_id = org
     and cr.source_item_id is not distinct from f.source_item_id
    where f.source_item_id is not null
      and (p_days is null or cr.created_at >= now() - make_interval(days => p_days))
    group by f.source_item_id
  ),
  rule_citations as (
    select f.rule_id, count(*) as times_cited
    from selected_findings f
    where f.source_item_id is null
      and f.rule_id is not null
    group by f.rule_id
  ),
  rule_outcomes as (
    select
      f.rule_id,
      count(*) filter (where cr.outcome = 'applied') as applied,
      count(*) filter (where cr.outcome = 'edited') as edited,
      count(*) filter (where cr.outcome = 'rejected') as rejected
    from all_scoped_findings f
    join public.corrections cr
      on cr.finding_id = f.id
     and cr.org_id = org
    where f.source_item_id is null
      and f.rule_id is not null
      and (p_days is null or cr.created_at >= now() - make_interval(days => p_days))
    group by f.rule_id
  ),
  sources as (
    select
      'vault'::text as source_kind,
      ic.source_item_id as item_id,
      null::text as source_rule_id,
      case when v_role = 'brand_manager' or not vi.is_confidential
        then vi.title else 'Confidential source' end as source_label,
      ic.times_cited,
      coalesce(io.applied, 0)::bigint as applied,
      coalesce(io.edited, 0)::bigint as edited,
      coalesce(io.rejected, 0)::bigint as rejected
    from item_citations ic
    join public.vault_items vi on vi.id = ic.source_item_id and vi.org_id = org
    left join item_outcomes io on io.source_item_id = ic.source_item_id

    union all

    select
      'rule',
      null::uuid,
      rc.rule_id,
      'Rule: ' || initcap(replace(rc.rule_id, '_', ' ')),
      rc.times_cited,
      coalesce(ro.applied, 0)::bigint,
      coalesce(ro.edited, 0)::bigint,
      coalesce(ro.rejected, 0)::bigint
    from rule_citations rc
    left join rule_outcomes ro on ro.rule_id = rc.rule_id
  )
  select
    s.source_kind::text,
    (case when s.item_id is null or v_role = 'brand_manager' or not vi.is_confidential then s.item_id else null end)::uuid,
    s.source_rule_id::text,
    s.source_label::text,
    s.times_cited::bigint,
    s.applied::bigint,
    s.edited::bigint,
    s.rejected::bigint,
    round((s.applied + s.edited)::numeric / nullif(s.applied + s.edited + s.rejected, 0), 4)::numeric,
    (s.applied + s.edited + s.rejected)::bigint
  from sources s
  left join public.vault_items vi on vi.id = s.item_id and vi.org_id = org
  order by s.times_cited desc, s.source_label
  limit 10;
end;
$$;

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
      max(coalesce(vi.is_confidential, f.source_confidential)) as is_confidential
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

create or replace function public.insights_origin_split(
  org uuid,
  p_days int,
  p_mine boolean
)
returns table (
  split_type text,
  origin text,
  findings_count bigint,
  applied bigint,
  edited bigint,
  rejected bigint,
  acceptance_rate numeric,
  sample_size bigint
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
  with   all_scoped_findings as (
    select f.*
    from public.findings f
    join public.contents c on c.id = f.content_id and c.org_id = f.org_id
    where f.org_id = org
      and (not coalesce(p_mine, false) or c.created_by = auth.uid())
  ),
  selected_findings as (
    select f.*
    from all_scoped_findings f
    where p_days is null or f.created_at >= now() - make_interval(days => p_days)
  ),
  decisions as (
    select f.id, f.origin as finding_origin, f.suggestion_origin, cr.outcome
    from all_scoped_findings f
    join public.corrections cr
      on cr.finding_id = f.id
     and cr.org_id = org
    where cr.outcome in ('applied', 'edited', 'rejected')
      and (p_days is null or cr.created_at >= now() - make_interval(days => p_days))
  ),
  grouped as (
    select
      'finding_origin'::text as grouping_type,
      coalesce(d.finding_origin, 'unknown')::text as grouping_origin,
      count(distinct d.id) as findings_count,
      count(*) filter (where d.outcome = 'applied') as applied,
      count(*) filter (where d.outcome = 'edited') as edited,
      count(*) filter (where d.outcome = 'rejected') as rejected
    from decisions d
    group by coalesce(d.finding_origin, 'unknown')

    union all

    select
      'suggestion_origin',
      coalesce(d.suggestion_origin, 'unknown')::text,
      count(distinct d.id),
      count(*) filter (where d.outcome = 'applied'),
      count(*) filter (where d.outcome = 'edited'),
      count(*) filter (where d.outcome = 'rejected')
    from decisions d
    group by coalesce(d.suggestion_origin, 'unknown')
  )
  select
    g.grouping_type::text,
    g.grouping_origin::text,
    g.findings_count::bigint,
    g.applied::bigint,
    g.edited::bigint,
    g.rejected::bigint,
    round((g.applied + g.edited)::numeric / nullif(g.applied + g.edited + g.rejected, 0), 4)::numeric,
    (g.applied + g.edited + g.rejected)::bigint
  from grouped g
  order by g.grouping_type, g.grouping_origin;
end;
$$;

create or replace function public.insights_trend(
  org uuid,
  p_days int,
  p_mine boolean
)
returns table (
  week_start date,
  contents_reviewed bigint,
  findings_raised bigint,
  blockers_raised bigint,
  blockers_per_content numeric
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
  with scoped_contents as (
    select c.id
    from public.contents c
    where c.org_id = org
      and (not coalesce(p_mine, false) or c.created_by = auth.uid())
  ),
  run_weeks as (
    select
      date_trunc('week', rr.created_at)::date as week_start,
      count(distinct rr.content_id) as contents_reviewed
    from public.review_runs rr
    join scoped_contents sc on sc.id = rr.content_id
    where rr.org_id = org
      and (p_days is null or rr.created_at >= now() - make_interval(days => p_days))
    group by date_trunc('week', rr.created_at)::date
  ),
  finding_weeks as (
    select
      date_trunc('week', f.created_at)::date as week_start,
      count(*) as findings_raised,
      count(*) filter (where f.severity = 'blocker') as blockers_raised
    from public.findings f
    join scoped_contents sc on sc.id = f.content_id
    where f.org_id = org
      and (p_days is null or f.created_at >= now() - make_interval(days => p_days))
    group by date_trunc('week', f.created_at)::date
  ),
  all_weeks as (
    select rw.week_start from run_weeks rw
    union
    select fw.week_start from finding_weeks fw
  )
  select
    aw.week_start::date,
    coalesce(rw.contents_reviewed, 0)::bigint,
    coalesce(fw.findings_raised, 0)::bigint,
    coalesce(fw.blockers_raised, 0)::bigint,
    round(coalesce(fw.blockers_raised, 0)::numeric / nullif(rw.contents_reviewed, 0), 2)::numeric
  from all_weeks aw
  left join run_weeks rw on rw.week_start = aw.week_start
  left join finding_weeks fw on fw.week_start = aw.week_start
  order by aw.week_start;
end;
$$;

revoke all on function public.insights_summary(uuid, int, boolean) from public, anon;
revoke all on function public.insights_needs_attention(uuid, int, boolean) from public, anon;
revoke all on function public.insights_top_sources(uuid, int, boolean) from public, anon;
revoke all on function public.insights_patterns(uuid, int, boolean) from public, anon;
revoke all on function public.insights_origin_split(uuid, int, boolean) from public, anon;
revoke all on function public.insights_trend(uuid, int, boolean) from public, anon;

grant execute on function public.insights_summary(uuid, int, boolean) to authenticated;
grant execute on function public.insights_needs_attention(uuid, int, boolean) to authenticated;
grant execute on function public.insights_top_sources(uuid, int, boolean) to authenticated;
grant execute on function public.insights_patterns(uuid, int, boolean) to authenticated;
grant execute on function public.insights_origin_split(uuid, int, boolean) to authenticated;
grant execute on function public.insights_trend(uuid, int, boolean) to authenticated;

notify pgrst, 'reload schema';
