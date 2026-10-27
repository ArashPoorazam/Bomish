import { Suspense, type ReactNode } from "react";
import { StoreProvider } from "@/components/store-provider";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { SupportButton } from "@/components/requests/support-button";
import { ReferralCapture } from "@/components/referral-capture";
import "../storefront.css";

export default function StorefrontLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <StoreProvider>
      <Suspense fallback={null}>
        <ReferralCapture />
      </Suspense>
      <Header />
      <main id="main">{children}</main>
      <Footer />
      <SupportButton />
    </StoreProvider>
  );
}
