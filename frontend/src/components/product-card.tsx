import Image from "next/image";
import { ProductClickLink } from "./product-click-link";
import { ArrowUpLeft } from "lucide-react";
import type { Product } from "@/lib/types";
import { priceRange, inStock, fa } from "@/lib/format";
export function ProductImage({
  product,
  priority = false,
}: {
  product: Product;
  priority?: boolean;
}) {
  return (
    <div
      className={`product-photo ${product.images?.[0] === "/images/spices.png" ? "photo-" + product.slug : ""}`}
    >
      <Image
        src={product.images?.[0] || "/images/spices.png"}
        alt={product.name}
        fill
        sizes="(max-width: 640px) 50vw, (max-width: 1000px) 33vw, 25vw"
        priority={priority}
      />
    </div>
  );
}
export function ProductCard({ product }: { product: Product }) {
  const available = inStock(product);
  const discounted = product.discountPercent > 0;
  return (
    <ProductClickLink
      id={product.id}
      slug={product.slug}
      className={available ? "" : "is-unavailable"}
    >
      <div className="product-card-media">
        <ProductImage product={product} />
        {!available ? (
          <span className="product-stock-stamp">ناموجود</span>
        ) : discounted ? (
          <span className="product-discount-tag">
            <strong>{fa(product.discountPercent)}٪</strong>
          </span>
        ) : null}
      </div>
      <div className="product-card-content">
        <span className="eyebrow">
          {product.categoryId === "herbs"
            ? "سبزی‌های خشک"
            : product.categoryId === "seeds"
              ? "دانه‌های خوراکی"
              : product.categoryId === "spices"
                ? "ادویه‌ها"
                : "محصولات بومیش"}
        </span>
        <h3>{product.name}</h3>
        <p>{product.summary}</p>
        <div className="product-card-bottom">
          <div
            className={`product-card-prices${discounted ? " is-discounted" : ""}`}
          >
            {discounted && (
              <del aria-label="قیمت پیش از تخفیف">
                {priceRange({ ...product, discountPercent: 0 })} تومان
              </del>
            )}
            <div>
              <strong>{priceRange(product)}</strong> <span>تومان</span>
            </div>
          </div>
          <span className="round-arrow">
            <ArrowUpLeft size={18} />
          </span>
        </div>
      </div>
    </ProductClickLink>
  );
}
