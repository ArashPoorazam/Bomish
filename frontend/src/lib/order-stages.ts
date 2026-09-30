import {
  ClipboardList,
  CreditCard,
  PackageCheck,
  Truck,
  House,
} from "lucide-react";
export const orderStages = [
  { id: "pending", label: "ثبت سفارش", icon: ClipboardList },
  { id: "paid", label: "پرداخت", icon: CreditCard },
  { id: "packing", label: "بسته‌بندی", icon: PackageCheck },
  { id: "shipped", label: "ارسال", icon: Truck },
  { id: "received", label: "تحویل", icon: House },
] as const;
