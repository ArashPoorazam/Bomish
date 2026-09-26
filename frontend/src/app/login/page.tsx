"use client";
import { useRouter } from "next/navigation";
import { LoginForm } from "@/components/login-form";
export default function Login() {
  const router = useRouter();
  return (
    <div className="auth-layout">
      <LoginForm onSuccess={() => router.push("/account")} />
    </div>
  );
}
