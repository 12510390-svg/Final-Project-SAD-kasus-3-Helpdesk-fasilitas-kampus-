-- Jalankan SEKALI di Supabase Dashboard > SQL Editor.
-- Fungsi ini membuat laporan dari Pelapor langsung masuk ke semua Teknisi
-- yang sesuai. Skrip juga tetap kompatibel dengan data lama, saat Teknisi
-- Bangunan dan Air masih memakai bidang gabungan bangunan_air.

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
    and (
      (p_jenis::text in ('listrik', 'ac') and profil_teknisi.bidang::text = p_jenis::text)
      or (p_jenis::text = 'bangunan' and (profil_teknisi.bidang::text = 'bangunan' or (profil_teknisi.bidang::text = 'bangunan_air' and profil_teknisi.nama ilike 'Teknisi Bangunan%')))
      or (p_jenis::text = 'air' and (profil_teknisi.bidang::text = 'air' or (profil_teknisi.bidang::text = 'bangunan_air' and profil_teknisi.nama ilike 'Teknisi Air%')))
    )
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
  and (
    (laporan.jenis::text in ('listrik', 'ac') and profil_teknisi.bidang::text = laporan.jenis::text)
    or (laporan.jenis::text = 'bangunan' and (profil_teknisi.bidang::text = 'bangunan' or (profil_teknisi.bidang::text = 'bangunan_air' and profil_teknisi.nama ilike 'Teknisi Bangunan%')))
    or (laporan.jenis::text = 'air' and (profil_teknisi.bidang::text = 'air' or (profil_teknisi.bidang::text = 'bangunan_air' and profil_teknisi.nama ilike 'Teknisi Air%')))
  )
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
