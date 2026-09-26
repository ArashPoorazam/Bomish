import Link from "next/link";
import Image from "next/image";
import { serverApi } from "@/lib/api";
import type { Article } from "@/lib/types";
export const metadata = { title: "مجله بومیش" };
export default async function Blog() {
  const articles = await serverApi<Article[]>("/articles");
  return (
    <div className="container section">
      <div className="page-heading">
        <span className="eyebrow">دفتر آشپزخانه</span>
        <h1>مجله بومیش</h1>
        <p>کمی بیشتر بدانیم، کمی خوش‌طعم‌تر بپزیم.</p>
      </div>
      <div className="article-grid">
        {articles.map((a) => (
          <Link key={a.id} href={"/blog/" + a.slug} className="article-card">
            <div className="article-image">
              <Image
                src={a.image}
                alt={a.title}
                fill
                sizes="(max-width: 760px) 50vw, 25vw"
              />
            </div>
            <div>
              <span className="eyebrow">راهنمای آشپزی</span>
              <h2 style={{ fontSize: 22 }}>{a.title}</h2>
              <p>{a.excerpt}</p>
              <span className="text-link">خواندن مقاله ←</span>
            </div>
          </Link>
        ))}
      </div>
      {!articles.length ? <p>اولین نوشته‌ها به‌زودی منتشر می‌شوند.</p> : null}
    </div>
  );
}
