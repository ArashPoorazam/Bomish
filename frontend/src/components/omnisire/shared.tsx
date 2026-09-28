"use client";
import { useState, useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  ChartNoAxesCombined,
  History,
  ArrowUpLeft,
  LogOut,
  Store,
  Wallet,
  Menu,
  X,
} from "lucide-react";
import { useStore } from "@/components/store-provider";
import { StaffLogin } from "@/components/staff/staff-login";
import { api } from "@/lib/api";
import { money, fa, date, statuses } from "@/lib/format";
import type { components } from "@/lib/api-types";
export type Row = Record<string, unknown>;
export type Column = components["schemas"]["ReportColumn"];
export type PageData = {
  items: Row[];
  total: number;
  page: number;
  pageSize: number;
  columns?: Column[];
};
export const sectionLabels: Record<string, string> = {
  products: "محصولات",
  articles: "مجله",
  categories: "دسته‌بندی‌ها",
  pricing: "قیمت و تخفیف",
  orders: "سفارش‌ها",
  shipping: "ارسال",
  sales: "فروش من",
};
export const reportSections = [
  ["overview", "نمای کلی فروش"],
  ["products", "عملکرد محصولات"],
  ["packages", "فروش بسته‌ها"],
  ["prices", "تاریخچه قیمت"],
  ["customers", "مشتریان"],
  ["categories", "دسته‌بندی‌ها"],
  ["searches", "جستجوها"],
];
export const roleLabels: Record<string, string> = {
  owner: "مالک",
  manager: "مدیر",
  editor: "ویرایشگر",
  operator: "مسئول سفارش",
  salesperson: "فروشنده",
};
export const stamp = (v: unknown) =>
  v
    ? new Intl.DateTimeFormat("fa-IR", {
        dateStyle: "medium",
        timeStyle: "medium",
        timeZone: "Asia/Tehran",
      }).format(new Date(String(v)))
    : "—";
export function useLoad<T>(url: string, revision = 0) {
  const { user } = useStore();
  const identity = user?.staffId + ":" + user?.role;
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    if (!user?.role) {
      setData(null);
      setLoading(!user);
      return;
    }
    setLoading(true);
    setError("");
    api<T>(url)
      .then((v) => {
        if (live) setData(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [url, revision, identity]);
  return { data, error, loading };
}
export function Workspace({
  children,
  owner = false,
  title,
  activeSection,
  onSectionChange,
  navigationLocked = false,
  actions,
}: {
  children: ReactNode;
  owner?: boolean;
  title: string;
  activeSection?: string;
  onSectionChange?: (section: string) => void;
  navigationLocked?: boolean;
  actions?: ReactNode;
}) {
  const { user, refresh, sessionError } = useStore();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [open]);
  const [error, setError] = useState("");
  if (!user && sessionError)
    return (
      <div className="auth-layout">
        <div className="form-card">
          <p role="alert" className="error">
            {sessionError}
          </p>
          <button
            className="button"
            onClick={() => {
              void refresh().catch(() => {});
            }}
          >
            تلاش دوباره
          </button>
        </div>
      </div>
    );
  if (!user)
    return (
      <p className="loading" role="status">
        در حال دریافت اطلاعات…
      </p>
    );
  if (!user.role) return <StaffLogin />;
  if (owner && user.role !== "owner")
    return (
      <div className="auth-layout">
        <div className="form-card">
          <h1>دسترسی ویژه مالک</h1>
          <p>این فضا فقط در اختیار مالک فروشگاه است.</p>
          <Link className="button" href="/staff">
            بازگشت به فضای کار
          </Link>
        </div>
      </div>
    );
  const nav = owner
    ? ([
        ["/omnisire", "نمای کلی", LayoutDashboard],
        ["/omnisire/members", "همکاران", Users],
        ["/omnisire/analytics", "تحلیل داده‌ها", ChartNoAxesCombined],
        ["/omnisire/events", "رویدادها", History],
      ] as const)
    : ([
        ["/staff", "مدیریت فروشگاه", Store],
        ["/staff/sales", "فروش من", Wallet],
      ] as const);
  return (
    <div className="omni-shell">
      <aside
        id="workspace-navigation"
        className={`omni-sidebar ${open ? "is-open" : ""}`}
      >
        <button
          ref={closeButton}
          className="omni-menu omni-menu-close"
          aria-label="بستن فهرست"
          onClick={() => {
            setOpen(false);
            menuButton.current?.focus();
          }}
        >
          <X />
        </button>
        <Link href={owner ? "/omnisire" : "/staff"} className="omni-brand">
          <span className="omni-mark">O</span>
          <span>{owner ? "Omnisire" : "Staff Interface"}</span>
        </Link>
        <nav aria-label="ناوبری فضای کار">
          {nav
            .filter(
              ([href]) =>
                href != "/staff/sales" || user.permissions?.includes("sales"),
            )
            .map(([href, label, Icon]) => (
              <div key={href} className="omni-nav-group">
                <Link
                  href={href}
                  aria-current={
                    path === href && !activeSection ? "page" : undefined
                  }
                  onClick={(event) => {
                    if (onSectionChange && path === href) {
                      event.preventDefault();
                      if (navigationLocked) return;
                      onSectionChange(
                        href === "/omnisire/analytics"
                          ? "overview"
                          : user.permissions?.find((p) => p !== "omnisire") ||
                              "",
                      );
                    }
                    setOpen(false);
                  }}
                >
                  <Icon size={20} />
                  {label}
                </Link>
                {(href === "/staff" || href === "/omnisire/analytics") && (
                  <div className="omni-nav-children">
                    {(href === "/staff"
                      ? Object.entries(sectionLabels).filter(
                          ([key]) =>
                            key !== "sales" && user.permissions?.includes(key),
                        )
                      : reportSections
                    ).map(([key, text]) =>
                      onSectionChange && path === href ? (
                        <button
                          key={key}
                          disabled={navigationLocked}
                          aria-current={
                            activeSection === key ? "page" : undefined
                          }
                          onClick={() => {
                            onSectionChange(key);
                            setOpen(false);
                          }}
                        >
                          {text}
                        </button>
                      ) : (
                        <Link
                          key={key}
                          href={`${href}?section=${key}`}
                          aria-current={
                            activeSection === key ? "page" : undefined
                          }
                          onClick={() => setOpen(false)}
                        >
                          {text}
                        </Link>
                      ),
                    )}
                  </div>
                )}
              </div>
            ))}
        </nav>
        <div className="omni-side-bottom">
          {owner && (
            <Link href="/staff">
              Staff Interface <ArrowUpLeft size={18} />
            </Link>
          )}
          <Link href="/">
            مشاهده فروشگاه <ArrowUpLeft size={16} />
          </Link>
          <button
            onClick={async () => {
              try {
                await api("/logout", "POST");
                await refresh();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <LogOut size={18} />
            خروج از حساب
          </button>
        </div>
      </aside>
      <div className="omni-main">
        <div className="omni-content">
          <div className="omni-heading">
            <button
              ref={menuButton}
              className="omni-menu"
              aria-expanded={open}
              aria-controls="workspace-navigation"
              aria-label="فهرست"
              onClick={() => setOpen(!open)}
            >
              <Menu />
            </button>
            <h1>{title}</h1>
            {actions}
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
export function Feedback({
  error,
  loading,
}: {
  error?: string;
  loading?: boolean;
}) {
  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading && (
        <p className="omni-loading" role="status">
          در حال دریافت اطلاعات…
        </p>
      )}
    </>
  );
}
export function Stats({
  items,
}: {
  items: { label: string; value: number; money?: boolean; hint?: string }[];
}) {
  return (
    <div className="omni-stats">
      {items.map((x, i) => (
        <article
          className={`omni-stat ${i === 0 ? "featured" : ""}`}
          key={x.label}
        >
          <span>{x.label}</span>
          <strong>
            {x.money ? money(x.value) : fa(x.value)}
            {x.money && <small>تومان</small>}
          </strong>
          <p>{x.hint || "در یک نگاه"}</p>
        </article>
      ))}
    </div>
  );
}
export function Pager({
  data,
  page,
  onPage,
}: {
  data: PageData | null;
  page: number;
  onPage: (p: number) => void;
}) {
  if (!data) return null;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <div className="omni-pager">
      <span>
        {fa(data.total)} نتیجه · صفحه {fa(page)} از {fa(pages)}
      </span>
      <div>
        <button
          className="button secondary"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          قبلی
        </button>
        <button
          className="button secondary"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          بعدی
        </button>
      </div>
    </div>
  );
}
export function valueText(v: unknown, c: Column) {
  if (v === null || v === undefined) return "—";
  if (c.kind === "money") return money(Number(v));
  if (c.kind === "number") return fa(Number(v));
  if (c.kind === "date") return stamp(v);
  if (typeof v === "boolean") return v ? "بله" : "خیر";
  return statuses[String(v)] || String(v);
}
export function DataTable({
  data,
  columns,
  selected,
  onSelect,
  onRow,
  extra,
}: {
  data: Row[];
  columns: Column[];
  selected?: Set<string>;
  onSelect?: (id: string) => void;
  onRow?: (row: Row) => void;
  extra?: (row: Row) => ReactNode;
}) {
  return (
    <div className="table-scroll omni-table">
      <table>
        <thead>
          <tr>
            {onSelect && <th>مقایسه</th>}
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
            {extra && <th>عملیات</th>}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={`${row.id ?? i}:${row.day ?? i}`}>
              {onSelect && (
                <td>
                  <input
                    aria-label={`انتخاب ${row.name || row.id}`}
                    type="checkbox"
                    checked={selected?.has(String(row.id)) || false}
                    onChange={() => onSelect(String(row.id))}
                  />
                </td>
              )}
              {columns.map((c, i) => (
                <td key={c.key}>
                  {i === 0 && onRow ? (
                    <button className="text-link" onClick={() => onRow(row)}>
                      {valueText(row[c.key], c)}
                    </button>
                  ) : (
                    valueText(row[c.key], c)
                  )}
                </td>
              ))}
              {extra && <td>{extra(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {!data.length && (
        <div className="omni-empty">
          <span>هنوز چیزی اینجا نیست</span>
          <p>با تغییر فیلترها دوباره بررسی کنید.</p>
        </div>
      )}
    </div>
  );
}
export function Panel({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="omni-panel">
      <div className="between">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
