import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic, Fraunces } from "next/font/google";
import "./globals.css";

const body = IBM_Plex_Sans_Arabic({
  variable: "--font-body",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
});

const display = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "700"],
});

export const metadata: Metadata = {
  title: "Iaqar.ai — مكاتب عقارية ذكية",
  description:
    "نظام يقرأ رسائل واتساب، يدرجها، يطبعها، يكتشف النسخ في نفس الحي، ويحوّلها للمالك أو العميل أو الوسيط.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${body.variable} ${display.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
