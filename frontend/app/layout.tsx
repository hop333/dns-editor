import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DNS Editor — Управление DNS-записями",
  description: "Редактор DNS-записей для домена",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" data-theme="light" suppressHydrationWarning>
      <body className="min-h-screen antialiased" suppressHydrationWarning>{children}</body>
    </html>
  );
}
