-- Jalankan sekali agar nomor LAP-YYYYMM-NNNN dihitung dari seluruh laporan,
-- bukan hanya laporan milik akun yang sedang masuk.
create or replace function public.new_report_number()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select 'LAP-' || to_char(now(), 'YYYYMM') || '-' || lpad((count(*) + 1)::text, 4, '0')
  from public.reports
  where dibuat_pada >= date_trunc('month', now());
$$;
