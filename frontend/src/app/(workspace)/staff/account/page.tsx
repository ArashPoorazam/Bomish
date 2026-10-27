import { StaffAccount } from "@/components/staff/account";
export const metadata = {
  title: "اطلاعات حساب",
  robots: { index: false, follow: false },
};
export default function Page() {
  return <StaffAccount />;
}
