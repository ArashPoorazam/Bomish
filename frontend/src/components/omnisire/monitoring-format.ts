export const decimal = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
export const bytes = (value: number) =>
  value >= 1024 ** 3
    ? `${decimal(value / 1024 ** 3)} GiB`
    : `${decimal(value / 1024 ** 2)} MiB`;
export const duration = (seconds: number) =>
  seconds >= 86400
    ? `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`
    : seconds >= 3600
      ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
      : `${Math.floor(seconds / 60)}m`;
export const time = (at: string) =>
  new Date(at).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Tehran",
  });
export const stamp = (at: string) =>
  new Date(at).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Tehran",
  });
export const utilization = (
  capacity: { totalBytes: number; availableBytes: number } | null | undefined,
) =>
  capacity && capacity.totalBytes > 0
    ? Math.max(
        0,
        Math.min(
          100,
          100 * (1 - capacity.availableBytes / capacity.totalBytes),
        ),
      )
    : null;
