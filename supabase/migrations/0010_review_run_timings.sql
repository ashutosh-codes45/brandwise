create or replace function public.set_review_run_timings(
  p_run uuid,
  p_timings jsonb
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if jsonb_typeof(p_timings) is distinct from 'object' then
    raise exception 'Review timings must be a JSON object of non-negative numbers.';
  end if;

  if exists (
    select 1
    from jsonb_each(p_timings) timing
    where jsonb_typeof(timing.value) is distinct from 'number'
       or case
            when jsonb_typeof(timing.value) = 'number'
              then (timing.value #>> '{}')::numeric < 0
            else false
          end
  ) then
    raise exception 'Review timings must be a JSON object of non-negative numbers.';
  end if;

  if not exists (
    select 1
    from public.review_runs rr
    join public.contents c
      on c.id = rr.content_id
     and c.org_id = rr.org_id
    where rr.id = p_run
      and rr.triggered_by = auth.uid()
      and c.created_by = auth.uid()
      and public.user_role(rr.org_id) is not null
  ) then
    raise exception 'Review run not found or unavailable.';
  end if;

  update public.review_runs
  set stats = jsonb_set(
    coalesce(stats, '{}'::jsonb),
    '{timings_ms}',
    p_timings,
    true
  )
  where id = p_run;
end;
$$;

revoke all on function public.set_review_run_timings(uuid, jsonb)
  from public, anon;
grant execute on function public.set_review_run_timings(uuid, jsonb)
  to authenticated;
