-- Jalankan sekali di Supabase Dashboard > SQL Editor.
-- Menyimpan foto bukti laporan dalam bucket privat report-photos.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'report-photos',
  'report-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[];

drop policy if exists "authenticated users view report photos" on storage.objects;
drop policy if exists "reporters upload their own report photos" on storage.objects;
drop policy if exists "reporters update their own report photos" on storage.objects;
drop policy if exists "reporters delete their own report photos" on storage.objects;

create policy "authenticated users view report photos"
on storage.objects for select
to authenticated
using (bucket_id = 'report-photos');

create policy "reporters upload their own report photos"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'report-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "reporters update their own report photos"
on storage.objects for update
to authenticated
using (
  bucket_id = 'report-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'report-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "reporters delete their own report photos"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'report-photos'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
