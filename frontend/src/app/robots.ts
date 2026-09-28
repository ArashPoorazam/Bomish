import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
  return process.env.SITE_INDEXABLE === "true"
    ? {
        rules: {
          userAgent: "*",
          allow: "/",
          disallow: [
            "/omnisire",
            "/staff",
            "/account",
            "/checkout",
            "/login",
            "/api",
          ],
        },
        sitemap:
          (process.env.SITE_URL || "http://localhost:3000") + "/sitemap.xml",
      }
    : { rules: { userAgent: "*", disallow: "/" } };
}
