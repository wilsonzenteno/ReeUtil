import "dotenv/config";
import express from "express";
import { ObjectId } from "mongodb";
import { getDb } from "./db";
import jsonLogic from "json-logic-js";

/* ----------------------------------------------------------------------------
 * Config
 * ------------------------------------------------------------------------- */
const REGISTRY_BASE = (process.env.REGISTRY_BASE || "http://localhost:3011").replace(/\/$/, "");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

/* ----------------------------------------------------------------------------
 * CORS (sin dependencia externa)
 *  - Responde preflight OPTIONS y refleja el Origin (para credentials)
 * ------------------------------------------------------------------------- */
const ALLOW_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
const ALLOW_HEADERS = "Content-Type, Authorization, X-Request-Id, X-User-Sub";
app.use((req, res, next) => {
  const origin = (req.headers.origin as string) || "*";
  // Si usarás credentials, no uses "*" — devolvemos el origin recibido
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", ALLOW_METHODS);
  res.setHeader("Access-Control-Allow-Headers", ALLOW_HEADERS);

  if (req.method === "OPTIONS") {
    // 204 No Content para preflight OK
    return res.status(204).end();
  }
  next();
});

/* ----------------------------------------------------------------------------
 * Health
 * ------------------------------------------------------------------------- */
app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "quote-svc", time: new Date().toISOString() });
});

/* ----------------------------------------------------------------------------
 * Utils fetch
 * ------------------------------------------------------------------------- */
async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
) {
  const { timeoutMs = 8000, ...rest } = init;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 8000) {
  const r = await fetchWithTimeout(url, { ...(init as any), timeoutMs });
  const text = await r.text();
  const ctype = r.headers.get("content-type") || "";
  const isJson = ctype.includes("application/json");
  const data = isJson && text ? JSON.parse(text) : text;

  if (!r.ok) {
    const err = new Error(
      `fetch ${url} -> ${r.status}${
        data ? ` : ${typeof data === "string" ? data : JSON.stringify(data)}` : ""
      }`
    ) as any;
    err.status = r.status;
    throw err;
  }
  return data;
}

/* ----------------------------------------------------------------------------
 * Normalización de reglas (nuevo/legacy)
 * ------------------------------------------------------------------------- */
type LogicAdj = { if: any; then: number };
type NewRuleBody = { basePrice?: number; minPrice?: number; adjustments?: LogicAdj[] };
type LegacyRuleBody = {
  basePrice?: number;
  minPrice?: number;
  adjustments?: {
    [key: string]: { [option: string]: number } | { perUnit?: number };
  };
};

function normalizeRule(raw: any): {
  version: number;
  body: NewRuleBody & { __perUnit?: Record<string, number> };
} {
  const container = raw?.body ?? raw ?? {};
  const version = Number(raw?.version ?? container?.version ?? 1);

  // 1) Nuevo con formula
  const formula = raw?.formula ?? container?.formula;
  if (formula && typeof formula === "object") {
    const adj = Array.isArray(formula.adjustments) ? (formula.adjustments as LogicAdj[]) : [];
    return {
      version,
      body: {
        basePrice: Number(formula.basePrice ?? 0),
        minPrice: Number(formula.minPrice ?? 0),
        adjustments: adj,
      },
    };
  }

  // 2) Variante directa
  if (Array.isArray((container as any)?.adjustments)) {
    return {
      version,
      body: {
        basePrice: Number(container.basePrice ?? 0),
        minPrice: Number(container.minPrice ?? 0),
        adjustments: (container.adjustments as LogicAdj[]) ?? [],
      },
    };
  }

  // 3) Legacy → a json-logic
  const legacy = container as LegacyRuleBody;
  const basePrice = Number(legacy.basePrice ?? 0);
  const minPrice = Number(legacy.minPrice ?? 0);
  const adjList: LogicAdj[] = [];
  const perUnitBag: Record<string, number> = {};

  const adj = legacy.adjustments || {};
  for (const key of Object.keys(adj)) {
    const def = (adj as any)[key];

    if (def && typeof def === "object" && "perUnit" in def) {
      perUnitBag[key] = Number(def.perUnit ?? 0);
      adjList.push({ if: { var: key }, then: 0 });
    } else if (def && typeof def === "object") {
      for (const opt of Object.keys(def)) {
        const delta = Number(def[opt] ?? 0);
        const val = opt === "true" ? true : opt === "false" ? false : opt;
        adjList.push({ if: { "==": [{ var: key }, val] }, then: delta });
      }
    }
  }

  return {
    version,
    body: {
      basePrice,
      minPrice,
      adjustments: adjList,
      __perUnit: Object.keys(perUnitBag).length ? perUnitBag : undefined,
    },
  };
}

/* ----------------------------------------------------------------------------
 * Resolver URL /rules/active (Gateway → Registry directo)
 * ------------------------------------------------------------------------- */
function resolveRegistryActiveRuleUrl(input: string): string {
  try {
    const u = new URL(input);

    if (u.href.startsWith(REGISTRY_BASE) && u.pathname.endsWith("/rules/active")) {
      return u.href;
    }

    const srcParams = u.searchParams;
    const typeId = srcParams.get("typeId") || srcParams.get("type_id") || "";
    const kind = srcParams.get("kind") || "pricing";
    if (!typeId) return "";

    const target = new URL(`${REGISTRY_BASE}/rules/active`);
    target.searchParams.set("typeId", typeId);
    if (kind) target.searchParams.set("kind", kind);
    return target.href;
  } catch {
    const fallbackTypeId = String(input || "");
    if (!fallbackTypeId) return "";
    const target = new URL(`${REGISTRY_BASE}/rules/active`);
    target.searchParams.set("typeId", fallbackTypeId);
    target.searchParams.set("kind", "pricing");
    return target.href;
  }
}

/* ----------------------------------------------------------------------------
 * /price
 * ------------------------------------------------------------------------- */
app.post("/price", async (req, res) => {
  try {
    const answers =
      req.body?.answers && typeof req.body.answers === "object" ? req.body.answers : {};
    const registryRuleUrlRaw = String(req.body?.registryRuleUrl || "");
    if (!registryRuleUrlRaw) return res.status(400).send("registryRuleUrl required");

    const resolvedUrl = resolveRegistryActiveRuleUrl(registryRuleUrlRaw);
    if (!resolvedUrl) {
      return res.status(400).send("Invalid registryRuleUrl (missing typeId/type_id)");
    }

    let rawRule: any;
    try {
      rawRule = await fetchJson(resolvedUrl, { method: "GET" }, 8000);
    } catch (e: any) {
      const st = Number(e?.status || 0);
      console.error("[quote-svc:/price] fetch rule error:", resolvedUrl, e?.message || e);
      if (st === 404) return res.status(404).send("No active pricing rule");
      if (st === 502 || st === 503 || st === 504) return res.status(502).send("Registry unavailable");
      return res.status(500).send("Error retrieving pricing rule");
    }

    const norm = normalizeRule(rawRule);
    const body = norm.body;

    if (typeof body.basePrice !== "number") {
      return res.status(404).send("No active pricing rule (missing basePrice)");
    }

    let price = Number(body.basePrice ?? 0);

    const adjustments: LogicAdj[] = Array.isArray(body.adjustments) ? body.adjustments : [];
    for (const adj of adjustments) {
      try {
        if (jsonLogic.apply(adj.if, answers)) price += Number(adj.then ?? 0);
      } catch (err) {
        console.warn("[quote-svc:/price] bad adjustment rule ignored:", adj, err);
      }
    }

    if (body.__perUnit && typeof body.__perUnit === "object") {
      for (const key of Object.keys(body.__perUnit)) {
        const per = Number(body.__perUnit[key] ?? 0);
        const val = Number((answers as any)?.[key] ?? 0);
        if (!Number.isNaN(per) && !Number.isNaN(val)) price += per * val;
      }
    }

    const minPrice = Number(body.minPrice ?? 0);
    if (!Number.isNaN(minPrice)) price = Math.max(price, minPrice);

    const rounded = Math.max(0, Math.round(price));
    res.json({
      prelimPrice: rounded,
      ruleVersion: norm.version,
      ruleSnapshot: body,
    });
  } catch (err) {
    console.error("[quote-svc] POST /price error", err);
    res.status(500).send("error");
  }
});

/* ----------------------------------------------------------------------------
 * Seguridad simple por header (para /quotes creación)
 * ------------------------------------------------------------------------- */
function requireUserSub(req: express.Request, res: express.Response, next: express.NextFunction) {
  const sub = String(req.header("x-user-sub") || "");
  if (!sub) return res.status(401).send("unauthorized");
  (req as any).userSub = sub;
  next();
}

/* ----------------------------------------------------------------------------
 * Crear cotización
 * ------------------------------------------------------------------------- */
app.post("/quotes", requireUserSub, async (req, res) => {
  try {
    const sub = (req as any).userSub as string;
    const b = req.body || {};

    const doc = {
      userId: sub,
      deviceType: b.device_type || null,
      modelIdExt: b.model_id_ext || null,
      answers: b.answers && typeof b.answers === "object" ? b.answers : {},
      offeredPrice: typeof b.offered_price === "number" ? b.offered_price : null,
      prelimPrice: typeof b.prelim_price === "number" ? b.prelim_price : null,
      ruleVersion: b.rule_version ?? null,
      ruleSnapshot: b.rule_snapshot && typeof b.rule_snapshot === "object" ? b.rule_snapshot : {},
      status: "PENDING" as "PENDING" | "APPROVED" | "REJECTED" | "NEEDS_INFO",
      counterOffers: [] as Array<{
        amount: number; currency: string; actor: "user" | "admin"; createdAt: Date;
      }>,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const db = await getDb();
    const r = await db.collection("quotes").insertOne(doc);
    res.json({ ok: true, id: String(r.insertedId) });
  } catch (err) {
    console.error("[quote-svc] POST /quotes error", err);
    res.status(500).send("error");
  }
});

/* ----------------------------------------------------------------------------
 * Helpers comunes
 * ------------------------------------------------------------------------- */
function sanitizeQuote(doc: any) {
  if (!doc) return null;
  return {
    _id: String(doc._id),
    userId: doc.userId,
    deviceType: doc.deviceType ?? null,
    modelIdExt: doc.modelIdExt ?? null,
    answers: doc.answers || {},
    offeredPrice: doc.offeredPrice ?? null,
    prelimPrice: doc.prelimPrice ?? null,
    ruleVersion: doc.ruleVersion ?? null,
    ruleSnapshot: doc.ruleSnapshot || {},
    status: doc.status,
    counterOffers: Array.isArray(doc.counterOffers) ? doc.counterOffers : [],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/* ----------------------------------------------------------------------------
 * Listar / Obtener cotizaciones
 * ------------------------------------------------------------------------- */
app.get("/quotes", async (req, res) => {
  try {
    const mine = String(req.query.mine || "") === "1";
    const status = String(req.query.status || "").toUpperCase();

    const db = await getDb();
    const q: any = {};

    if (mine) {
      const sub = String(req.header("x-user-sub") || "");
      if (!sub) return res.status(401).send("unauthorized");
      q.userId = sub;
    }

    if (["PENDING", "APPROVED", "REJECTED", "NEEDS_INFO"].includes(status)) {
      q.status = status;
    }

    const list = await db
      .collection("quotes")
      .find(q)
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();

    res.json(list.map(sanitizeQuote));
  } catch (err) {
    console.error("[quote-svc] GET /quotes error", err);
    res.status(500).send("error");
  }
});

app.get("/quotes/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) return res.status(400).send("invalid id");

    const db = await getDb();
    const doc = await db.collection("quotes").findOne({ _id: new ObjectId(id) });
    if (!doc) return res.status(404).send("not found");

    res.json(sanitizeQuote(doc));
  } catch (err) {
    console.error("[quote-svc] GET /quotes/:id error", err);
    res.status(500).send("error");
  }
});

/* ----------------------------------------------------------------------------
 * Admin: GET by id (paridad con /quotes/:id)
 * ------------------------------------------------------------------------- */
app.get("/admin/quotes/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) return res.status(400).send("invalid id");

    const db = await getDb();
    const doc = await db.collection("quotes").findOne({ _id: new ObjectId(id) });
    if (!doc) return res.status(404).send("not found");

    res.json(sanitizeQuote(doc));
  } catch (err) {
    console.error("[quote-svc] GET /admin/quotes/:id error", err);
    res.status(500).send("error");
  }
});

/* ----------------------------------------------------------------------------
 * Admin: update status
 * ------------------------------------------------------------------------- */
app.put("/admin/quotes/:id/status", async (req, res) => {
  try {
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) return res.status(400).send("invalid id");

    const allowed = ["PENDING", "APPROVED", "REJECTED", "NEEDS_INFO"];
    const status = String(req.body?.status || "").toUpperCase();
    if (!allowed.includes(status)) {
      return res.status(400).send("invalid status");
    }

    const db = await getDb();
    const upd = await db.collection("quotes").updateOne(
      { _id: new ObjectId(id) },
      { $set: { status, updatedAt: new Date() } }
    );

    if (upd.matchedCount === 0) return res.status(404).send("not found");

    const doc = await db.collection("quotes").findOne({ _id: new ObjectId(id) });
    if (!doc) return res.status(404).send("not found");

    res.json({ ok: true, id, status: doc.status, updatedAt: doc.updatedAt });
  } catch (err) {
    console.error("[quote-svc] PUT /admin/quotes/:id/status error", err);
    res.status(500).send("error");
  }
});

/* ----------------------------------------------------------------------------
 * Contraoferta (public & admin) — update con pipeline que normaliza counterOffers
 * ------------------------------------------------------------------------- */
async function handleCounterOffer(
  id: string,
  body: any,
  actor: "user" | "admin",
  res: express.Response
) {
  if (!ObjectId.isValid(id)) return res.status(400).send("invalid id");

  const amount = Number(body?.amount);
  const currency = String(body?.currency || "").trim() || "BOB";
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).send("invalid amount");
  }

  const now = new Date();

  const db = await getDb();
  // Pipeline update (MongoDB >= 4.2)
  const upd = await db.collection("quotes").updateOne(
    { _id: new ObjectId(id) },
    [
      {
        $set: {
          counterOffers: {
            $cond: [
              { $isArray: "$counterOffers" },
              "$counterOffers",
              {
                $cond: [
                  { $in: [{ $type: "$counterOffers" }, ["missing", "null"]] },
                  [],
                  [], // si existe pero no es array → reset a []
                ],
              },
            ],
          },
          updatedAt: now,
        },
      },
      {
        $set: {
          counterOffers: {
            $concatArrays: [
              "$counterOffers",
              [
                {
                  amount: amount,
                  currency: currency,
                  actor: actor,
                  createdAt: now,
                },
              ],
            ],
          },
        },
      },
    ]
  );

  if (upd.matchedCount === 0) return res.status(404).send("not found");
  return res.json({ ok: true });
}

// Público (actor "user")
app.post("/quotes/:id/counter-offer", async (req, res) => {
  try {
    const id = String(req.params.id);
    await handleCounterOffer(id, req.body, "user", res);
  } catch (err) {
    console.error("[quote-svc] POST /quotes/:id/counter-offer error", err);
    res.status(500).send("error");
  }
});

// Admin (actor "admin")
app.post("/admin/quotes/:id/counter-offer", async (req, res) => {
  try {
    const id = String(req.params.id);
    await handleCounterOffer(id, req.body, "admin", res);
  } catch (err) {
    console.error("[quote-svc] POST /admin/quotes/:id/counter-offer error", err);
    res.status(500).send("error");
  }
});

/* ----------------------------------------------------------------------------
 * Serve
 * ------------------------------------------------------------------------- */
const PORT = process.env.PORT || 3021;
app.listen(PORT, () => console.log("quote-svc on :" + PORT));
