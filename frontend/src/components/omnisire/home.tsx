"use client";
import Link from "next/link";
import { Users, ArrowUpLeft, ChartNoAxesCombined, History } from "lucide-react";
import { Workspace, Stats, Feedback, useLoad } from "./shared";
export function OmnisireHome() {
  const { data, error, loading } = useLoad<{
    revenue: number;
    orders: number;
    members: number;
    payable: number;
  }>("/omnisire/summary");
  return (
    <Workspace owner title="نمای کلی">
      <Feedback error={error} loading={loading} />
      {data && (
        <Stats
          items={[
            {
              label: "فروش ۳۰ روز اخیر",
              value: data.revenue,
              money: true,
              hint: "کالای خالص، بدون هزینه ارسال",
            },
            {
              label: "سفارش‌های پرداخت‌شده",
              value: data.orders,
              hint: "در ۳۰ روز اخیر",
            },
            {
              label: "کمیسیون قابل پرداخت",
              value: data.payable,
              money: true,
              hint: "مانده مثبت حساب همکاران",
            },
            {
              label: "همکاران فعال",
              value: data.members,
              hint: "حساب‌های فعال",
            },
          ]}
        />
      )}
      <div className="omni-launch-grid">
        {[
          {
            href: "members",
            label: "همکاران",
            text: "دسترسی، فروش و حساب همکاران.",
            Icon: Users,
          },
          {
            href: "analytics",
            label: "تحلیل داده‌ها",
            text: "گزارش فروش، مقایسه و دریافت اکسل.",
            Icon: ChartNoAxesCombined,
          },
          {
            href: "events",
            label: "رویدادها",
            text: "تاریخچه تغییرات و فعالیت‌ها.",
            Icon: History,
          },
        ].map(({ href, label, text, Icon }) => (
          <Link className="omni-launch" key={href} href={"/omnisire/" + href}>
            <Icon size={26} />
            <h2>{label}</h2>
            <p>{text}</p>
            <span>
              ورود به بخش <ArrowUpLeft size={18} />
            </span>
          </Link>
        ))}
      </div>
    </Workspace>
  );
}
