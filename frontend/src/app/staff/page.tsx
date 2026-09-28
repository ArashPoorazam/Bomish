import { Dashboard } from "@/components/staff/dashboard";
export const metadata = {
  title: "فضای کار بومیش",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; q?: string }>;
}) {
  const query = await searchParams;
  return <Dashboard initialSection={query.section} initialQuery={query.q} />;
}
