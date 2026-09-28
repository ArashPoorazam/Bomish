import { ProductEvent } from "@/components/product-event";
import { inStock } from "@/lib/format";
import Link from "next/link";
import { notFound } from "next/navigation";
import { serverApi } from "@/lib/api";
import type { Product, Article } from "@/lib/types";
import { ProductPurchase } from "@/components/product-purchase";
import { ProductGallery } from "@/components/product-gallery";
import { ProductCard } from "@/components/product-card";
import { RichText } from "@/components/rich-text";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  try {
    const p = await serverApi<Product>("/products/" + encodeURIComponent(slug));
    return { title: p.name, description: p.summary };
  } catch {
    return { title: "محصول پیدا نشد" };
  }
}
export default async function Detail({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  let p: Product;
  try {
    p = await serverApi<Product>("/products/" + encodeURIComponent(slug));
  } catch {
    notFound();
  }
  const [products, articles] = await Promise.all([
    serverApi<Product[]>(
      "/products?available=true&category=" +
        encodeURIComponent(p.categoryId) +
        "&pageSize=5",
    ),
    serverApi<Article[]>("/articles"),
  ]);
  const available = products.filter((x) => x.id !== p.id && inStock(x));
  const related = available
    .toSorted(
      (a, b) =>
        Number(b.categoryId === p.categoryId) -
          Number(a.categoryId === p.categoryId) ||
        b.popularity - a.popularity ||
        a.name.localeCompare(b.name, "fa"),
    )
    .slice(0, 4);
  const guides = articles.filter((a) => a.productIds.includes(p.id));
  return (
    <div className="container section">
      <ProductEvent productId={p.id} />
      <nav className="breadcrumbs">
        <Link href="/">خانه</Link>
        <span>/</span>
        <Link href="/products">محصولات</Link>
        <span>/</span>
        <span>{p.name}</span>
      </nav>
      <div className="product-detail">
        <div className="product-intro">
          <span className="eyebrow">عطری برای آشپزخانه شما</span>
          <h1>{p.name}</h1>
          <p className="lead">{p.summary}</p>
          <ProductPurchase product={p} />
        </div>
        <ProductGallery product={p} />
      </div>
      <div className="product-story">
        <aside>
          <h2>بیشتر بشناسیم</h2>
          <p>
            از طعم و کاربرد
            <br />
            تا نگهداری درست.
          </p>
          <nav>
            {[
              [p.description, "معرفی", "intro"],
              [p.uses, "کاربردها", "uses"],
              [p.preparation, "روش استفاده", "preparation"],
              [p.storage, "نگهداری", "storage"],
            ]
              .filter(([text]) => text)
              .map(([, title, id]) => (
                <a key={id} href={"#" + id}>
                  {title}
                </a>
              ))}
          </nav>
        </aside>
        <div>
          {[
            [p.description, "داستان این طعم", "intro"],
            [p.uses, "برای چه غذاهایی مناسب است؟", "uses"],
            [p.preparation, "چطور استفاده کنیم؟", "preparation"],
            [p.storage, "چطور نگهداری کنیم؟", "storage"],
            [p.ingredients, "ترکیبات", "ingredients"],
            [p.allergens, "اطلاعات حساسیت‌زا", "allergens"],
          ]
            .filter(([text]) => text)
            .map(([text, title, id]) => (
              <section key={id} id={id}>
                <h2>{title}</h2>
                <RichText text={text} />
              </section>
            ))}
          {(p.sections || []).map((section, i) => (
            <section key={i}>
              <h2>{section.title}</h2>
              <RichText text={section.body} />
            </section>
          ))}
          {p.nutrients.length > 0 ? (
            <section>
              <h2>ارزش غذایی در ۱۰۰ گرم</h2>
              <table>
                <tbody>
                  {p.nutrients.map((n) => (
                    <tr key={n.name}>
                      <th>{n.name}</th>
                      <td>{n.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted">منبع: {p.nutrientSource}</p>
            </section>
          ) : null}
          {guides.length ? (
            <section>
              <h2>در مجله بخوانید</h2>
              {guides.map((a) => (
                <Link
                  className="guide-link"
                  href={"/blog/" + a.slug}
                  key={a.id}
                >
                  {a.title} ←
                </Link>
              ))}
            </section>
          ) : null}
        </div>
      </div>
      {related.length ? (
        <section className="section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">طعم‌هایی در همین حوالی</span>
              <h2>شاید این‌ها را هم دوست داشته باشید</h2>
            </div>
          </div>
          <div className="product-grid">
            {related.map((x) => (
              <ProductCard key={x.id} product={x} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
