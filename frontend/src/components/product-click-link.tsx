"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { api } from "@/lib/api";
export function ProductClickLink({
  id,
  slug,
  children,
  className = "",
}: {
  id: string;
  slug: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={`/products/${slug}`}
      className={`product-card compact-product ${className}`}
      onClick={() => {
        void api("/events", "POST", {
          kind: "click",
          productId: id,
          query: "",
        }).catch(() => {});
      }}
    >
      {children}
    </Link>
  );
}
