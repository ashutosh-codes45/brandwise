drop policy if exists "sections: creators insert editable content" on public.content_sections;
drop policy if exists "sections: creators update editable content" on public.content_sections;
drop policy if exists "sections: creators delete editable content" on public.content_sections;

create policy "sections: creators insert editable content"
on public.content_sections
for insert to authenticated
with check (
  exists (
    select 1
    from public.contents c
    where c.id = content_sections.content_id
      and content_sections.org_id = c.org_id
      and c.created_by = auth.uid()
      and c.status in ('draft', 'changes_requested')
      and public.user_role(c.org_id) is not null
  )
);

create policy "sections: creators update editable content"
on public.content_sections
for update to authenticated
using (
  exists (
    select 1
    from public.contents c
    where c.id = content_sections.content_id
      and c.created_by = auth.uid()
      and c.status in ('draft', 'changes_requested')
      and public.user_role(c.org_id) is not null
  )
)
with check (
  exists (
    select 1
    from public.contents c
    where c.id = content_sections.content_id
      and c.created_by = auth.uid()
      and c.status in ('draft', 'changes_requested')
      and public.user_role(c.org_id) is not null
  )
);

create policy "sections: creators delete editable content"
on public.content_sections
for delete to authenticated
using (
  exists (
    select 1
    from public.contents c
    where c.id = content_sections.content_id
      and c.created_by = auth.uid()
      and c.status in ('draft', 'changes_requested')
      and public.user_role(c.org_id) is not null
  )
);

notify pgrst, 'reload schema';
