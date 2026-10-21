"use client";
import { useState } from "react";
import { useNavigationState } from "./navigation-state";
import Link from "next/link";
import { hasStaffPermission } from "@/lib/staff-permissions";
import { fa } from "@/lib/format";
import { usePathname } from "next/navigation";
import {
  Store,
  Truck,
  Inbox,
  ChartNoAxesCombined,
  LayoutDashboard,
  Users,
  History,
  UserRound,
  ChevronDown,
} from "lucide-react";
import type { NotificationCounts } from "../requests/notifications";
export const sectionLabels: Record<string, string> = {
  products: "محصولات",
  articles: "مجله",
  categories: "دسته‌بندی‌ها",
  pricing: "قیمت و تخفیف",
  orders: "سفارش‌ها",
  support: "گفتگو با مشتری",
  custom: "سفارش‌های اختصاصی",
  suggestions: "مدیریت خانه",
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
  key === "suggestions" ? "home" : key;
const managementLinks = [
  {
    id: "overview",
    href: "/omnisire",
    label: "نمای کلی",
    Icon: LayoutDashboard,
  },
  { id: "members", href: "/omnisire/members", label: "همکاران", Icon: Users },
  {
    id: "analytics",
    href: "/omnisire/analytics",
    label: "تحلیل داده‌ها",
    Icon: ChartNoAxesCombined,
    children: reportSections,
  },
  { id: "shipping", href: "/omnisire/shipping", label: "ارسال", Icon: Truck },
  { id: "events", href: "/omnisire/events", label: "رویدادها", Icon: History },
];
export function WorkspaceNavigation({
  owner,
  permissions,
  role,
  activeSection,
  onSectionChange,
  locked,
  beforeNavigate,
  onNavigate,
  counts,
}: {
  owner: boolean;
  permissions: string[];
  role: string;
  activeSection?: string;
  onSectionChange?: (s: string) => void;
  locked: boolean;
  beforeNavigate: () => boolean;
  onNavigate: () => void;
  counts: NotificationCounts | null;
}) {
  const path = usePathname();
  const navigation = useNavigationState(owner);
  const [closed, setClosed] = useState(navigation.closed);
  const can = (key: string) => hasStaffPermission({ role, permissions }, key);
  const management = managementLinks
    .filter(
      (item) =>
        can(item.id) && (owner ? role === "owner" : item.id === "shipping"),
    )
    .map((item) =>
      item.id === "shipping" && !owner
        ? { ...item, href: "/staff/shipping" }
        : item,
    );
  const account = {
    id: "account",
    href: owner ? "/omnisire/account" : "/staff/account",
    label: "حساب کاربری",
    Icon: UserRound,
    children: [
      ...(!owner && can("sales") ? [["sales", "فروش من"]] : []),
      ["profile", "اطلاعات حساب"],
    ],
  };
  const groups = owner
    ? [...management, account]
    : [
        {
          id: "store",
          href: "/staff",
          label: "مدیریت فروشگاه",
          Icon: Store,
          children: Object.entries(sectionLabels).filter(
            ([key]) =>
              !["orders", "support", "custom", "sales"].includes(key) &&
              can(sectionPermission(key)),
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
              can(sectionPermission(key)),
          ),
        },
        account,
        ...management,
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
                  onClick={() => {
                    const next = { ...closed, [id]: !closed[id] };
                    navigation.closed = next;
                    setClosed(next);
                  }}
                >
                  <Icon size={20} />
                  {label}
                  {id === "requests" &&
                    counts &&
                    counts.orders + counts.support + counts.custom > 0 && (
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
                    id !== "account" && onSectionChange && path === href ? (
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
                        scroll={false}
                        key={key}
                        href={
                          id === "account"
                            ? key === "sales"
                              ? "/staff/sales"
                              : href
                            : `${href}?section=${key}`
                        }
                        aria-current={
                          (
                            id === "account"
                              ? path ===
                                (key === "sales" ? "/staff/sales" : href)
                              : activeSection === key
                          )
                            ? "page"
                            : undefined
                        }
                        onNavigate={(event) => {
                          if (locked || !beforeNavigate())
                            event.preventDefault();
                          else onNavigate();
                        }}
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
                scroll={false}
                href={href}
                aria-current={
                  path === href ||
                  (href !== "/omnisire" && path.startsWith(`${href}/`))
                    ? "page"
                    : undefined
                }
                onNavigate={(event) => {
                  if (locked || !beforeNavigate()) event.preventDefault();
                  else onNavigate();
                }}
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
