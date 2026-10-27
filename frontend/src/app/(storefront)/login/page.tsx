"use client";
import { useRouter } from "next/navigation";
import { AuthLayout } from "@/components/auth-layout";
import { useStore } from "@/components/store-provider";
import Link from "next/link";
import { LoginForm } from "@/components/login-form";
export default function Login() {
  const router = useRouter();
  const { user } = useStore();
  if (!user) return <p className="container section">در حال دریافت اطلاعات…</p>;
  if (user.catalogOnly)
    return (
      <AuthLayout>
        <h1>فروش آنلاین به‌زودی</h1>
        <p>ثبت‌نام مشتریان هم‌زمان با آغاز فروش فعال می‌شود.</p>
        <Link href="/products">مشاهده محصولات</Link>
      </AuthLayout>
    );
  return (
    <AuthLayout>
      <LoginForm
        onSuccess={() => {
          const next = new URLSearchParams(window.location.search).get("next");
          router.replace(next === "/checkout" ? "/checkout" : "/account");
        }}
      />
    </AuthLayout>
  );
}
