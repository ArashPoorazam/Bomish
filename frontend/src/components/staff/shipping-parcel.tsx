import type { Parcel } from "@/lib/types";
import { fa } from "@/lib/format";
export function ParcelView({ parcel: p }: { parcel: Parcel }) {
  const layers = [...new Set(p.placements.map((v) => v.z))].sort(
    (a, b) => a - b,
  );
  return (
    <section className="product-package stack">
      <h4>کارتن ارسال · {p.box.name}</h4>
      <p>
        <bdi>
          {fa(p.box.outside.lengthMm / 10)} × {fa(p.box.outside.widthMm / 10)} ×{" "}
          {fa(p.box.outside.heightMm / 10)}
        </bdi>{" "}
        سانتی‌متر · وزن برآوردی {fa(p.grossGrams)} گرم{" "}
        {p.measuredGrams > 0 ? `· وزن واقعی ${fa(p.measuredGrams)} گرم` : ""}
      </p>
      <strong>{p.manual ? "چیدمان دستی تأییدشده" : "چیدمان پیشنهادی"}</strong>
      {!p.manual &&
        layers.map((z) => (
          <figure key={z}>
            <figcaption>لایه در ارتفاع {fa(z / 10)} سانتی‌متر</figcaption>
            <svg
              className="packing-layout"
              viewBox={`0 0 ${p.box.inside.lengthMm} ${p.box.inside.widthMm}`}
              role="img"
              aria-label={`نمای بالای لایه ${z / 10} سانتی‌متری`}
            >
              {p.placements.map((v, i) =>
                v.z === z ? (
                  <g key={v.item.productId + v.item.packageId + v.item.unit}>
                    <rect
                      x={v.x}
                      y={v.y}
                      width={
                        v.rotated ? v.item.size.widthMm : v.item.size.lengthMm
                      }
                      height={
                        v.rotated ? v.item.size.lengthMm : v.item.size.widthMm
                      }
                      fill="#dce9d9"
                      stroke="#235943"
                    />
                    <text x={v.x + 5} y={v.y + 16} fontSize="14">
                      {i + 1}
                    </text>
                  </g>
                ) : null,
              )}
            </svg>
          </figure>
        ))}
      <ol>
        {p.placements.map((v, i) => (
          <li key={v.item.productId + v.item.packageId + v.item.unit}>
            {fa(i + 1)}. {v.item.label} · {fa(v.item.grams)} گرم · موقعیت{" "}
            <bdi>
              {v.x}, {v.y}, {v.z}
            </bdi>{" "}
            میلی‌متر {v.rotated ? "· چرخش روی قاعده" : ""}
          </li>
        ))}
      </ol>
    </section>
  );
}
