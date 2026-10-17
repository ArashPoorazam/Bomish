import Link from "next/link";
import { ArrowLeft, PackageCheck, Truck, Route } from "lucide-react";

export function HomeShoppingGuide() {
  return (
    <section
      className="home-shopping-guide container"
      id="home-shopping-guide"
      aria-labelledby="shopping-guide-title"
      data-home-reveal
    >
      <div className="shopping-guide-intro">
        <span className="eyebrow">از انتخاب بسته تا رسیدن سفارش</span>
        <h2 id="shopping-guide-title">جزئیات روشن، خرید راحت‌تر</h2>
        <p>پیش از ثبت سفارش، اندازه بسته، قیمت و هزینه ارسال را بررسی کنید.</p>
        <ul className="shopping-guide-facts">
          <li>
            <PackageCheck size={21} />
            <span>اندازه و قیمت مشخص برای هر بسته</span>
          </li>
          <li>
            <Truck size={21} />
            <span>نمایش هزینه ارسال پیش از پرداخت</span>
          </li>
          <li>
            <Route size={21} />
            <span>پیگیری مراحل سفارش در حساب شما</span>
          </li>
        </ul>
        <Link className="text-link" href="/account">
          پیگیری سفارش من <ArrowLeft size={16} />
        </Link>
      </div>
      <div className="shopping-guide-questions">
        <details>
          <summary>چطور اندازه بسته را انتخاب کنم؟</summary>
          <p>
            در صفحه هر محصول، بسته‌های موجود و قیمت هر کدام را می‌بینید. اندازه
            مناسب مصرفتان را انتخاب کنید و سپس محصول را به سبد خرید اضافه کنید.
          </p>
          <Link className="text-link" href="/products">
            دیدن محصولات <ArrowLeft size={16} />
          </Link>
        </details>
        <details>
          <summary>هزینه ارسال چطور مشخص می‌شود؟</summary>
          <p>
            هزینه ارسال با توجه به مقصد و وزن سفارش، همراه با وزن بسته‌بندی، در
            مرحله تکمیل خرید نمایش داده می‌شود. پیش از پرداخت می‌توانید مبلغ
            نهایی را ببینید.
          </p>
          <Link className="text-link" href="/shipping">
            جزئیات ارسال <ArrowLeft size={16} />
          </Link>
        </details>
        <details>
          <summary>از کجا وضعیت سفارشم را ببینم؟</summary>
          <p>
            در بخش سفارش‌های حساب کاربری، مراحل آماده‌سازی و ارسال را دنبال
            کنید. پس از ارسال، کد رهگیری سفارش نیز همان‌جا در دسترس است.
          </p>
          <Link className="text-link" href="/account">
            رفتن به حساب من <ArrowLeft size={16} />
          </Link>
        </details>
        <details>
          <summary>برای خرید عمده یا سفارش اختصاصی چه کنم؟</summary>
          <p>
            در فرم سفارش اختصاصی، محصول و مقدار مورد نیازتان را بنویسید تا
            درخواست شما بررسی شود. برای پرسش‌های خرید هم از دکمه پشتیبانی
            استفاده کنید؛ از ۱۲ ظهر تا ۱۲ شب پاسخ‌گوی شما هستیم.
          </p>
          <Link className="text-link" href="/account/custom/new">
            ثبت درخواست اختصاصی <ArrowLeft size={16} />
          </Link>
        </details>
      </div>
    </section>
  );
}
