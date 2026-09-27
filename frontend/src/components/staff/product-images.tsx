import { useRef, useState } from "react";
import Image from "next/image";
import { ImagePlus, Star, Trash2, UploadCloud } from "lucide-react";
import { api } from "@/lib/api";
import { fa } from "@/lib/format";
import type { ProductFields } from "./product-form";

type FailedUpload = { file: File; message: string };
export function ProductImages({
  p,
  field,
  onBusy,
}: ProductFields & { onBusy: (busy: boolean) => void }) {
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [failures, setFailures] = useState<FailedUpload[]>([]);
  const [dragging, setDragging] = useState(false);
  const lock = useRef(false);
  async function upload(files: File[]) {
    if (!files.length || lock.current) return;
    lock.current = true;
    onBusy(true);
    setFailures([]);
    setProgress({ done: 0, total: files.length });
    const images = [...p.images];
    const failed: FailedUpload[] = [];
    // Keep selection order and bound requests; successful files survive partial failures.
    for (const [index, file] of files.entries()) {
      try {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
          throw new Error("فقط JPG، PNG یا WebP انتخاب کنید.");
        if (file.size >= 8 * 1024 * 1024)
          throw new Error("حجم تصویر باید کمتر از ۸ مگابایت باشد.");
        const body = new FormData();
        body.set("image", file);
        const result = await api<{ url: string }>(
          "/staff/uploads",
          "POST",
          body,
        );
        images.push(result.url);
        field("images", [...images]);
      } catch (e) {
        failed.push({ file, message: (e as Error).message });
      }
      setProgress({ done: index + 1, total: files.length });
    }
    setFailures(failed);
    setProgress(null);
    lock.current = false;
    onBusy(false);
  }
  return (
    <div className="stack">
      <label
        className={`product-upload ${dragging ? "dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(Array.from(e.dataTransfer.files));
        }}
      >
        <UploadCloud size={34} aria-hidden="true" />
        <strong>
          {progress ? "در حال بارگذاری تصاویر…" : "تصاویر را اینجا رها کنید"}
        </strong>
        <span>یا برای انتخاب چند تصویر با هم کلیک کنید</span>
        <span className="button secondary">
          <ImagePlus size={18} aria-hidden="true" />
          انتخاب تصاویر
        </span>
        <small>JPG، PNG یا WebP · هر تصویر کمتر از ۸ مگابایت</small>
        <input
          className="upload-file-input"
          aria-label="بارگذاری تصاویر"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          disabled={!!progress}
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = "";
            void upload(files);
          }}
        />
      </label>
      {progress && (
        <div role="status" className="upload-progress">
          <progress
            value={progress.done}
            max={progress.total}
            aria-label="پیشرفت بارگذاری"
          />
          <span>
            {fa(progress.done)} از {fa(progress.total)} تصویر
          </span>
        </div>
      )}
      {failures.length > 0 && (
        <div className="error" role="alert">
          <strong>برخی تصاویر بارگذاری نشدند؛ تصاویر موفق حفظ شدند.</strong>
          <ul>
            {failures.map(({ file, message }, i) => (
              <li key={i}>
                {file.name}: {message}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="button secondary"
            onClick={() => void upload(failures.map((f) => f.file))}
          >
            تلاش دوباره برای تصاویر ناموفق
          </button>
        </div>
      )}
      <div className="between">
        <strong>{fa(p.images.length)} تصویر محصول</strong>
        <small className="muted">
          تصویر اول در فهرست محصولات نمایش داده می‌شود.
        </small>
      </div>
      <div className="product-image-grid">
        {p.images.map((src, i) => (
          <article
            className={`product-image ${i === 0 ? "is-cover" : ""}`}
            key={src + i}
          >
            <Image src={src} alt={`تصویر ${i + 1}`} width={260} height={200} />
            {i === 0 && (
              <span className="cover-badge">
                <Star size={13} aria-hidden="true" />
                تصویر اصلی
              </span>
            )}
            <div>
              <button
                type="button"
                className="button secondary"
                disabled={!!progress || i === 0}
                aria-label={`انتخاب تصویر ${i + 1} به‌عنوان تصویر اصلی`}
                onClick={() =>
                  field("images", [src, ...p.images.filter((_, n) => n !== i)])
                }
              >
                <Star size={15} aria-hidden="true" />
                {i === 0 ? "اصلی" : "تصویر اصلی"}
              </button>
              <button
                type="button"
                className="button subtle-danger"
                disabled={!!progress}
                aria-label={`حذف تصویر ${i + 1}`}
                onClick={() =>
                  field(
                    "images",
                    p.images.filter((_, n) => n !== i),
                  )
                }
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
