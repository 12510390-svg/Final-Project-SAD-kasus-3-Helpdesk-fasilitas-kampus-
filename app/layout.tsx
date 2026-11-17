import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fasilitaku | Helpdesk Fasilitas Kampus",
  description: "Frontend helpdesk fasilitas kampus untuk pelapor, admin, teknisi, dan kepala unit",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
