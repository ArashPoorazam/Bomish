import type { ShippingBox, ShippingSize } from "@/lib/types";
import { MeasurementNumber } from "./product-measurements";
export const emptySize: ShippingSize = { lengthMm: 0, widthMm: 0, heightMm: 0 };
export function SizeFields({
  value,
  onChange,
  label,
}: {
  value: ShippingSize;
  onChange: (s: ShippingSize) => void;
  label: string;
}) {
  return (
    <fieldset className="product-step-fields">
      <legend>{label}</legend>
      <div className="form-grid">
        {(
          [
            ["lengthMm", "طول"],
            ["widthMm", "عرض"],
            ["heightMm", "ارتفاع"],
          ] as const
        ).map(([k, l]) => (
          <MeasurementNumber
            key={k}
            label={`${l} (سانتی‌متر)`}
            value={value[k]}
            scale={10}
            max={3000}
            onChange={(n) => onChange({ ...value, [k]: n })}
          />
        ))}
      </div>
    </fieldset>
  );
}
export function ShippingBoxes({
  boxes,
  onChange,
}: {
  boxes: ShippingBox[];
  onChange: (b: ShippingBox[]) => void;
}) {
  const update = (i: number, v: Partial<ShippingBox>) =>
    onChange(boxes.map((b, j) => (j === i ? { ...b, ...v } : b)));
  return (
    <section className="stack">
      <h3>کارتن‌ها و بسته‌بندی</h3>
      <p>
        ابعاد داخلی قابل استفاده را اندازه بگیرید. حاشیه محافظ یک بار از هر دو
        سمت کم می‌شود و وزن پرکننده یک بار اضافه می‌شود.
      </p>
      {boxes.map((b, i) => (
        <details
          className="product-package"
          key={b.id}
          open={b.active || undefined}
        >
          <summary>
            {b.name || "کارتن جدید"} · {b.active ? "فعال" : "غیرفعال"}
          </summary>
          <div className="stack">
            <label>
              نام کارتن
              <input
                value={b.name}
                onChange={(e) => update(i, { name: e.target.value })}
              />
            </label>
            <SizeFields
              value={b.inside}
              label="ابعاد داخلی"
              onChange={(inside) => update(i, { inside, verified: false })}
            />
            <SizeFields
              value={b.outside}
              label="ابعاد بیرونی"
              onChange={(outside) => update(i, { outside, verified: false })}
            />
            <div className="form-grid">
              {(
                [
                  ["emptyGrams", "وزن کارتن خالی (گرم)"],
                  ["maxGrams", "ظرفیت وزن ناخالص (گرم)"],
                  ["fillerGrams", "وزن پرکننده (گرم)"],
                  ["insetMm", "حاشیه محافظ هر سمت (سانتی‌متر)"],
                ] as const
              ).map(([key, label]) => (
                <MeasurementNumber
                  key={key}
                  label={label}
                  value={b[key]}
                  scale={key === "insetMm" ? 10 : 1}
                  onChange={(v) => update(i, { [key]: v, verified: false })}
                />
              ))}
              <label>
                شناسه اندازه پستی
                <input
                  dir="ltr"
                  value={b.postalSizeId}
                  onChange={(e) =>
                    update(i, { postalSizeId: e.target.value, verified: false })
                  }
                />
              </label>
            </div>
            <label className="check-label">
              <input
                type="checkbox"
                checked={b.verified}
                onChange={(e) => update(i, { verified: e.target.checked })}
              />
              اندازه‌های واقعی، ظرفیت و نگاشت پستی بررسی شده‌اند
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={b.active}
                onChange={(e) => update(i, { active: e.target.checked })}
              />
              کارتن فعال
            </label>
            <button
              type="button"
              className="button secondary"
              onClick={() => update(i, { active: false })}
            >
              بایگانی کارتن
            </button>
          </div>
        </details>
      ))}
      <button
        type="button"
        className="button secondary"
        onClick={() =>
          onChange([
            ...boxes,
            {
              id: crypto.randomUUID(),
              name: "",
              inside: { ...emptySize },
              outside: { ...emptySize },
              emptyGrams: 0,
              maxGrams: 0,
              fillerGrams: 0,
              insetMm: 0,
              postalSizeId: "",
              active: false,
              verified: false,
            },
          ])
        }
      >
        افزودن کارتن
      </button>
      <button
        type="button"
        className="button secondary"
        onClick={() => {
          const sizes = [
            [15, 10, 10],
            [20, 15, 10],
            [20, 20, 15],
            [30, 20, 20],
            [35, 25, 20],
            [45, 25, 20],
            [40, 30, 25],
            [45, 40, 30],
            [55, 45, 35],
          ];
          onChange([
            ...boxes,
            ...sizes.map(([l, w, h], i) => ({
              id: crypto.randomUUID(),
              name: `نمونه تأمین‌کننده ${i + 1}؛ نیازمند اندازه‌گیری`,
              inside: { ...emptySize },
              outside: { lengthMm: l * 10, widthMm: w * 10, heightMm: h * 10 },
              emptyGrams: 0,
              maxGrams: 0,
              fillerGrams: 0,
              insetMm: 0,
              postalSizeId: "",
              active: false,
              verified: false,
            })),
          ]);
        }}
      >
        افزودن نمونه‌های غیرفعال ۱ تا ۹
      </button>
    </section>
  );
}
