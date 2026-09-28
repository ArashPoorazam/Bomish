"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, type ReactNode } from "react";
import { Header } from "./header";
import { Footer } from "./footer";
import { api } from "@/lib/api";
export function WorkspaceFrame({ children }: { children: ReactNode }) {
  const path = usePathname();
  const admin = path.startsWith("/staff") || path.startsWith("/omnisire");
  return (
    <>
      {!admin && (
        <>
          <Suspense fallback={null}>
            <ReferralCapture />
          </Suspense>
          <Header />
        </>
      )}
      <main id="main">{children}</main>
      {!admin && <Footer />}
    </>
  );
}

function ReferralCapture() {
  const search = useSearchParams();
  const code = search.get("ref");
  useEffect(() => {
    if (code) void api("/referral", "POST", { code }).catch(() => {});
  }, [code]);
  return null;
}
