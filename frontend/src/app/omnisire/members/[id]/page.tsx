import { MemberPage } from "@/components/omnisire/members";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MemberPage id={id} />;
}
