import { CustomOrders } from "@/components/requests/custom-orders";
import { Account } from "@/components/account";
export const metadata = { title: "حساب من" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { section } = await searchParams;
  if (section === "custom") return <CustomOrders />;
  return (
    <Account
      section={
        section === "orders" || section === "addresses" ? section : "overview"
      }
    />
  );
}
