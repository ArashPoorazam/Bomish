"use client";
import { useEffect } from "react";
import { api } from "@/lib/api";
export function ProductEvent({
  productId,
  query,
}: {
  productId?: string;
  query?: string;
}) {
  useEffect(() => {
    if (productId || query?.trim())
      void api("/events", "POST", {
        kind: productId ? "view" : "search",
        productId: productId || "",
        query: query || "",
      }).catch(() => {});
  }, [productId, query]);
  return null;
}
