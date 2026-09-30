"use client";
import Link from "next/link";
import { api } from "@/lib/api";
import Image from "next/image";
import { useEffect, useState, useRef } from "react";
import { Search, ShoppingBag, UserRound, ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useStore } from "./store-provider";
import type { Product } from "@/lib/types";
import { fa, priceRange } from "@/lib/format";
export function Header() {
  const { cart, user, openCart } = useStore();
  const [q, setQ] = useState(""),
    [hits, setHits] = useState<Product[]>([]),
    [focused, setFocused] = useState(false),
    [active, setActive] = useState(-1);
  const root = useRef<HTMLFormElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (!q.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch("/api/v1/products?pageSize=5&q=" + encodeURIComponent(q), {
        signal: controller.signal,
      })
        .then((r) => (r.ok ? r.json() : []))
        .then((v) => {
          setHits(v.slice(0, 5));
          setActive(-1);
        })
        .catch(() => {});
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);
  const show = focused && q.trim().length > 0;
  return (
    <>
      <div className="top-strip">
        <span>از عطر خاک، تا طعم زندگی</span>
        <span>بسته‌های مشخص، قیمت روشن</span>
      </div>
      <header className="site-header">
        <div className="header-main container">
          <Link href="/" className="brand" aria-label="بومیش، صفحه نخست">
            <Image
              src="/images/bomish-logo.png"
              alt=""
              width={64}
              height={64}
              priority
            />
            <span>
              بومیش<small>BOMISH · طعمِ خوبِ طبیعت</small>
            </span>
          </Link>
          <form
            ref={root}
            className="search"
            role="search"
            onBlur={(e) => {
              if (!root.current?.contains(e.relatedTarget)) setFocused(false);
            }}
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim())
                void api("/events", "POST", { kind: "search", query: q }).catch(
                  () => {},
                );
              if (active >= 0 && hits[active])
                void api("/events", "POST", {
                  kind: "click",
                  productId: hits[active].id,
                  query: "",
                }).catch(() => {});
              setFocused(false);
              router.push(
                active >= 0 && hits[active]
                  ? "/products/" + hits[active].slug
                  : "/products?q=" + encodeURIComponent(q),
              );
            }}
          >
            <Search size={21} />
            <input
              aria-label="جستجوی محصولات"
              role="combobox"
              aria-expanded={show}
              aria-controls="search-results"
              aria-autocomplete="list"
              aria-activedescendant={
                active >= 0 ? `search-${active}` : undefined
              }
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setHits([]);
                setActive(-1);
              }}
              onFocus={() => setFocused(true)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((i) => Math.min(i + 1, hits.length - 1));
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((i) => Math.max(i - 1, 0));
                }
                if (e.key === "Escape") {
                  setFocused(false);
                  setActive(-1);
                }
              }}
              placeholder="دنبال چه عطر و طعمی می‌گردید؟"
            />
            <button type="submit" aria-label="جستجو">
              <ArrowLeft size={19} />
            </button>
            {show ? (
              <div className="suggestions" id="search-results" role="listbox">
                {hits.map((p, i) => (
                  <Link
                    id={`search-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className={i === active ? "active" : ""}
                    key={p.id}
                    href={"/products/" + p.slug}
                    onClick={() => {
                      void api("/events", "POST", {
                        kind: "click",
                        productId: p.id,
                        query: "",
                      }).catch(() => {});
                      if (q.trim())
                        void api("/events", "POST", {
                          kind: "search",
                          query: q,
                        }).catch(() => {});
                      setFocused(false);
                    }}
                  >
                    <span>{p.name}</span>
                    <small>{priceRange(p)} تومان</small>
                  </Link>
                ))}
                <button role="option" aria-selected={false} type="submit">
                  دیدن همه نتایج برای «{q}»
                </button>
              </div>
            ) : null}
          </form>
          <div className="header-actions">
            <Link
              className="account-link"
              aria-label={user?.authenticated ? "حساب من" : "ورود و ثبت‌نام"}
              href={user?.authenticated ? "/account" : "/login"}
            >
              <UserRound size={21} />
              <span>{user?.authenticated ? "حساب من" : "ورود / ثبت‌نام"}</span>
            </Link>
            <button
              className="cart-trigger"
              onClick={() => openCart()}
              aria-label="باز کردن سبد خرید"
            >
              <ShoppingBag size={22} />
              <span>{fa(cart.items.length)}</span>
            </button>
          </div>
        </div>
        <nav className="main-nav container" aria-label="فهرست اصلی">
          <Link href="/products">همه محصولات</Link>
          <Link href="/products?category=spices">ادویه‌ها</Link>
          <Link href="/products?category=herbs">سبزی‌های خشک</Link>
          <Link href="/products?category=seeds">دانه‌های خوراکی</Link>
          <Link href="/blog">مجله بومیش</Link>
          <Link href="/about" className="nav-about">
            داستان بومیش
          </Link>
        </nav>
      </header>
    </>
  );
}
