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

const GATEWAY_BASE =
  process.env.GATEWAY_BASE ??
  `http://localhost:${process.env.PORT || 8080}`;

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

    // Adjunta el sub del usuario autenticado si existe
    const sub = (req as any)?.user?.sub;
    if (typeof sub === "string" && sub) headers["x-user-sub"] = sub;

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
// Types
app.get("/api/registry/types", (req, res) =>
  proxy(req, res, `${svc.registry}/types`, "GET")
);
app.post("/api/registry/types", (req, res) =>
  proxy(req, res, `${svc.registry}/types`)
);

// Models (?type_id -> typeId)
app.get("/api/registry/models", (req, res) => {
  const usp = new URLSearchParams();
  if (req.query.type_id) usp.set("typeId", String(req.query.type_id));
  else if (req.query.typeId) usp.set("typeId", String(req.query.typeId));
  proxy(req, res, `${svc.registry}/models?${usp.toString()}`, "GET");
});
app.post("/api/registry/models", (req, res) =>
  proxy(req, res, `${svc.registry}/models`)
);

// Rules (lista)
app.get("/api/registry/rules", (req, res) => {
  const usp = new URLSearchParams();
  if (req.query.type_id) usp.set("typeId", String(req.query.type_id));
  else if (req.query.typeId) usp.set("typeId", String(req.query.typeId));
  if (req.query.kind) usp.set("kind", String(req.query.kind));
  proxy(req, res, `${svc.registry}/rules?${usp.toString()}`, "GET");
});
app.post("/api/registry/rules", (req, res) =>
  proxy(req, res, `${svc.registry}/rules`)
);

/* ---------------- Rules active (aplanado para pricing) ---------------- */
app.get("/api/rules/active", async (req, res) => {
  try {
    const usp = new URLSearchParams();
    if (req.query.type_id) usp.set("typeId", String(req.query.type_id));
    else if (req.query.typeId) usp.set("typeId", String(req.query.typeId));
    if (req.query.kind) usp.set("kind", String(req.query.kind));

    const url = `${svc.registry}/rules/active?${usp.toString()}`;
    const r = await fetchWithTimeout(url, { timeoutMs: 8000 });
    const ctype = r.headers.get("content-type") || "application/json";
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res.status(r.status).type(ctype).send(text);
    }

    const raw = await r.json();

    // Registry podría devolver {item}, {items:[...]}, o el doc directo
    const doc: any =
      raw?.item ??
      (Array.isArray(raw?.items) ? raw.items[0] : raw) ??
      {};

    const body = doc?.body ?? {};
    const flattened: any = {
      ...doc,
      active: doc.active ?? body.active ?? false,
      status: doc.status ?? body.status,
      published: doc.published ?? body.published,
      effectiveFrom: doc.effectiveFrom ?? body.effectiveFrom,
      effectiveTo: doc.effectiveTo ?? body.effectiveTo,
      match: doc.match ?? body.match ?? doc.criteria ?? body.criteria ?? {},
      criteria: doc.criteria ?? body.criteria ?? {},
      formula: doc.formula ?? body.formula ?? { basePrice: 0, minPrice: 0, adjustments: [] },
    };

    delete flattened.body; // menos ruido
    return res.json(flattened);
  } catch (err: any) {
    console.error("[GW /api/rules/active] flatten error:", err);
    return res.status(502).json({ ok: false, error: "Bad gateway", detail: String(err) });
  }
});

/* ---------------- Forms (registry-svc) ---------------- */
// Active form para usuarios  /api/forms/active?type_id=...
app.get("/api/forms/active", (req, res) => {
  const usp = new URLSearchParams();
  if (req.query.type_id) usp.set("typeId", String(req.query.type_id));
  else if (req.query.typeId) usp.set("typeId", String(req.query.typeId));
  proxy(req, res, `${svc.registry}/forms/active?${usp.toString()}`, "GET");
});

// Admin forms
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

// Alias públicos/compat
app.get("/api/registry/forms/active", (req, res) => {
  const usp = new URLSearchParams();
  if (req.query.type_id) usp.set("typeId", String(req.query.type_id));
  else if (req.query.typeId) usp.set("typeId", String(req.query.typeId));
  proxy(req, res, `${svc.registry}/forms/active?${usp.toString()}`, "GET");
});
app.get(
  "/api/registry/forms",
  requireAuth,
  requireRole(["admin", "staff"]),
  (req, res) => {
    const qp = req.url.includes("?") ? req.url.substring(req.url.indexOf("?")) : "";
    proxy(req, res, `${svc.registry}/forms${qp}`, "GET");
  }
);
app.post(
  "/api/registry/forms",
  requireAuth,
  requireRole(["admin", "staff"]),
  (req, res) => proxy(req, res, `${svc.registry}/forms`)
);
app.put(
  "/api/registry/forms/:id/activate",
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

// Compat: acepta PUT y PATCH desde la UI
const updateInspectionStatus = (req: Request, res: Response) =>
  proxy(
    req,
    res,
    `${svc.inspection}/reports/${encodeURIComponent(req.params.id)}/status`,
    req.method as HttpMethod
  );

app.put(
  "/api/admin/inspections/:id/status",
  requireAuth,
  requireRole(["admin", "staff"]),
  updateInspectionStatus
);
app.patch(
  "/api/admin/inspections/:id/status",
  requireAuth,
  requireRole(["admin", "staff"]),
  updateInspectionStatus
);

app.post("/api/inspection/reports/confirm-shipment", requireAuth, (req, res) =>
  proxy(req, res, `${svc.inspection}/reports/confirm-shipment`)
);

/* ---------------- NUEVO: Admin Shipments (inspection-svc) ----------- */
app.get(
  "/api/admin/shipments",
  requireAuth,
  requireRole(["admin", "staff"]),
  (req, res) => {
    const qp = req.url.includes("?") ? req.url.substring(req.url.indexOf("?")) : "";
    proxy(req, res, `${svc.inspection}/shipments${qp}`, "GET");
  }
);
/** Admin: listar confirmaciones (shipment-svc) */
app.get(
  "/api/admin/shipments/confirmations",
  requireAuth,
  requireRole(["admin", "staff"]),
  (req, res) => {
    const qp = req.url.includes("?") ? req.url.substring(req.url.indexOf("?")) : "";
    proxy(req, res, `${svc.shipment}/admin/shipments/confirmations${qp}`, "GET");
  }
);

/** Admin: marcar confirmación como procesada (shipment-svc) */
app.patch(
  "/api/admin/shipments/confirmations/:id/process",
  requireAuth,
  requireRole(["admin", "staff"]),
  (req, res) =>
    proxy(
      req,
      res,
      `${svc.shipment}/admin/shipments/confirmations/${encodeURIComponent(req.params.id)}/process`,
      "PATCH"
    )
);

/* ---------------- Admin Deliveries (shipment-svc) ---------------- */
// Crear una recepción (staff/admin)
app.post(
  "/api/deliveries/receive",
  requireAuth,
  requireRole(["admin", "staff"]),
  (req, res) => proxy(req, res, `${svc.shipment}/deliveries/receive`)
);

app.get(
  "/api/admin/deliveries",
  requireAuth,
  requireRole(["admin", "staff"]),
  (req, res) => {
    const qp = req.url.includes("?") ? req.url.substring(req.url.indexOf("?")) : "";
    proxy(req, res, `${svc.shipment}/admin/deliveries${qp}`, "GET");
  }
);

app.patch(
  "/api/admin/deliveries/:id/status",
  requireAuth,
  requireRole(["admin", "staff"]),
  (req, res) =>
    proxy(
      req,
      res,
      `${svc.shipment}/admin/deliveries/${encodeURIComponent(req.params.id)}/status`,
      "PATCH"
    )
);

// recepción por QR/ID (pública para UI admin si ya está autenticado vía gateway)
app.post("/api/deliveries/receive", requireAuth, (req, res) =>
  proxy(req, res, `${svc.shipment}/deliveries/receive`, "POST")
);

/* ---------------- Quote ---------------- */
// Calcular precio con reglas de registry (inyecta registryRuleUrl y answers)
app.post("/api/quote/price", (req, res) => {
  try {
    const original = (req.body ?? {}) as Record<string, any>;

    // answers: si ya vienen, usarlos; si no, empaquetar el body completo como answers
    const answers =
      original.answers && typeof original.answers === "object"
        ? original.answers
        : { ...original };

    // typeId puede venir en answers o en nivel raíz
    const typeId =
      original.typeId ||
      original.type_id ||
      answers.typeId ||
      answers.type_id;

    // registryRuleUrl: si no viene, lo generamos con base en typeId
    let registryRuleUrl = String(original.registryRuleUrl || "");
    if (!registryRuleUrl) {
      if (!typeId) {
        return res
          .status(400)
          .json({ ok: false, error: "typeId required when registryRuleUrl is missing" });
      }
      const usp = new URLSearchParams();
      usp.set("typeId", String(typeId));
      usp.set("kind", "pricing");
      registryRuleUrl = `${GATEWAY_BASE}/api/rules/active?${usp.toString()}`;
    }

    // No contaminar answers con registryRuleUrl
    delete (answers as any).registryRuleUrl;

    // Sobrescribimos body para el microservicio quote
    (req as any).body = { answers, registryRuleUrl };
    return proxy(req, res, `${svc.quote}/price`);
  } catch (err) {
    console.error("[GW] /api/quote/price transform error", err);
    return res.status(500).json({ ok: false, error: "transform error" });
  }
});

// Crear cotización (requiere auth para inyectar x-user-sub)
app.post("/api/quotes", requireAuth, (req, res) =>
  proxy(req, res, `${svc.quote}/quotes`)
);

// Obtener cotización por id
app.get("/api/quotes/:id", requireAuth, (req, res) =>
  proxy(req, res, `${svc.quote}/quotes/${encodeURIComponent(req.params.id)}`, "GET")
);

// Listar "Mis cotizaciones" (mine=1) para el usuario autenticado
app.get("/api/quotes", requireAuth, (req, res) => {
  const usp = new URLSearchParams();
  if (req.query.status) usp.set("status", String(req.query.status));
  usp.set("mine", "1");
  proxy(req, res, `${svc.quote}/quotes?${usp.toString()}`, "GET");
});

// (Opcional dev) Reasignar demo-quotes al usuario autenticado
app.post(
  "/api/admin/reassign-demo-quotes",
  requireAuth,
  requireRole(["admin", "staff"]),
  (req, res) => proxy(req, res, `${svc.quote}/admin/reassign-demo-quotes`)
);

// (Opcional) Exponer sync de estado de quote para panel admin
app.put(
  "/api/admin/quotes/:id/status",
  requireAuth,
  requireRole(["admin", "staff"]),
  (req, res) =>
    proxy(
      req,
      res,
      `${svc.quote}/admin/quotes/${encodeURIComponent(req.params.id)}/status`,
      "PUT"
    )
);

/* ===== Admin Inspections: detalle y quote proxy ===== */
app.get(
  "/api/admin/inspections/:id",
  requireAuth, requireRole(["admin","staff"]),
  (req, res) => proxy(req, res, `${svc.inspection}/reports/${encodeURIComponent(req.params.id)}`, "GET")
);

// Si tu inspection-svc expone /reports/:id/quote como proxy:
app.get(
  "/api/admin/inspections/:id/quote",
  requireAuth, requireRole(["admin","staff"]),
  (req, res) => proxy(req, res, `${svc.inspection}/reports/${encodeURIComponent(req.params.id)}/quote`, "GET")
);

/* ===== Admin Confirmations: GET por id (shipment-svc) ===== */
app.get(
  "/api/admin/confirmations/:id",
  requireAuth, requireRole(["admin","staff"]),
  (req, res) =>
    proxy(
      req, res,
      `${svc.shipment}/admin/shipments/confirmations/${encodeURIComponent(req.params.id)}`,
      "GET"
    )
);

/* ===== Quotes (quote-svc): admin/public GET por id ===== */
app.get(
  "/api/admin/quotes/:id",
  requireAuth, requireRole(["admin","staff"]),
  (req, res) =>
    proxy(req, res, `${svc.quote}/admin/quotes/${encodeURIComponent(req.params.id)}`, "GET")
);

// Counter-offer (quote-svc)
app.post(
  "/api/admin/quotes/:id/counter-offer",
  requireAuth, requireRole(["admin","staff"]),
  (req, res) =>
    proxy(
      req, res,
      `${svc.quote}/admin/quotes/${encodeURIComponent(req.params.id)}/counter-offer`
    )
);
app.post(
  "/api/quotes/:id/counter-offer",
  requireAuth,
  (req, res) =>
    proxy(
      req, res,
      `${svc.quote}/quotes/${encodeURIComponent(req.params.id)}/counter-offer`
    )
);

/* ---------------- Notify (bandeja del usuario) ---------------- */
app.get("/api/notify/inbox", requireAuth, (req, res) => {
  const qp = req.url.includes("?") ? req.url.substring(req.url.indexOf("?")) : "";
  const sub = (req as any).user?.sub || "";
  proxy(req, res, `${svc.notify}/inbox${qp}`, "GET", { "x-user-sub": sub });
});

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

// Notify: ack explícito (PATCH y POST compat)
app.patch("/api/notify/inbox/:id/ack", requireAuth, (req, res) => {
  const sub = (req as any).user?.sub || "";
  proxy(
    req,
    res,
    `${svc.notify}/inbox/${encodeURIComponent(req.params.id)}/ack`,
    "PATCH",
    { "x-user-sub": sub }
  );
});
app.post("/api/notify/inbox/:id/ack", requireAuth, (req, res) => {
  const sub = (req as any).user?.sub || "";
  proxy(
    req,
    res,
    `${svc.notify}/inbox/${encodeURIComponent(req.params.id)}/ack`,
    "POST",
    { "x-user-sub": sub }
  );
});

// **NUEVOS** endpoints usados por tu UI para notificaciones
app.post("/api/notify/send", (req, res) =>
  proxy(req, res, `${svc.notify}/send`)
);
app.post("/api/notify/inbox", (req, res) =>
  proxy(req, res, `${svc.notify}/inbox`)
);

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
