import type { Metadata } from "next";
import localFont from "next/font/local";
import { StoreProvider } from "@/components/store-provider";
import { WorkspaceFrame } from "@/components/workspace-frame";

import "leaflet/dist/leaflet.css";
import "./globals.css";
const vazir = localFont({
  src: "../../public/fonts/Vazirmatn.woff2",
  variable: "--font-vazir",
  display: "swap",
});
export const metadata: Metadata = {
  title: { default: "بومیش | طعم خوب طبیعت", template: "%s | بومیش" },
  robots:
    process.env.SITE_INDEXABLE === "true"
      ? { index: true, follow: true }
      : { index: false, follow: false },
  description:
    "خرید ادویه، سبزی خشک و دانه‌های خوراکی در بسته‌های متنوع. راهنمای استفاده و آشپزی در بومیش.",
};
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
        <StoreProvider>
          <WorkspaceFrame>{children}</WorkspaceFrame>
        </StoreProvider>
      </body>
    </html>
  );
}
