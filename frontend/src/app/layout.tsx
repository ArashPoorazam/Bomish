import type { Metadata } from "next";
import { connection } from "next/server";
import localFont from "next/font/local";

import "./globals.css";
import "./auth.css";
import "./requests.css";
const vazir = localFont({
  src: "../../public/fonts/Vazirmatn.woff2",
  variable: "--font-vazir",
  display: "swap",
});
export async function generateMetadata(): Promise<Metadata> {
  await connection();
  return {
    title: { default: "بومیش | طعم خوب طبیعت", template: "%s | بومیش" },
    robots:
      process.env.SITE_INDEXABLE === "true"
        ? { index: true, follow: true }
        : { index: false, follow: false },
    description:
      "خرید ادویه، سبزی خشک و دانه‌های خوراکی در بسته‌های متنوع. راهنمای استفاده و آشپزی در بومیش.",
  };
}
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fa" dir="rtl" className={vazir.variable}>
      <body>
        <a className="skip-link" href="#main">
          رفتن به محتوای اصلی
        </a>
        {children}
      </body>
    </html>
  );
}
