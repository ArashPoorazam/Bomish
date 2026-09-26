import Image from "next/image";
import Link from "next/link";
import { ArrowUpLeft } from "lucide-react";
import type { Product } from "@/lib/types";
import { money } from "@/lib/format";
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
    <Link href={`/products/${product.slug}`} className="product-card">
      <ProductImage product={product} />
      <div className="product-card-content">
        <span className="eyebrow">
          {product.categoryId === "herbs"
            ? "سبزی‌های خشک"
            : product.categoryId === "seeds"
              ? "دانه‌های خوراکی"
              : "ادویه‌ها"}
        </span>
        <h3>{product.name}</h3>
        <p>{product.summary}</p>
        <div className="product-card-bottom">
          <div>
            <strong>{money(product.priceRials)}</strong>{" "}
            <span>تومان / کیلوگرم</span>
          </div>
          <span className="round-arrow">
            <ArrowUpLeft size={18} />
          </span>
        </div>
        {product.availableGrams < product.minGrams ? (
          <span className="muted">ناموجود</span>
        ) : null}
      </div>
    </Link>
  );
}
