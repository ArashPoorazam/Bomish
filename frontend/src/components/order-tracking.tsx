"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Order } from "@/lib/types";
import { useStore } from "./store-provider";
import { LoginForm } from "./login-form";
import { OrderView } from "./checkout";
export function OrderTracking({ id }: { id: string }) {
  const { user } = useStore();
  const [result, setResult] = useState<{
      order: Order;
      trackingUrl: string;
    } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!user?.authenticated) return;
    let active = true;
    const load = () =>
      api<{ order: Order; trackingUrl: string }>(
        "/orders/" + encodeURIComponent(id),
      )
        .then((v) => {
          if (active) {
            setResult(v);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [id, user?.authenticated]);
  if (user && !user.authenticated)
    return (
      <div className="auth-layout">
        <LoginForm onSuccess={() => {}} />
      </div>
    );
  return (
    <div className="container section">
      <Link className="text-link" href="/account">
        ← حساب من
      </Link>
      <h1>سفارش شما، قدم به قدم</h1>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {result ? (
        <OrderView order={result.order} trackingUrl={result.trackingUrl} />
      ) : (
        !error && <p role="status">در حال دریافت وضعیت سفارش…</p>
      )}
    </div>
  );
}
