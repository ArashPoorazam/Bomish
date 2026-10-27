import "@/app/product-packages.css";
import type { Package, ProductPackaging } from "@/lib/types";
import { fa } from "@/lib/format";
import {
  withProductPackaging,
  withoutProductPackaging,
} from "@/lib/product-packaging";
import { MeasurementNumber } from "./measurement-number";

export function ProductPackagingFields({
  pack,
  options,
  loading,
  onChange,
}: {
  pack: Package;
  options: ProductPackaging[];
  loading: boolean;
  onChange: (patch: Partial<Package>) => void;
}) {
  return (
    <section
      className="product-packaging-fields stack"
      aria-label="انتخاب بسته‌بندی"
    >
      <label>
        بسته‌بندی محصول
        <select
          aria-label="بسته‌بندی محصول"
          value={pack.packagingId || ""}
          disabled={loading}
          onChange={(event) => {
            const selected = options.find(
              (item) => item.id === event.target.value,
            );
            onChange(
              selected
                ? withProductPackaging(pack, selected)
                : withoutProductPackaging(pack),
            );
          }}
        >
          <option value="">
            {loading
              ? "در حال دریافت بسته‌بندی‌ها…"
              : "بسته‌بندی را انتخاب کنید"}
          </option>
          {pack.packagingId &&
            !options.some((item) => item.id === pack.packagingId) && (
              <option value={pack.packagingId}>
                {pack.packaging?.name || "بسته‌بندی ذخیره‌شده"}
              </option>
            )}
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {fa(item.emptyGrams)} گرم
            </option>
          ))}
        </select>
        <small className="muted">
          ابعاد و وزن ظرف از بسته‌بندی انتخاب‌شده دریافت می‌شود؛ نیازی به ورود
          دوباره نیست. ویرایش مشخصات در بخش بسته‌بندی‌ها، همه محصولات مرتبط را
          به‌روز می‌کند.
        </small>
      </label>
      {pack.packagingId && pack.packaging ? (
        <>
          {(pack.unit === "ml" || pack.unit === "l") && (
            <MeasurementNumber
              label="وزن خالص محصول (گرم)"
              value={pack.netGrams ?? 0}
              min={1}
              max={1000000 - pack.packaging.emptyGrams}
              onChange={(netGrams) => onChange({ netGrams })}
            />
          )}
          <p role="status">
            وزن ارسال: {fa(pack.netGrams ?? 0)} گرم محصول +{" "}
            {fa(pack.packaging.emptyGrams)} گرم بسته‌بندی ={" "}
            {fa(pack.shippingGrams)} گرم
          </p>
          <p className="muted">
            <bdi>
              {fa(pack.packaging.lengthMm / 10)} ×{" "}
              {fa(pack.packaging.widthMm / 10)} ×{" "}
              {fa(pack.packaging.heightMm / 10)}
            </bdi>{" "}
            سانتی‌متر · حجم {fa(pack.packaging.volumeCm3)} سانتی‌متر مکعب
          </p>
          <small className="muted">
            وزن هر واحد برای محاسبه ارسال استفاده می‌شود؛ وزن کارتن پستی در
            مرحله ارسال اضافه می‌شود.
          </small>
        </>
      ) : (
        <p className="notice">
          {!loading && options.length === 0
            ? "ابتدا در مدیریت فروشگاه ← بسته‌بندی‌ها یک بسته‌بندی تعریف کنید، سپس آن را اینجا انتخاب کنید."
            : "برای انتشار و فروش این محصول، بسته‌بندی هر بسته را انتخاب کنید. تا آن زمان می‌توانید پیش‌نویس را ذخیره کنید."}
        </p>
      )}
    </section>
  );
}
