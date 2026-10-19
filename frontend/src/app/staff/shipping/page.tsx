import { ShippingPage } from "@/components/omnisire/shipping";
export const metadata = {
  title: "ارسال",
  robots: { index: false, follow: false },
};
export default function Page() {
  return <ShippingPage owner={false} />;
}
