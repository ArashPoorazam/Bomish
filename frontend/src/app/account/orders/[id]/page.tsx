import { OrderTracking } from "@/components/order-tracking";
export const metadata = { title: "پیگیری سفارش" };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OrderTracking id={id} />;
}
