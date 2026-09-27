import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  Leaf,
  Scale,
  BookOpen,
  PackageCheck,
  Flower2,
  Wheat,
  Sprout,
} from "lucide-react";
import { serverApi } from "@/lib/api";
import type { Product, Article } from "@/lib/types";
import { ProductCard } from "@/components/product-card";
export const dynamic = "force-dynamic";
export default async function Home() {
  const [products, articles] = await Promise.all([
    serverApi<Product[]>("/products"),
    serverApi<Article[]>("/articles"),
  ]);
  const featured = ["turmeric", "mint", "cinnamon", "sesame"]
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is Product => !!p);
  const selected = featured.length ? featured : products.slice(0, 4);
  return (
    <>
      <section className="hero container">
        <div className="hero-copy">
          
          <h1>
           دنیایی از عطر
            <br />
            دنیایی از <em>طعم</em>
          </h1>
          <p>
            ادویه‌های خوش‌عطر، سبزی‌های خشک و دانه‌های خوراکی.
            <br />
            با حوصله بشناسید، به اندازه نیازتان انتخاب کنید.
          </p>
          <div className="hero-actions">
            <Link className="button" href="/products">
              گشت‌وگذار در محصولات <ArrowLeft size={19} />
            </Link>
            <Link className="text-link" href="/blog">
              از طبیعت بیشتر بدانیم
            </Link>
          </div>
          <div className="hero-caption">
            <Leaf size={18} />
            <span>بسته‌های متنوع برای خرید روزمره</span>
          </div>
        </div>
        <div className="hero-art">
          <Image
            src="/images/spices.png"
            fill
            priority
            sizes="(max-width: 760px) 100vw, 55vw"
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
      <div className="values-strip container">
        <div>
          <Scale />
          <span>
            به اندازه نیاز شما<small>انتخاب آزادانه وزن</small>
          </span>
        </div>
        <div>
          <BookOpen />
          <span>
            انتخاب آگاهانه<small>راهنمای استفاده از هر محصول</small>
          </span>
        </div>
        <div>
          <PackageCheck />
          <span>
            خرید روشن و ساده<small>مشاهده هزینه پیش از پرداخت</small>
          </span>
        </div>
      </div>
      <section className="section container">
        <div className="section-heading">
          <div>
            <span className="eyebrow">از کجا شروع کنیم؟</span>
            <h2>دنیایی از عطر و طعم</h2>
          </div>
          <Link className="text-link" href="/products">
            دیدن همه محصولات <ArrowLeft size={17} />
          </Link>
        </div>
        <div className="category-grid">
          <Link href="/products?category=spices" className="category-tile">
            <Flower2 size={38} strokeWidth={1.2} />
            <div>
              <h3>ادویه‌ها</h3>
              <p>روحِ هر غذا</p>
            </div>
            <ArrowLeft size={21} />
          </Link>
          <Link href="/products?category=herbs" className="category-tile">
            <Leaf size={38} strokeWidth={1.2} />
            <div>
              <h3>سبزی‌های خشک</h3>
              <p>عطر باغ در آشپزخانه</p>
            </div>
            <ArrowLeft size={21} />
          </Link>
          <Link href="/products?category=seeds" className="category-tile">
            <Wheat size={38} strokeWidth={1.2} />
            <div>
              <h3>دانه‌های خوراکی</h3>
              <p>کوچک، اما پر از طعم</p>
            </div>
            <ArrowLeft size={21} />
          </Link>
        </div>
      </section>
      <section className="section container">
        <div className="section-heading">
          <div>
            <span className="eyebrow">برای قفسه آشپزخانه شما</span>
            <h2>انتخاب‌های بومیش</h2>
          </div>
          <span className="muted">بسته‌های متنوع، قیمت روشن</span>
        </div>
        <div className="product-grid">
          {selected.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>
      <section className="editorial-banner container">
        <span className="eyebrow">به اندازه خودتان</span>
        <h2>
          بسته‌ای به اندازه نیاز،
          <br />
          طعمی برای هر روز.
        </h2>
        <p>
          اندازه بسته و تعداد مورد نیازتان را انتخاب کنید و قیمت هر بسته را پیش
          از افزودن به سبد ببینید.
        </p>
        <Link href="/products" className="button light">
          انتخاب محصول <ArrowLeft size={18} />
        </Link>
        <Scale className="banner-icon" strokeWidth={0.6} />
      </section>
      <section className="section container">
        <div className="section-heading">
          <div>
            <span className="eyebrow">بخوانیم، بچشیم، یاد بگیریم</span>
            <h2>از مجله بومیش</h2>
          </div>
          <Link href="/blog" className="text-link">
            همه نوشته‌ها <ArrowLeft size={17} />
          </Link>
        </div>
        <div className="article-grid">
          {articles.slice(0, 2).map((a, i) => (
            <Link key={a.id} href={"/blog/" + a.slug} className="article-card">
              <div className={"article-image article-image-" + i}>
                <Image
                  src={a.image}
                  alt={a.title}
                  fill
                  sizes="(max-width: 760px) 100vw, 40vw"
                />
              </div>
              <div>
                <span className="eyebrow">راهنمای آشپزخانه</span>
                <h3>{a.title}</h3>
                <p>{a.excerpt}</p>
                <span className="text-link">
                  خواندن مقاله <ArrowLeft size={16} />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
