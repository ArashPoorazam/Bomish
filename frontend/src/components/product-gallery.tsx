"use client";
import Image from "next/image";
import { useState } from "react";
import type { Product } from "@/lib/types";
export function ProductGallery({ product: p }: { product: Product }) {
  const [index, setIndex] = useState(0);
  return (
    <div className="product-gallery">
      <div
        className={
          "detail-image " +
          (p.images[index] === "/images/spices.png" ? "photo-" + p.slug : "")
        }
      >
        <Image
          src={p.images[index] || "/images/spices.png"}
          alt={p.name}
          fill
          priority
          sizes="(max-width: 760px) 90vw, (max-width: 1100px) 45vw, 510px"
        />
      </div>
      {p.images.length > 1 ? (
        <div className="thumbnails">
          {p.images.map((src, i) => (
            <button
              key={src + i}
              onClick={() => setIndex(i)}
              aria-label={`تصویر ${i + 1}`}
              aria-pressed={i === index}
            >
              <Image src={src} alt="" width={72} height={72} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
