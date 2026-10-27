import "server-only";

export async function serverApi<T>(path: string): Promise<T> {
  const response = await fetch(
    `${process.env.API_URL || "http://127.0.0.1:8080"}/api/v1${path}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error(`API request failed: ${response.status}`);
  return response.json();
}
