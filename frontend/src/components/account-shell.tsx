"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { LayoutDashboard, ShoppingBag, MapPin, LogOut } from "lucide-react";
import { api } from "@/lib/api";
import { useStore } from "./store-provider";
import { AuthLayout } from "./auth-layout";
import { LoginForm } from "./login-form";
export function AccountShell({
  section,
  title,
  children,
  actions,
}: {
  section: string;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
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
      <AuthLayout>
        <LoginForm onSuccess={() => {}} />
      </AuthLayout>
    );
  return (
    <div className="account-page container section">
      <div className="account-layout">
        <aside className="account-sidebar">
          <div className="account-identity">
            <h1>حساب من</h1>
            <p>سفارش‌ها و نشانی‌هایتان، یک‌جا و در دسترس.</p>
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
          <div className="account-toolbar">
            <h2 className="account-section-title">{title}</h2>
            {actions && (
              <div className="account-toolbar-actions">{actions}</div>
            )}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
