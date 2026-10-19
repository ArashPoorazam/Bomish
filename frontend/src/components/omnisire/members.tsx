"use client";
import {
  Permission,
  PermissionFields,
  useStaffPermission,
} from "../staff/permissions";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, ArrowUpLeft, ShieldCheck, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { digits, money } from "@/lib/format";
import type { components } from "@/lib/api-types";
import type { Member } from "@/lib/types";
import {
  Workspace,
  Panel,
  Feedback,
  Pager,
  useLoad,
  roleLabels,
  type PageData,
} from "./shared";
import { SalesContent } from "./sales";
import { EventsContent } from "./events";
const empty = {
  fullName: "",
  username: "",
  phone: "",
  bankCard: "",
  role: "salesperson",
  active: true,
  restrictions: [] as string[],
  permissionOverrides: {} as Record<string, boolean>,
  password: "",
};
type PermissionOptions = components["schemas"]["StaffPermissionOptions"];
const actionLabels: Record<string, string> = {
  create: "ایجاد",
  edit: "ویرایش / انجام عملیات",
  delete: "حذف / بایگانی",
  manage: "تغییر روش ارسال / رفع وضعیت نامشخص",
  export: "دریافت خروجی",
};
function memberOverrides(member?: Member): Record<string, boolean> {
  const overrides: Record<string, boolean> = {};
  for (const key of member?.restrictions || []) {
    const sections =
      key === "requests"
        ? ["support", "custom"]
        : key === "products"
          ? ["products", "home"]
          : [key];
    for (const section of sections) overrides[section] = false;
  }
  return { ...overrides, ...member?.permissionOverrides };
}
export const formatCard = (s: string) =>
  digits(s)
    .replace(/\D/g, "")
    .slice(0, 16)
    .match(/.{1,4}/g)
    ?.join(" - ") || "";
export function MemberForm({
  initial,
  onSave,
  creating = false,
  onCancel,
}: {
  initial?: Member;
  onSave: (id?: string) => void;
  creating?: boolean;
  onCancel?: () => void;
}) {
  const [v, setV] = useState(
    initial
      ? {
          ...empty,
          ...initial,
          bankCard: initial.bankCard || "",
          permissionOverrides: memberOverrides(initial),
        }
      : empty,
  );
  const { data: options, error: optionsError } = useLoad<PermissionOptions>(
    "/omnisire/permission-options",
  );
  const inherited = options?.defaults[v.role] || [];
  const enabled = (key: string) =>
    v.permissionOverrides[key] ?? inherited.includes(key);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const field = (k: string, value: unknown) =>
    setV((prev) => ({ ...prev, [k]: value }));
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const body = {
            fullName: v.fullName,
            username: v.username,
            phone: digits(v.phone),
            bankCard: digits(v.bankCard).replace(/\D/g, ""),
            role: v.role,
            active: v.active,
            restrictions: [],
            permissionOverrides: v.permissionOverrides,
            password: creating ? v.password : "",
          };
          const res = await api<{ id?: string }>(
            initial ? `/omnisire/members/${initial.id}` : "/omnisire/members",
            initial ? "PATCH" : "POST",
            body,
          );
          onSave(res.id);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="omni-form-grid">
        <label>
          نام و نام خانوادگی
          <input
            required
            maxLength={100}
            value={v.fullName}
            onChange={(e) => field("fullName", e.target.value)}
          />
        </label>
        <label>
          نام کاربری
          <input
            dir="ltr"
            required
            minLength={2}
            value={v.username}
            onChange={(e) => field("username", e.target.value)}
          />
        </label>
        <label>
          شماره همراه
          <input
            required
            dir="ltr"
            inputMode="tel"
            value={v.phone}
            onChange={(e) => field("phone", e.target.value)}
          />
        </label>
        <label>
          شماره کارت بانکی
          <input
            required
            dir="ltr"
            className="bank-card-input"
            inputMode="numeric"
            placeholder="1111 - 2222 - 3333 - 4444"
            value={formatCard(v.bankCard)}
            onChange={(e) => field("bankCard", e.target.value)}
          />
        </label>
        <label>
          نقش
          <select
            value={v.role}
            onChange={(e) => {
              field("role", e.target.value);
            }}
          >
            {Object.entries(roleLabels)
              .filter(([r]) => r !== "owner")
              .map(([r, label]) => (
                <option key={r} value={r}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        {creating && (
          <label>
            گذرواژه اولیه
            <input
              required
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={v.password}
              onChange={(e) => field("password", e.target.value)}
            />
          </label>
        )}
      </div>
      {v.role === "courier" && (
        <p className="notice">
          همکار فعال با نقش «پیک» در فهرست ارسال سفارش‌های تهران نمایش داده
          می‌شود. این نقش به‌صورت پیش‌فرض دسترسی مدیریت سفارش‌ها ندارد.
        </p>
      )}
      <fieldset className="omni-access">
        <legend>
          <ShieldCheck size={18} />
          دسترسی‌های فعال این همکار
        </legend>
        <div className="permission-heading">
          <p>
            نقش، دسترسی‌های پیش‌فرض را تعیین می‌کند. تغییرات اختصاصی با تغییر
            نقش حفظ می‌شوند.
          </p>
          <button
            type="button"
            className="button secondary permission-reset"
            title="بازنشانی به دسترسی‌های پیش‌فرض نقش"
            disabled={busy || !options}
            onClick={() => field("permissionOverrides", {})}
          >
            <RotateCcw size={18} aria-hidden="true" />
            بازنشانی
          </button>
        </div>
        <Feedback error={optionsError} loading={!options && !optionsError} />
        <div className="permission-sections">
          {options?.sections.map((section) => (
            <div className="permission-section" key={section.key}>
              <strong>{section.label}</strong>
              <div className="permission-options">
                {["view", ...section.actions].map((action) => {
                  const key =
                    action === "view"
                      ? section.key
                      : `${section.key}.${action}`;
                  return (
                    <label className="check-label" key={key}>
                      <input
                        type="checkbox"
                        checked={enabled(section.key) && enabled(key)}
                        disabled={
                          busy || (action !== "view" && !enabled(section.key))
                        }
                        onChange={(e) =>
                          field("permissionOverrides", {
                            ...v.permissionOverrides,
                            [key]: e.target.checked,
                          })
                        }
                      />
                      {action === "view" ? "مشاهده بخش" : actionLabels[action]}
                      {key in v.permissionOverrides && <small>اختصاصی</small>}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </fieldset>
      <label className="check-label">
        <input
          type="checkbox"
          checked={v.active}
          onChange={(e) => field("active", e.target.checked)}
        />
        حساب فعال باشد
      </label>
      <Feedback error={error} />
      <div className="inline-actions">
        <button className="button" disabled={busy || !options}>
          {busy
            ? "در حال ذخیره…"
            : creating
              ? "ایجاد حساب همکار"
              : "ذخیره تغییرات"}
        </button>
        {onCancel && (
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onCancel}
          >
            انصراف
          </button>
        )}
      </div>
    </form>
  );
}
export function MembersPage() {
  const [q, setQ] = useState(""),
    [role, setRole] = useState(""),
    [status, setStatus] = useState(""),
    [sort, setSort] = useState("balance"),
    [unpaid, setUnpaid] = useState(false),
    [page, setPage] = useState(1);
  const params = new URLSearchParams({
    q,
    role,
    status,
    sort,
    unpaid: String(unpaid),
    page: String(page),
  });
  const { data, error, loading } = useLoad<PageData>(
    "/omnisire/members?" + params,
  );
  return (
    <Workspace
      owner
      title="همکاران"
      actions={
        <Permission name="members.create">
          <Link className="button" href="/omnisire/members/new">
            <Plus size={18} aria-hidden="true" />
            همکار جدید
          </Link>
        </Permission>
      }
    >
      <Panel title="اعضای تیم">
        <div className="omni-filters">
          <label>
            جستجوی همکار
            <input
              type="search"
              placeholder="نام، نام کاربری یا همراه"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            نقش
            <select
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
                setPage(1);
              }}
            >
              <option value="">همه نقش‌ها</option>
              {Object.entries(roleLabels).map(([r, l]) => (
                <option value={r} key={r}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            وضعیت
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">اعضای جاری</option>
              <option value="active">فعال</option>
              <option value="suspended">تعلیق‌شده</option>
              <option value="archived">بایگانی‌شده</option>
              <option value="all">همه</option>
            </select>
          </label>
          <label>
            مرتب‌سازی
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setPage(1);
              }}
            >
              <option value="balance">بیشترین مانده پرداخت</option>
              <option value="balance-asc">کمترین مانده</option>
              <option value="name">نام همکار</option>
              <option value="newest">تازه‌ترین عضو</option>
            </select>
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={unpaid}
              onChange={(e) => {
                setUnpaid(e.target.checked);
                setPage(1);
              }}
            />
            فقط پرداخت‌نشده
          </label>
        </div>
        <Feedback error={error} loading={loading} />
        <div className="table-scroll omni-table">
          <table>
            <thead>
              <tr>
                <th>همکار</th>
                <th>نقش</th>
                <th>وضعیت</th>
                <th>مانده حساب</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.items.map((row) => {
                const m = row as unknown as Member;
                return (
                  <tr key={m.id}>
                    <td>
                      <Link
                        className="omni-member-name"
                        href={`/omnisire/members/${m.id}`}
                      >
                        <span>
                          <strong>{m.fullName || m.username}</strong>
                          <small dir="ltr">{m.username}</small>
                        </span>
                      </Link>
                    </td>
                    <td>{roleLabels[m.role]}</td>
                    <td>
                      <span
                        className={`omni-badge ${m.active && !m.archivedAt ? "positive" : ""}`}
                      >
                        {m.archivedAt
                          ? "بایگانی"
                          : m.active
                            ? "فعال"
                            : "تعلیق‌شده"}
                      </span>
                      {m.profileIncomplete && (
                        <small className="omni-warning">
                          اطلاعات کارت ناقص
                        </small>
                      )}
                    </td>
                    <td>
                      <Link
                        className={`omni-balance ${m.balanceRials > 0 ? "due" : ""}`}
                        href={`/omnisire/members/${m.id}?tab=sales`}
                      >
                        {money(m.balanceRials)} تومان{" "}
                        <small>
                          {m.balanceRials > 0
                            ? "قابل پرداخت"
                            : m.balanceRials < 0
                              ? "اعتبار پرداخت قبلی"
                              : "تسویه‌شده"}
                        </small>
                      </Link>
                    </td>
                    <td>
                      <Link
                        aria-label={`پرونده ${m.fullName || m.username}`}
                        href={`/omnisire/members/${m.id}`}
                      >
                        <ArrowUpLeft size={20} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data && !data.items.length && (
            <p className="omni-empty">همکاری با این مشخصات پیدا نشد.</p>
          )}
        </div>
        <Pager data={data} page={page} onPage={setPage} />
      </Panel>
    </Workspace>
  );
}
export function MemberPage({ id }: { id: string }) {
  const can = useStaffPermission();
  const [revision, setRevision] = useState(0);
  const {
    data: m,
    error,
    loading,
  } = useLoad<Member>(`/omnisire/members/${id}`, revision);
  const [tab, setTab] = useState("sales"),
    [message, setMessage] = useState(""),
    [failure, setFailure] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <Workspace
      owner
      title={m?.fullName || m?.username || "پرونده همکار"}
      actions={
        <Link className="button secondary" href="/omnisire/members">
          همه همکاران
        </Link>
      }
    >
      <Feedback error={error || failure} loading={loading} />
      {message && (
        <p role="status" className="success">
          {message}
        </p>
      )}
      {m && (
        <>
          <div className="omni-profile-strip">
            <div className="omni-profile-identity">
              <strong>{m.fullName || m.username}</strong>
              <span dir="ltr">@{m.username}</span>
            </div>
            <div>
              <small>نقش و وضعیت</small>
              <strong>
                {roleLabels[m.role]} ·{" "}
                {m.archivedAt ? "بایگانی‌شده" : m.active ? "فعال" : "تعلیق‌شده"}
              </strong>
            </div>
            <div>
              <small>شماره همراه</small>
              <span dir="ltr">{m.phone || "—"}</span>
            </div>
            <div>
              <small>شماره کارت بانکی</small>
              <span className="omni-card-number" dir="ltr">
                {formatCard(m.bankCard || "") || "ثبت نشده"}
              </span>
            </div>
          </div>
          <nav className="dashboard-tabs">
            {[
              ["sales", "فروش و حساب"],
              ["activity", "فعالیت‌ها"],
              ["profile", "اطلاعات و دسترسی"],
            ]
              .filter(([v]) => v !== "activity" || can("events"))
              .map(([v, l]) => (
                <button
                  key={v}
                  className={tab === v ? "selected" : ""}
                  onClick={() => setTab(v)}
                >
                  {l}
                </button>
              ))}
          </nav>
          {tab === "sales" && (
            <SalesContent memberId={id} bankCard={m.bankCard || ""} />
          )}{" "}
          {tab === "activity" && <EventsContent actor={id} />}{" "}
          {tab === "profile" && (
            <>
              {m.role === "owner" || m.archivedAt ? (
                <p className="notice">
                  حساب مالک یا پرونده بایگانی‌شده از این بخش تغییر نمی‌کند.
                </p>
              ) : (
                <>
                  <Panel title="مشخصات و دسترسی">
                    <PermissionFields name="members.edit">
                      <MemberForm
                        key={revision}
                        initial={m}
                        onSave={() => {
                          setRevision((x) => x + 1);
                          setMessage(
                            "تغییرات ذخیره شد. نشست‌های قبلی این همکار بسته شدند.",
                          );
                        }}
                      />
                    </PermissionFields>
                  </Panel>
                  <Permission name="members.edit">
                    <Panel title="بازیابی اطلاعات ورود">
                      <form
                        className="stack"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          setBusy(true);
                          setFailure("");
                          try {
                            await api<{ ok: boolean }>(
                              `/omnisire/members/${id}/credentials`,
                              "POST",
                              { password },
                            );
                            setPassword("");
                            setMessage(
                              "اطلاعات ورود تغییر کرد و نشست‌های قبلی بسته شدند.",
                            );
                          } catch (e) {
                            setFailure((e as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        <label>
                          گذرواژه جدید
                          <input
                            type="password"
                            minLength={12}
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                          />
                        </label>
                        <button
                          className="button secondary"
                          disabled={busy || !password}
                        >
                          بازیابی ورود
                        </button>
                      </form>
                    </Panel>
                  </Permission>
                  <Permission name="members.delete">
                    <Panel title="بایگانی حساب">
                      <p>
                        دسترسی و درآمد آینده متوقف می‌شود. سوابق و بدهی‌های قبلی
                        باقی می‌مانند.
                      </p>
                      <button
                        className="button danger"
                        disabled={busy}
                        onClick={async () => {
                          if (
                            !confirm(
                              "حساب این همکار بایگانی شود؟ ورود و کمیسیون‌های آینده متوقف خواهد شد.",
                            )
                          )
                            return;
                          setBusy(true);
                          try {
                            await api(`/omnisire/members/${id}`, "DELETE");
                            setRevision((x) => x + 1);
                            router.refresh();
                          } catch (e) {
                            setFailure((e as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        بایگانی همکار
                      </button>
                    </Panel>
                  </Permission>
                </>
              )}
            </>
          )}
        </>
      )}
    </Workspace>
  );
}
