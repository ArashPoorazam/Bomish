import type { ShippingConfig } from "@/lib/types";
import { ProviderCard, LocalitySettings } from "./shipping-providers";
import { MeasurementNumber } from "./measurement-number";
import { simulationSetup } from "./shipping-simulation";
export function ShippingTechnical({
  v,
  setV,
  busy,
  dirty,
  onCheck,
}: {
  v: ShippingConfig;
  setV: (value: ShippingConfig) => void;
  busy: boolean;
  dirty: boolean;
  onCheck: (name: "snapp" | "tapin") => Promise<void>;
}) {
  return (
    <details
      id="shipping-technical"
      className="shipping-section technical-settings"
    >
      <summary>تنظیمات فنی و راه‌اندازی</summary>
      <div className="stack">
        <p className="muted">
          تنظیمات یک‌باره اتصال و تعرفه‌ها؛ برای آماده‌سازی سفارش‌ها نیازی به
          تغییر این بخش نیست.
        </p>
        {v.simulated && (
          <button
            type="button"
            className="button secondary"
            onClick={() => setV(simulationSetup(v))}
          >
            آماده‌سازی تنظیمات شبیه‌سازی
          </button>
        )}
        <LocalitySettings
          value={v.localities}
          onChange={(localities) => setV({ ...v, localities })}
        />
        {(["snapp", "tapin"] as const).map((name) => (
          <ProviderCard
            key={name}
            name={name}
            value={v[name]}
            health={v.providers?.[name]}
            busy={busy || dirty}
            onChange={(value) => setV({ ...v, [name]: value })}
            onCheck={() => onCheck(name)}
          />
        ))}
        <label>
          روش محاسبه
          <select
            value={v.mode}
            onChange={(e) =>
              setV({ ...v, mode: e.target.value as ShippingConfig["mode"] })
            }
          >
            <option value="legacy">تعرفه‌های قبلی</option>
            <option value="calculated">محاسبه با اندازه و ارائه‌دهنده</option>
          </select>
        </label>
        <details>
          <summary>
            تعرفه‌های قبلی {v.mode === "calculated" ? "· غیرفعال" : ""}
          </summary>
          <MeasurementNumber
            label="وزن بسته‌بندی قبلی (گرم)"
            value={v.packagingGrams}
            onChange={(n) => setV({ ...v, packagingGrams: n })}
          />
          {v.rules.map((r, i) => (
            <div className="product-package form-grid" key={r.id}>
              <label>
                استان
                <input
                  value={r.province}
                  onChange={(e) =>
                    setV({
                      ...v,
                      rules: v.rules.map((x, j) =>
                        i === j ? { ...x, province: e.target.value } : x,
                      ),
                    })
                  }
                />
              </label>
              <MeasurementNumber
                label="حداکثر وزن (گرم)"
                value={r.maxGrams}
                onChange={(n) =>
                  setV({
                    ...v,
                    rules: v.rules.map((x, j) =>
                      i === j ? { ...x, maxGrams: n } : x,
                    ),
                  })
                }
              />
              <MeasurementNumber
                label="هزینه (تومان)"
                value={r.feeRials / 10}
                onChange={(n) =>
                  setV({
                    ...v,
                    rules: v.rules.map((x, j) =>
                      i === j ? { ...x, feeRials: n * 10 } : x,
                    ),
                  })
                }
              />
              <button
                type="button"
                onClick={() =>
                  setV({ ...v, rules: v.rules.filter((_, j) => j !== i) })
                }
              >
                حذف بازه
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setV({
                ...v,
                rules: [
                  ...v.rules,
                  {
                    id: crypto.randomUUID(),
                    province: "",
                    maxGrams: 1000,
                    feeRials: 0,
                  },
                ],
              })
            }
          >
            افزودن بازه
          </button>
        </details>
      </div>
    </details>
  );
}
