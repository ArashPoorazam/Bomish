import type { MetadataRoute } from "next";
import { serverApi } from "@/lib/api";
import type { Product, Article } from "@/lib/types";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (process.env.SITE_INDEXABLE !== "true") return [];
  const root = process.env.SITE_URL || "http://localhost:3000";
  const [p, a] = await Promise.all([
    serverApi<Product[]>("/products"),
    serverApi<Article[]>("/articles"),
  ]);
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
