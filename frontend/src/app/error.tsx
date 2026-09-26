"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="empty-state">
      <h1>ارتباط با فروشگاه برقرار نشد</h1>
      <p>لطفاً چند لحظه بعد دوباره تلاش کنید.</p>
      <button className="button" onClick={reset}>
        تلاش دوباره
      </button>
    </div>
  );
}
