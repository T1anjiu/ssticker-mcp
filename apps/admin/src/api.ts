export class AuthenticationError extends Error {}

const API_BASE = "/api/v1/admin";

export async function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path, { method: "GET" });
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function apiDelete(path: string): Promise<void> {
  await apiRequest<unknown>(path, { method: "DELETE" });
}

export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  return apiRequest<T>(path, { method: "POST", body: form });
}

export async function checkSession(): Promise<boolean> {
  try {
    await apiGet<{ authenticated: boolean }>("/session");
    return true;
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return false;
    }
    throw error;
  }
}

export async function login(token: string): Promise<void> {
  await apiPost("/session", { token });
}

async function apiRequest<T>(path: string, init: RequestInit): Promise<T> {
  const method = init.method ?? "GET";
  const headers = new Headers(init.headers);
  if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) {
    const csrf = cookieValue("ssticker_csrf");
    if (csrf) {
      headers.set("x-csrf-token", csrf);
    }
  }
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: "include" });
  if (response.status === 401) {
    throw new AuthenticationError("登录已失效");
  }
  if (!response.ok) {
    const payload = await readPayload(response);
    throw new Error(typeof payload.error === "string" ? payload.error : `请求失败（HTTP ${response.status}）`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

function cookieValue(name: string): string | null {
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return null;
}

async function readPayload(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}
