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
  return (
    <ProductClickLink id={product.id} slug={product.slug}>
      <ProductImage product={product} />
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
        {product.discountPercent > 0 && (
          <span className="badge">{fa(product.discountPercent)}٪ تخفیف</span>
        )}
        <p>{product.summary}</p>
        <div className="product-card-bottom">
          <div>
            <strong>{priceRange(product)}</strong> <span>تومان</span>
          </div>
          <span className="round-arrow">
            <ArrowUpLeft size={18} />
          </span>
        </div>
        {!inStock(product) ? <span className="muted">ناموجود</span> : null}
      </div>
    </ProductClickLink>
  );
}
