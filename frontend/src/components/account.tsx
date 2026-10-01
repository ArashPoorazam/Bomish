"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, MapPin, Package, Truck } from "lucide-react";
import type { Address, Order } from "@/lib/types";
import { useLiveQuery } from "@/hooks/use-live-query";
import { fa, statuses } from "@/lib/format";
import { useStore } from "./store-provider";
import { AccountShell } from "./account-shell";
import { AccountAddresses } from "./account-addresses";
import { activeOrderStates, OrderSummary, orderStates } from "./customer-order";
export function Account({
  section,
}: {
  section: "overview" | "orders" | "addresses";
}) {
  const { user } = useStore();
  const [status, setStatus] = useState("");
  const orders = useLiveQuery<Order[]>("/orders", !!user?.authenticated);
  const addresses = useLiveQuery<Address[]>(
    "/addresses",
    !!user?.authenticated,
    0,
  );
  const reload = orders.refresh;
  const refreshing = orders.loading;
  const error = orders.error;
  const data =
    orders.data || (section === "addresses" && addresses.data)
      ? {
          orders: (orders.data || []).toSorted((a, b) =>
            b.createdAt.localeCompare(a.createdAt),
          ),
          addresses: addresses.data || [],
        }
      : null;
  const active =
    data?.orders.filter((o) => activeOrderStates.includes(o.status)) || [];
  const latest = active[0] || data?.orders[0];
  const filtered =
    data?.orders.filter((o) => !status || o.status === status) || [];
  return (
    <AccountShell
      section={section}
      title={
        {
          overview: "نمای کلی",
          orders: "سفارش‌های شما",
          addresses: "نشانی‌های شما",
        }[section]
      }
      actions={
        section !== "addresses" ? (
          <button
            className="button secondary order-refresh"
            disabled={refreshing}
            onClick={reload}
          >
            {refreshing ? "در حال به‌روزرسانی…" : "به‌روزرسانی وضعیت"}
          </button>
        ) : undefined
      }
    >
      {error && (
        <div className="account-panel" role="alert">
          <p className="error">{error}</p>
          <button className="button secondary" onClick={reload}>
            تلاش دوباره
          </button>
        </div>
      )}
      {addresses.error && (
        <div className="account-panel" role="alert">
          <p className="error">{addresses.error}</p>
          <button disabled={addresses.loading} onClick={addresses.refresh}>
            تلاش دوباره برای نشانی‌ها
          </button>
        </div>
      )}
      {!data && !error && (
        <div className="account-panel" role="status">
          در حال دریافت اطلاعات…
        </div>
      )}
      {data && (
        <>
          {section === "overview" && (
            <>
              <div className="account-stats">
                <Link href="/account?section=orders">
                  <Package size={22} />
                  <strong>{fa(data.orders.length)}</strong>
                  <span>همه سفارش‌ها</span>
                </Link>
                <Link href="/account?section=orders">
                  <Truck size={22} />
                  <strong>{fa(active.length)}</strong>
                  <span>سفارش در جریان</span>
                </Link>
                <Link href="/account?section=addresses">
                  <MapPin size={22} />
                  <strong>{fa(data.addresses.length)}</strong>
                  <span>نشانی ذخیره‌شده</span>
                </Link>
              </div>
              <div className="section-heading">
                <h3>
                  {active.length ? "سفارش در جریان شما" : "آخرین سفارش شما"}
                </h3>
                <Link className="text-link" href="/account?section=orders">
                  همه سفارش‌ها <ArrowLeft size={16} />
                </Link>
              </div>
              {latest ? (
                <OrderSummary order={latest} />
              ) : (
                <div className="empty-state">
                  <Package size={34} />
                  <h3>هنوز سفارشی ندارید</h3>
                  <p>هنوز سفارشی ثبت نکرده‌اید.</p>
                  <Link href="/products" className="button">
                    شروع خرید
                  </Link>
                </div>
              )}
              <div className="account-note">
                <MapPin size={27} />
                <div>
                  <h3>نشانی‌های تحویل</h3>
                  <p>نشانی تازه اضافه کنید یا اطلاعات قبلی را تغییر دهید.</p>
                </div>
                <Link href="/account?section=addresses" className="text-link">
                  مدیریت نشانی‌ها <ArrowLeft size={16} />
                </Link>
              </div>
            </>
          )}
          {section === "orders" && (
            <>
              <label className="order-status-filter">
                وضعیت سفارش
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="">همه وضعیت‌ها</option>
                  {orderStates.map((s) => (
                    <option key={s} value={s}>
                      {statuses[s]}
                    </option>
                  ))}
                </select>
              </label>
              <div className="account-order-list">
                {filtered.map((o) => (
                  <OrderSummary key={o.id} order={o} />
                ))}
              </div>
              {!filtered.length && (
                <div className="empty-state">
                  <h3>سفارشی در این بخش نیست</h3>
                  {status ? (
                    <button
                      className="button secondary"
                      onClick={() => setStatus("")}
                    >
                      همه سفارش‌ها
                    </button>
                  ) : (
                    <Link href="/products" className="button">
                      شروع خرید
                    </Link>
                  )}
                </div>
              )}
            </>
          )}
          {section === "addresses" && (
            <AccountAddresses
              addresses={data.addresses}
              onChanged={() => {
                void addresses.refresh();
              }}
            />
          )}
        </>
      )}
    </AccountShell>
  );
}
