import "../../analytics.css";
import { AnalyticsPage } from "@/components/omnisire/analytics";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <AnalyticsPage initialParams={await searchParams} />;
}
