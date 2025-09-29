// apps/web/src/lib/api.ts

// Lee el token guardado por el login. Acepta dos claves por compatibilidad.
export function getIdToken() {
  return (
    localStorage.getItem("idToken") ||
    localStorage.getItem("g_id_token") ||
    ""
  );
}

function setIdToken(token: string | null) {
  if (!token) {
    localStorage.removeItem("idToken");
    localStorage.removeItem("g_id_token");
  } else {
    localStorage.setItem("idToken", token);
  }
}

async function handleResponse<T>(r: Response): Promise<T> {
  // Manejo específico de 401: limpiar token y forzar re-login del usuario
  if (r.status === 401) {
    setIdToken(null);
    const txt = await r.text().catch(() => "");
    throw new Error(txt || "No autorizado. Inicia sesión de nuevo.");
  }

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(txt || `HTTP ${r.status}`);
  }

  // 204 No Content o sin cuerpo
  if (r.status === 204) return undefined as unknown as T;

  const ctype = r.headers.get("content-type") || "";
  if (ctype.includes("application/json")) {
    return (await r.json()) as T;
  }

  // Fallback a texto cuando no es JSON (algunos endpoints devuelven texto)
  const text = await r.text();
  if (!text) return undefined as unknown as T;

  // Intenta parsear por si vino JSON sin content-type correcto
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const base = (import.meta.env.VITE_API_BASE as string) ?? "/api";
  const token = getIdToken();

  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init?.headers as Record<string, string> | undefined),
  };

  const r = await fetch(base + path, { ...init, headers });
  return handleResponse<T>(r);
}

export const get  = <T = any>(p: string) => api<T>(p, { method: "GET" });
export const post = <T = any>(p: string, body?: any) =>
  api<T>(p, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
export const put  = <T = any>(p: string, body?: any) =>
  api<T>(p, { method: "PUT",  body: body === undefined ? undefined : JSON.stringify(body) });
export const del  = <T = any>(p: string) =>
  api<T>(p, { method: "DELETE" });
