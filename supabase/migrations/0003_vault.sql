alter table public.vault_items
  add column tags text[] not null default '{}';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'vault-files',
    'vault-files',
    false,
    10485760,
    array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ]
  ),
  (
    'vault-assets',
    'vault-assets',
    false,
    5242880,
    array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
  )
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "vault storage: managers access files"
on storage.objects
for all
to authenticated
using (
  bucket_id in ('vault-files', 'vault-assets')
  and public.user_role((storage.foldername(name))[1]::uuid) = 'brand_manager'
)
with check (
  bucket_id in ('vault-files', 'vault-assets')
  and public.user_role((storage.foldername(name))[1]::uuid) = 'brand_manager'
);

notify pgrst, 'reload schema';
