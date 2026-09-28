import type { Session } from "./types";
let csrf = "";
let pendingSession: Promise<Session> | null = null;
export async function session(): Promise<Session> {
  if (!pendingSession)
    pendingSession = fetch("/api/v1/session", { cache: "no-store" })
      .then(async (r) => {
        const s = await readResponse<Session>(r);
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
  return readResponse<T>(r);
}
async function readResponse<T>(response: Response): Promise<T> {
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      response.status === 404
        ? "این بخش در سرویس فروشگاه در دسترس نیست. سرویس را به‌روز کنید و دوباره تلاش کنید."
        : "پاسخ معتبر از فروشگاه دریافت نشد. دوباره تلاش کنید.",
    );
  }
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? data.error
        : undefined;
    throw new Error(
      typeof message === "string" && message
        ? message
        : "درخواست انجام نشد؛ دوباره تلاش کنید.",
    );
  }
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
