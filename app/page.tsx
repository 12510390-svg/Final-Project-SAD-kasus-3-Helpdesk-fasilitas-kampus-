"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";

type Role = "Pelapor" | "Admin" | "Teknisi" | "Kepala Unit";
type DbRole = "pelapor" | "admin" | "teknisi" | "kepala_unit";
type DbStatus = "baru" | "ditugaskan" | "dikerjakan" | "ditahan" | "menunggu_konfirmasi" | "selesai" | "dibuka_kembali" | "ditolak";
type ReporterView = "dashboard" | "create" | "reports" | "track" | "facilities" | "help";
type DbReport = { id: string; nomor: string; gedung_id: number; ruang: string; jenis: string; deskripsi: string; foto_url: string | null; status: DbStatus; prioritas: "darurat" | "tinggi" | "normal" | null; tenggat: string | null; dibuat_pada: string; catatan_admin: string | null; pelapor_id: string };
type Technician = { id: string; nama: string; bidang: string | null };
const roleNames: Record<DbRole, Role> = { pelapor: "Pelapor", admin: "Admin", teknisi: "Teknisi", kepala_unit: "Kepala Unit" };
const meta: Record<Role, { initials: string; label: string }> = { Pelapor: { initials: "PL", label: "Buat laporan dan pantau perkembangannya" }, Admin: { initials: "AD", label: "Kelola, prioritaskan, dan tugaskan laporan" }, Teknisi: { initials: "TK", label: "Lihat tugas dan perbarui pengerjaan" }, "Kepala Unit": { initials: "KU", label: "Pantau tenggat dan rekap fasilitas" } };
const statusLabel: Record<DbStatus, string> = { baru: "Baru", ditugaskan: "Ditugaskan", dikerjakan: "Dikerjakan", ditahan: "Ditahan", menunggu_konfirmasi: "Menunggu Konfirmasi", selesai: "Selesai", dibuka_kembali: "Dibuka Kembali", ditolak: "Ditolak" };
const priorityLabel: Record<NonNullable<DbReport["prioritas"]>, string> = { darurat: "Darurat", tinggi: "Tinggi", normal: "Normal" };

export default function Home() {
  const [role, setRole] = useState<Role | null>(null); const [name, setName] = useState(""); const [userId, setUserId] = useState(""); const [loading, setLoading] = useState(true); const [reports, setReports] = useState<DbReport[]>([]); const [buildings, setBuildings] = useState<Record<number, string>>({}); const [technicians, setTechnicians] = useState<Technician[]>([]); const [showForm, setShowForm] = useState(false); const [uploading, setUploading] = useState(false); const [toast, setToast] = useState("");
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 3600); };
  const loadWorkspace = async (activeRole: Role) => { const [reportResult, buildingResult, techResult] = await Promise.all([supabase.from("reports").select("*").order("dibuat_pada", { ascending: false }), supabase.from("gedung").select("id,nama"), activeRole === "Admin" ? supabase.from("profiles").select("id,nama,bidang").eq("peran", "teknisi") : Promise.resolve({ data: [] as Technician[] })]); if (reportResult.error) notify("Data laporan belum dapat dimuat: " + reportResult.error.message); setReports((reportResult.data ?? []) as DbReport[]); setBuildings(Object.fromEntries((buildingResult.data ?? []).map((item) => [item.id as number, item.nama as string]))); setTechnicians((techResult.data ?? []) as Technician[]); };
  const loadProfile = async (id: string) => { const { data } = await supabase.from("profiles").select("nama,peran").eq("id", id).single(); if (!data) { setLoading(false); return; } const activeRole = roleNames[data.peran as DbRole]; setRole(activeRole); setName(data.nama as string); setUserId(id); await loadWorkspace(activeRole); setLoading(false); };
  // Sesi Supabase hanya perlu didaftarkan sekali saat halaman pertama kali dimuat.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { supabase.auth.getSession().then(({ data }) => { if (data.session) loadProfile(data.session.user.id); else setLoading(false); }); const { data: listener } = supabase.auth.onAuthStateChange((_event: string, session: Session | null) => { if (session) loadProfile(session.user.id); else { setRole(null); setName(""); setUserId(""); setReports([]); setLoading(false); } }); return () => listener.subscription.unsubscribe(); }, []);
  const refresh = () => role && userId && loadWorkspace(role);
  const createReport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (uploading || !userId) return;

    const form = new FormData(event.currentTarget);
    const photo = form.get("foto") as File | null;
    if (photo?.size) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(photo.type)) return notify("Bukti harus berupa foto JPG, PNG, atau WEBP.");
      if (photo.size > 5 * 1024 * 1024) return notify("Ukuran foto bukti maksimal 5 MB.");
    }

    setUploading(true);
    const { data: numberData, error: numberError } = await supabase.rpc("new_report_number");
    if (numberError || !numberData) {
      setUploading(false);
      return notify("Nomor laporan belum bisa dibuat: " + (numberError?.message ?? "coba lagi."));
    }

    let photoPath: string | null = null;
    if (photo?.size) {
      const extension = (photo.name.split(".").pop() || "jpg").toLowerCase();
      photoPath = `${userId}/${numberData}-${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from("report-photos").upload(photoPath, photo, { cacheControl: "3600", upsert: false, contentType: photo.type });
      if (uploadError) {
        setUploading(false);
        return notify("Foto bukti gagal diunggah: " + uploadError.message);
      }
    }

    const gedungId = Number(form.get("gedung"));
    const reportType = String(form.get("jenis"));
    const title = String(form.get("judul") || "").trim();
    const details = String(form.get("deskripsi"));
    const reportDescription = title ? `${title} — ${details}` : details;
    const { error } = await supabase.rpc("create_report_and_assign", { p_nomor: numberData, p_gedung_id: gedungId, p_ruang: String(form.get("ruang")), p_jenis: reportType, p_deskripsi: reportDescription, p_foto_url: photoPath });
    if (error) {
      if (photoPath) await supabase.storage.from("report-photos").remove([photoPath]);
      setUploading(false);
      return notify("Laporan gagal dikirim: " + error.message);
    }

    setUploading(false);
    setShowForm(false);
    notify(`Laporan ${numberData} berhasil dikirim dan langsung dialurkan ke Teknisi ${reportType.toUpperCase()}${photoPath ? " beserta foto bukti" : ""}.`);
    await refresh();
  };
  if (loading) return <main className="login-page"><p>Memuat sesi akun...</p></main>;
  if (!role) return <LoginScreen />;
  const active = meta[role];
  if (role === "Pelapor") return <ReporterPortal name={name} reports={reports} buildings={buildings} submit={createReport} submitting={uploading} refresh={refresh} notify={notify} logout={() => supabase.auth.signOut()} toast={toast} />;
  if (["Admin", "Teknisi", "Kepala Unit"].includes(role)) return <StaffPortal role={role} name={name} reports={reports} buildings={buildings} technicians={technicians} refresh={refresh} notify={notify} logout={() => supabase.auth.signOut()} toast={toast} />;
  return <main className="helpdesk-app"><aside className="side-panel"><div className="brand"><span className="brand-symbol">✦</span><span>FasilitasKami</span></div><p className="campus">HELPDESK FASILITAS KAMPUS</p><nav className="dashboard-nav" aria-label="Menu dashboard"><a className="active" href="#dashboard-content"><i>⌂</i>Beranda</a></nav><div className="signed-role"><p>AKUN MASUK</p><b>{active.initials}</b><span><strong>{name}</strong><small>{role}</small></span></div><button className="dashboard-logout" onClick={() => supabase.auth.signOut()}>Keluar <span>→</span></button></aside><section className="workspace"><header className="topbar"><div><p className="crumb">UNIVERSITAS NUSANTARA / HELPDESK FASILITAS</p><h1>Ruang kerja {role}</h1></div><div className="profile"><span className="avatar">{active.initials}</span><div><strong>{name}</strong><small>{role}</small></div></div></header><div className="page-content" id="dashboard-content">{role === "Admin" && <Admin reports={reports} buildings={buildings} technicians={technicians} refresh={refresh} notify={notify} />}{role === "Teknisi" && <Technician reports={reports} buildings={buildings} refresh={refresh} notify={notify} />}{role === "Kepala Unit" && <Head reports={reports} buildings={buildings} refresh={refresh} notify={notify} />}</div></section><ActivityRail reports={reports} buildings={buildings} role={role} />{showForm && <ReportForm close={() => setShowForm(false)} submit={createReport} buildings={buildings} submitting={uploading} />}{toast && <div className="toast">✓ {toast}</div>}</main>;
}

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const openLogin = () => { setError(""); setLoginOpen(true); window.scrollTo({ top: 0, behavior: "smooth" }); };
  useEffect(() => {
    const cards = [...document.querySelectorAll<HTMLElement>(".landing-page .type-card")];
    const activate = () => openLogin();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); } };
    cards.forEach((card) => { card.tabIndex = 0; card.setAttribute("role", "button"); card.setAttribute("aria-label", `Buat laporan kategori ${card.textContent?.trim()}`); card.addEventListener("click", activate); card.addEventListener("keydown", onKeyDown); });
    return () => cards.forEach((card) => { card.removeEventListener("click", activate); card.removeEventListener("keydown", onKeyDown); });
  });
  const submit = async (event: FormEvent) => { event.preventDefault(); setSending(true); setError(""); const { error: authError } = await supabase.auth.signInWithPassword({ email, password }); if (authError) { setError(`Login ditolak oleh Supabase: ${authError.message}`); setSending(false); } };

  if (loginOpen) return <main className="login-page"><button className="back-to-landing" type="button" onClick={() => setLoginOpen(false)}>← Kembali ke beranda</button><section className="login-story"><div className="login-story-inner"><div className="brand login-brand"><span className="brand-symbol">✦</span><span>FasilitasKami</span></div><p className="story-kicker">PORTAL LAYANAN KAMPUS</p><div className="story-heading"><h1>Fasilitas rusak?<br/><span>Jangan dipendam.</span></h1><p>Satu laporan kecil dari kamu membantu kampus menjadi tempat belajar yang lebih nyaman untuk semua.</p></div><div className="service-flow"><p className="flow-title">LAPORANMU PUNYA ALUR JELAS</p><div><b>01</b><span><strong>Kirim laporan</strong><small>Ceritakan kendala yang kamu temukan</small></span></div><div><b>02</b><span><strong>Diproses admin</strong><small>Laporan diarahkan ke teknisi terkait</small></span></div><div><b>03</b><span><strong>Pantau progres</strong><small>Lihat perubahan status di dashboardmu</small></span></div></div><p className="story-footer">UNIT SARANA &amp; PRASARANA <span>•</span> KAMPUS YANG LEBIH NYAMAN</p></div></section><section className="login-access"><div className="login-card"><p className="eyebrow">AKSES PENGGUNA</p><h2>Halo, selamat datang!</h2><p className="login-copy">Masuk dengan akun yang diberikan untuk membuat laporan atau memantau progresnya.</p><form onSubmit={submit}><label>Email<input type="email" placeholder="nama@kampus.ac.id" value={email} onChange={(e) => setEmail(e.target.value)} required /></label><label>Kata sandi<input type="password" placeholder="Masukkan kata sandi" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>{error && <p className="login-error">{error}</p>}<button className="primary full login-submit" disabled={sending}>{sending ? "Memeriksa akun..." : <>Masuk ke dashboard <span aria-hidden="true">→</span></>}</button></form><div className="login-security"><span aria-hidden="true">✓</span><p>Dashboard akan menyesuaikan peran akun Anda.</p></div></div><div className="login-access-foot">FasilitasKami <span>·</span> Helpdesk fasilitas kampus</div></section></main>;

  return <main className="landing-page"><section className="landing-hero"><nav className="landing-nav"><button type="button" className="landing-brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><span>✦</span> FasilitasKami</button><div className="landing-nav-links"><a href="#cara-kerja">Cara kerja</a><a href="#laporkan">Jenis laporan</a></div><button type="button" className="nav-login" onClick={openLogin}>Masuk <span>↗</span></button></nav><div className="hero-grid"><div className="hero-copy"><p className="hero-label"><i /> HELP DESK FASILITAS KAMPUS</p><h1>KAMPUS<br/>NYAMAN,<br/><em>DIMULAI</em> DARI<br/>LAPORANMU.</h1><p className="hero-description">Ketemu fasilitas kampus yang bermasalah? Ceritakan di sini. Kami bantu alurkan laporanmu sampai ada tindak lanjut.</p><div className="hero-actions"><button type="button" className="hero-cta" onClick={openLogin}>Buat laporan <span>→</span></button><button type="button" className="hero-text-button" onClick={() => document.getElementById("cara-kerja")?.scrollIntoView({ behavior: "smooth" })}>Lihat cara kerja <span>↓</span></button></div><div className="hero-counts"><div><b>4</b><span>kategori<br/>fasilitas</span></div><div><b>3</b><span>langkah<br/>pelaporan</span></div><div><b>1</b><span>tempat untuk<br/>memantau</span></div></div></div><div className="hero-art" aria-hidden="true"><span className="art-spark spark-one">✦</span><span className="art-spark spark-two">✳</span><span className="art-scribble">⌁</span><div className="art-halo"/><div className="report-poster"><div className="poster-top"><span>FasilitasKami</span><b>01</b></div><p className="poster-sticker">LAPOR<br/>SEKARANG!</p><div className="poster-window"><span>⚡</span><i/><i/><i/></div><h2>ADA YANG<br/><em>NGGAK BERES?</em></h2><p>Jangan cuma lewat. Kirim laporanmu!</p><div className="poster-footer"><span>CEPAT</span><span>MUDAH</span><span>TERPANTAU</span></div></div><div className="art-chip chip-status"><b>✓</b><span><small>STATUS</small>Diproses</span></div><div className="art-chip chip-location"><b>⌖</b><span><small>LOKASI</small>Gedung kampus</span></div></div></div><div className="hero-marquee"><span>FASILITAS BAIK • BELAJAR ENAK • LAPOR ITU MUDAH • </span><span>FASILITAS BAIK • BELAJAR ENAK • LAPOR ITU MUDAH • </span></div></section><section className="landing-intro" id="cara-kerja"><div className="section-marker">01 <span>CARANYA GAMPANG</span></div><div className="intro-title"><p>NGGAK PAKAI RIBET</p><h2>TIGA LANGKAH.<br/><em>SATU</em> PERUBAHAN.</h2></div><div className="step-list"><article className="step-card step-purple"><span>01</span><div className="step-icon">✎</div><h3>CERITAKAN<br/>KENDALANYA</h3><p>Pilih gedung, ruang, dan jenis masalah. Tambahkan penjelasan agar lebih jelas.</p></article><article className="step-card step-lime"><span>02</span><div className="step-icon">↗</div><h3>LAPORAN<br/>DIALURKAN</h3><p>Admin memeriksa laporan lalu meneruskannya kepada teknisi bidang terkait.</p></article><article className="step-card step-orange"><span>03</span><div className="step-icon">✓</div><h3>PANTAU<br/>PROGRESNYA</h3><p>Lihat status terbaru dan konfirmasi ketika fasilitas sudah selesai ditangani.</p></article></div></section><section className="report-types" id="laporkan"><div className="types-copy"><p className="section-marker">02 <span>YANG BISA DILAPORKAN</span></p><h2>ADA MASALAH<br/><em>DI MANA?</em></h2><p>Mulai dari ruangan kuliah sampai area umum, laporanmu membantu fasilitas kampus terus bekerja dengan baik.</p><button type="button" className="types-cta" onClick={openLogin}>Mulai membuat laporan <span>→</span></button></div><div className="type-orbit"><article className="type-card type-electric"><b>⚡</b><span>Listrik</span></article><article className="type-card type-cool"><b>❄</b><span>AC</span></article><article className="type-card type-water"><b>≈</b><span>Air</span></article><article className="type-card type-building"><b>▦</b><span>Bangunan</span></article><span className="orbit-line one"/><span className="orbit-line two"/><span className="orbit-dot">✦</span></div></section><section className="landing-closing"><p>JANGAN BIARKAN MASALAH KECIL JADI MENGGANGGU.</p><h2>YUK, BIKIN KAMPUS<br/><em>LEBIH NYAMAN.</em></h2><button type="button" onClick={openLogin}>Masuk &amp; buat laporan <span>→</span></button><small>FasilitasKami · Helpdesk fasilitas kampus</small></section></main>;
}

function ReporterPortal({ name, reports, buildings, submit, submitting, refresh, notify, logout, toast }: { name: string; reports: DbReport[]; buildings: Record<number, string>; submit: (event: FormEvent<HTMLFormElement>) => void; submitting: boolean; refresh: () => void; notify: (text: string) => void; logout: () => void; toast: string }) {
  const [view, setView] = useState<ReporterView>("dashboard");
  const [trackedId, setTrackedId] = useState("");
  const firstName = name.trim().split(" ")[0] || "Pelapor";
  const selectView = (nextView: ReporterView) => { setView(nextView); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const startTracking = (reportId: string) => { setTrackedId(reportId); selectView("track"); };
  const navigation: { key: ReporterView; icon: string; label: string }[] = [
    { key: "dashboard", icon: "⌂", label: "Beranda" },
    { key: "create", icon: "＋", label: "Buat laporan" },
    { key: "reports", icon: "▤", label: "Laporan saya" },
    { key: "track", icon: "⌕", label: "Lacak status" },
    { key: "facilities", icon: "⌂", label: "Fasilitas" },
    { key: "help", icon: "?", label: "Bantuan" },
  ];

  return <main className="reporter-app">
    <aside className="reporter-sidebar">
      <button className="reporter-brand" type="button" onClick={() => selectView("dashboard")}><span>F</span><b>FasilitasKami</b></button>
      <nav className="reporter-nav" aria-label="Menu Pelapor">{navigation.map((item) => <button key={item.key} type="button" onClick={() => selectView(item.key)} className={view === item.key ? "active" : ""}><i>{item.icon}</i>{item.label}</button>)}</nav>
      <div className="reporter-account"><span>{name.slice(0, 2).toUpperCase()}</span><div><strong>{name}</strong><small>Pelapor</small></div></div>
      <button type="button" className="reporter-logout" onClick={logout}>Keluar <span>→</span></button>
    </aside>
    <section className="reporter-workspace">
      <header className="reporter-header"><div><p>HELPDESK FASILITAS KAMPUS</p><h1>{view === "dashboard" ? `Halo, ${firstName}` : reporterTitle[view]}</h1></div><button className="reporter-new-report" type="button" onClick={() => selectView("create")}><span>＋</span> Laporan baru</button></header>
      <div className="reporter-page">
        {view === "dashboard" && <ReporterDashboard reports={reports} buildings={buildings} name={firstName} onCreate={() => selectView("create")} onReports={() => selectView("reports")} onTrack={startTracking} />}
        {view === "create" && <ReporterCreate buildings={buildings} submit={submit} submitting={submitting} onDone={() => selectView("reports")} />}
        {view === "reports" && <ReporterReports reports={reports} buildings={buildings} refresh={refresh} onTrack={startTracking} />}
        {view === "track" && <ReporterTrack reports={reports} buildings={buildings} selectedId={trackedId} onSelect={setTrackedId} onCreate={() => selectView("create")} />}
        {view === "facilities" && <ReporterFacilities buildings={buildings} reports={reports} onCreate={() => selectView("create")} />}
        {view === "help" && <ReporterHelp onCreate={() => selectView("create")} notify={notify} />}
      </div>
    </section>
    {toast && <div className="toast">✓ {toast}</div>}
  </main>;
}

function StaffPortal({ role, name, reports, buildings, technicians, refresh, notify, logout, toast }: { role: Exclude<Role, "Pelapor">; name: string; reports: DbReport[]; buildings: Record<number, string>; technicians: Technician[]; refresh: () => void; notify: (text: string) => void; logout: () => void; toast: string }) {
  const [view, setView] = useState<"dashboard" | "workspace">("dashboard");
  const [selectedId, setSelectedId] = useState("");
  const firstName = name.trim().split(" ")[0] || role;
  const active = meta[role];
  const selected = reports.find((report) => report.id === selectedId) ?? reports[0] ?? null;
  const openWorkspace = () => { setView("workspace"); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const roleCopy = role === "Admin"
    ? { kicker: "PUSAT KOORDINASI", title: "Atur laporan, <em>pastikan cepat ditangani.</em>", description: "Tinjau laporan masuk, tentukan prioritas, lalu arahkan ke teknisi yang tepat.", main: "Kelola laporan", workLabel: "Kelola laporan" }
    : role === "Teknisi"
      ? { kicker: "RUANG KERJA TEKNISI", title: "Tugas lapangan, <em>lebih terarah.</em>", description: "Lihat tugas yang masuk untuk bidangmu dan perbarui progres pengerjaannya.", main: "Buka tugas", workLabel: "Tugas saya" }
      : { kicker: "PANTAU LAYANAN", title: "Fasilitas terjaga, <em>kampus lebih nyaman.</em>", description: "Pantau tren laporan dan pekerjaan yang membutuhkan perhatian unit.", main: "Lihat pemantauan", workLabel: "Pemantauan" };
  const pending = reports.filter((report) => ["baru", "ditugaskan", "dikerjakan", "menunggu_konfirmasi"].includes(report.status)).length;
  const processing = reports.filter((report) => ["ditugaskan", "dikerjakan", "menunggu_konfirmasi"].includes(report.status)).length;
  const completed = reports.filter((report) => report.status === "selesai").length;

  const assign = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    const priority = String(data.get("priority")) as NonNullable<DbReport["prioritas"]>;
    const technicianId = String(data.get("technician"));
    const hours = priority === "darurat" ? 4 : priority === "tinggi" ? 24 : 72;
    const due = new Date(Date.now() + hours * 3600000).toISOString();
    const { error } = await supabase.from("reports").update({ prioritas: priority, tenggat: due, status: "ditugaskan" }).eq("id", selected.id);
    if (error) return notify(error.message);
    const assignment = await supabase.from("assignments").upsert({ laporan_id: selected.id, teknisi_id: technicianId, catatan: String(data.get("note") || "") }, { onConflict: "laporan_id,teknisi_id" });
    if (assignment.error) return notify(assignment.error.message);
    await supabase.from("status_history").insert({ laporan_id: selected.id, status_lama: selected.status, status_baru: "ditugaskan", keterangan: "Teknisi ditugaskan oleh Admin" });
    notify("Penugasan berhasil disimpan. Tugas langsung muncul pada akun teknisi.");
    await refresh();
  };
  const updateTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    const status = String(data.get("status")) as DbStatus;
    const note = String(data.get("note") || "");
    const { error } = await supabase.from("reports").update({ status, menunggu_konfirmasi_pada: status === "menunggu_konfirmasi" ? new Date().toISOString() : null }).eq("id", selected.id);
    if (error) return notify(error.message);
    await supabase.from("status_history").insert({ laporan_id: selected.id, status_lama: selected.status, status_baru: status, keterangan: note });
    notify("Status pekerjaan berhasil diperbarui.");
    await refresh();
  };
  const navigation = [{ key: "dashboard" as const, icon: "⌂", label: "Beranda" }, { key: "workspace" as const, icon: role === "Teknisi" ? "⌁" : role === "Admin" ? "▤" : "◌", label: roleCopy.workLabel }];

  return <main className="reporter-app staff-app">
    <aside className="reporter-sidebar">
      <button className="reporter-brand" type="button" onClick={() => setView("dashboard")}><span>F</span><b>FasilitasKami</b></button>
      <nav className="reporter-nav" aria-label={`Menu ${role}`}>{navigation.map((item) => <button key={item.key} type="button" onClick={() => setView(item.key)} className={view === item.key ? "active" : ""}><i>{item.icon}</i>{item.label}</button>)}</nav>
      <div className="reporter-account"><span>{active.initials}</span><div><strong>{name}</strong><small>{role}</small></div></div>
      <button type="button" className="reporter-logout" onClick={logout}>Keluar <span>→</span></button>
    </aside>
    <section className="reporter-workspace">
      <header className="reporter-header"><div><p>HELPDESK FASILITAS KAMPUS</p><h1>{view === "dashboard" ? `Halo, ${firstName}` : roleCopy.workLabel}</h1></div><button className="reporter-new-report" type="button" onClick={refresh}><span>↻</span> Perbarui data</button></header>
      <div className="reporter-page staff-page">
        {view === "dashboard" && <>
          <section className="reporter-welcome staff-welcome"><div><p>{roleCopy.kicker}</p><h2>{roleCopy.title.split("<em>")[0]}<em>{roleCopy.title.split("<em>")[1]?.replace("</em>", "")}</em></h2><span>{roleCopy.description}</span></div><button type="button" onClick={openWorkspace}>{roleCopy.main} <b>→</b></button><i className="welcome-orbit" /></section>
          <section className="reporter-stats staff-stats"><article><span className="stat-icon wait">◷</span><div><small>{role === "Admin" ? "Perlu ditinjau" : "Laporan aktif"}</small><strong>{pending} <em>laporan</em></strong></div></article><article><span className="stat-icon progress">⌁</span><div><small>{role === "Kepala Unit" ? "Sedang dipantau" : "Dalam pengerjaan"}</small><strong>{processing} <em>laporan</em></strong></div></article><article><span className="stat-icon complete">✓</span><div><small>Telah selesai</small><strong>{completed} <em>laporan</em></strong></div></article></section>
          <div className="staff-overview-grid"><section className="reporter-recent"><div className="reporter-section-head"><div><p>AKTIVITAS TERBARU</p><h2>{role === "Teknisi" ? "Tugas masuk" : "Laporan terbaru"}</h2></div><button type="button" onClick={openWorkspace}>Lihat semua <span>→</span></button></div>{reports.slice(0, 5).map((report) => <button key={report.id} type="button" onClick={() => { setSelectedId(report.id); openWorkspace(); }}><b>{reporterIcon(report.jenis)}</b><span><strong>{shortDescription(report.deskripsi)}</strong><small>{buildings[report.gedung_id] ?? "Gedung kampus"} · {report.ruang}</small></span><ReporterStatus status={report.status} /></button>)}{!reports.length && <p className="reporter-empty">Belum ada laporan untuk ditampilkan.</p>}</section><aside className="reporter-tips staff-role-card"><p>AKSES {role.toUpperCase()}</p><h3>{role === "Admin" ? "Penugasan lebih cepat." : role === "Teknisi" ? "Selesaikan tugasmu." : "Kualitas layanan terpantau."}</h3><span>{role === "Admin" ? "Tetapkan prioritas dan teknisi agar laporan langsung masuk ke ruang kerja yang sesuai." : role === "Teknisi" ? "Perbarui status pekerjaan setiap ada perkembangan agar pelapor mendapat informasi terbaru." : "Gunakan ringkasan laporan untuk melihat area yang membutuhkan perhatian."}</span><button type="button" onClick={openWorkspace}>Buka {roleCopy.workLabel} <b>→</b></button></aside></div>
        </>}
        {view === "workspace" && <section className="staff-workspace">
          <div className="reporter-page-intro row"><div><p>{roleCopy.kicker}</p><h2>{roleCopy.workLabel}</h2><span>{role === "Admin" ? "Pilih laporan untuk menetapkan prioritas dan teknisi." : role === "Teknisi" ? "Pilih tugas untuk memperbarui status pengerjaan." : "Lihat kondisi laporan dan capaian layanan fasilitas."}</span></div><button type="button" onClick={refresh}>↻ Perbarui</button></div>
          <div className="staff-work-grid">
            <section className="staff-report-list">
              {reports.map((report) => <button type="button" key={report.id} onClick={() => setSelectedId(report.id)} className={selected?.id === report.id ? "selected" : ""}><span>{reporterIcon(report.jenis)}</span><div><small>{report.nomor}</small><strong>{shortDescription(report.deskripsi)}</strong><em>{buildings[report.gedung_id] ?? "Gedung kampus"} · {report.ruang}</em></div><ReporterStatus status={report.status} /><i>›</i></button>)}
              {!reports.length && <p className="reporter-empty">Belum ada laporan untuk peran ini.</p>}
            </section>
            <aside className="staff-action-card">
              {selected ? <>
                <p>{selected.nomor}</p><h3>{shortDescription(selected.deskripsi)}</h3><span>{buildings[selected.gedung_id] ?? "Gedung kampus"} · Ruang {selected.ruang} · {selected.jenis.toUpperCase()}</span><ReporterStatus status={selected.status} />
                {selected.foto_url && <ReportEvidence path={selected.foto_url} />}
                {role === "Admin" && <form onSubmit={assign}><label>Prioritas<select name="priority" required defaultValue={selected.prioritas ?? ""}><option value="" disabled>Tetapkan prioritas</option><option value="darurat">Darurat</option><option value="tinggi">Tinggi</option><option value="normal">Normal</option></select></label><label>Teknisi<select name="technician" required defaultValue=""><option value="" disabled>Pilih teknisi</option>{technicians.map((technician) => <option key={technician.id} value={technician.id}>{technician.nama} — {technician.bidang}</option>)}</select></label><label>Catatan<input name="note" placeholder="Instruksi untuk teknisi" /></label><button>Simpan penugasan →</button></form>}
                {role === "Teknisi" && <form onSubmit={updateTask}><label>Perbarui status<select name="status" defaultValue={selected.status}><option value="dikerjakan">Dikerjakan</option><option value="ditahan">Ditahan</option><option value="menunggu_konfirmasi">Menunggu konfirmasi</option></select></label><label>Catatan pekerjaan<textarea name="note" placeholder="Tambahkan hasil atau hambatan pekerjaan..." /></label><button>Simpan pembaruan →</button></form>}
                {role === "Kepala Unit" && <div className="staff-monitor-note"><b>Informasi pemantauan</b><p>Prioritas: {selected.prioritas ? priorityLabel[selected.prioritas] : "Belum ditetapkan"}</p><p>{selected.tenggat ? `Tenggat: ${new Date(selected.tenggat).toLocaleDateString("id-ID")}` : "Tenggat belum ditetapkan"}</p><p>{selected.catatan_admin || "Belum ada catatan tambahan dari admin."}</p></div>}
              </> : <p className="reporter-empty">Pilih laporan pada daftar.</p>}
            </aside>
          </div>
        </section>}
      </div>
    </section>
    {toast && <div className="toast">✓ {toast}</div>}
  </main>;
}

const reporterTitle: Record<Exclude<ReporterView, "dashboard">, string> = { create: "Buat laporan", reports: "Laporan saya", track: "Lacak status", facilities: "Fasilitas kampus", help: "Bantuan" };
const reporterIcon = (kind: string) => kind === "ac" ? "AC" : kind === "listrik" ? "ϟ" : kind === "air" ? "≈" : "▦";
const shortDescription = (description: string) => description.split(" — ")[0];
const isComplete = (status: DbStatus) => ["selesai", "ditolak"].includes(status);
const isInProgress = (status: DbStatus) => ["ditugaskan", "dikerjakan", "menunggu_konfirmasi"].includes(status);

function ReporterDashboard({ reports, buildings, name, onCreate, onReports, onTrack }: { reports: DbReport[]; buildings: Record<number, string>; name: string; onCreate: () => void; onReports: () => void; onTrack: (reportId: string) => void }) {
  const waiting = reports.filter((report) => report.status === "baru").length;
  const inProgress = reports.filter((report) => isInProgress(report.status)).length;
  const completed = reports.filter((report) => report.status === "selesai").length;
  const featureReports = reports.slice(0, 3);
  const recent = reports.slice(0, 4);
  return <>
    <section className="reporter-welcome"><div><p>RINGKASAN PELAPOR</p><h2>Semua laporanmu<br/><em>terpantau di sini.</em></h2><span>Halo {name}, pantau laporan atau buat laporan baru dalam satu ruang kerja.</span></div><button type="button" onClick={onCreate}>Buat laporan <b>→</b></button><i className="welcome-orbit" /></section>
    <section className="reporter-stats">
      <article><span className="stat-icon wait">◷</span><div><small>Menunggu tindak lanjut</small><strong>{waiting} <em>laporan</em></strong></div></article>
      <article><span className="stat-icon progress">↗</span><div><small>Sedang diproses</small><strong>{inProgress} <em>laporan</em></strong></div></article>
      <article><span className="stat-icon complete">✓</span><div><small>Selesai ditangani</small><strong>{completed} <em>laporan</em></strong></div></article>
    </section>
    <section className="reporter-section-head"><div><p>STATUS TERBARU</p><h2>Laporan yang perlu kamu pantau</h2></div><button type="button" onClick={onReports}>Lihat semua <span>→</span></button></section>
    <section className="reporter-feature-grid">{featureReports.length ? featureReports.map((report, index) => <button type="button" key={report.id} className={`reporter-feature-card tone-${index % 3}`} onClick={() => onTrack(report.id)}><span className="feature-icon">{reporterIcon(report.jenis)}</span><small>{statusLabel[report.status]}</small><h3>{shortDescription(report.deskripsi)}</h3><p>{buildings[report.gedung_id] ?? "Gedung kampus"}, {report.ruang}</p><i>→</i></button>) : <article className="reporter-empty-feature"><span>✦</span><h3>Belum ada laporan</h3><p>Mulai dengan membuat laporan fasilitas pertamamu.</p><button type="button" onClick={onCreate}>Buat laporan</button></article>}</section>
    <section className="reporter-bottom-grid"><article className="reporter-recent"><div className="reporter-section-head"><div><p>AKTIVITAS</p><h2>Laporan terbaru</h2></div></div>{recent.length ? recent.map((report) => <button type="button" key={report.id} onClick={() => onTrack(report.id)}><b>{reporterIcon(report.jenis)}</b><span><strong>{shortDescription(report.deskripsi)}</strong><small>{buildings[report.gedung_id] ?? "Gedung kampus"} · {new Date(report.dibuat_pada).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}</small></span><ReporterStatus status={report.status} /></button>) : <p className="reporter-empty">Laporan yang dikirim akan tampil di sini.</p>}</article><article className="reporter-tips"><p>TIP LAPORAN CEPAT</p><h3>Foto yang jelas membantu teknisi memahami kendala lebih cepat.</h3><span>Tambahkan lokasi, ruangan, serta foto bukti ketika membuat laporan.</span><button type="button" onClick={onCreate}>Buat laporan <b>→</b></button></article></section>
  </>;
}

function ReporterCreate({ buildings, submit, submitting, onDone }: { buildings: Record<number, string>; submit: (event: FormEvent<HTMLFormElement>) => void; submitting: boolean; onDone: () => void }) {
  const [type, setType] = useState("ac"); const [title, setTitle] = useState(""); const [building, setBuilding] = useState(""); const categories = [{ key: "listrik", label: "Listrik", icon: "ϟ" }, { key: "ac", label: "AC", icon: "AC" }, { key: "air", label: "Air", icon: "≈" }, { key: "bangunan", label: "Bangunan", icon: "▦" }];
  return <section className="reporter-create-layout"><form className="reporter-form-card" onSubmit={submit}><div className="reporter-page-intro"><p>BUAT LAPORAN</p><h2>Ceritakan kendala fasilitasnya.</h2><span>Laporan akan otomatis diteruskan ke teknisi sesuai jenis kerusakan.</span></div><div className="reporter-form-steps"><span className="active">1 Jenis &amp; lokasi</span><span>2 Detail masalah</span><span>3 Kirim</span></div><input type="hidden" name="jenis" value={type} /><label className="reporter-label">Pilih jenis kerusakan<div className="reporter-category-grid">{categories.map((category) => <button type="button" key={category.key} onClick={() => setType(category.key)} className={type === category.key ? "selected" : ""}><b>{category.icon}</b><span>{category.label}</span></button>)}</div></label><div className="reporter-two-fields"><label>Gedung<select name="gedung" required value={building} onChange={(event) => setBuilding(event.target.value)}><option value="" disabled>Pilih gedung</option>{Object.entries(buildings).map(([id, value]) => <option value={id} key={id}>{value}</option>)}</select></label><label>Ruangan<input name="ruang" required placeholder="Contoh: 204 atau Aula" /></label></div><label>Judul masalah<input name="judul" required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Contoh: AC tidak dingin" /></label><label>Deskripsi<textarea name="deskripsi" required placeholder="Jelaskan kondisi fasilitas, sejak kapan kendala terjadi, dan hal lain yang perlu diketahui teknisi." /></label><label className="reporter-photo-input"><span>Foto bukti <em>opsional</em></span><input name="foto" type="file" accept="image/jpeg,image/png,image/webp" disabled={submitting} /><b>＋</b><strong>Pilih foto bukti</strong><small>JPG, PNG, atau WEBP · maksimal 5 MB</small></label><div className="reporter-form-actions"><button className="reporter-submit" disabled={submitting}>{submitting ? "Mengirim laporan..." : "Kirim laporan"} <span>→</span></button><button type="button" className="reporter-cancel" onClick={onDone}>Lihat laporan saya</button></div></form><aside className="reporter-create-aside"><article className="reporter-summary-card"><p>RINGKASAN LAPORAN</p><b>{reporterIcon(type)}</b><h3>{title || "Masalah fasilitas"}</h3><span>{building ? buildings[Number(building)] : "Pilih gedung"} · Ruangan belum diisi</span><small>Jenis: {categories.find((item) => item.key === type)?.label}</small></article><article className="reporter-create-tip"><p>AGAR LEBIH CEPAT</p><h3>Tambahkan foto yang terang dan pastikan lokasi ditulis dengan jelas.</h3><span>Teknisi akan menerima laporan berdasarkan jenis kerusakan yang kamu pilih.</span></article></aside></section>;
}

function ReporterReports({ reports, buildings, refresh, onTrack }: { reports: DbReport[]; buildings: Record<number, string>; refresh: () => void; onTrack: (reportId: string) => void }) { const [filter, setFilter] = useState<"all" | "active" | "done">("all"); const [query, setQuery] = useState(""); const shownReports = reports.filter((report) => (filter === "all" || (filter === "active" ? !isComplete(report.status) : report.status === "selesai")) && `${report.deskripsi} ${report.nomor} ${buildings[report.gedung_id] ?? ""}`.toLowerCase().includes(query.toLowerCase())); return <section className="reporter-list-page"><div className="reporter-page-intro row"><div><p>SEMUA LAPORAN</p><h2>Laporan yang pernah kamu kirim.</h2></div><button type="button" onClick={refresh}>↻ Perbarui</button></div><div className="reporter-list-controls"><div>{(["all", "active", "done"] as const).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item === "all" ? `Semua ${reports.length}` : item === "active" ? `Aktif ${reports.filter((r) => !isComplete(r.status)).length}` : `Selesai ${reports.filter((r) => r.status === "selesai").length}`}</button>)}</div><label>⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari laporan" /></label></div><div className="reporter-list">{shownReports.length ? shownReports.map((report) => <button className="reporter-list-row" key={report.id} type="button" onClick={() => onTrack(report.id)}><b>{reporterIcon(report.jenis)}</b><div><strong>{shortDescription(report.deskripsi)}</strong><small>{report.nomor} · {buildings[report.gedung_id] ?? "Gedung kampus"}, {report.ruang}</small></div><time>{new Date(report.dibuat_pada).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}</time><ReporterStatus status={report.status} /><i>›</i></button>) : <p className="reporter-empty">Tidak ada laporan yang sesuai.</p>}</div></section>; }

function ReporterTrack({ reports, buildings, selectedId, onSelect, onCreate }: { reports: DbReport[]; buildings: Record<number, string>; selectedId: string; onSelect: (id: string) => void; onCreate: () => void }) { const report = reports.find((item) => item.id === selectedId) ?? reports[0] ?? null; if (!report) return <section className="reporter-track-empty"><span>⌕</span><h2>Belum ada laporan untuk dilacak.</h2><p>Buat laporan terlebih dahulu, lalu perkembangan penanganannya muncul di sini.</p><button type="button" onClick={onCreate}>Buat laporan</button></section>; const stage = report.status === "baru" ? 1 : report.status === "ditugaskan" ? 2 : report.status === "dikerjakan" ? 3 : report.status === "menunggu_konfirmasi" ? 4 : report.status === "selesai" ? 5 : 2; const steps = ["Laporan dikirim", "Teknisi dialurkan", "Dalam pengerjaan", "Menunggu konfirmasi", "Selesai"]; return <section className="reporter-track-layout"><div><div className="reporter-page-intro row"><div><p>PANTAU PROGRES</p><h2>Lacak status laporan.</h2><span>Perkembangan diperbarui langsung dari sistem.</span></div></div><label className="reporter-track-select">Pilih laporan<select value={report.id} onChange={(event) => onSelect(event.target.value)}>{reports.map((item) => <option value={item.id} key={item.id}>{item.nomor} — {shortDescription(item.deskripsi)}</option>)}</select></label><article className="reporter-timeline-card">{steps.map((label, index) => <div className={index + 1 < stage ? "done" : index + 1 === stage ? "current" : ""} key={label}><span>{index + 1 < stage ? "✓" : index + 1}</span><section><strong>{label}</strong><small>{index === 0 ? new Date(report.dibuat_pada).toLocaleString("id-ID") : index + 1 === stage ? statusLabel[report.status] : "Menunggu pembaruan"}</small></section></div>)}</article></div><aside className="reporter-track-side"><article><ReporterStatus status={report.status} /><h3>{shortDescription(report.deskripsi)}</h3><p>{buildings[report.gedung_id] ?? "Gedung kampus"}, Ruang {report.ruang}</p><small>Nomor laporan: {report.nomor}</small>{report.foto_url && <ReporterProofPhoto path={report.foto_url} />}</article><article><p>CATATAN PELAPOR</p><span>Laporan otomatis diarahkan ke teknisi yang sesuai dengan jenis kerusakannya.</span></article></aside></section>; }

function ReporterFacilities({ buildings, reports, onCreate }: { buildings: Record<number, string>; reports: DbReport[]; onCreate: () => void }) { return <section className="reporter-facility-page"><div className="reporter-page-intro row"><div><p>FASILITAS KAMPUS</p><h2>Area yang dapat kamu laporkan.</h2><span>Pilih area untuk membuat laporan fasilitas baru.</span></div><button type="button" onClick={onCreate}>＋ Laporan baru</button></div><div className="reporter-facility-tabs"><span className="active">Semua area</span><span>Gedung</span><span>Area umum</span></div><div className="reporter-facility-grid">{Object.entries(buildings).map(([id, building], index) => { const count = reports.filter((report) => report.gedung_id === Number(id) && !isComplete(report.status)).length; return <article key={id}><b className={`facility-tone-${index % 3}`}>⌂</b><h3>{building}</h3><p>Fasilitas pembelajaran kampus</p><div><span className={count ? "has-reports" : "good"}>{count ? `${count} laporan aktif` : "Kondisi dipantau"}</span><button type="button" onClick={onCreate}>Laporkan →</button></div></article>; })}</div></section>; }

function ReporterHelp({ onCreate, notify }: { onCreate: () => void; notify: (text: string) => void }) { const faqs = [["Bagaimana cara membuat laporan?", "Pilih menu Buat laporan, isi lokasi dan detail masalah, kemudian unggah foto bukti jika tersedia."], ["Berapa lama laporan ditindaklanjuti?", "Laporan langsung dialurkan ke teknisi sesuai kategori. Waktu penanganan mengikuti tingkat kerusakan dan antrean pekerjaan."], ["Apakah saya dapat melihat perkembangan laporan?", "Ya. Buka menu Lacak status atau Laporan saya untuk melihat perkembangan laporan terbaru."], ["Bagaimana jika laporan belum ditanggapi?", "Pastikan lokasi dan deskripsi sudah jelas. Kamu dapat menghubungi Admin Fasilitas untuk bantuan lebih lanjut."]]; return <section className="reporter-help-layout"><div><div className="reporter-page-intro"><p>PUSAT BANTUAN</p><h2>Butuh bantuan?</h2><span>Panduan singkat untuk menggunakan layanan FasilitasKami.</span></div><div className="reporter-faq">{faqs.map(([question, answer]) => <details key={question}><summary>{question}<b>＋</b></summary><p>{answer}</p></details>)}</div></div><aside><article className="reporter-help-contact"><p>LAYANAN HELPDESK</p><h3>Butuh bantuan lebih lanjut?</h3><span>Hubungi Admin Fasilitas kampus untuk kendala akun atau laporan yang belum dapat dipantau.</span><button type="button" onClick={() => notify("Silakan hubungi Admin Fasilitas kampus untuk bantuan lebih lanjut.")}>Tampilkan panduan <b>→</b></button></article><article className="reporter-help-start"><h3>Siap membuat laporan?</h3><p>Lengkapi lokasi, deskripsi, dan foto bukti agar lebih mudah ditangani.</p><button type="button" onClick={onCreate}>Buat laporan</button></article></aside></section>; }

function ReporterStatus({ status }: { status: DbStatus }) { return <span className={`reporter-status ${status}`}>{statusLabel[status]}</span>; }

function ReporterProofPhoto({ path }: { path: string }) { return <ReportEvidence path={path} compact />; }

function ReportEvidence({ path, compact = false }: { path: string; compact?: boolean }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    let isCurrent = true;
    const loadPhoto = async () => {
      if (path.startsWith("http")) { if (isCurrent) setUrl(path); return; }
      const { data, error: signedUrlError } = await supabase.storage.from("report-photos").createSignedUrl(path, 60 * 60);
      if (!isCurrent) return;
      if (signedUrlError || !data?.signedUrl) setError(true);
      else setUrl(data.signedUrl);
    };
    void loadPhoto();
    return () => { isCurrent = false; };
  }, [path]);
  if (error) return <span className="report-evidence-error">Foto bukti tidak dapat dibuka</span>;
  if (!url) return <span className="report-evidence-loading">Memuat foto bukti...</span>;
  // Tautan bertanda tangan dari Supabase bersifat sementara dan tidak dapat dipetakan saat proses build.
  // eslint-disable-next-line @next/next/no-img-element
  return <a className={compact ? "report-evidence compact" : "report-evidence"} href={url} target="_blank" rel="noreferrer"><img src={url} alt="Foto bukti laporan dari pelapor" /><span><b>Foto bukti pelapor</b><small>Klik untuk memperbesar ↗</small></span></a>;
}

function ActivityRail({ reports, buildings, role }: { reports: DbReport[]; buildings: Record<number, string>; role: Role }) { const activeCount = reports.filter((report) => !["selesai", "ditolak"].includes(report.status)).length; const recent = reports.slice(0, 4); const iconFor = (jenis: string) => jenis === "listrik" ? "ϟ" : jenis === "ac" ? "❄" : jenis === "air" ? "≈" : "▦"; return <aside className="activity-rail" id="activity-panel"><div className="activity-heading"><div><p>AKTIVITAS LAYANAN</p><h2>Update terbaru</h2></div><span>{recent.length}</span></div><div className="activity-list">{recent.length ? recent.map((report) => <article className="activity-item" key={report.id}><b>{iconFor(report.jenis)}</b><div><strong>{report.deskripsi}</strong><small>{buildings[report.gedung_id] ?? "Gedung kampus"}</small></div><Status value={report.status} /></article>) : <p className="activity-empty">Belum ada aktivitas laporan.</p>}</div><article className="service-pulse"><p>RINGKASAN LAYANAN</p><strong>{activeCount}</strong><span>laporan masih dalam proses</span><div><i /><i /><i /></div><small>Dipantau oleh {role}</small></article></aside>; }

function Admin({ reports, buildings, technicians, refresh, notify }: { reports: DbReport[]; buildings: Record<number, string>; technicians: Technician[]; refresh: () => void; notify: (text: string) => void }) { const [selected, setSelected] = useState<DbReport | null>(null); const assign = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!selected) return; const data = new FormData(event.currentTarget); const priority = String(data.get("priority")) as NonNullable<DbReport["prioritas"]>; const technicianId = String(data.get("technician")); const hours = priority === "darurat" ? 4 : priority === "tinggi" ? 24 : 72; const due = new Date(Date.now() + hours * 3600000).toISOString(); const { error } = await supabase.from("reports").update({ prioritas: priority, tenggat: due, status: "ditugaskan" }).eq("id", selected.id); if (error) return notify(error.message); const assignment = await supabase.from("assignments").upsert({ laporan_id: selected.id, teknisi_id: technicianId, catatan: String(data.get("note") || "") }, { onConflict: "laporan_id,teknisi_id" }); if (assignment.error) return notify(assignment.error.message); await supabase.from("status_history").insert({ laporan_id: selected.id, status_lama: selected.status, status_baru: "ditugaskan", keterangan: "Teknisi ditugaskan oleh Admin" }); notify("Penugasan berhasil disimpan. Tugas langsung muncul pada akun teknisi."); setSelected(null); refresh(); }; return <><Section title="Semua laporan" subtitle="Pilih laporan, kemudian tetapkan prioritas dan teknisi." action={<button className="text-button" onClick={refresh}>↻ Perbarui</button>} /><div className="admin-grid"><section className="table-panel"><div className="table-head"><span>NOMOR</span><span>LOKASI & KERUSAKAN</span><span>PRIORITAS</span><span>STATUS</span><span /></div>{reports.map((r) => <div className="table-data" key={r.id}><span className="ticket-no">{r.nomor}</span><span><strong>{r.deskripsi}</strong><small>{buildings[r.gedung_id]}, {r.ruang}</small></span><Priority value={r.prioritas} /><Status value={r.status} /><button className="detail" onClick={() => setSelected(r)}>Kelola →</button></div>)}{!reports.length && <Empty text="Belum ada laporan dari pelapor." />}</section><aside className="action-panel"><p className="eyebrow">{selected ? selected.nomor : "PILIH LAPORAN"}</p><h3>{selected ? selected.deskripsi : "Pilih laporan pada daftar"}</h3><p className="muted">{selected ? `${buildings[selected.gedung_id]}, ${selected.ruang}` : "Penugasan akan membuat tugas muncul pada dashboard teknisi."}</p>{selected && <form onSubmit={assign}><label>Prioritas<select name="priority" required defaultValue={selected.prioritas ?? ""}><option value="" disabled>Tetapkan prioritas</option><option value="darurat">Darurat</option><option value="tinggi">Tinggi</option><option value="normal">Normal</option></select></label><label>Teknisi<select name="technician" required defaultValue=""><option value="" disabled>Pilih teknisi</option>{technicians.map((t) => <option key={t.id} value={t.id}>{t.nama} — {t.bidang}</option>)}</select></label><label>Catatan penugasan<input name="note" placeholder="Instruksi untuk teknisi" /></label><button className="primary full">Simpan penugasan</button></form>}</aside></div></>; }

function Technician({ reports, buildings, refresh, notify }: { reports: DbReport[]; buildings: Record<number, string>; refresh: () => void; notify: (text: string) => void }) { const [selected, setSelected] = useState<DbReport | null>(null); const activeReport = selected && reports.some((report) => report.id === selected.id) ? selected : reports[0] ?? null; const update = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!activeReport) return; const form = new FormData(event.currentTarget); const status = String(form.get("status")) as DbStatus; const note = String(form.get("note") || ""); const { error } = await supabase.from("reports").update({ status, menunggu_konfirmasi_pada: status === "menunggu_konfirmasi" ? new Date().toISOString() : null }).eq("id", activeReport.id); if (error) return notify(error.message); await supabase.from("status_history").insert({ laporan_id: activeReport.id, status_lama: activeReport.status, status_baru: status, keterangan: note }); notify("Status pekerjaan berhasil diperbarui."); refresh(); }; return <><Section title="Tugas saya" subtitle="Daftar ini hanya memuat laporan yang ditugaskan kepada Anda." action={<button className="text-button" onClick={refresh}>↻ Perbarui</button>} /><section className="task-layout"><div className="task-list">{reports.map((r) => <button className={activeReport?.id === r.id ? "task selected-task" : "task"} key={r.id} onClick={() => setSelected(r)}><Priority value={r.prioritas} /><div><strong>{r.deskripsi}</strong><span>{buildings[r.gedung_id]}, {r.ruang}</span><small>{r.tenggat ? `Tenggat: ${new Date(r.tenggat).toLocaleString("id-ID")}` : "Tenggat belum ditetapkan"}</small></div><b>›</b></button>)}{!reports.length && <Empty text="Belum ada tugas yang ditugaskan kepada Anda." />}</div>{activeReport && <article className="work-card"><div className="work-top"><div><span className="ticket-no">{activeReport.nomor}</span><h2>{activeReport.deskripsi}</h2><p>{buildings[activeReport.gedung_id]}, {activeReport.ruang}</p></div><Status value={activeReport.status} /></div><div className="detail-box"><b>Jenis kerusakan</b><p>{activeReport.jenis}</p></div><form onSubmit={update}><label>Perbarui status<select name="status" defaultValue={activeReport.status}><option value="dikerjakan">Dikerjakan</option><option value="ditahan">Ditahan</option><option value="menunggu_konfirmasi">Menunggu Konfirmasi</option></select></label><label>Keterangan<textarea name="note" placeholder="Tambahkan hasil atau hambatan pekerjaan..." /></label><button className="primary">Simpan pembaruan</button></form></article>}</section></>; }

function Head({ reports, buildings, refresh, notify }: { reports: DbReport[]; buildings: Record<number, string>; refresh: () => void; notify: (text: string) => void }) { const overdue = reports.filter((r) => r.tenggat && new Date(r.tenggat) < new Date() && !["selesai", "ditolak", "ditahan", "menunggu_konfirmasi"].includes(r.status)); const perBuilding = useMemo(() => Object.entries(buildings).map(([id, name]) => ({ name, count: reports.filter((r) => r.gedung_id === Number(id)).length })).filter((row) => row.count), [reports, buildings]); return <><Section title="Pemantauan fasilitas" subtitle="Ringkasan data laporan aktual dari database." action={<button className="primary" onClick={() => notify("Ekspor CSV dapat ditambahkan pada tahap berikutnya.")}>⇩ Ekspor CSV</button>} /><section className="metric-row"><Metric label="Laporan terlambat" value={`${overdue.length} laporan`} icon="!" danger /><Metric label="Dalam proses" value={`${reports.filter((r) => !["selesai", "ditolak"].includes(r.status)).length} laporan`} icon="◷" /><Metric label="Selesai" value={`${reports.filter((r) => r.status === "selesai").length} laporan`} icon="✓" /></section><section className="head-grid"><article className="overdue-panel"><div className="panel-title"><div><h3>Laporan melewati tenggat</h3><p>Perlu perhatian Kepala Unit.</p></div><span className="overdue">{overdue.length} terlambat</span></div>{overdue.length ? overdue.map((r) => <div className="overdue-row" key={r.id}><div className="late-icon">!</div><div><span className="ticket-no">{r.nomor}</span><strong>{r.deskripsi}</strong><p>{buildings[r.gedung_id]}, {r.ruang}</p></div></div>) : <Empty text="Tidak ada laporan terlambat." />}</article><article className="recap-panel"><div className="panel-title"><div><h3>Rekap per gedung</h3><p>Jumlah laporan yang tersimpan.</p></div><button className="text-button" onClick={refresh}>↻</button></div><div className="recap-bars">{perBuilding.length ? perBuilding.map((row) => <Bar key={row.name} label={row.name} value={String(row.count)} width={`${Math.max(12, (row.count / Math.max(...perBuilding.map((item) => item.count))) * 100)}%`} />) : <Empty text="Belum ada data laporan." />}</div></article></section></>; }

function ReportForm({ close, submit, buildings, submitting }: { close: () => void; submit: (event: FormEvent<HTMLFormElement>) => void; buildings: Record<number, string>; submitting: boolean }) { return <div className="modal-backdrop"><form className="report-form" onSubmit={submit}><div className="form-heading"><div><p className="eyebrow">LAPORAN BARU</p><h2>Buat laporan kerusakan</h2><p>Laporan akan muncul di dashboard Admin setelah dikirim.</p></div><button type="button" className="close" onClick={close} disabled={submitting}>×</button></div><label>Gedung<select name="gedung" required defaultValue=""><option value="" disabled>Pilih gedung</option>{Object.entries(buildings).map(([id, building]) => <option key={id} value={id}>{building}</option>)}</select></label><div className="two-col"><label>Ruang<input name="ruang" required placeholder="Contoh: 3.12" /></label><label>Jenis kerusakan<select name="jenis" required defaultValue=""><option value="" disabled>Pilih jenis</option><option value="listrik">Listrik</option><option value="ac">AC</option><option value="bangunan">Bangunan</option><option value="air">Air</option></select></label></div><label>Deskripsi<textarea name="deskripsi" required placeholder="Jelaskan kerusakan yang ditemukan..." /></label><label className="photo-upload">Foto bukti <span>Opsional</span><input name="foto" type="file" accept="image/jpeg,image/png,image/webp" disabled={submitting} /><small>JPG, PNG, atau WEBP · maksimal 5 MB</small></label><div className="form-actions"><button type="button" className="secondary" onClick={close} disabled={submitting}>Batal</button><button className="primary" disabled={submitting}>{submitting ? "Mengunggah bukti..." : "Kirim laporan"}</button></div></form></div>; }
function Section({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) { return <section className="section-heading"><div><h2>{title}</h2><p>{subtitle}</p></div>{action}</section>; }
function Metric({ label, value, icon, danger }: { label: string; value: string; icon: string; danger?: boolean }) { return <article className={danger ? "metric warning" : "metric"}><span>{icon}</span><div><p>{label}</p><strong>{value}</strong></div></article>; }
function Status({ value }: { value: DbStatus }) { return <span className={`status ${value}`}>{statusLabel[value]}</span>; }
function Priority({ value }: { value: DbReport["prioritas"] }) { return value ? <span className={`priority ${value}`}>{priorityLabel[value]}</span> : <span className="priority normal">Belum diatur</span>; }
function Empty({ text }: { text: string }) { return <p className="empty">{text}</p>; }
function Bar({ label, value, width }: { label: string; value: string; width: string }) { return <div className="bar-row"><span>{label}</span><div><i style={{ width }} /></div><b>{value}</b></div>; }
