import Image from "next/image";
import Link from "next/link";
import { Leaf, ArrowUpLeft } from "lucide-react";
export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <Link className="brand" href="/">
            <Image
              src="/images/bomish-logo.png"
              alt=""
              width={64}
              height={64}
            />
            <span>بومیش</span>
          </Link>
          <p>
            برای هر آشپزخانه، کمی عطر طبیعت.
            <br />
            ادویه، سبزی خشک و دانه‌های خوراکی.
          </p>
        </div>
        <div>
          <h3>در بومیش بگردید</h3>
          <Link href="/products">همه محصولات</Link>
          <Link href="/blog">مجله بومیش</Link>
          <Link href="/about">درباره ما</Link>
        </div>
        <div>
          <h3>همراه خرید شما</h3>
          <Link href="/account">پیگیری سفارش</Link>
          <Link href="/shipping">ارسال و بازگشت</Link>
          <Link href="/contact">
            ارتباط با بومیش <ArrowUpLeft size={14} />
          </Link>
        </div>
        <div className="footer-note">
          <span className="eyebrow">خرید به اندازه شما</span>
          <h3>
            اندازه مناسب شما،
            <br />
            برای هر روز آشپزی.
          </h3>
          <p>بسته و تعداد مورد نیازتان را انتخاب کنید.</p>
        </div>
      </div>
      <div className="container footer-bottom">
        <span>© بومیش · با سلیقه، از طبیعت</span>
        <Link href="/staff">ورود همکاران</Link>
      </div>
    </footer>
  );
}
