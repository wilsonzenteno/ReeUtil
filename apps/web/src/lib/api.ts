// apps/web/src/lib/api.ts
// Wrapper de fetch con base URL, Authorization por idToken y manejo robusto de errores,
// con FALLBACK automático al shipment-svc cuando el gateway /api no tenga las rutas publicadas.
// Exporta: get, post, put, patch, del

/* ============================ Bases ============================ */
const API_BASE = String(
  ((import.meta as any)?.env?.VITE_API_BASE || "http://localhost:8080/api") as string
).replace(/\/$/, ""); // sin / al final

// Base directa del shipment-svc para fallback cuando /api responde 404/502
const SHIPMENT_BASE = String(
  ((import.meta as any)?.env?.VITE_SHIPMENT_BASE || "http://localhost:3031") as string
).replace(/\/$/, "");

/* ============================ Tipos ============================ */
type JsonLike = Record<string, any> | any[] | null;
type ReqOpts = RequestInit & {
  expectText?: boolean;   // fuerza respuesta como texto
  timeoutMs?: number;     // timeout opcional
};

/* ============================ Utils ============================ */
/** Une la base con el path, tolerando paths con o sin "/" inicial; respeta URLs absolutas */
function joinUrl(base: string, path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Determina si el body es de tipo binario/form para NO fijar content-type JSON automáticamente */
function isSpecialBody(b: any) {
  return (
    b instanceof FormData ||
    b instanceof Blob ||
    b instanceof ArrayBuffer ||
    b instanceof URLSearchParams ||
    // @ts-ignore - streams opcionales según runtime
    (typeof ReadableStream !== "undefined" && b instanceof ReadableStream)
  );
}

/** Safe text para errores */
async function safeText(r: Response) {
  try {
    return await r.text();
  } catch {
    return "";
  }
}

/** Intenta parsear JSON; si falla, devuelve null */
function tryParseJSON<T = any>(s: string): T | null {
  try {
    return s ? (JSON.parse(s) as T) : (null as any);
  } catch {
    return null;
  }
}

/** Ejecuta un fetch “crudo” a una URL absoluta, con parseo de respuesta y manejo de error */
async function doFetch<T = any>(absUrl: string, opts: ReqOpts): Promise<T> {
  const method = (opts.method || "GET").toUpperCase();

  // Headers
  const headers = new Headers(opts.headers || {});
  // Body y content-type inteligente:
  let bodyToSend: BodyInit | undefined = opts.body as any;
  const hasBody = bodyToSend !== undefined && method !== "GET" && method !== "HEAD";

  if (hasBody) {
    if (!isSpecialBody(bodyToSend)) {
      // Si es objeto/array/cosa serializable y NO se definió content-type, lo hacemos JSON
      const ctype = headers.get("content-type");
      if (!ctype) headers.set("content-type", "application/json");
      if (typeof bodyToSend !== "string") {
        bodyToSend = JSON.stringify(bodyToSend ?? {});
      }
    } else {
      // FormData / Blob / etc -> NO fijar content-type (lo hace el navegador)
    }
  } else {
    bodyToSend = undefined;
  }

  // Soporte de timeout opcional
  const controller = new AbortController();
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : 15000;
  const t = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(absUrl, {
      ...opts,
      method,
      headers,
      body: bodyToSend,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(t);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  const text = await safeText(res);
  const ctype = res.headers.get("content-type") || "";

  if (!res.ok) {
    const payload = tryParseJSON<JsonLike>(text);
    const msg =
      (payload &&
        typeof payload === "object" &&
        ("error" in payload || "message" in payload) &&
        ((payload as any).error || (payload as any).message)) ||
      text ||
      `${res.status} ${res.statusText}`;
    const err = new Error(String(msg));
    (err as any).status = res.status;
    (err as any).payload = payload ?? text;
    throw err;
  }

  if (opts.expectText) return (text as unknown) as T;

  if (ctype.includes("application/json")) {
    return (tryParseJSON<T>(text) as T);
  }

  const maybe = tryParseJSON<T>(text);
  if (maybe !== null) return maybe;

  return (text as unknown) as T;
}

/* ================ Detección de rutas shipment-svc ================ */
/** ¿El path pertenece a shipment-svc? (para activar fallback) */
function isShipmentPath(path: string) {
  return path.startsWith("/admin/shipments/confirmations")
      || path.startsWith("/admin/shipment-confirmations")
      || path.startsWith("/confirmations")
      || path.startsWith("/kits");
}

/** Para rutas admin/process probamos alias legacy cuando el principal da 404 */
function legacyAlias(path: string) {
  if (path.startsWith("/admin/shipments/confirmations/") && path.endsWith("/process")) {
    return path.replace("/admin/shipments/confirmations/", "/admin/shipment-confirmations/");
  }
  return null;
}

/* ============================ request ============================ */
export async function request<T = any>(path: string, opts: ReqOpts = {}): Promise<T> {
  const token = localStorage.getItem("idToken") || "";
  const method = (opts.method || "GET").toUpperCase();

  // Headers base + Authorization si existe token
  const headers = new Headers(opts.headers || {});
  if (token && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${token}`);
  }

  // 1) Intento vía gateway (/api)
  try {
    return await doFetch<T>(joinUrl(API_BASE, path), { ...opts, method, headers });
  } catch (e: any) {
    const status = e?.status ?? 0;

    // 2) Si es una ruta de shipment y el gateway responde 404/502/0, probamos alias legacy y/o servicio directo
    if (isShipmentPath(path) && (status === 404 || status === 502 || status === 0)) {
      // 2.a) Reintento con alias legacy contra gateway (por si el gateway solo expone la ruta vieja)
      const alias = legacyAlias(path);
      if (alias) {
        try {
          return await doFetch<T>(joinUrl(API_BASE, alias), { ...opts, method, headers });
        } catch {
          // si también falla, seguimos al 2.b
        }
      }

      // 2.b) Directo al shipment-svc (ruta principal)
      try {
        return await doFetch<T>(joinUrl(SHIPMENT_BASE, path), { ...opts, method, headers });
      } catch (e3: any) {
        // 2.c) Si es la ruta process principal, reintentar alias legacy directo al servicio
        if (alias) {
          return await doFetch<T>(joinUrl(SHIPMENT_BASE, alias), { ...opts, method, headers });
        }
        throw e3;
      }
    }

    // Si no es ruta de shipment o el error no es de ruteo, propagar
    throw e;
  }
}

/* ============================ Helpers ============================ */
export function get<T = any>(path: string, init?: Omit<ReqOpts, "method">) {
  return request<T>(path, { ...(init || {}), method: "GET" });
}

export function post<T = any>(path: string, body?: any, init?: Omit<ReqOpts, "method" | "body">) {
  return request<T>(path, { ...(init || {}), method: "POST", body });
}

export function put<T = any>(path: string, body?: any, init?: Omit<ReqOpts, "method" | "body">) {
  return request<T>(path, { ...(init || {}), method: "PUT", body });
}

export function patch<T = any>(path: string, body?: any, init?: Omit<ReqOpts, "method" | "body">) {
  return request<T>(path, { ...(init || {}), method: "PATCH", body });
}

export function del<T = any>(path: string, init?: Omit<ReqOpts, "method">) {
  return request<T>(path, { ...(init || {}), method: "DELETE" });
}
