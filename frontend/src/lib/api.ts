import type { Session } from "./types";
const csrf: Record<string, string> = {};
const pendingSession: Record<string, Promise<Session> | undefined> = {};
function workspace() {
  return typeof window !== "undefined" &&
    /^\/(staff|omnisire)(\/|$)/.test(window.location.pathname)
    ? "staff"
    : "customer";
}
export async function session(scope = workspace()): Promise<Session> {
  if (!pendingSession[scope])
    pendingSession[scope] = fetch(
      "/api/v1/session" + (scope === "staff" ? "?workspace=staff" : ""),
      { cache: "no-store" },
    )
      .then(async (r) => {
        const s = await readResponse<Session>(r);
        csrf[scope] = s.csrf;
        return s;
      })
      .finally(() => {
        delete pendingSession[scope];
      });
  return pendingSession[scope]!;
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const scope = /^\/(staff|omnisire)(\/|$)/.test(path)
    ? "staff"
    : path === "/logout"
      ? workspace()
      : "customer";
  if (method !== "GET" && !csrf[scope]) await session(scope);
  if (path === "/logout" && scope === "staff") path += "?workspace=staff";
  const form = body instanceof FormData;
  const r = await fetch("/api/v1" + path, {
    method,
    signal,
    cache: "no-store",
    headers: {
      ...(method !== "GET" ? { "X-CSRF-Token": csrf[scope] } : {}),
      ...(!form && body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  });
  if (
    r.status === 401 &&
    !path.includes("/login") &&
    !path.startsWith("/auth/")
  ) {
    window.dispatchEvent(
      new CustomEvent("bomish:session-expired", { detail: scope }),
    );
  }
  return readResponse<T>(r);
}
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
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
    throw new ApiError(
      typeof message === "string" && message
        ? message
        : "درخواست انجام نشد؛ دوباره تلاش کنید.",
      response.status,
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
