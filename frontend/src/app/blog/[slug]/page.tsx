import Image from "next/image";
import { notFound } from "next/navigation";
import { serverApi } from "@/lib/api";
import type { Article, Product } from "@/lib/types";
import { RichText } from "@/components/rich-text";
import { ProductCard } from "@/components/product-card";
import { date } from "@/lib/format";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  try {
    const a = await serverApi<Article>(
      "/articles/" + encodeURIComponent((await params).slug),
    );
    return { title: a.title, description: a.excerpt };
  } catch {
    return { title: "مقاله پیدا نشد" };
  }
}
export default async function Post({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  let a: Article;
  try {
    a = await serverApi<Article>(
      "/articles/" + encodeURIComponent((await params).slug),
    );
  } catch {
    notFound();
  }
  const products = await serverApi<Product[]>("/products");
  return (
    <article className="container section">
      <header className="article-header">
        <span className="eyebrow">مجله بومیش · {date(a.updatedAt)}</span>
        <h1>{a.title}</h1>
        <p>{a.excerpt}</p>
      </header>
      <div className="article-cover">
        <Image
          src={a.image}
          alt={a.title}
          fill
          sizes="(max-width: 900px) 100vw, 900px"
          priority
        />
      </div>
      <div className="article-body">
        <RichText text={a.body} />
      </div>
      <section className="section">
        <h2 style={{ marginBottom: 24 }}>طعم‌های این نوشته</h2>
        <div className="product-grid">
          {products
            .filter((p) => a.productIds.includes(p.id))
            .map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
        </div>
      </section>
    </article>
  );
}
