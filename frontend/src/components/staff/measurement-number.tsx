import { useState, useId } from "react";
import { digits } from "@/lib/format";
export function MeasurementNumber({
  label,
  value,
  onChange,
  scale = 1,
  max = 1000000,
  min = 0,
  errorText,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  scale?: number;
  max?: number;
  min?: number;
  errorText?: string;
}) {
  const errorId = useId();
  const [draft, setDraft] = useState<{ text: string; value: number } | null>(
    null,
  );
  const invalid =
    value < 0 ||
    value > max ||
    !Number.isFinite(value) ||
    (value > 0 && value < min);
  const decimals = Math.log10(scale);
  return (
    <label>
      {label}
      <input
        aria-label={label}
        dir="ltr"
        inputMode={scale > 1 ? "decimal" : "numeric"}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        value={
          draft?.value === value
            ? draft.text
            : value
              ? String(value / scale)
              : ""
        }
        onChange={(e) => {
          const text = digits(e.target.value).replace(/٫/g, ".");
          const valid = (
            decimals > 0
              ? new RegExp(`^\\d+(\\.\\d{0,${decimals}})?$`)
              : /^\d+$/
          ).test(text);
          const next =
            text === "" ? 0 : valid ? Math.round(Number(text) * scale) : -1;
          setDraft({ text, value: next });
          onChange(next);
        }}
        onBlur={() => {
          if (!invalid) setDraft(null);
        }}
      />
      {invalid && (
        <small id={errorId} className="error">
          {errorText ?? "مقدار مثبت و در محدوده وارد کنید."}
        </small>
      )}
    </label>
  );
}
