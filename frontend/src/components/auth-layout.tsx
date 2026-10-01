import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Leaf } from "lucide-react";
import type { ReactNode } from "react";

export function AuthLayout({
  children,
  staff = false,
}: {
  children: ReactNode;
  staff?: boolean;
}) {
  return (
    <section
      className={`auth-experience ${staff ? "auth-staff" : "auth-customer"}`}
    >
      <div className="auth-surface">
        <div className="auth-form-side">
          <Link
            href="/"
            className="auth-brand"
            aria-label="بومیش؛ بازگشت به فروشگاه"
          >
            <Image
              src="/images/bomish-logo.png"
              width={44}
              height={44}
              alt=""
            />
            <span>
              بومیش<small>{staff ? "فضای کار همکاران" : "طعم خوب طبیعت"}</small>
            </span>
          </Link>
          {children}
          <Link href="/products" className="auth-back">
            <ArrowRight size={16} />
            بازگشت به فروشگاه
          </Link>
        </div>
        <div className="auth-art">
          <Image
            src={
              staff ? "/images/login-staff.webp" : "/images/login-customer.webp"
            }
            alt=""
            fill
            sizes="(max-width: 700px) 100vw, 50vw"
            priority
          />
          <div className="auth-art-copy">
            <span className="auth-art-mark">
              <Leaf size={22} />
            </span>
            <p>
              {staff ? "با هم، برای تجربه‌ای بهتر" : "کمی نزدیک‌تر به طبیعت"}
            </p>
            <span>
              {staff
                ? "از انتخاب باکیفیت تا رسیدن به دست مشتری"
                : "عطر تازه، طعم آشنا، انتخابی از دل طبیعت"}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
