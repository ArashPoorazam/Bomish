import type { Session } from "./types";
let csrf = "";
let pendingSession: Promise<Session> | null = null;
export async function session(): Promise<Session> {
  if (!pendingSession)
    pendingSession = fetch("/api/v1/session", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error("ارتباط با فروشگاه برقرار نشد");
        const s: Session = await r.json();
        csrf = s.csrf;
        return s;
      })
      .finally(() => {
        pendingSession = null;
      });
  return pendingSession;
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  if (method !== "GET" && !csrf) await session();
  const form = body instanceof FormData;
  const r = await fetch("/api/v1" + path, {
    method,
    cache: "no-store",
    headers: {
      ...(method !== "GET" ? { "X-CSRF-Token": csrf } : {}),
      ...(!form && body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok)
    throw new Error(data.error || "درخواست انجام نشد؛ دوباره تلاش کنید");
  return data as T;
}
export async function serverApi<T>(path: string): Promise<T> {
  const response = await fetch(
    `${process.env.API_URL || "http://127.0.0.1:8080"}/api/v1${path}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error(`API request failed: ${response.status}`);
  return response.json();
}
