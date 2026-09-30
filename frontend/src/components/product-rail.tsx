"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Product } from "@/lib/types";
import { ProductCard } from "./product-card";

export function ProductRail({
  products,
  title,
  eyebrow,
  href = "/products",
}: {
  products: Product[];
  title: string;
  eyebrow: string;
  href?: string;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const id = useId();
  const [edges, setEdges] = useState({ start: true, end: true });
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    const update = () => {
      const bounds = el.getBoundingClientRect();
      const first = el.firstElementChild?.getBoundingClientRect();
      const last = el.lastElementChild?.getBoundingClientRect();
      setEdges({
        start: !first || first.right <= bounds.right + 2,
        end: !last || last.left >= bounds.left - 2,
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, [products]);
  if (!products.length) return null;
  function move(next: boolean) {
    const el = rail.current;
    if (!el) return;
    el.scrollBy({
      left: (next ? -1 : 1) * el.clientWidth * 0.85,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }
  return (
    <section className="product-rail" aria-labelledby={id + "-heading"}>
      <div className="section-heading">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2 id={id + "-heading"}>{title}</h2>
        </div>
        <div className="rail-actions">
          <Link className="text-link" href={href}>
            همه محصولات <ArrowLeft size={16} />
          </Link>
          <div className="rail-controls">
            <button
              type="button"
              aria-label={`قبلی در ${title}`}
              aria-controls={id}
              disabled={edges.start}
              onClick={() => move(false)}
            >
              <ArrowRight size={19} />
            </button>
            <button
              type="button"
              aria-label={`بعدی در ${title}`}
              aria-controls={id}
              disabled={edges.end}
              onClick={() => move(true)}
            >
              <ArrowLeft size={19} />
            </button>
          </div>
        </div>
      </div>
      <div
        ref={rail}
        id={id}
        className="rail-track"
        tabIndex={0}
        role="region"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            move(e.key === "ArrowLeft");
          }
        }}
      >
        {products.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}
