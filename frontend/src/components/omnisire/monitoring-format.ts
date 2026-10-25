import { fa } from "@/lib/format";

export const decimal = (value: number) =>
  new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(value);
export const bytes = (value: number) =>
  value >= 1024 ** 3
    ? `${decimal(value / 1024 ** 3)} گیگابایت`
    : `${decimal(value / 1024 ** 2)} مگابایت`;
export const duration = (seconds: number) =>
  seconds >= 86400
    ? `${fa(Math.floor(seconds / 86400))} روز و ${fa(Math.floor((seconds % 86400) / 3600))} ساعت`
    : seconds >= 3600
      ? `${fa(Math.floor(seconds / 3600))} ساعت و ${fa(Math.floor((seconds % 3600) / 60))} دقیقه`
      : `${fa(Math.floor(seconds / 60))} دقیقه`;
export const time = (at: string) =>
  new Date(at).toLocaleTimeString("fa-IR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tehran",
  });
