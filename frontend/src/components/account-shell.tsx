"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  LayoutDashboard,
  ShoppingBag,
  MapPin,
  LogOut,
  Sprout,
} from "lucide-react";
import { api } from "@/lib/api";
import { useStore } from "./store-provider";
import { LoginForm } from "./login-form";
export function AccountShell({
  section,
  title,
  children,
}: {
  section: string;
  title: string;
  children: ReactNode;
}) {
  const { user, refresh, sessionError } = useStore();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (!user && sessionError)
    return (
      <div className="container section">
        <div className="account-panel" role="alert">
          <p className="error">{sessionError}</p>
          <button
            className="button secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await refresh();
              } catch {
              } finally {
                setBusy(false);
              }
            }}
          >
            تلاش دوباره
          </button>
        </div>
      </div>
    );
  if (!user)
    return (
      <div className="loading" role="status">
        در حال دریافت حساب…
      </div>
    );
  if (!user.authenticated)
    return (
      <div className="auth-layout">
        <LoginForm onSuccess={() => {}} />
      </div>
    );
  return (
    <div className="account-page container section">
      <div className="account-heading">
        <span className="eyebrow">همراه شما، از انتخاب تا رسیدن</span>
        <h1>حساب من</h1>
        <p>سفارش‌ها و نشانی‌هایتان، یک‌جا و در دسترس.</p>
      </div>
      <div className="account-layout">
        <aside className="account-sidebar">
          <div className="account-welcome">
            <Sprout size={28} />
            <div>
              <strong>به بومیش خوش آمدید</strong>
              <small>خوشحالیم که همراه مایید</small>
            </div>
          </div>
          <nav aria-label="حساب کاربری">
            {[
              {
                id: "overview",
                title: "نمای کلی",
                href: "/account",
                Icon: LayoutDashboard,
              },
              {
                id: "orders",
                title: "سفارش‌ها",
                href: "/account?section=orders",
                Icon: ShoppingBag,
              },
              {
                id: "custom",
                title: "سفارش اختصاصی",
                href: "/account?section=custom",
                Icon: ShoppingBag,
              },
              {
                id: "addresses",
                title: "نشانی‌ها",
                href: "/account?section=addresses",
                Icon: MapPin,
              },
            ].map(({ id, title, href, Icon }) => (
              <Link
                key={id}
                href={href}
                aria-current={id === section ? "page" : undefined}
              >
                <Icon size={19} />
                {title}
              </Link>
            ))}
          </nav>
          <button
            className="account-logout"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api("/logout", "POST");
                await refresh();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <LogOut size={18} />
            خروج از حساب
          </button>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </aside>
        <div className="account-content">
          <h2 className="account-section-title">{title}</h2>
          {children}
        </div>
      </div>
    </div>
  );
}
