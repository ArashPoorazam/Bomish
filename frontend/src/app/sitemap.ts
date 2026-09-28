import type { MetadataRoute } from "next";
import { serverApi } from "@/lib/api";
import type { Product, Article } from "@/lib/types";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (process.env.SITE_INDEXABLE !== "true") return [];
  const root = process.env.SITE_URL || "http://localhost:3000";
  const a = await serverApi<Article[]>("/articles");
  const p: Product[] = [];
  for (let page = 1; ; page++) {
    const batch = await serverApi<{ items: Product[]; total: number }>(
      `/products?page=${page}&pageSize=100`,
    );
    p.push(...batch.items);
    if (p.length >= batch.total || !batch.items.length) break;
  }

  return [
    ...["", "/products", "/blog", "/about"].map((path) => ({
      url: root + path,
    })),
    ...p.map((x) => ({ url: root + "/products/" + x.slug })),
    ...a.map((x) => ({
      url: root + "/blog/" + x.slug,
      lastModified: x.updatedAt,
    })),
  ];
}
