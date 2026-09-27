"use client";
import {
  CatalogManager,
  CategoryManager,
  PriceManager,
} from "./catalog-manager";
import { Analytics } from "./analytics";
import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import type {
  Product,
  Category,
  Article,
  Order,
  ShippingConfig,
  Member,
} from "@/lib/types";
import { useStore } from "@/components/store-provider";
import { newArticle, ArticleEditor } from "./article-editor";
import { OrderManager, ShippingEditor, Members } from "./operations";
import { date, digits, statuses } from "@/lib/format";
export function Dashboard() {
  const { user, refresh } = useStore();
  const [tab, setTab] = useState("products"),
    [error, setError] = useState(""),
    [products, setProducts] = useState<Product[]>([]),
    [categories, setCategories] = useState<Category[]>([]),
    [articles, setArticles] = useState<Article[]>([]),
    [orders, setOrders] = useState<Order[]>([]),
    [shipping, setShipping] = useState<ShippingConfig | null>(null),
    [members, setMembers] = useState<Member[]>([]),
    [events, setEvents] = useState<Record<string, string>[]>([]),
    [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const role = user?.role || "";
  const reload = useCallback(async () => {
    if (!role) return;
    const content = role === "owner" || role === "editor";
    if (content) {
      const [p, c, a] = await Promise.all([
        api<Product[]>("/staff/products"),
        api<Category[]>("/categories"),
        api<Article[]>("/staff/articles"),
      ]);
      setProducts(p);
      setCategories(c);
      setArticles(a);
      setSelectedArticle((current) =>
        current ? a.find((item) => item.id === current.id) || current : null,
      );
    }
    if (role === "owner" || role === "operator")
      setOrders(await api<Order[]>("/staff/orders"));
    if (role === "owner") {
      const [s, m, e] = await Promise.all([
        api<ShippingConfig>("/staff/shipping"),
        api<Member[]>("/staff/members"),
        api<Record<string, string>[]>("/staff/audit"),
      ]);
      setShipping(s);
      setMembers(m);
      setEvents(e);
    }
  }, [role]);
  useEffect(() => {
    reload().catch((e) => setError(e.message));
    if (role === "operator") setTab("orders");
  }, [reload, role]);
  if (!user) return <div className="loading">در حال دریافت اطلاعات…</div>;
  if (!role) return <StaffLogin />;
  const tabs =
    role === "operator"
      ? [["orders", "سفارش‌ها"]]
      : [
          ["products", "محصولات"],
          ["articles", "مجله"],
          ["categories", "دسته‌بندی‌ها"],
          ...(role === "owner"
            ? [
                ["orders", "سفارش‌ها"],
                ["pricing", "قیمت و تخفیف"],
                ["analytics", "تحلیل داده‌ها"],
                ["shipping", "ارسال"],
                ["members", "همکاران"],
                ["audit", "رویدادها"],
              ]
            : []),
        ];
  return (
    <div className="container section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">فضای کار بومیش</span>
          <h1>مدیریت فروشگاه</h1>
        </div>
        <button
          className="button secondary"
          onClick={async () => {
            try {
              await api("/logout", "POST");
              await refresh();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          خروج
        </button>
      </div>
      <div className="notice">
        {role === "owner"
          ? "مالک فروشگاه · انتشار، قیمت و موجودی در اختیار شماست."
          : role === "editor"
            ? "ویرایشگر محتوا · تغییرات شما به صورت پیش‌نویس برای تأیید مالک ذخیره می‌شود."
            : "مسئول سفارش‌ها · سفارش‌های پرداخت‌شده را آماده و ارسال کنید."}
      </div>
      <nav className="dashboard-tabs">
        {tabs.map(([key, title]) => (
          <button
            key={key}
            className={tab === key ? "selected" : ""}
            onClick={() => {
              setTab(key);
              setError("");
            }}
          >
            {title}
          </button>
        ))}
      </nav>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {tab === "products" ? (
        <CatalogManager
          products={products}
          categories={categories}
          owner={role === "owner"}
          reload={reload}
        />
      ) : null}
      {tab === "articles" ? (
        <div className="dashboard-grid">
          <aside className="dashboard-list">
            <button onClick={() => setSelectedArticle(newArticle())}>
              + مقاله جدید
            </button>
            {articles.map((a) => (
              <button
                key={a.id}
                className={selectedArticle?.id === a.id ? "selected" : ""}
                onClick={() => setSelectedArticle(a)}
              >
                {a.title}
                <small>{statuses[a.status]}</small>
              </button>
            ))}
          </aside>
          {selectedArticle ? (
            <ArticleEditor
              article={selectedArticle}
              products={products}
              owner={role === "owner"}
              onSaved={reload}
            />
          ) : (
            <div className="empty-state">مقاله‌ای را انتخاب کنید.</div>
          )}
        </div>
      ) : null}
      {tab === "categories" ? (
        <CategoryManager
          categories={categories}
          products={products}
          reload={reload}
        />
      ) : null}
      {tab === "pricing" && role === "owner" ? (
        <PriceManager products={products} reload={reload} />
      ) : null}
      {tab === "analytics" && role === "owner" ? <Analytics /> : null}
      {tab === "orders" ? (
        <OrderManager orders={orders} reload={reload} />
      ) : null}
      {tab === "shipping" && shipping ? (
        <ShippingEditor initial={shipping} />
      ) : null}
      {tab === "members" ? <Members members={members} reload={reload} /> : null}
      {tab === "audit" ? (
        <div className="form-card table-scroll">
          <table>
            <thead>
              <tr>
                <th>همکار</th>
                <th>عملیات</th>
                <th>زمان</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={i}>
                  <td>{e.username}</td>
                  <td>
                    {(
                      {
                        "product.draft": "ذخیره پیش‌نویس محصول",
                        "product.publish": "انتشار محصول",
                        "product.archive": "بایگانی محصول",
                        "inventory.adjust": "اصلاح موجودی",
                        "article.save": "ذخیره مقاله",
                        "shipping.update": "تنظیم ارسال",
                        "staff.update": "مدیریت همکار",
                        "order.packing": "آماده‌سازی سفارش",
                        "order.shipped": "ارسال سفارش",
                      } as Record<string, string>
                    )[e.action] || "تغییر فروشگاه"}
                  </td>
                  <td dir="ltr">{date(e.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
function StaffLogin() {
  const { refresh } = useStore();
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="auth-layout">
      <div className="form-card">
        <h1>ورود همکاران</h1>
        <p>نام کاربری، گذرواژه و کد برنامه رمزساز را وارد کنید.</p>
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await api("/staff/login", "POST", {
                username,
                password,
                code: digits(code),
              });
              await refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            نام کاربری
            <input
              autoComplete="username"
              required
              dir="ltr"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label>
            گذرواژه
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label>
            کد برنامه رمزساز
            <input
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              required
              dir="ltr"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <button className="button" disabled={busy}>
            {busy ? "در حال ورود…" : "ورود به فضای کار"}
          </button>
          {error ? (
            <p role="alert" className="error">
              {error}
            </p>
          ) : null}
        </form>
      </div>
    </div>
  );
}
