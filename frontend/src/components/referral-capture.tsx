"use client";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { api } from "@/lib/api";

export function ReferralCapture() {
  const search = useSearchParams();
  const code = search.get("ref");
  useEffect(() => {
    if (code) void api("/referral", "POST", { code }).catch(() => {});
  }, [code]);
  return null;
}
