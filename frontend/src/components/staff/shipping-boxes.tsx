import { simulationBox } from "./shipping-simulation";
import { useState } from "react";
import { fa } from "@/lib/format";
import type { ShippingConfig, ShippingBox, ShippingSize } from "@/lib/types";
import { MeasurementNumber } from "./measurement-number";
const emptySize: ShippingSize = { lengthMm: 0, widthMm: 0, heightMm: 0 };
function SizeFields({
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
  catalog,
  simulated,
  defaults,
  onChange,
}: {
  boxes: ShippingBox[];
  catalog: NonNullable<ShippingConfig["boxCatalog"]>;
  simulated: boolean;
  defaults: NonNullable<ShippingConfig["boxDefaults"]>;
  onChange: (b: ShippingBox[]) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const update = (i: number, v: Partial<ShippingBox>) =>
    onChange(
      boxes.map((b, j) =>
        j === i
          ? { ...b, ...v, ...(v.verified === false ? { active: false } : {}) }
          : b,
      ),
    );
  return (
    <section id="shipping-boxes" className="shipping-section stack">
      <div className="section-heading">
        <span className="section-number">۲</span>
        <div>
          <h3>کارتن‌های موجود</h3>
          <p className="muted">
            کارتن‌هایی را انتخاب کنید که در فروشگاه موجود دارید؛ چیدمان سفارش
            خودکار پیشنهاد می‌شود.
          </p>
        </div>
      </div>
      <div className="box-catalog-grid">
        {catalog.map((entry) => {
          const selected = boxes.find(
            (b) =>
              b.catalog?.id === entry.id &&
              b.catalog?.version === entry.version,
          );
          return (
            <article className="box-catalog-card" key={entry.id}>
              <strong>{entry.name}</strong>
              <bdi>
                {fa(entry.nominalOutside.lengthMm / 10)} ×{" "}
                {fa(entry.nominalOutside.widthMm / 10)} ×{" "}
                {fa(entry.nominalOutside.heightMm / 10)} سانتی‌متر
              </bdi>
              <small className="muted">ابعاد اسمی بیرونی</small>
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  if (selected) {
                    setEditing(selected.id);
                    return;
                  }
                  const id = crypto.randomUUID();
                  onChange([
                    ...boxes,
                    {
                      id,
                      name: entry.name,
                      inside: { ...emptySize },
                      outside: { ...entry.nominalOutside },
                      emptyGrams: 0,
                      maxGrams: 0,
                      fillerGrams: 0,
                      insetMm: 0,
                      postalSizeId: "",
                      active: false,
                      verified: false,
                      catalog: {
                        id: entry.id,
                        version: entry.version,
                        sourceUrl: entry.sourceUrl,
                        nominalOutside: { ...entry.nominalOutside },
                      },
                    },
                  ]);
                  setEditing(id);
                }}
              >
                {selected
                  ? selected.active
                    ? "موجود · مشاهده"
                    : "تکمیل و فعال‌سازی"
                  : "این کارتن را داریم"}
              </button>
            </article>
          );
        })}
      </div>
      <p className="muted">
        فقط ابعاد بیرونی و وزن کارتن خالی را اندازه بگیرید. فضای داخلی با ضخامت
        دیواره {fa(defaults.wallMm)} میلی‌متر و حاشیه محافظ{" "}
        {fa(defaults.insetMm / 10)}
        سانتی‌متر از هر سمت، خودکار محاسبه می‌شود.
      </p>
      {boxes.map((b, i) => (
        <article className="box-stock-card stack" key={b.id}>
          <div className="between">
            <div>
              <h4>{b.name || "کارتن سفارشی"}</h4>
              <small>
                {b.simulated
                  ? "فقط شبیه‌سازی"
                  : b.verified
                    ? "اندازه‌ها تکمیل شده"
                    : "نیازمند اندازه‌گیری اولیه"}
              </small>
            </div>
            <label className="check-label">
              <input
                type="checkbox"
                checked={b.active}
                disabled={!b.verified}
                onChange={(e) => update(i, { active: e.target.checked })}
              />
              موجود و قابل استفاده
            </label>
          </div>
          <details
            open={editing === b.id}
            onToggle={(e) => {
              if (!e.currentTarget.open && editing === b.id) setEditing(null);
            }}
          >
            <summary
              onClick={(e) => {
                e.preventDefault();
                setEditing(editing === b.id ? null : b.id);
              }}
            >
              مشخصات و اندازه‌گیری کارتن
            </summary>
            <div className="stack">
              {b.catalog && (
                <p className="muted">
                  نسخه {b.catalog.version} ·{" "}
                  <a
                    href={b.catalog.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    مشخصات تأمین‌کننده
                  </a>{" "}
                  · ابعاد اسمی با فضای داخلی قابل استفاده یکسان نیست.
                </p>
              )}
              <label>
                نام کارتن
                <input
                  value={b.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                />
              </label>
              <SizeFields
                value={b.outside}
                label="ابعاد بیرونی"
                onChange={(outside) => update(i, { outside, verified: false })}
              />
              <MeasurementNumber
                label="وزن کارتن خالی (گرم)"
                value={b.emptyGrams}
                onChange={(emptyGrams) =>
                  update(i, { emptyGrams, verified: false })
                }
              />
              <p className="box-usable-size" aria-live="polite">
                فضای قابل استفاده برای محصولات:{" "}
                <bdi>
                  {[b.outside.lengthMm, b.outside.widthMm, b.outside.heightMm]
                    .map((size) =>
                      fa(
                        Math.max(
                          0,
                          size - 2 * (defaults.wallMm + defaults.insetMm),
                        ) / 10,
                      ),
                    )
                    .join(" × ")}
                </bdi>{" "}
                سانتی‌متر
              </p>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={b.verified}
                  onChange={(e) => update(i, { verified: e.target.checked })}
                />
                ابعاد بیرونی و وزن کارتن خالی را بررسی کردم
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
        </article>
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
        افزودن کارتن سفارشی
      </button>
      {simulated && (
        <button
          type="button"
          className="button secondary"
          onClick={() => onChange([...boxes, simulationBox()])}
        >
          افزودن کارتن آزمایشی · فقط شبیه‌سازی
        </button>
      )}
    </section>
  );
}
