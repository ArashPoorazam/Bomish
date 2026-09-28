"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, ArrowUpLeft, Users, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { digits, money, fa } from "@/lib/format";
import type { Member } from "@/lib/types";
import {
  Workspace,
  Panel,
  Feedback,
  Pager,
  useLoad,
  sectionLabels,
  roleLabels,
  stamp,
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
  password: "",
};
const defaults: Record<string, string[]> = {
  manager: Object.keys(sectionLabels),
  editor: ["products", "articles", "categories", "pricing", "sales"],
  operator: ["orders", "sales"],
  salesperson: ["sales"],
};
export const formatCard = (s: string) =>
  digits(s)
    .replace(/\D/g, "")
    .slice(0, 16)
    .match(/.{1,4}/g)
    ?.join(" - ") || "";
function MemberForm({
  initial,
  onSave,
  creating = false,
  onCancel,
}: {
  initial?: Member;
  onSave: (id?: string, secret?: string) => void;
  creating?: boolean;
  onCancel?: () => void;
}) {
  const [v, setV] = useState(
    initial
      ? { ...empty, ...initial, bankCard: initial.bankCard || "" }
      : empty,
  );
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
            restrictions: v.restrictions,
            password: creating ? v.password : "",
          };
          const res = await api<{ id?: string; totpSecret?: string }>(
            initial ? `/omnisire/members/${initial.id}` : "/omnisire/members",
            initial ? "PATCH" : "POST",
            body,
          );
          onSave(res.id, res.totpSecret);
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
              field("restrictions", []);
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
      <fieldset className="omni-access">
        <legend>
          <ShieldCheck size={18} />
          دسترسی‌های فعال این همکار
        </legend>
        <p>خاموش کردن یک بخش، دسترسی به همان بخش را محدود می‌کند.</p>
        <div>
          {(defaults[v.role] || []).map((p) => (
            <label className="check-label" key={p}>
              <input
                type="checkbox"
                checked={!v.restrictions.includes(p)}
                onChange={() =>
                  field(
                    "restrictions",
                    v.restrictions.includes(p)
                      ? v.restrictions.filter((x) => x !== p)
                      : [...v.restrictions, p],
                  )
                }
              />
              {sectionLabels[p]}
            </label>
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
        <button className="button" disabled={busy}>
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
    [page, setPage] = useState(1),
    [creating, setCreating] = useState(false),
    [revision, setRevision] = useState(0),
    [secret, setSecret] = useState(""),
    [created, setCreated] = useState("");
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
    revision,
  );
  return (
    <Workspace
      owner
      title="همکاران"
      actions={
        <button
          className="button"
          onClick={() => {
            setCreating(!creating);
            setSecret("");
          }}
        >
          <Plus size={18} />
          همکار جدید
        </button>
      }
    >
      {creating && (
        <Panel title="همکار جدید">
          {secret ? (
            <div className="notice">
              <h3>حساب آماده است</h3>
              <p>
                کلید رمزساز فقط همین‌بار نمایش داده می‌شود. آن را به همکار تحویل
                دهید.
              </p>
              <code className="omni-secret" dir="ltr">
                {secret}
              </code>
              <Link className="button" href={`/omnisire/members/${created}`}>
                مشاهده پرونده همکار
              </Link>
            </div>
          ) : (
            <MemberForm
              onCancel={() => setCreating(false)}
              creating
              onSave={(id, key) => {
                setCreated(id || "");
                setSecret(key || "");
                setRevision((x) => x + 1);
              }}
            />
          )}
        </Panel>
      )}
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
    [resetTotp, setResetTotp] = useState(false),
    [secret, setSecret] = useState(""),
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
            ].map(([v, l]) => (
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
                  </Panel>
                  <Panel title="بازیابی اطلاعات ورود">
                    <form
                      className="stack"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        setBusy(true);
                        setFailure("");
                        try {
                          const res = await api<{ totpSecret: string }>(
                            `/omnisire/members/${id}/credentials`,
                            "POST",
                            { password, resetTotp },
                          );
                          setSecret(res.totpSecret);
                          setPassword("");
                          setResetTotp(false);
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
                        گذرواژه جدید (اختیاری)
                        <input
                          type="password"
                          minLength={12}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                      </label>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={resetTotp}
                          onChange={(e) => setResetTotp(e.target.checked)}
                        />
                        ساخت کلید جدید رمزساز
                      </label>
                      <button
                        className="button secondary"
                        disabled={busy || (!password && !resetTotp)}
                      >
                        بازیابی ورود
                      </button>
                      {secret && (
                        <p className="notice">
                          کلید رمزساز جدید — فقط همین‌بار نمایش داده می‌شود:
                          <code className="omni-secret" dir="ltr">
                            {secret}
                          </code>
                        </p>
                      )}
                    </form>
                  </Panel>
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
                </>
              )}
            </>
          )}
        </>
      )}
    </Workspace>
  );
}
