-- Helpdesk Fasilitas Kampus: skema awal sesuai ERD Tahap 3.
create extension if not exists "pgcrypto";

create type public.user_role as enum ('pelapor', 'admin', 'teknisi', 'kepala_unit');
create type public.technician_field as enum ('listrik', 'ac', 'bangunan_air');
create type public.damage_type as enum ('listrik', 'ac', 'bangunan', 'air');
create type public.report_priority as enum ('darurat', 'tinggi', 'normal');
create type public.report_status as enum ('baru', 'ditugaskan', 'dikerjakan', 'ditahan', 'menunggu_konfirmasi', 'selesai', 'dibuka_kembali', 'ditolak');
create type public.financial_status as enum ('tidak_perlu', 'menunggu', 'disetujui', 'ditolak');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  nama text not null,
  peran public.user_role not null default 'pelapor',
  bidang public.technician_field,
  dibuat_pada timestamptz not null default now(),
  constraint technician_field_only check ((peran = 'teknisi') = (bidang is not null))
);

create table public.gedung (
  id smallint primary key,
  kode varchar(10) not null unique,
  nama varchar(100) not null
);

insert into public.gedung (id, kode, nama) values
  (1, 'A', 'Gedung A'), (2, 'B', 'Gedung B'), (3, 'C', 'Gedung C'), (4, 'D', 'Gedung D'),
  (5, 'E', 'Gedung E'), (6, 'F', 'Gedung F'), (7, 'G', 'Gedung G'), (8, 'H', 'Gedung H')
on conflict (id) do nothing;

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  nomor varchar(20) not null unique,
  pelapor_id uuid not null references public.profiles(id),
  gedung_id smallint not null references public.gedung(id),
  ruang varchar(50) not null,
  jenis public.damage_type not null,
  deskripsi text not null,
  foto_url text,
  prioritas public.report_priority,
  tenggat timestamptz,
  status public.report_status not null default 'baru',
  induk_id uuid references public.reports(id),
  alasan_tolak text,
  catatan_admin text,
  menunggu_konfirmasi_pada timestamptz,
  dibuat_pada timestamptz not null default now(),
  diperbarui_pada timestamptz not null default now()
);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  laporan_id uuid not null references public.reports(id) on delete cascade,
  teknisi_id uuid not null references public.profiles(id),
  catatan text,
  dibuat_pada timestamptz not null default now(),
  unique (laporan_id, teknisi_id)
);

create table public.status_history (
  id bigint generated always as identity primary key,
  laporan_id uuid not null references public.reports(id) on delete cascade,
  status_lama public.report_status,
  status_baru public.report_status not null,
  keterangan text,
  diubah_oleh uuid references public.profiles(id),
  dibuat_pada timestamptz not null default now()
);

create table public.work_logs (
  id uuid primary key default gen_random_uuid(),
  penugasan_id uuid not null references public.assignments(id) on delete cascade,
  tanggal date not null,
  jam numeric(4,2) not null check (jam > 0 and jam <= 24),
  keterangan text,
  dibuat_pada timestamptz not null default now()
);

create table public.spare_parts (
  id uuid primary key default gen_random_uuid(),
  laporan_id uuid not null references public.reports(id) on delete cascade,
  nama varchar(100) not null,
  estimasi_biaya integer not null check (estimasi_biaya >= 0),
  status_keuangan public.financial_status not null default 'tidak_perlu',
  dibuat_pada timestamptz not null default now(),
  diputuskan_pada timestamptz
);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.diperbarui_pada = now(); return new; end; $$;
create trigger reports_set_updated_at before update on public.reports for each row execute function public.set_updated_at();

create or replace function public.new_report_number() returns text language sql stable as $$
  select 'LAP-' || to_char(now(), 'YYYYMM') || '-' || lpad((count(*) + 1)::text, 4, '0')
  from public.reports where dibuat_pada >= date_trunc('month', now());
$$;

alter table public.profiles enable row level security;
alter table public.gedung enable row level security;
alter table public.reports enable row level security;
alter table public.assignments enable row level security;
alter table public.status_history enable row level security;
alter table public.work_logs enable row level security;
alter table public.spare_parts enable row level security;

create policy "public can read buildings" on public.gedung for select using (true);
create policy "users read own profile" on public.profiles for select using (auth.uid() = id);
create policy "reporters create reports" on public.reports for insert with check (auth.uid() = pelapor_id);
create policy "reporters read own reports" on public.reports for select using (auth.uid() = pelapor_id);
create policy "reporters update own confirmation" on public.reports for update using (auth.uid() = pelapor_id) with check (auth.uid() = pelapor_id);
create policy "admins and heads read all reports" on public.reports for select using ((select peran from public.profiles where id = auth.uid()) in ('admin', 'kepala_unit'));
create policy "admins manage reports" on public.reports for update using ((select peran from public.profiles where id = auth.uid()) = 'admin');
create policy "technicians read assigned reports" on public.reports for select using (exists (select 1 from public.assignments a where a.laporan_id = reports.id and a.teknisi_id = auth.uid()));
create policy "admins manage assignments" on public.assignments for all using ((select peran from public.profiles where id = auth.uid()) = 'admin') with check ((select peran from public.profiles where id = auth.uid()) = 'admin');
create policy "technicians read own assignments" on public.assignments for select using (teknisi_id = auth.uid());
create policy "related users read histories" on public.status_history for select using (exists (select 1 from public.reports r where r.id = laporan_id and r.pelapor_id = auth.uid()) or exists (select 1 from public.assignments a where a.laporan_id = status_history.laporan_id and a.teknisi_id = auth.uid()) or (select peran from public.profiles where id = auth.uid()) in ('admin', 'kepala_unit'));
create policy "assigned technicians write histories" on public.status_history for insert with check (diubah_oleh = auth.uid());
create policy "technicians manage own work logs" on public.work_logs for all using (exists (select 1 from public.assignments a where a.id = penugasan_id and a.teknisi_id = auth.uid())) with check (exists (select 1 from public.assignments a where a.id = penugasan_id and a.teknisi_id = auth.uid()));
create policy "admins manage spare parts" on public.spare_parts for all using ((select peran from public.profiles where id = auth.uid()) = 'admin') with check ((select peran from public.profiles where id = auth.uid()) = 'admin');
