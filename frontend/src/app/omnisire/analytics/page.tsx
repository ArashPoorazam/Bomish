import { AnalyticsPage } from "@/components/omnisire/analytics";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  return <AnalyticsPage initialSection={(await searchParams).section} />;
}
