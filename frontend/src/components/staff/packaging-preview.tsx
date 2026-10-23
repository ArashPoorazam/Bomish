import type { ProductPackaging } from "@/lib/types";
import { fa } from "@/lib/format";

export function PackagingPreview({
  packaging,
}: {
  packaging: ProductPackaging;
}) {
  const dimension = (value: number) => (value > 0 ? fa(value / 10) : "—");
  return (
    <div className="packaging-preview">
      <span className="packaging-eyebrow">راهنمای اندازه‌گیری</span>
      <svg
        viewBox="0 0 260 205"
        role="img"
        aria-label="طول و عرض روی قاعده و ارتفاع به صورت عمودی اندازه‌گیری می‌شود"
      >
        <path
          d="M56 63 139 35 206 69 121 101Z"
          fill="#e9e4cf"
          stroke="#a5ad8a"
          strokeLinejoin="round"
        />
        <path
          d="M56 63v78l65 34v-74Z"
          fill="#d6dcc4"
          stroke="#a5ad8a"
          strokeLinejoin="round"
        />
        <path
          d="m121 101 85-32v78l-85 28Z"
          fill="#bbcbb0"
          stroke="#8ca580"
          strokeLinejoin="round"
        />
        <path d="m87 52 67 35v31l21-8V79l-66-35Z" fill="#f9f7eb" opacity=".8" />
        <path
          d="m54 156 62 33m12 1 82-30M222 72v76"
          fill="none"
          stroke="#607353"
          strokeDasharray="3 3"
        />
        <path
          d="m54 151 0 10m62 23 0 10m12-9 0 10m82-40 0 10m7-93h10m-10 76h10"
          fill="none"
          stroke="#607353"
        />
      </svg>
      <dl>
        <div>
          <dt>طول</dt>
          <dd>
            {dimension(packaging.lengthMm)}
            <small>cm</small>
          </dd>
        </div>
        <div>
          <dt>عرض</dt>
          <dd>
            {dimension(packaging.widthMm)}
            <small>cm</small>
          </dd>
        </div>
        <div>
          <dt>ارتفاع</dt>
          <dd>
            {dimension(packaging.heightMm)}
            <small>cm</small>
          </dd>
        </div>
      </dl>
      <p>نمای شماتیک · ابعاد بیرونی</p>
    </div>
  );
}
