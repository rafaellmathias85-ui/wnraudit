export const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase}/api${path}`, {
    ...opts,
    credentials: "include",
    headers: { "Content-Type": "application/json", "Accept": "application/json", ...(opts?.headers ?? {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}
