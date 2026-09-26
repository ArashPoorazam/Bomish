import Link from "next/link";
export default function NotFound() {
  return (
    <div className="empty-state">
      <h1>این صفحه پیدا نشد</h1>
      <p>شاید طعم دلخواهتان را در محصولات پیدا کنید.</p>
      <Link className="button" href="/products">
        دیدن محصولات
      </Link>
    </div>
  );
}
