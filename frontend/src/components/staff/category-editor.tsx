"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { Category } from "@/lib/types";
import { Workspace, Feedback, useLoad, Panel } from "../omnisire/shared";
export function CategoryPage({ id }: { id: string }) {
  const { data, error, loading } = useLoad<Category[]>("/categories");
  const category = data?.find((c) => c.id === id);
  return (
    <Workspace
      title={id === "new" ? "دسته‌بندی جدید" : "ویرایش دسته‌بندی"}
      activeSection="categories"
      actions={
        <Link className="button secondary" href="/staff?section=categories">
          بازگشت به دسته‌بندی‌ها
        </Link>
      }
    >
      <Feedback error={error} loading={loading} />
      {data &&
        (id === "new" || category ? (
          <CategoryEditor key={id} initial={category} />
        ) : (
          <p role="alert">دسته‌بندی پیدا نشد.</p>
        ))}
    </Workspace>
  );
}
function CategoryEditor({ initial }: { initial?: Category }) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name || ""),
    [description, setDescription] = useState(initial?.description || ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const dirty =
    name !== (initial?.name || "") ||
    description !== (initial?.description || "");
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  return (
    <Panel title={initial?.name || "مشخصات دسته‌بندی"}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api(
              `/staff/categories/${initial?.id || crypto.randomUUID()}`,
              "PUT",
              { name, description },
            );
            router.push("/staff?section=categories");
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        <label>
          نام دسته
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          توضیح دسته
          <textarea
            rows={8}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
          />
        </label>
        <Feedback error={error} />
        <div className="inline-actions">
          <button className="button" disabled={busy}>
            {busy ? "در حال ذخیره…" : "ذخیره دسته"}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => {
              if (!dirty || confirm("تغییرات ذخیره نشده‌اند. خارج می‌شوید؟"))
                router.push("/staff?section=categories");
            }}
          >
            انصراف
          </button>
        </div>
      </form>
    </Panel>
  );
}
