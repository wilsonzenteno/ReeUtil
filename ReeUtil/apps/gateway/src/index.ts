// apps/gateway/src/index.ts
import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import crypto from "crypto";
import { requireAuth, requireRole } from "./auth";

/**
 * Gateway: CORS/JSON, request-id/log, status, proxys a microservicios.
 */

const app = express();
app.disable("x-powered-by");

app.use(
  cors({
    origin: true,
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })
);
app.use(express.json({ limit: "1mb" }));

/* ---------------- request-id + log ---------------- */
app.use((req, res, next) => {
  const rid = req.headers["x-request-id"]?.toString() || crypto.randomUUID();
  res.setHeader("x-request-id", rid);
  (req as any).requestId = rid;

  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    const msg = `[GW] ${req.method} ${req.originalUrl} ${res.statusCode} (${ms}ms) rid=${rid}`;
    if (res.statusCode >= 500) console.error(msg);
    else if (res.statusCode >= 400) console.warn(msg);
    else console.log(msg);
  });
  next();
});

/* ---------------- bases servicios ---------------- */
const svc = {
  registry: process.env.REGISTRY_BASE ?? "http://localhost:3011",
  quote: process.env.QUOTE_BASE ?? "http://localhost:3021",
  shipment: process.env.SHIPMENT_BASE ?? "http://localhost:3031",
  inspection: process.env.INSPECTION_BASE ?? "http://localhost:3041",
  payout: process.env.PAYOUT_BASE ?? "http://localhost:3051",
  notify: process.env.NOTIFY_BASE ?? "http://localhost:3061",
  auth: process.env.AUTH_BASE ?? "http://localhost:3071",
};

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/* ---------------- utils fetch ---------------- */
async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
) {
  const { timeoutMs = 10000, ...rest } = init;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Proxy genérico con headers extra.
 */
async function proxy(
  req: Request,
  res: Response,
  url: string,
  method: HttpMethod = "POST",
  extraHeaders?: Record<string, string>
) {
  try {
    const headers: Record<string, string> = {
      "x-request-id": (req as any).requestId || "",
      ...(extraHeaders || {}),
    };

    // Propaga el sub del usuario si está autenticado
    const sub = (req as any)?.user?.sub;
    if (typeof sub === "string" && sub) headers["x-user-sub"] = sub;

    // Sólo GET sin body
    const hasBody = method !== "GET";
    if (hasBody && !headers["content-type"]) {
      headers["content-type"] = "application/json";
    }

    // Propaga Authorization si vino del cliente
    const auth = req.header("authorization");
    if (auth) headers["authorization"] = auth;

    const r = await fetchWithTimeout(url, {
      method,
      headers,
      body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
      timeoutMs: 12000,
    });

    const ctype = r.headers.get("content-type") || "application/json; charset=utf-8";
    const text = await r.text();
    res.status(r.status).type(ctype).send(text);
  } catch (err: any) {
    console.error("[Gateway proxy error]", method, url, err);
    res.status(502).json({ ok: false, error: "Bad gateway", detail: String(err) });
  }
}

/* ---------------- Health / Status ---------------- */
app.get("/", (_req, res) => res.type("text/plain").send("Gateway OK"));
app.get("/healthz", (_req, res) =>
  res.json({ ok: true, service: "gateway", time: new Date().toISOString() })
);

app.get("/api/_status", async (_req, res) => {
  const port = String(process.env.PORT || 8080);
  const targets: Record<string, string> = {
    gateway: `http://localhost:${port}/healthz`,
    registry: `${svc.registry}/healthz`,
    quote: `${svc.quote}/healthz`,
    shipment: `${svc.shipment}/healthz`,
    inspection: `${svc.inspection}/healthz`,
    payout: `${svc.payout}/healthz`,
    notify: `${svc.notify}/healthz`,
    auth: `${svc.auth}/healthz`,
  };

  const entries = await Promise.all(
    Object.entries(targets).map(async ([name, url]) => {
      try {
        const r = await fetchWithTimeout(url, { timeoutMs: 5000 });
        const json = r.ok ? await r.json() : { ok: false };
        return [name, { ok: r.ok, url, ...json }] as const;
      } catch (e: any) {
        return [name, { ok: false, url, error: String(e) }] as const;
      }
    })
  );

  res.json(Object.fromEntries(entries));
});

/* ---------------- Auth ---------------- */
app.get("/api/auth/me", requireAuth, (req, res) => res.json(req.user));

/* ---------------- Admin (RBAC) ---------------- */
app.get("/api/admin/health", requireAuth, requireRole(["admin", "staff"]), (_req, res) => {
  res.json({ ok: true });
});

/* ---- Admin users (auth-svc) ---- */
app.get(
  "/api/admin/users",
  requireAuth,
  requireRole(["admin", "staff"]),
  (req, res) => proxy(req, res, `${svc.auth}/users`, "GET")
);
app.put(
  "/api/admin/users/:sub/roles",
  requireAuth,
  requireRole(["admin"]),
  (req, res) =>
    proxy(req, res, `${svc.auth}/users/${encodeURIComponent(req.params.sub)}/roles`, "PUT")
);
app.put(
  "/api/admin/users/:sub/status",
  requireAuth,
  requireRole(["admin"]),
  (req, res) =>
    proxy(req, res, `${svc.auth}/users/${encodeURIComponent(req.params.sub)}/status`, "PUT")
);

/* ---------------- Registry ---------------- */
app.get("/api/registry/types", (req, res) =>
  proxy(req, res, `${svc.registry}/types`, "GET")
);
app.post("/api/registry/types", (req, res) =>
  proxy(req, res, `${svc.registry}/types`)
);

app.get("/api/registry/models", (req, res) => {
  const usp = new URLSearchParams();
  if (req.query.type_id) usp.set("typeId", String(req.query.type_id));
  proxy(req, res, `${svc.registry}/models?${usp.toString()}`, "GET");
});
app.post("/api/registry/models", (req, res) =>
  proxy(req, res, `${svc.registry}/models`)
);

app.get("/api/registry/rules", (req, res) => {
  const usp = new URLSearchParams();
  if (req.query.type_id) usp.set("typeId", String(req.query.type_id));
  if (req.query.kind) usp.set("kind", String(req.query.kind));
  proxy(req, res, `${svc.registry}/rules?${usp.toString()}`, "GET");
});
app.post("/api/registry/rules", (req, res) =>
  proxy(req, res, `${svc.registry}/rules`)
);

/* ---------------- Admin Forms (registry-svc) ---------------- */
app.get(
  "/api/admin/forms",
  requireAuth,
  requireRole(["admin", "staff"]),
  (req, res) => {
    const qp = req.url.includes("?") ? req.url.substring(req.url.indexOf("?")) : "";
    proxy(req, res, `${svc.registry}/forms${qp}`, "GET");
  }
);
app.post(
  "/api/admin/forms",
  requireAuth,
  requireRole(["admin", "staff"]),
  (req, res) => proxy(req, res, `${svc.registry}/forms`)
);
app.put(
  "/api/admin/forms/:id/activate",
  requireAuth,
  requireRole(["admin", "staff"]),
  (req, res) =>
    proxy(
      req,
      res,
      `${svc.registry}/forms/${encodeURIComponent(req.params.id)}/activate`,
      "PUT"
    )
);

/* ---------------- Admin Inspections (inspection-svc) ---------------- */
app.get(
  "/api/admin/inspections",
  requireAuth,
  requireRole(["admin", "staff"]),
  (req, res) => {
    const qp = req.url.includes("?") ? req.url.substring(req.url.indexOf("?")) : "";
    proxy(req, res, `${svc.inspection}/reports${qp}`, "GET");
  }
);
app.put(
  "/api/admin/inspections/:id/status",
  requireAuth,
  requireRole(["admin", "staff"]),
  (req, res) =>
    proxy(
      req,
      res,
      `${svc.inspection}/reports/${encodeURIComponent(req.params.id)}/status`,
      "PUT"
    )
);

/* ---------------- Quote ---------------- */
app.post("/api/quote/price", (req, res) => proxy(req, res, `${svc.quote}/price`));
app.post("/api/quotes", (req, res) => proxy(req, res, `${svc.quote}/quotes`));
app.get("/api/quotes/:id", (req, res) =>
  proxy(req, res, `${svc.quote}/quotes/${encodeURIComponent(req.params.id)}`, "GET")
);

/* ---------------- Notify (bandeja del usuario) ---------------- */
// Lista inbox del usuario autenticado (soporta ?unread=1)
// Se reenvía explícitamente x-user-sub para evitar 401 en notify-svc
app.get("/api/notify/inbox", requireAuth, (req, res) => {
  const qp = req.url.includes("?") ? req.url.substring(req.url.indexOf("?")) : "";
  const sub = (req as any).user?.sub || "";
  proxy(req, res, `${svc.notify}/inbox${qp}`, "GET", { "x-user-sub": sub });
});

// Marcar leído/no leído
app.patch("/api/notify/inbox/:id/read", requireAuth, (req, res) => {
  const sub = (req as any).user?.sub || "";
  proxy(
    req,
    res,
    `${svc.notify}/inbox/${encodeURIComponent(req.params.id)}/read`,
    "PATCH",
    { "x-user-sub": sub }
  );
});

/* ---------------- Otros ---------------- */
app.post("/api/shipment/kits", (req, res) => proxy(req, res, `${svc.shipment}/kits`));
app.post("/api/inspection/reports", (req, res) =>
  proxy(req, res, `${svc.inspection}/reports`)
);
app.post("/api/payout/payouts", (req, res) => proxy(req, res, `${svc.payout}/payouts`));
app.post("/api/notify/send-email", (req, res) =>
  proxy(req, res, `${svc.notify}/send-email`)
);

/* ---------------- 404 + errores ---------------- */
app.use((req, res) =>
  res.status(404).json({ ok: false, error: "Not Found", path: req.originalUrl })
);
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[Gateway error handler]", err);
  res.status(500).json({ ok: false, error: "Internal Error", detail: String(err) });
});

/* ---------------- Serve ---------------- */
const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, () => console.log(`Gateway listening on :${PORT}`));
