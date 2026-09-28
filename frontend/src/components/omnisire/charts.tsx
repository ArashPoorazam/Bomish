"use client";
import { useEffect, useRef, useState } from "react";
import { fa, money } from "@/lib/format";
export type ChartRow = {
  id: string;
  name: string;
  day?: string;
  [key: string]: unknown;
};
export type ChartData = {
  days: string[];
  points: ChartRow[];
  totals: ChartRow[];
  packages: ChartRow[];
};
const colors = [
  "#2d7055",
  "#b55d27",
  "#496fc0",
  "#9a4e8a",
  "#978013",
  "#248d91",
  "#d34f50",
  "#67763e",
  "#6953ac",
  "#bf6e91",
  "#365674",
  "#866349",
];
const dayLabel = (day: string) =>
  new Intl.DateTimeFormat("fa-IR", {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Tehran",
  }).format(new Date(day + "T12:00:00+03:30"));
export function LineChart({
  data,
  metric,
  label,
  monetary = false,
}: {
  data: ChartData;
  metric: string;
  label: string;
  monetary?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null),
    [hidden, setHidden] = useState<Set<string>>(new Set());
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(940);
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(280, entry.contentRect.width)),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const names = new Map<string, string>();
  for (const p of data.points) names.set(p.id, p.name);
  const series = [...names].map(([id, name], i) => ({
    id,
    name,
    color: colors[i % colors.length],
    values: new Map(
      data.points
        .filter((p) => p.id === id)
        .map((p) => [
          p.day,
          p[metric] === null ? null : Number(p[metric] || 0),
        ]),
    ),
  }));
  const visible = series.filter((s) => !hidden.has(s.id));
  const max = visible.reduce((max, series) => {
    for (const value of series.values.values())
      if (value !== null) max = Math.max(max, value);
    return max;
  }, 1);
  const W = width,
    H = width < 500 ? 240 : 310,
    left = monetary ? 85 : 45,
    right = 25,
    top = 22,
    bottom = 45;
  const x = (i: number) =>
      left + (i * (W - left - right)) / Math.max(1, data.days.length - 1),
    y = (n: number) => H - bottom - (n / max) * (H - top - bottom);
  const format = (n: number) => (monetary ? money(n) : fa(n));
  const active = hover === null ? null : Math.min(hover, data.days.length - 1);
  return (
    <div ref={container} className="omni-line-chart" dir="ltr">
      <div className="chart-legend" dir="rtl">
        {series.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={!hidden.has(s.id)}
            onClick={() =>
              setHidden((prev) => {
                const next = new Set(prev);
                if (next.has(s.id)) next.delete(s.id);
                else next.add(s.id);
                return next;
              })
            }
          >
            <i style={{ background: s.color }} />
            {s.name}
          </button>
        ))}
      </div>
      {!series.length ? (
        <p className="omni-empty" dir="rtl">
          در این بازه داده‌ای ثبت نشده است.
        </p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`${label} در بازه انتخاب‌شده`}
          >
            <title>{label}</title>
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <g key={t}>
                <line
                  x1={left}
                  x2={W - right}
                  y1={y(max * t)}
                  y2={y(max * t)}
                  stroke="#e3e7df"
                />
                <text
                  x={left - 12}
                  y={y(max * t) + 4}
                  textAnchor="end"
                  fontSize="12"
                  fill="#687368"
                >
                  {format(max * t)}
                </text>
              </g>
            ))}
            {visible.map((s) => {
              let open = false;
              const path = data.days
                .map((d, i) => {
                  const v = s.values.get(d) ?? (metric === "price" ? null : 0);
                  if (v === null) {
                    open = false;
                    return "";
                  }
                  const segment = `${open ? "L" : "M"}${x(i)},${y(v)}`;
                  open = true;
                  return segment;
                })
                .join(" ");
              return (
                <g key={s.id}>
                  <path
                    d={path}
                    fill="none"
                    stroke={s.color}
                    strokeWidth="2.5"
                    strokeLinejoin="round"
                  />
                  {data.days.map((d, i) => {
                    const v =
                      s.values.get(d) ?? (metric === "price" ? null : 0);
                    return v !== null &&
                      (data.days.length <= 14 || i === active) ? (
                      <circle
                        key={d}
                        cx={x(i)}
                        cy={y(v)}
                        r={i === active ? 5 : 3}
                        fill={s.color}
                      />
                    ) : null;
                  })}
                </g>
              );
            })}
            {data.days.map((d, i) =>
              i === 0 ||
              i === data.days.length - 1 ||
              i %
                Math.max(
                  1,
                  Math.ceil(data.days.length / (width < 500 ? 3 : 7)),
                ) ===
                0 ? (
                <text
                  key={d}
                  x={x(i)}
                  y={H - 12}
                  textAnchor="middle"
                  fontSize="12"
                  fill="#687368"
                >
                  {dayLabel(d)}
                </text>
              ) : null,
            )}
            {active !== null && (
              <line
                x1={x(active)}
                x2={x(active)}
                y1={top}
                y2={H - bottom}
                stroke="#829180"
                strokeDasharray="4 4"
              />
            )}
            <rect
              x={left}
              y={top}
              width={W - left - right}
              height={H - top - bottom}
              fill="transparent"
              onMouseMove={(e) => {
                const box = e.currentTarget.getBoundingClientRect();
                setHover(
                  Math.round(
                    ((e.clientX - box.left) / box.width) *
                      (data.days.length - 1),
                  ),
                );
              }}
              onMouseLeave={() => setHover(null)}
            />
          </svg>
          <label className="chart-date-control" dir="rtl">
            بررسی روز{" "}
            <input
              aria-label="روز نمودار"
              type="range"
              min={0}
              max={Math.max(0, data.days.length - 1)}
              value={active ?? data.days.length - 1}
              onChange={(e) => setHover(Number(e.target.value))}
            />
          </label>
          <div className="chart-tooltip" dir="rtl" aria-live="polite">
            <strong>
              {dayLabel(data.days[active ?? data.days.length - 1])}
            </strong>
            {visible.map((s) => {
              const v = s.values.get(data.days[active ?? data.days.length - 1]);
              return (
                <span key={s.id}>
                  <i style={{ background: s.color }} />
                  {s.name}:{" "}
                  <b>
                    {v === null || (v === undefined && metric === "price")
                      ? "ثبت نشده"
                      : format(v || 0)}
                    {monetary && v !== null ? " تومان" : ""}
                  </b>
                </span>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
export function PieChart({
  rows,
  metric,
  title,
  monetary = false,
}: {
  rows: ChartRow[];
  metric: string;
  title: string;
  monetary?: boolean;
}) {
  const [active, setActive] = useState<string | null>(null);
  const all = rows
    .map((r) => ({ id: r.id, name: r.name, value: Number(r[metric] || 0) }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  const slices = all.slice(0, 7);
  if (all.length > 7)
    slices.push({
      id: "other",
      name: "سایر",
      value: all.slice(7).reduce((n, r) => n + r.value, 0),
    });
  const total = slices.reduce((n, r) => n + r.value, 0);
  let offset = 0;
  const radius = 70,
    circumference = 2 * Math.PI * radius;
  const current = slices.find((s) => s.id === active);
  return (
    <section className="chart-pie">
      <h3>{title}</h3>
      {!total ? (
        <p className="omni-empty">داده‌ای در این بازه ثبت نشده است.</p>
      ) : (
        <>
          <div className="pie-layout">
            <svg viewBox="0 0 200 200" role="img" aria-label={title}>
              {slices.map((s, i) => {
                const length = (s.value / total) * circumference;
                const start = offset;
                offset += length;
                return (
                  <circle
                    key={s.id}
                    cx={100}
                    cy={100}
                    r={radius}
                    fill="none"
                    stroke={colors[i]}
                    strokeWidth={active === s.id ? 33 : 27}
                    strokeDasharray={`${length} ${circumference - length}`}
                    strokeDashoffset={-start}
                    transform="rotate(-90 100 100)"
                    onMouseEnter={() => setActive(s.id)}
                    onMouseLeave={() => setActive(null)}
                  >
                    <title>
                      {s.name}: {fa((s.value / total) * 100)}٪
                    </title>
                  </circle>
                );
              })}
              <text
                x="100"
                y="98"
                textAnchor="middle"
                fontSize="19"
                fill="#203b32"
              >
                {fa(Math.round(((current?.value || total) / total) * 100))}٪
              </text>
              <text
                x="100"
                y="122"
                textAnchor="middle"
                fontSize="11"
                fill="#687368"
              >
                {current ? "سهم انتخاب‌شده" : "کل بازه"}
              </text>
            </svg>
            <div className="pie-legend">
              {slices.map((s, i) => (
                <button
                  key={s.id}
                  onMouseEnter={() => setActive(s.id)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(s.id)}
                  onBlur={() => setActive(null)}
                  onClick={() => setActive(active === s.id ? null : s.id)}
                >
                  <i style={{ background: colors[i] }} />
                  <span>{s.name}</span>
                  <b>{fa(Math.round((s.value / total) * 1000) / 10)}٪</b>
                  <small>
                    {monetary ? money(s.value) + " تومان" : fa(s.value)}
                  </small>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
