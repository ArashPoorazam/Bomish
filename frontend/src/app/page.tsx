import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  Leaf,
  Flower2,
  Wheat,
  Sprout,
  BadgeCheck,
  Coins,
  Handshake,
} from "lucide-react";
import { serverApi } from "@/lib/api";
import type { Product, Article } from "@/lib/types";
import { ProductRail } from "@/components/product-rail";
export const dynamic = "force-dynamic";
export default async function Home() {
  const [selected, newest, offers, articles] = await Promise.all([
    serverApi<Product[]>(
      "/products?available=true&collection=bestsellers&pageSize=12",
    ),
    serverApi<Product[]>(
      "/products?available=true&collection=arrivals&sort=newest&pageSize=12",
    ),
    serverApi<Product[]>(
      "/products?available=true&collection=suggestions&pageSize=12",
    ),
    serverApi<Article[]>("/articles"),
  ]);
  return (
    <div className="shop-home">
      <section className="hero container">
        <div className="hero-copy">
          <span className="eyebrow">از طبیعت، برای سفره شما</span>
          <h1>
            دنیایی از عطر
            <br />
            دنیایی از <em>طعم</em>
          </h1>
          <p>
            ادویه‌های خوش‌عطر، سبزی‌های خشک و دانه‌های خوراکی.
            <br />
            طعم دلخواهتان را در بسته‌های مشخص و با قیمت روشن پیدا کنید.
          </p>
          <div className="hero-actions">
            <Link className="button" href="/products">
              گشت‌وگذار در محصولات <ArrowLeft size={19} />
            </Link>
          </div>
          <div className="hero-caption">
            <Leaf size={18} />
            <span>بسته‌های متنوع، انتخابی ساده</span>
          </div>
        </div>
        <div className="hero-art">
          <Image
            src="/images/spices.png"
            fill
            priority
            sizes="(max-width: 760px) 100vw, 50vw"
            alt="چیدمان ادویه‌های رنگارنگ، نعناع، کنجد و دارچین"
          />
          <div className="hero-label">
            <span className="label-mark">
              <Sprout size={26} />
            </span>
            <div>
              <strong>هر دانه، یک داستان</strong>
              <span>طعم‌های آشنا، انتخاب‌های تازه</span>
            </div>
          </div>
          <span className="image-note">تصویر نمایشی</span>
        </div>
      </section>
      <section
        className="container home-categories"
        aria-label="دسته‌های محصولات"
      >
        <div className="category-grid">
          {[
            {
              href: "spices",
              title: "ادویه‌ها",
              text: "روحِ هر غذا",
              Icon: Flower2,
            },
            {
              href: "herbs",
              title: "سبزی‌های خشک",
              text: "عطر باغ در آشپزخانه",
              Icon: Leaf,
            },
            {
              href: "seeds",
              title: "دانه‌های خوراکی",
              text: "کوچک، اما پر از طعم",
              Icon: Wheat,
            },
          ].map(({ href, title, text, Icon }) => (
            <Link
              key={href}
              href={`/products?category=${href}`}
              className="category-tile"
            >
              <Icon size={30} strokeWidth={1.3} />
              <div>
                <h2>{title}</h2>
                <p>{text}</p>
              </div>
              <ArrowLeft size={19} />
            </Link>
          ))}
        </div>
      </section>
      <div className="container">
        <ProductRail
          title="پرفروش ترین‌های بومیش"
          eyebrow="محبوب‌ترین‌ها در ۳۰ روز گذشته"
          products={selected}
          href="/products?collection=bestsellers"
        />
      </div>
      <section
        className="principles container"
        aria-labelledby="principles-title"
      >
        <div className="section-heading">
          <div>
            <span className="eyebrow">قول ما به شما</span>
            <h2 id="principles-title">سه اصل، یک خیال راحت</h2>
          </div>
          <p>خرید خوب، از اعتماد شروع می‌شود.</p>
        </div>
        <div className="principle-grid">
          {[
            {
              title: "کیفیت بالا",
              text: "کیفیت خوب، اصل انتخاب ماست؛ عطر و طعم محصول باید ارزش خرید داشته باشد.",
              Icon: BadgeCheck,
            },
            {
              title: "ارزان بودن",
              text: "قیمت مناسب، بدون کوتاه آمدن از کیفیت و صداقت؛ مبلغ هر بسته روشن است.",
              Icon: Coins,
            },
            {
              title: "تقلب نکردن",
              text: "به قول بازاری‌ها، جنس درجه ۱، ۲ و ۳ را قاطی نمی‌کنیم؛ کیفیت‌های مختلف را مخلوط نمی‌کنیم تا به اسم یک کیفیت بفروشیم.",
              Icon: Handshake,
            },
          ].map(({ title, text, Icon }, i) => (
            <article className="principle-card" key={title}>
              <div className="principle-top">
                <Icon size={28} strokeWidth={1.4} />
                <span>{["۰۱", "۰۲", "۰۳"][i]}</span>
              </div>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>
      <div className="container">
        <ProductRail
          title="تازه‌های بومیش"
          eyebrow="تازه به قفسه‌ها رسیده"
          href="/products?sort=newest"
          products={newest}
        />
        <ProductRail
          title="پیشنهادهای بومیش"
          eyebrow="به انتخاب تیم بومیش"
          href="/products?collection=suggestions"
          products={offers}
        />
      </div>
      <section
        className="home-editorial container"
        aria-label="داستان و مجله بومیش"
      >
        <article className="brand-story">
          <Sprout size={42} strokeWidth={1.1} />
          <span className="eyebrow">آشنایی با ما</span>
          <h2>داستان بومیش</h2>
          <p>
            از عطر یک ادویه تا طعم یک غذای خانگی؛ بومیش جایی برای شناخت طعم‌ها و
            انتخاب با خیال راحت است.
          </p>
          <Link href="/about" className="text-link">
            داستان ما را بخوانید <ArrowLeft size={18} />
          </Link>
          <span className="story-signature" aria-hidden="true">
            بومیش
          </span>
        </article>
        <div className="magazine-preview">
          <div className="section-heading">
            <div>
              <span className="eyebrow">بخوانیم، بچشیم، یاد بگیریم</span>
              <h2>مجله بومیش</h2>
            </div>
            <Link className="text-link" href="/blog">
              همه نوشته‌ها <ArrowLeft size={16} />
            </Link>
          </div>
          {articles.slice(0, 2).map((a) => (
            <Link key={a.id} href={`/blog/${a.slug}`} className="magazine-row">
              <div className="magazine-photo">
                <Image
                  src={a.image}
                  alt={a.title}
                  fill
                  sizes="(max-width: 760px) 96px, 140px"
                />
              </div>
              <div>
                <h3>{a.title}</h3>
                <p>{a.excerpt}</p>
                <span className="text-link">
                  خواندن مقاله <ArrowLeft size={15} />
                </span>
              </div>
            </Link>
          ))}
          {!articles.length && (
            <p>به‌زودی، نوشته‌هایی برای خوش‌طعم‌تر شدن روزها.</p>
          )}
        </div>
      </section>
    </div>
  );
}
