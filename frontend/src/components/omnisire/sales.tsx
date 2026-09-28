"use client";
import { useState } from "react";
import { Copy, Check, Wallet, ArrowUpRight } from "lucide-react";
import { api } from "@/lib/api";
import { digits, money } from "@/lib/format";
import { useStore } from "@/components/store-provider";
import type { components } from "@/lib/api-types";
import {
  Workspace,
  Stats,
  Panel,
  Feedback,
  Pager,
  DataTable,
  useLoad,
  type PageData,
  type Column,
  type Row,
} from "./shared";
type Summary = components["schemas"]["SalesSummary"];
const customerColumns: Column[] = [
  { key: "phone", label: "مشتری", kind: "text" },
  { key: "createdAt", label: "عضویت", kind: "date" },
  { key: "expiresAt", label: "پایان دوره کمیسیون", kind: "date" },
  { key: "orders", label: "خرید", kind: "number" },
  { key: "salesRials", label: "فروش (تومان)", kind: "money" },
  { key: "commissionRials", label: "کمیسیون (تومان)", kind: "money" },
];
const orderColumns: Column[] = [
  { key: "id", label: "سفارش", kind: "text" },
  { key: "createdAt", label: "پرداخت", kind: "date" },
  { key: "status", label: "وضعیت", kind: "text" },
  { key: "salesRials", label: "کالای خالص (تومان)", kind: "money" },
  { key: "commissionRials", label: "کمیسیون (تومان)", kind: "money" },
  { key: "refundedRials", label: "استرداد ثبت‌شده (تومان)", kind: "money" },
];
const ledgerColumns: Column[] = [
  { key: "kind", label: "شرح تراکنش", kind: "text" },
  { key: "amountRials", label: "مبلغ (تومان)", kind: "money" },
  { key: "transactionNumber", label: "شماره تراکنش", kind: "text" },
  { key: "occurredAt", label: "تاریخ", kind: "date" },
  { key: "note", label: "یادداشت", kind: "text" },
];
const kinds: Record<string, string> = {
  commission: "کمیسیون فروش",
  payment: "پرداخت مالک",
  payment_reversal: "اصلاح پرداخت",
  commission_correction: "اصلاح کمیسیون",
};
export function SalesContent({
  memberId,
  bankCard = "",
}: {
  memberId?: string;
  bankCard?: string;
}) {
  const base = memberId
    ? `/omnisire/members/${memberId}/sales`
    : "/staff/sales";
  const [revision, setRevision] = useState(0);
  const { data: s, error, loading } = useLoad<Summary>(base, revision);
  const [part, setPart] = useState("customers"),
    [page, setPage] = useState(1);
  const [customer, setCustomer] = useState("");
  const rows = useLoad<PageData>(
    `${base}?part=${part}&page=${page}&customer=${encodeURIComponent(customer)}`,
    revision,
  );
  const [copied, setCopied] = useState(false),
    [message, setMessage] = useState(""),
    [failure, setFailure] = useState(""),
    [busy, setBusy] = useState(false);
  const [mode, setMode] = useState(""),
    [target, setTarget] = useState(""),
    [amount, setAmount] = useState(""),
    [reference, setReference] = useState(""),
    [note, setNote] = useState(""),
    [date, setDate] = useState(() =>
      new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16),
    );
  const [requestKey, setRequestKey] = useState("");
  const [expanded, setExpanded] = useState<Row | null>(null);
  function start(action: string, id = "") {
    setMode(action);
    setTarget(id);
    setAmount("");
    setReference("");
    setNote("");
    setFailure("");
    setRequestKey(crypto.randomUUID());
  }
  const columns =
    part === "customers"
      ? customerColumns
      : part === "orders"
        ? orderColumns
        : ledgerColumns;
  const items =
    rows.data?.items.map((x) => ({
      ...x,
      ...(part === "ledger"
        ? { kind: kinds[String(x.kind)] || x.kind, rawKind: x.kind }
        : {}),
    })) || [];
  return (
    <div className="stack">
      <Feedback error={error || failure} loading={loading} />
      {message && (
        <p role="status" className="success">
          {message}
        </p>
      )}
      {s && (
        <>
          <Stats
            items={[
              {
                label: "مانده حساب",
                value: s.balanceRials,
                money: true,
                hint:
                  s.balanceRials < 0
                    ? "از درآمد آینده کسر می‌شود"
                    : "کمیسیون قابل پرداخت",
              },
              {
                label: "کمیسیون خالص",
                value: s.earnedRials,
                money: true,
                hint: "پس از اصلاحات و استردادها",
              },
              {
                label: "پرداخت‌شده",
                value: s.paidRials,
                money: true,
                hint: "پرداخت‌های ثبت‌شده مالک",
              },
              {
                label: "مشتریان معرفی‌شده",
                value: s.customers,
                hint: "رشد با همراهی شما",
              },
            ]}
          />
          <div className="omni-referral">
            <div>
              <span className="eyebrow">لینک اختصاصی معرفی</span>
              <h2>یک معرفی، فرصت‌های تازه</h2>
              <p>
                ۷٪ کمیسیون خرید کالا پس از تخفیف، تا ۳۰ روز پس از عضویت مشتری.
                هر سفارش رو به بالا تا هزار تومان گرد می‌شود.
              </p>
              <div className="omni-copy">
                <input
                  aria-label="لینک معرفی"
                  dir="ltr"
                  readOnly
                  value={s.referralLink}
                />
                <button
                  className="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(s.referralLink);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2500);
                    } catch {
                      setFailure(
                        "کپی خودکار انجام نشد؛ لینک را انتخاب و کپی کنید.",
                      );
                    }
                  }}
                >
                  {copied ? <Check size={18} /> : <Copy size={18} />}{" "}
                  {copied ? "کپی شد" : "کپی لینک"}
                </button>
              </div>
            </div>
            <div className="omni-referral-total">
              <ArrowUpRight size={30} />
              <span>فروش معرفی‌شده</span>
              <strong>{money(s.salesRials)}</strong>
              <small>تومان</small>
            </div>
          </div>
          {memberId && (
            <div className="between">
              <p>
                {!bankCard
                  ? "برای ثبت پرداخت ابتدا کارت بانکی همکار را تکمیل کنید."
                  : "پرداخت بانکی را خارج از سایت انجام دهید و رسید آن را اینجا ثبت کنید."}
              </p>
              <button
                className="button"
                disabled={!bankCard || s.balanceRials <= 0}
                onClick={() => start("payment")}
              >
                <Wallet size={18} />
                ثبت پرداخت
              </button>
            </div>
          )}
        </>
      )}
      {mode && memberId && (
        <Panel
          title={
            mode === "payment"
              ? "ثبت پرداخت به همکار"
              : mode === "refund"
                ? "اصلاح کمیسیون پس از استرداد"
                : "اصلاح پرداخت ثبت‌شده"
          }
          action={
            <button
              className="text-link"
              disabled={busy}
              onClick={() => setMode("")}
            >
              بستن
            </button>
          }
        >
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setFailure("");
              try {
                const amountRials =
                  Number(digits(amount).replace(/,/g, "")) * 10;
                if (mode === "payment")
                  await api(`/omnisire/members/${memberId}/payments`, "POST", {
                    amountRials,
                    transactionNumber: digits(reference),
                    occurredAt: new Date(date).toISOString(),
                    note,
                    idempotencyKey: requestKey,
                  });
                else if (mode === "refund")
                  await api(`/omnisire/members/${memberId}/refunds`, "POST", {
                    orderId: target,
                    amountRials,
                    reason: note,
                    idempotencyKey: requestKey,
                  });
                else
                  await api(
                    `/omnisire/members/${memberId}/payments/${target}/reverse`,
                    "POST",
                    { reason: note, idempotencyKey: requestKey },
                  );
                setMode("");
                setRevision((x) => x + 1);
                setMessage("تراکنش ثبت شد و مانده حساب به‌روز شد.");
              } catch (e) {
                setFailure((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {mode === "payment" && (
              <p className="notice">
                کارت مقصد:{" "}
                <b dir="ltr">{bankCard.match(/.{1,4}/g)?.join(" - ")}</b>
              </p>
            )}
            <div className="omni-form-grid">
              {mode !== "reverse" && (
                <label>
                  {mode === "refund"
                    ? "مبلغ کالای مستردشده پس از تخفیف (تومان)"
                    : "مبلغ پرداختی (تومان)"}
                  <input
                    required
                    inputMode="numeric"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
              )}
              {mode === "payment" && (
                <>
                  <label>
                    شماره تراکنش بانکی
                    <input
                      dir="ltr"
                      required
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                    />
                  </label>
                  <label>
                    تاریخ و ساعت پرداخت
                    <input
                      type="datetime-local"
                      required
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </label>
                </>
              )}
            </div>
            <label>
              {mode === "payment" ? "یادداشت (اختیاری)" : "دلیل اصلاح"}
              <textarea
                required={mode !== "payment"}
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            {mode === "refund" && (
              <p className="notice">
                این ثبت فقط کمیسیون را اصلاح می‌کند و انتقال وجه به مشتری انجام
                نمی‌دهد.
              </p>
            )}
            <button className="button" disabled={busy}>
              {busy ? "در حال ثبت…" : "ثبت تراکنش"}
            </button>
          </form>
        </Panel>
      )}
      <Panel title="جزئیات فروش و حساب">
        <nav className="dashboard-tabs">
          {[
            ["customers", "مشتریان معرفی‌شده"],
            ["orders", "خریدهای مشتریان معرفی‌شده"],
            ["ledger", "گردش حساب و پرداخت‌ها"],
          ].map(([p, label]) => (
            <button
              key={p}
              className={part === p ? "selected" : ""}
              onClick={() => {
                setPart(p);
                setCustomer("");
                setPage(1);
                setExpanded(null);
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <Feedback error={rows.error} loading={rows.loading} />
        <DataTable
          data={items}
          columns={columns}
          onRow={
            part === "orders"
              ? setExpanded
              : part === "customers"
                ? (row) => {
                    setCustomer(String(row.id));
                    setPart("orders");
                    setPage(1);
                  }
                : undefined
          }
          extra={
            memberId && part !== "customers"
              ? (row) =>
                  part === "orders" ? (
                    <button
                      className="text-link"
                      disabled={!row.eligible}
                      onClick={() => start("refund", String(row.id))}
                    >
                      ثبت استرداد
                    </button>
                  ) : row.rawKind === "payment" && !row.reversed ? (
                    <button
                      className="text-link"
                      onClick={() => start("reverse", String(row.id))}
                    >
                      اصلاح پرداخت
                    </button>
                  ) : row.reversed ? (
                    <span className="muted">اصلاح شده</span>
                  ) : null
              : undefined
          }
        />
        {expanded && (
          <div className="notice">
            <strong>محصولات سفارش</strong>
            <ul>
              {(
                (expanded.items as {
                  name: string;
                  quantity: number;
                  packageLabel: string;
                }[]) || []
              ).map((i, n) => (
                <li key={n}>
                  {i.name} · {i.packageLabel} × {i.quantity}
                </li>
              ))}
            </ul>
          </div>
        )}
        <Pager data={rows.data} page={page} onPage={setPage} />
      </Panel>
    </div>
  );
}
export function SalesPage() {
  const { user } = useStore();
  return (
    <Workspace title="فروش من">
      {user?.permissions?.includes("sales") ? (
        <SalesContent />
      ) : user?.role ? (
        <p className="notice">دسترسی به فروش شخصی برای این حساب فعال نیست.</p>
      ) : null}
    </Workspace>
  );
}
