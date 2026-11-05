alter table public.content_sections
  add column alt_text text;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'content-images',
  'content-images',
  false,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "content images: members read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'content-images'
  and public.user_role((storage.foldername(name))[1]::uuid) is not null
);

create policy "content images: members upload"
on storage.objects
for insert
to authenticated
with check (
 bucket_id = 'content-images'
 and public.user_role((storage.foldername(name))[1]::uuid) is not null
);

create policy "content images: members delete"
on storage.objects
for delete
to authenticated
using (
 bucket_id = 'content-images'
 and public.user_role((storage.foldername(name))[1]::uuid) is not null
);

create policy "contents: creators delete drafts"
on public.contents
for delete
to authenticated
using (
 created_by = auth.uid()
 and status = 'draft'
 and public.user_role(org_id) = 'creator'
);

notify pgrst, 'reload schema';
