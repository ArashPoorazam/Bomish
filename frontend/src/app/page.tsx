import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  Leaf,
  Flower2,
  Wheat,
  Sprout,
  BadgeCheck,
  Headset,
  Handshake,
} from "lucide-react";
import { serverApi } from "@/lib/api";
import type { Product, Article, HomeSlide } from "@/lib/types";
import { ProductRail } from "@/components/product-rail";
import { HomeSlideshow } from "@/components/home-slideshow";
import { HomeMotion } from "@/components/home-motion";
import { HomeShoppingGuide } from "@/components/home-shopping-guide";
export const dynamic = "force-dynamic";
export default async function Home() {
  const [selected, newest, offers, articles, slides] = await Promise.all([
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
    serverApi<HomeSlide[]>("/home/slides").catch(() => []),
  ]);
  const favorites = [...selected];
  for (const product of offers.slice(0, 4)) {
    if (favorites.length >= 4) break;
    if (!favorites.some((favorite) => favorite.id === product.id)) {
      favorites.push(product);
    }
  }
  return (
    <HomeMotion>
      <section className="hero container">
        <div className="hero-copy">
          <span className="eyebrow">بومیش، همراه آشپزی هر روز</span>
          <h1>
            کمی <em>عطر و طعم</em>
            <br />
            کلی حال خوب
          </h1>
          <p>
            ادویه، سبزی خشک و دانه‌های خوراکی؛ برای غذاهایی که با عشق می‌پزید.
            <br />
            برای آشپزخانه‌تان خرید کنید یا سفارش اختصاصی و عمده بدهید.
          </p>
          <div className="hero-actions">
            <Link className="button" href="/products">
              کشف طعم‌ها <ArrowLeft size={19} />
            </Link>
            <Link className="button secondary" href="/account/custom/new">
              سفارش اختصاصی
            </Link>
          </div>
          <Link className="hero-caption" href="#home-shopping-guide">
            <Leaf size={18} />
            <span>راهنمای انتخاب بسته و ارسال سفارش</span>
          </Link>
        </div>
        <HomeSlideshow key={JSON.stringify(slides)} slides={slides} />
      </section>
      <section
        className="container home-categories"
        aria-label="دسته‌های محصولات"
        data-home-reveal
      >
        <div className="category-grid">
          {[
            {
              href: "spices",
              title: "ادویه‌ها",
              text: "یک چاشنی، هزار طعم",
              Icon: Flower2,
            },
            {
              href: "herbs",
              title: "سبزی‌های خشک",
              text: "عطر آشنای غذای خانه",
              Icon: Leaf,
            },
            {
              href: "seeds",
              title: "دانه‌های خوراکی",
              text: "جزئیات کوچک، طعم‌های تازه",
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
          title="محبوب‌های بومیش"
          eyebrow="انتخاب مشتریان در ۳۰ روز گذشته"
          products={favorites}
          href="/products?collection=bestsellers"
        />
      </div>
      <section
        className="principles container"
        aria-labelledby="principles-title"
        data-home-reveal
      >
        <div className="section-heading">
          <div>
            <span className="eyebrow">پشت هر بسته، یک تعهد</span>
            <h2 id="principles-title">با خیال راحت انتخاب کنید</h2>
          </div>
          <p>کیفیت، پاسخ‌گویی و صداقت؛ پایه‌های کار ما.</p>
        </div>
        <div className="principle-grid">
          {[
            {
              title: "کیفیت خوب، قیمت منصفانه",
              text: "محصولات را با دقت انتخاب و بسته‌بندی می‌کنیم تا خرید باکیفیت، بخشی از زندگی روزمره باشد.",
              detail: "سلامت محصول و قیمت منصفانه، معیار ما در هر انتخاب است.",
              Icon: BadgeCheck,
            },
            {
              title: "از انتخاب تا تحویل، کنار شما",
              text: "از ۱۲ ظهر تا ۱۲ شب، پاسخ‌گوی پرسش‌های شما هستیم.",
              detail:
                "از ثبت سفارش تا رسیدن بسته، می‌توانید وضعیت خریدتان را پیگیری کنید.",
              Icon: Headset,
            },
            {
              title: "صداقت در هر بسته",
              text: "درجه‌های مختلف یک محصول را با هم ترکیب نمی‌کنیم. آنچه به دستتان می‌رسد، باید همان کیفیتی باشد که انتخاب کرده‌اید.",
              Icon: Handshake,
            },
          ].map(({ title, text, detail, Icon }, i) => (
            <article className="principle-card" key={title}>
              <div className="principle-top">
                <Icon size={28} strokeWidth={1.4} />
                <span>{["۰۱", "۰۲", "۰۳"][i]}</span>
              </div>
              <h3>{title}</h3>
              <p>{text}</p>
              {detail && <p>{detail}</p>}
            </article>
          ))}
        </div>
      </section>
      <div className="container">
        <ProductRail
          title="تازه‌های بومیش"
          eyebrow="طعم‌های تازه برای انتخاب بعدی شما"
          href="/products?sort=newest"
          products={newest}
        />
        <ProductRail
          title="پیشنهاد ما برای شما"
          eyebrow="از میان قفسه‌های بومیش، با سلیقه تیم ما"
          href="/products?collection=suggestions"
          products={offers}
        />
      </div>
      <HomeShoppingGuide />
      <section
        className="home-editorial container"
        aria-label="داستان و مجله بومیش"
        data-home-reveal
      >
        <article className="brand-story">
          <Sprout size={42} strokeWidth={1.1} />
          <span className="eyebrow">از ما و دنیای طعم‌ها</span>
          <h2>بومیش؛ به عشق غذای خوب</h2>
          <p>
            گاهی عطر یک ادویه، تمام حال‌وهوای غذا را عوض می‌کند. در بومیش، کنار
            شماییم تا طعم‌های تازه پیدا کنید و به غذاهای هر روزتان رنگ دیگری
            بدهید.
          </p>
          <Link href="/about" className="text-link">
            با بومیش آشنا شوید <ArrowLeft size={18} />
          </Link>
          <span className="story-signature" aria-hidden="true">
            بومیش
          </span>
        </article>
        <div className="magazine-preview">
          <div className="section-heading">
            <div>
              <span className="eyebrow">
                ایده‌های خواندنی، طعم‌های امتحان‌کردنی
              </span>
              <h2>مجله بومیش</h2>
            </div>
            <Link className="text-link" href="/blog">
              گشت‌وگذار در مجله <ArrowLeft size={16} />
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
                  ادامه مطلب <ArrowLeft size={15} />
                </span>
              </div>
            </Link>
          ))}
          {!articles.length && (
            <p>
              به‌زودی با ایده‌ها و نکته‌های تازه برای آشپزی، اینجا همراهتان
              هستیم.
            </p>
          )}
        </div>
      </section>
    </HomeMotion>
  );
}
