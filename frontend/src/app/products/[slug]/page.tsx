import { ProductEvent } from "@/components/product-event";
import { inStock } from "@/lib/format";
import Link from "next/link";
import { notFound } from "next/navigation";
import { serverApi } from "@/lib/api";
import type { Product, Article } from "@/lib/types";
import { ProductPurchase } from "@/components/product-purchase";
import { ProductGallery } from "@/components/product-gallery";
import { ProductRail } from "@/components/product-rail";
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
  const sections = [
    { body: p.description, title: "داستان این طعم", id: "intro" },
    { body: p.uses, title: "برای چه غذاهایی مناسب است؟", id: "uses" },
    { body: p.preparation, title: "چطور استفاده کنیم؟", id: "preparation" },
    { body: p.storage, title: "چطور نگهداری کنیم؟", id: "storage" },
    { body: p.ingredients, title: "ترکیبات", id: "ingredients" },
    { body: p.allergens, title: "اطلاعات حساسیت‌زا", id: "allergens" },
    ...(p.sections || []).map((section, i) => ({
      body: section.body,
      title: section.title,
      id: `section-${i}`,
    })),
  ].filter((s) => s.body.trim());
  return (
    <div className="container section shop-detail">
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
          <h1>{p.name}</h1>
          <p className="lead">{p.summary}</p>
        </div>
        <ProductGallery product={p} />
        <ProductPurchase product={p} />
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
            {sections.map((s) => (
              <a key={s.id} href={"#" + s.id}>
                {s.title}
              </a>
            ))}
            {p.nutrients.length > 0 && <a href="#nutrition">ارزش غذایی</a>}
            {guides.length > 0 && <a href="#guides">در مجله بخوانید</a>}
          </nav>
        </aside>
        <div>
          {sections.map((s) => (
            <section key={s.id} id={s.id}>
              <h2>{s.title}</h2>
              <RichText text={s.body} />
            </section>
          ))}
          {p.nutrients.length > 0 ? (
            <section id="nutrition">
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
            <section id="guides">
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
      <ProductRail
        products={related}
        title="شاید این‌ها را هم دوست داشته باشید"
        eyebrow="طعم‌هایی در همین حوالی"
        href={"/products?category=" + p.categoryId}
      />
    </div>
  );
}
