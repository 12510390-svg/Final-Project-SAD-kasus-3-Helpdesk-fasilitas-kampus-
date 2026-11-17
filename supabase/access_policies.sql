-- Kebijakan akses tambahan agar data benar-benar mengalir sesuai peran.
-- Jalankan setelah seed_profiles.sql.

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$ select peran from public.profiles where id = auth.uid() $$;

create policy "admins read technician profiles"
on public.profiles for select
using (public.current_user_role() = 'admin' and peran = 'teknisi');

create policy "heads read technician profiles"
on public.profiles for select
using (public.current_user_role() = 'kepala_unit' and peran = 'teknisi');

create policy "reporters confirm own reports"
on public.reports for update
using (auth.uid() = pelapor_id and status = 'menunggu_konfirmasi')
with check (auth.uid() = pelapor_id and status in ('selesai', 'dibuka_kembali'));

create policy "assigned technicians update reports"
on public.reports for update
using (exists (select 1 from public.assignments a where a.laporan_id = reports.id and a.teknisi_id = auth.uid()))
with check (exists (select 1 from public.assignments a where a.laporan_id = reports.id and a.teknisi_id = auth.uid()));

create policy "heads set report priority"
on public.reports for update
using (public.current_user_role() = 'kepala_unit')
with check (public.current_user_role() = 'kepala_unit');

create policy "related users read status history"
on public.status_history for select
using (
  exists (select 1 from public.reports r where r.id = status_history.laporan_id and r.pelapor_id = auth.uid())
  or exists (select 1 from public.assignments a where a.laporan_id = status_history.laporan_id and a.teknisi_id = auth.uid())
  or public.current_user_role() in ('admin', 'kepala_unit')
);

create policy "actors write status history"
on public.status_history for insert
with check (diubah_oleh = auth.uid() or diubah_oleh is null);
