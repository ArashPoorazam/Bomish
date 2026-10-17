"use client";
import { useRouter } from "next/navigation";
import { AuthLayout } from "@/components/auth-layout";
import { LoginForm } from "@/components/login-form";
export default function Login() {
  const router = useRouter();
  return (
    <AuthLayout>
      <LoginForm
        onSuccess={() => {
          const next = new URLSearchParams(window.location.search).get("next");
          router.replace(next === "/checkout" ? "/checkout" : "/account");
        }}
      />
    </AuthLayout>
  );
}
