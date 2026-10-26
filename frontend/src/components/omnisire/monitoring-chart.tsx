import { useState } from "react";
import { decimal, time } from "./monitoring-format";

export type ChartPoint = { at: string; value: number | null };

// Time-based positions preserve missing intervals instead of joining across outages.
export function HistoryChart({
  points,
  label,
  unit,
  max = 100,
  color = "#287e78",
  start,
  end,
}: {
  points: ChartPoint[];
  label: string;
  unit: string;
  max?: number;
  color?: string;
  start: number;
  end: number;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const width = 760,
    height = 160;
  const x = (at: string) =>
    Math.max(
      0,
      Math.min(
        width,
        ((Date.parse(at) - start) / Math.max(1, end - start)) * width,
      ),
    );
  const y = (value: number) =>
    height - Math.max(0, Math.min(1, value / max)) * height;
  let path = "",
    connected = false;
  points.forEach((point, index) => {
    if (point.value === null) {
      connected = false;
      return;
    }
    const gap =
      index > 0 &&
      Date.parse(point.at) - Date.parse(points[index - 1].at) > 90000;
    path += `${connected && !gap ? "L" : "M"}${x(point.at).toFixed(1)},${y(point.value).toFixed(1)} `;
    connected = true;
  });
  const active =
    points[Math.min(selected ?? points.length - 1, points.length - 1)];
  const hasValues = points.some((p) => p.value !== null);
  return (
    <div className="monitor-history-chart">
      <div className="monitor-chart-reading">
        <span>{label}</span>
        <strong>
          {active?.value != null
            ? `${decimal(active.value)} ${unit}`
            : "Unavailable"}
        </strong>
        <span>
          {active ? `${time(active.at)} Tehran` : "Waiting for samples"}
        </span>
      </div>
      <div className="monitor-plot">
        <div className="monitor-y-axis">
          <span>
            {decimal(max)}
            {unit}
          </span>
          <span>
            {decimal(max / 2)}
            {unit}
          </span>
          <span>0</span>
        </div>
        <svg
          viewBox={`0 -6 ${width} ${height + 12}`}
          role="img"
          aria-label={`${label} history. ${points.length} samples. Use the slider to inspect values.`}
          preserveAspectRatio="none"
          onMouseMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const at =
              start +
              ((event.clientX - bounds.left) / bounds.width) * (end - start);
            let nearest = 0;
            points.forEach((p, i) => {
              if (
                Math.abs(Date.parse(p.at) - at) <
                Math.abs(Date.parse(points[nearest].at) - at)
              )
                nearest = i;
            });
            setSelected(nearest);
          }}
        >
          {[0, 80, 160].map((v) => (
            <line
              key={v}
              x1="0"
              x2={width}
              y1={v}
              y2={v}
              stroke="#e4e9e5"
              strokeDasharray="4 5"
            />
          ))}
          <path
            d={path}
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            vectorEffect="non-scaling-stroke"
          />
          {active?.value != null && (
            <>
              <line
                x1={x(active.at)}
                x2={x(active.at)}
                y1="0"
                y2={height}
                stroke="#9aaba9"
                strokeDasharray="3 4"
              />
              <circle
                cx={x(active.at)}
                cy={y(active.value)}
                r="4"
                fill={color}
              />
            </>
          )}
        </svg>
        {!hasValues && (
          <span className="monitor-chart-empty">
            No measurements in this window
          </span>
        )}
      </div>
      <div className="monitor-chart-axis">
        <span>{time(new Date(start).toISOString())}</span>
        <span>{time(new Date(end).toISOString())}</span>
      </div>
      {points.length > 1 && (
        <label className="monitor-scrubber">
          <span>Inspect timeline</span>
          <input
            type="range"
            min="0"
            max={points.length - 1}
            value={Math.min(selected ?? points.length - 1, points.length - 1)}
            onChange={(event) => setSelected(Number(event.target.value))}
            aria-label={`${label} history sample`}
            aria-valuetext={
              active
                ? `${time(active.at)}: ${active.value === null ? "unavailable" : `${decimal(active.value)} ${unit}`}`
                : undefined
            }
          />
        </label>
      )}
    </div>
  );
}
