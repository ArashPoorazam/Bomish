import { CustomerOrderHistory } from "@/components/requests/customer-order-history";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CustomerOrderHistory requestId={id} />;
}
