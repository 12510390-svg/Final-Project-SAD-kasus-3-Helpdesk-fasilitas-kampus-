-- Jalankan SEKALI di Supabase Dashboard > SQL Editor.
-- Fungsi ini membuat laporan dari Pelapor langsung masuk ke semua Teknisi
-- yang memiliki bidang sesuai: listrik -> listrik, ac -> ac,
-- bangunan -> bangunan, air -> air.

alter type public.technician_field add value if not exists 'bangunan';
alter type public.technician_field add value if not exists 'air';

-- Memisahkan akun teknisi Bangunan dan Air lama yang sebelumnya masih tergabung
-- dalam bidang bangunan_air.
update public.profiles
set bidang = 'bangunan'::public.technician_field
where peran = 'teknisi'
  and bidang::text = 'bangunan_air'
  and nama ilike 'Teknisi Bangunan%';

update public.profiles
set bidang = 'air'::public.technician_field
where peran = 'teknisi'
  and bidang::text = 'bangunan_air'
  and nama ilike 'Teknisi Air%';

create or replace function public.create_report_and_assign(
  p_nomor text,
  p_gedung_id smallint,
  p_ruang text,
  p_jenis public.damage_type,
  p_deskripsi text,
  p_foto_url text default null
)
returns public.reports
language plpgsql
security definer
set search_path = public
as $$
declare
  new_report public.reports;
  assigned_count integer;
begin
  if auth.uid() is null then
    raise exception 'Anda harus masuk terlebih dahulu.';
  end if;

  if not exists (
    select 1 from public.profiles where id = auth.uid() and peran = 'pelapor'
  ) then
    raise exception 'Hanya akun Pelapor yang dapat membuat laporan.';
  end if;

  insert into public.reports (
    nomor, pelapor_id, gedung_id, ruang, jenis, deskripsi, foto_url, status
  )
  values (
    p_nomor, auth.uid(), p_gedung_id, p_ruang, p_jenis, p_deskripsi, p_foto_url, 'baru'
  )
  returning * into new_report;

  insert into public.assignments (laporan_id, teknisi_id, catatan)
  select
    new_report.id,
    profil_teknisi.id,
    'Ditugaskan otomatis berdasarkan jenis laporan: ' || p_jenis::text
  from public.profiles as profil_teknisi
  where profil_teknisi.peran = 'teknisi'
    and profil_teknisi.bidang::text = p_jenis::text
  on conflict (laporan_id, teknisi_id) do nothing;

  get diagnostics assigned_count = row_count;

  if assigned_count > 0 then
    update public.reports
    set status = 'ditugaskan'
    where id = new_report.id
    returning * into new_report;

    insert into public.status_history (
      laporan_id, status_lama, status_baru, keterangan, diubah_oleh
    )
    values (
      new_report.id,
      'baru',
      'ditugaskan',
      'Laporan dialurkan otomatis ke Teknisi bidang ' || p_jenis::text || '.',
      auth.uid()
    );
  end if;

  return new_report;
end;
$$;

revoke all on function public.create_report_and_assign(text, smallint, text, public.damage_type, text, text) from public;
grant execute on function public.create_report_and_assign(text, smallint, text, public.damage_type, text, text) to authenticated;

-- Kirim juga laporan lama yang belum selesai kepada semua Teknisi yang sesuai.
insert into public.assignments (laporan_id, teknisi_id, catatan)
select
  laporan.id,
  profil_teknisi.id,
  'Ditugaskan otomatis berdasarkan jenis laporan: ' || laporan.jenis::text
from public.reports as laporan
join public.profiles as profil_teknisi
  on profil_teknisi.peran = 'teknisi'
  and profil_teknisi.bidang::text = laporan.jenis::text
where laporan.status not in ('selesai', 'ditolak')
on conflict (laporan_id, teknisi_id) do nothing;

update public.reports as laporan
set status = 'ditugaskan'
where laporan.status = 'baru'
  and exists (
    select 1
    from public.assignments as penugasan
    where penugasan.laporan_id = laporan.id
  );
