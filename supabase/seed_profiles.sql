-- Jalankan sekali di Supabase Dashboard > SQL Editor setelah semua akun Auth dibuat.
-- Skrip ini tidak membuat akun Auth dan tidak mengubah kata sandi.
-- Versi ini sengaja tidak memakai alias tabel agar aman ditempel langsung di SQL Editor.

insert into public.profiles (id, email, nama, peran, bidang)
select id, email, 'Pelapor Demo', 'pelapor'::public.user_role, null::public.technician_field from auth.users where email = 'pelapor@gmail.com'
union all
select id, email, 'Admin Fasilitas', 'admin'::public.user_role, null::public.technician_field from auth.users where email = 'admin01@gmail.com'
union all
select id, email, 'Kepala Unit', 'kepala_unit'::public.user_role, null::public.technician_field from auth.users where email = 'kepalauni@gmail.com'
union all
select id, email, 'Teknisi Listrik 1', 'teknisi'::public.user_role, 'listrik'::public.technician_field from auth.users where email = 'teknisilistrik1@gmail.com'
union all
select id, email, 'Teknisi Listrik 2', 'teknisi'::public.user_role, 'listrik'::public.technician_field from auth.users where email = 'teknisilistrik2@gmail.com'
union all
select id, email, 'Teknisi AC 1', 'teknisi'::public.user_role, 'ac'::public.technician_field from auth.users where email = 'teknisiac1@gmail.com'
union all
select id, email, 'Teknisi AC 2', 'teknisi'::public.user_role, 'ac'::public.technician_field from auth.users where email = 'teknisiac2@gmail.com'
union all
select id, email, 'Teknisi Bangunan 1', 'teknisi'::public.user_role, 'bangunan_air'::public.technician_field from auth.users where email = 'teknisibngunan1@gmail.com'
union all
select id, email, 'Teknisi Bangunan 2', 'teknisi'::public.user_role, 'bangunan_air'::public.technician_field from auth.users where email = 'teknisibngunan2@gmail.com'
union all
select id, email, 'Teknisi Air 1', 'teknisi'::public.user_role, 'bangunan_air'::public.technician_field from auth.users where email = 'teknisiair1@gmail.com'
union all
select id, email, 'Teknisi Air 2', 'teknisi'::public.user_role, 'bangunan_air'::public.technician_field from auth.users where email = 'teknisiair2@gmail.com'
on conflict (id) do update set
  email = excluded.email,
  nama = excluded.nama,
  peran = excluded.peran,
  bidang = excluded.bidang;

select email, nama, peran, bidang
from public.profiles
order by peran, bidang nulls first, nama;
