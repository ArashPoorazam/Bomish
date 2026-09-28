import { CategoryPage } from "@/components/staff/category-editor";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <CategoryPage id={(await params).id} />;
}
