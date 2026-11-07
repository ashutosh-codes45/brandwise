alter table public.vault_items
  add column structured jsonb,
  add column asset_meta jsonb,
  add column image_role text check (image_role in ('logo', 'graphic', 'photo'));

create unique index vault_items_one_brand_kit_per_org
  on public.vault_items (org_id)
  where 'brand-kit' = any(tags);

alter table public.content_sections
  add column image_role text check (image_role in ('logo', 'graphic', 'photo')),
  add column image_meta jsonb,
  add column placed_background text;

alter table public.findings
  add column suggestion_kind text not null default 'text'
    check (suggestion_kind in ('text', 'manual'));

create policy "vault storage: members read visible assets"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'vault-assets'
  and exists (
    select 1
    from public.vault_items item
    where item.org_id = (storage.foldername(name))[1]::uuid
      and item.asset_path = name
      and item.kind = 'asset'
      and not item.is_confidential
  )
);

notify pgrst, 'reload schema';
