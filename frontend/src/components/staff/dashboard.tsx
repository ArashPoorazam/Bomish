"use client";
import { useCallback, useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useStore } from "@/components/store-provider";
import { api } from "@/lib/api";
import { fa } from "@/lib/format";
import type {
  Product,
  Category,
  Article,
  Order,
  ShippingConfig,
} from "@/lib/types";
import {
  Workspace,
  Feedback,
  Pager,
  type PageData,
} from "@/components/omnisire/shared";
import { CatalogManager, CategoryManager } from "./catalog-manager";
import { ArticleManager } from "./article-manager";
import { PriceManager } from "./price-manager";
import { ShippingEditor } from "./operations";
import {
  sectionLabels,
  sectionPermission,
} from "../omnisire/workspace-navigation";
import { StaffRequests } from "../requests/staff-requests";
import { SuggestionsEditor } from "./suggestions";
import { OrderManager } from "./order-manager";
export function Dashboard({
  initialSection = "",
  initialQuery = "",
}: {
  initialSection?: string;
  initialQuery?: string;
}) {
  const { user } = useStore();
  const permissions = user?.permissions || [];
  const key = permissions.join(",");
  const [tab, setTab] = useState(initialSection);
  const requestVersion = useRef(0);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [products, setProducts] = useState<Product[]>([]),
    [categories, setCategories] = useState<Category[]>([]),
    [articles, setArticles] = useState<Article[]>([]),
    [orders, setOrders] = useState<Order[]>([]),
    [shipping, setShipping] = useState<ShippingConfig | null>(null);
  const [editingArticle, setEditingArticle] = useState(false);
  const [viewingOrder, setViewingOrder] = useState(false);
  const [editor, setEditor] = useState({ dirty: false, busy: false });
  const [page, setPage] = useState(1),
    [listData, setListData] = useState<PageData | null>(null),
    [filters, setFilters] = useState<Record<string, string>>({
      q: initialQuery,
    });
  const filterKey = JSON.stringify(filters);
  const onFilters = useCallback((next: Record<string, string>) => {
    setFilters((prev) =>
      JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
    );
    setPage(1);
  }, []);
  useEffect(() => {
    if (!user?.role) return;
    if (!permissions.includes(sectionPermission(tab)))
      setTab(
        (permissions.find((x) => x !== "omnisire") || "").replace(
          /^requests$/,
          "support",
        ),
      );
  }, [key, tab]);
  const reload = useCallback(async () => {
    const request = ++requestVersion.current;
    if (!user?.role || !tab || tab === "sales") return;
    setBusy(true);
    setError("");
    try {
      if (["categories", "pricing"].includes(tab)) {
        const [p, c] = await Promise.all([
          api<Product[]>("/staff/product-options"),
          api<Category[]>("/categories"),
        ]);
        if (request !== requestVersion.current) return;
        setProducts(p);
        setCategories(c);
      }
      if (tab === "products") {
        const categories = await api<Category[]>("/categories");
        if (request !== requestVersion.current) return;
        setCategories(categories);
        const d = await api<PageData>(
          "/staff/products?" +
            new URLSearchParams({ ...filters, page: String(page) }),
        );
        if (request !== requestVersion.current) return;
        setProducts(d.items as unknown as Product[]);
        setListData(d);
      }
      if (tab === "articles") {
        const d = await api<PageData>(
          "/staff/articles?" +
            new URLSearchParams({ ...filters, page: String(page) }),
        );
        if (request !== requestVersion.current) return;
        setArticles(d.items as unknown as Article[]);
        setListData(d);
      }
      if (tab === "orders") {
        const d = await api<PageData>(
          "/staff/orders?" +
            new URLSearchParams({ ...filters, page: String(page) }),
        );
        if (request !== requestVersion.current) return;
        setOrders(d.items as unknown as Order[]);
        setListData(d);
      }
      if (tab === "shipping") {
        const config = await api<ShippingConfig>("/staff/shipping");
        if (request === requestVersion.current) setShipping(config);
      }
    } catch (e) {
      if (request === requestVersion.current) setError((e as Error).message);
    } finally {
      if (request === requestVersion.current) setBusy(false);
    }
  }, [tab, key, page, filterKey]);
  useEffect(() => {
    void reload();
    return () => {
      requestVersion.current++;
    };
  }, [reload]);
  useEffect(() => {
    if (tab !== "orders" || viewingOrder || editor.busy) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, 10000);
    return () => clearInterval(timer);
  }, [tab, viewingOrder, editor.busy, reload]);
  return (
    <Workspace
      title={sectionLabels[tab] || "مدیریت فروشگاه"}
      titleDetail={
        ["products", "articles"].includes(tab) && listData ? (
          <span className="badge">
            {fa(listData.total)} {tab === "products" ? "محصول" : "مقاله"}
          </span>
        ) : undefined
      }
      description={
        tab === "products"
          ? "محصولات فروشگاه را جستجو و مدیریت کنید؛ محصول جدید اضافه کنید و اطلاعات، تصاویر، بسته‌ها و وضعیت انتشار و موجودی آن‌ها را ویرایش کنید."
          : tab === "articles"
            ? "مقاله‌های مجله را بنویسید و ویرایش کنید؛ تصویر و محصولات مرتبط را انتخاب کنید و نوشته‌ها را به‌صورت پیش‌نویس ذخیره یا منتشر کنید."
            : tab === "categories"
              ? "دسته‌بندی‌های فروشگاه را جستجو و مدیریت کنید؛ دسته‌بندی جدید بسازید، نام و توضیحات آن‌ها را ویرایش کنید و تعداد محصولات هر دسته را ببینید."
              : tab === "pricing"
                ? "قیمت پایه بسته‌ها را اصلاح کنید، برای یک یا چند محصول تخفیف بسازید و تخفیف‌های فعال و کدهای خرید را مدیریت کنید."
                : tab === "orders"
                  ? "سفارش‌ها را پیگیری کنید؛ برای مشاهده اقلام و نشانی، روی هر سفارش بزنید و مراحل بسته‌بندی، ارسال و تحویل را مدیریت کنید."
                  : undefined
      }
      activeSection={tab}
      navigationLocked={editor.busy}
      onSectionChange={(p) => {
        if (
          editor.dirty &&
          !confirm("تغییرات ذخیره نشده‌اند. بدون ذخیره خارج می‌شوید؟")
        )
          return;
        setEditor({ dirty: false, busy: false });
        setPage(1);
        setEditingArticle(false);
        setViewingOrder(false);
        setFilters({});
        setListData(null);
        setTab(p);
        window.history.replaceState(null, "", `/staff?section=${p}`);
      }}
    >
      <Feedback error={error} loading={busy} />
      {tab === "products" && (
        <CatalogManager
          initialQuery={tab === initialSection ? initialQuery : ""}
          products={products}
          categories={categories}
          owner
          canPrice={permissions.includes("pricing")}
          onFilters={onFilters}
          reload={reload}
          onEditorStateChange={setEditor}
        />
      )}
      {tab === "articles" && (
        <ArticleManager
          initialQuery={tab === initialSection ? initialQuery : ""}
          onFilters={onFilters}
          articles={articles}
          onEditingChange={setEditingArticle}
          owner
          reload={reload}
          onEditorStateChange={setEditor}
        />
      )}
      {tab === "categories" && (
        <CategoryManager categories={categories} reload={reload} />
      )}
      {tab === "pricing" && (
        <PriceManager
          products={products}
          reload={reload}
          onStateChange={setEditor}
        />
      )}
      {tab === "orders" && (
        <OrderManager
          initialQuery={tab === initialSection ? initialQuery : ""}
          onFilters={onFilters}
          orders={orders}
          onDetailChange={setViewingOrder}
          reload={reload}
          onStateChange={setEditor}
        />
      )}
      {tab === "support" && (
        <StaffRequests key="support" kind="support" onStateChange={setEditor} />
      )}
      {tab === "custom" && (
        <StaffRequests key="custom" kind="custom" onStateChange={setEditor} />
      )}
      {tab === "suggestions" && <SuggestionsEditor />}
      {tab === "shipping" && shipping && (
        <ShippingEditor initial={shipping} />
      )}{" "}
      {tab === "sales" && (
        <div className="omni-welcome">
          <h2>فروش‌های شما، دستاورد شما</h2>
          <p>لینک اختصاصی، کمیسیون و پرداخت‌های خود را در یک‌جا ببینید.</p>
          <Link className="button" href="/staff/sales">
            مشاهده فروش من
          </Link>
        </div>
      )}
      {["products", "orders", "articles"].includes(tab) &&
        !editingArticle &&
        !viewingOrder && (
          <Pager data={listData} page={page} onPage={setPage} />
        )}{" "}
      {!permissions.length && (
        <p className="notice">در حال حاضر بخشی برای حساب شما فعال نیست.</p>
      )}
    </Workspace>
  );
}
