"use client";
import { useState } from "react";
import Link from "next/link";
import { fa } from "@/lib/format";
import { usePathname } from "next/navigation";
import {
  Store,
  Inbox,
  ChartNoAxesCombined,
  LayoutDashboard,
  Users,
  History,
  Wallet,
  ChevronDown,
} from "lucide-react";
import type { NotificationCounts } from "../requests/notifications";
export const sectionLabels: Record<string, string> = {
  products: "محصولات",
  articles: "مجله",
  categories: "دسته‌بندی‌ها",
  pricing: "قیمت و تخفیف",
  orders: "سفارش‌ها",
  support: "گفتگو با پشتیبانی",
  custom: "سفارش‌های اختصاصی",
  suggestions: "پیشنهادهای بومیش",
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
export const sectionPermission = (key: string) =>
  key === "support" || key === "custom"
    ? "requests"
    : key === "suggestions"
      ? "products"
      : key;
export function WorkspaceNavigation({
  owner,
  permissions,
  activeSection,
  onSectionChange,
  locked,
  onNavigate,
  counts,
}: {
  owner: boolean;
  permissions: string[];
  activeSection?: string;
  onSectionChange?: (s: string) => void;
  locked: boolean;
  onNavigate: () => void;
  counts: NotificationCounts | null;
}) {
  const path = usePathname();
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const groups = owner
    ? [
        {
          id: "home",
          href: "/omnisire",
          label: "نمای کلی",
          Icon: LayoutDashboard,
        },
        {
          id: "members",
          href: "/omnisire/members",
          label: "همکاران",
          Icon: Users,
        },
        {
          id: "analytics",
          href: "/omnisire/analytics",
          label: "تحلیل داده‌ها",
          Icon: ChartNoAxesCombined,
          children: reportSections,
        },
        {
          id: "events",
          href: "/omnisire/events",
          label: "رویدادها",
          Icon: History,
        },
      ]
    : [
        {
          id: "store",
          href: "/staff",
          label: "مدیریت فروشگاه",
          Icon: Store,
          children: Object.entries(sectionLabels).filter(
            ([key]) =>
              !["orders", "support", "custom", "sales"].includes(key) &&
              permissions.includes(sectionPermission(key)),
          ),
        },
        {
          id: "requests",
          href: "/staff",
          label: "درخواست‌ها",
          Icon: Inbox,
          children: Object.entries(sectionLabels).filter(
            ([key]) =>
              ["orders", "support", "custom"].includes(key) &&
              permissions.includes(sectionPermission(key)),
          ),
        },
        ...(permissions.includes("sales")
          ? [
              {
                id: "sales",
                href: "/staff/sales",
                label: "فروش من",
                Icon: Wallet,
              },
            ]
          : []),
      ];
  const badge = (key: string) => {
    const n = counts?.[key as keyof NotificationCounts] || 0;
    return n > 0 ? (
      <span className="notification-badge" aria-label={`${n} مورد خوانده‌نشده`}>
        {fa(n)}
      </span>
    ) : null;
  };
  return (
    <nav aria-label="ناوبری فضای کار">
      {groups
        .filter((g) => !g.children || g.children.length)
        .map(({ id, href, label, Icon, children }) => (
          <div key={id} className="omni-nav-group">
            {children ? (
              <>
                <button
                  className="omni-nav-parent"
                  aria-expanded={!closed[id]}
                  aria-controls={`nav-${id}`}
                  onClick={() => setClosed({ ...closed, [id]: !closed[id] })}
                >
                  <Icon size={20} />
                  {label}
                  {id === "requests" && counts && (
                    <span className="notification-badge">
                      {fa(counts.orders + counts.support + counts.custom)}
                    </span>
                  )}
                  <ChevronDown size={16} />
                </button>
                <div
                  id={`nav-${id}`}
                  className="omni-nav-children"
                  hidden={!!closed[id]}
                >
                  {children.map(([key, text]) =>
                    onSectionChange && path === href ? (
                      <button
                        key={key}
                        disabled={locked}
                        aria-current={
                          activeSection === key ? "page" : undefined
                        }
                        onClick={() => {
                          onSectionChange(key);
                          onNavigate();
                        }}
                      >
                        {text}
                        {badge(key)}
                      </button>
                    ) : (
                      <Link
                        key={key}
                        href={`${href}?section=${key}`}
                        aria-current={
                          activeSection === key ? "page" : undefined
                        }
                        onClick={onNavigate}
                      >
                        {text}
                        {badge(key)}
                      </Link>
                    ),
                  )}
                </div>
              </>
            ) : (
              <Link
                href={href}
                aria-current={path === href ? "page" : undefined}
                onClick={onNavigate}
              >
                <Icon size={20} />
                {label}
              </Link>
            )}
          </div>
        ))}
    </nav>
  );
}
