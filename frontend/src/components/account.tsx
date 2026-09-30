"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, MapPin, Package, Truck } from "lucide-react";
import type { Address, Order } from "@/lib/types";
import { api } from "@/lib/api";
import { fa, statuses } from "@/lib/format";
import { useStore } from "./store-provider";
import { AccountShell } from "./account-shell";
import { AccountAddresses } from "./account-addresses";
import {
  activeOrderStates,
  OrderSummary,
  orderStates,
  PendingPayment,
} from "./customer-order";
export function Account({
  section,
}: {
  section: "overview" | "orders" | "addresses";
}) {
  const { user } = useStore();
  const [data, setData] = useState<{
      orders: Order[];
      addresses: Address[];
    } | null>(null),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [retry, setRetry] = useState(0);
  const fetchData = useCallback(async () => {
    const [orders, addresses] = await Promise.all([
      api<Order[]>("/orders"),
      api<Address[]>("/addresses"),
    ]);
    return {
      orders: orders.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)),
      addresses,
    };
  }, []);
  const reload = async () => {
    setData(await fetchData());
    setError("");
  };
  useEffect(() => {
    let active = true;
    if (!user?.authenticated) {
      setData(null);
      return;
    }
    setError("");
    fetchData()
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [user?.authenticated, fetchData, retry]);
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
    >
      {error && (
        <div className="account-panel" role="alert">
          <p className="error">{error}</p>
          <button
            className="button secondary"
            onClick={() => setRetry((n) => n + 1)}
          >
            تلاش دوباره
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
                <>
                  <OrderSummary order={latest} />
                  <PendingPayment order={latest} onPaid={reload} />
                </>
              ) : (
                <div className="empty-state">
                  <Package size={34} />
                  <h3>اولین طعم را انتخاب کنید</h3>
                  <p>هنوز سفارشی ثبت نکرده‌اید.</p>
                  <Link href="/products" className="button">
                    شروع خرید
                  </Link>
                </div>
              )}
              <div className="account-note">
                <MapPin size={27} />
                <div>
                  <h3>نشانی‌ها، آماده برای خرید بعدی</h3>
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
                  <div key={o.id}>
                    <OrderSummary order={o} />
                    <PendingPayment order={o} onPaid={reload} />
                  </div>
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
              onChanged={(addresses) =>
                setData((current) =>
                  current ? { ...current, addresses } : current,
                )
              }
            />
          )}
        </>
      )}
    </AccountShell>
  );
}
