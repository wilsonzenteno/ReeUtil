// services/shipment-svc/src/app.ts
import "dotenv/config";
import express, { Request, Response } from "express";
import cors, { CorsOptions } from "cors";
import { ObjectId } from "mongodb";
import { randomUUID } from "node:crypto";
import * as http from "node:http";
import * as https from "node:https";
import { URL } from "node:url";
import { getDb } from "./db";

/* ======================= CORS ======================= */
const DEFAULT_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:8080",
];
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || DEFAULT_ORIGINS.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const corsOptions: CorsOptions = {
  origin(origin, cb) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "X-User-Sub",
    "x-user-sub",
  ],
  maxAge: 86400,
};

/* ======================= App & ENV ======================= */
const app = express();
app.use(cors(corsOptions));
app.use(express.json());

const NOTIFY_BASE_ENV = (process.env.NOTIFY_BASE || "").replace(/\/+$/, "");
const EST_DELIVERY_DAYS = process.env.EST_DELIVERY_DAYS || "2–5";
const QUOTE_BASE = (process.env.QUOTE_BASE || "http://localhost:3021").replace(
  /\/+$/,
  ""
);

/* ======================= Tipos ======================= */
type ShippingAddr = {
  fullName: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  notes?: string;
};

type ConfirmationDoc = {
  _id?: any;
  inboxId?: string | null;
  userSub: string | null;
  quoteId?: string | null;
  quoteIdExt?: string | null;
  reportId?: string | null;
  modelIdExt?: string | null;
  shipping?: ShippingAddr; // soporta ambos esquemas
  address?: ShippingAddr;
  status: "PENDING" | "PROCESSED";
  createdAt: Date;
  processedAt?: Date | null;
};

type DeliveryStatus = "RECEIVED" | "IN_INSPECTION" | "CLOSED";
type DeliveryItem = { name: string; qty: number; notes?: string };
type DeliveryDoc = {
  _id?: any;
  confirmationId?: string | null;
  quoteId?: string | null;
  quoteIdExt?: string | null;
  modelIdExt?: string | null;
  userSub?: string | null;
  trackingCode?: string | null;
  receivedAt: Date;
  status: DeliveryStatus;
  notes?: string | null;
  items?: Array<DeliveryItem>;
};

type InspectionStatus = "IN_INSPECTION" | "PASSED" | "FAILED" | "CLOSED";
type InspectionFinding = { label: string; value: string };
type InspectionDoc = {
  _id?: any;
  source: "SHIPMENT";
  deliveryId?: string | null;
  confirmationId?: string | null;
  quoteId?: string | null;
  quoteIdExt?: string | null;
  modelIdExt?: string | null;
  userSub?: string | null;
  startedAt?: Date | null;
  closedAt?: Date | null;
  status: InspectionStatus;
  notes?: string | null;
  findings?: InspectionFinding[];
  createdAt: Date;
  updatedAt: Date;
};

/* ======================= Colecciones ======================= */
const CONF_COLL = "shipment_confirmations";
const KITS_COLL = "kits";
const DELIVERIES_COLL = "deliveries";
const INSPECTIONS_COLL = "device_inspections";

/* ======================= Utils ======================= */
function requiredStr(v: any): string {
  if (typeof v !== "string") return "";
  return v.trim();
}
function pickShipping(body: any): ShippingAddr | null {
  const s = body?.shipping;
  if (!s || typeof s !== "object") return null;
  return {
    fullName: requiredStr(s.fullName),
    addressLine1: requiredStr(s.addressLine1),
    addressLine2: requiredStr(s.addressLine2) || undefined,
    city: requiredStr(s.city),
    state: requiredStr(s.state) || undefined,
    postalCode: requiredStr(s.postalCode) || undefined,
    country: requiredStr(s.country) || undefined,
    phone: requiredStr(s.phone) || undefined,
    notes: requiredStr(s.notes) || undefined,
  };
}
function validateShipping(s: ShippingAddr | null) {
  if (!s) return "shipping requerido";
  if (!s.fullName) return "fullName requerido";
  if (!s.addressLine1) return "addressLine1 requerido";
  if (!s.city) return "city requerido";
  return null;
}
function getShipFromConf(conf: ConfirmationDoc): ShippingAddr | null {
  return (conf.shipping as any) || (conf.address as any) || null;
}
function formatAddr(s?: ShippingAddr | null) {
  if (!s) return "—";
  const lines = [
    s.fullName,
    s.addressLine1,
    s.addressLine2,
    `${s.city || ""}${s.state ? ", " + s.state : ""} ${s.postalCode || ""}`.trim(),
    s.country,
    s.phone ? `Tel: ${s.phone}` : "",
    s.notes ? `Notas: ${s.notes}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

/* ---------- fetch JSON helpers ---------- */
async function postJson(
  urlStr: string,
  body: any
): Promise<{ ok: boolean; status?: number }> {
  try {
    // @ts-ignore
    if (typeof globalThis.fetch === "function") {
      // @ts-ignore
      const r = await fetch(urlStr, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { ok: r.ok, status: r.status };
    }
  } catch (e) {
    console.warn("[shipment-svc] fetch POST failed:", e);
  }
  return await new Promise((resolve) => {
    try {
      const u = new URL(urlStr);
      const isHttps = u.protocol === "https:";
      const data = Buffer.from(JSON.stringify(body));
      const req = (isHttps ? https : http).request(
        {
          hostname: u.hostname,
          port: u.port || (isHttps ? 443 : 80),
          path: u.pathname + u.search,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": data.length,
          },
        },
        (res) => {
          res.resume();
          resolve({
            ok:
              (res.statusCode || 500) >= 200 &&
              (res.statusCode || 500) < 300,
            status: res.statusCode,
          });
        }
      );
      req.on("error", (err) => {
        console.warn("[shipment-svc] http/https POST error:", err);
        resolve({ ok: false });
      });
      req.write(data);
      req.end();
    } catch (err) {
      console.warn("[shipment-svc] http/https POST build error:", err);
      resolve({ ok: false });
    }
  });
}

async function fetchJson(urlStr: string): Promise<any> {
  // @ts-ignore
  if (typeof globalThis.fetch === "function") {
    // @ts-ignore
    const r = await fetch(urlStr, { method: "GET" });
    const text = await r.text();
    const ctype = r.headers.get("content-type") || "";
    const isJson = ctype.includes("application/json");
    const data = isJson && text ? JSON.parse(text) : text;
    if (!r.ok) {
      const err: any = new Error(`fetch ${urlStr} -> ${r.status}`);
      err.status = r.status;
      err.data = data;
      throw err;
    }
    return data;
  }
  // Fallback http/https
  return await new Promise((resolve, reject) => {
    try {
      const u = new URL(urlStr);
      const isHttps = u.protocol === "https:";
      const req = (isHttps ? https : http).request(
        {
          hostname: u.hostname,
          port: u.port || (isHttps ? 443 : 80),
          path: u.pathname + u.search,
          method: "GET",
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) =>
            chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c))
          );
          res.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            if (
              (res.statusCode || 500) >= 200 &&
              (res.statusCode || 500) < 300
            ) {
              try {
                resolve(JSON.parse(body));
              } catch {
                resolve(body);
              }
            } else {
              reject(new Error(`fetch ${urlStr} -> ${res.statusCode}`));
            }
          });
        }
      );
      req.on("error", (err) => reject(err));
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

/* ======================= Healthcheck ======================= */
app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    service: "shipment-svc",
    time: new Date().toISOString(),
    allowedOrigins: ALLOWED_ORIGINS,
  });
});

/* ======================= POST /confirmations ======================= */
app.post("/confirmations", async (req, res) => {
  try {
    const userSub = requiredStr(
      req.header("x-user-sub") || req.body?.user_sub || ""
    );
    const inboxId = requiredStr(req.body?.inbox_id);
    const quoteId = requiredStr(req.body?.quote_id) || null;
    const quoteIdExt = requiredStr(req.body?.quote_id_ext) || null;
    const reportId = requiredStr(req.body?.report_id) || null;
    const modelIdExt = requiredStr(req.body?.model_id_ext) || null;

    const shipping = pickShipping(req.body);
    const errShip = validateShipping(shipping);
    if (errShip) return res.status(400).json({ ok: false, error: errShip });

    const doc: ConfirmationDoc = {
      inboxId: inboxId || null,
      userSub: userSub || null,
      quoteId,
      quoteIdExt,
      reportId,
      modelIdExt,
      shipping: shipping!,
      status: "PENDING",
      createdAt: new Date(),
      processedAt: null,
    };

    const db = await getDb();
    const r = await db.collection(CONF_COLL).insertOne(doc);

    res.json({ ok: true, id: String(r.insertedId) });
  } catch (err) {
    console.error("[shipment-svc] POST /confirmations error", err);
    res.status(500).json({ ok: false, error: "error" });
  }
});

/* ======================= POST /kits ======================= */
app.post("/kits", async (req, res) => {
  try {
    const { quote_id_ext, quote_id, report_id, model_id_ext, shipping } =
      req.body || {};
    if (!quote_id_ext) return res.status(400).send("quote_id_ext required");
    const userSub = requiredStr(
      req.header("x-user-sub") || req.body?.user_sub || ""
    );

    let shippingDoc: ShippingAddr | null = null;
    if (shipping && typeof shipping === "object") {
      const s = shipping as Record<string, any>;
      shippingDoc = {
        fullName: String(s.recipientName || s.fullName || ""),
        phone: requiredStr(s.phone) || undefined,
        addressLine1: String(s.addressLine1 || ""),
        addressLine2: requiredStr(s.addressLine2) || undefined,
        city: String(s.city || ""),
        state: requiredStr(s.state) || undefined,
        postalCode: requiredStr(s.postalCode) || undefined,
        country: requiredStr(s.country) || undefined,
        notes: requiredStr(s.notes) || undefined,
      };
      const errShip = validateShipping(shippingDoc);
      if (errShip) return res.status(400).json({ ok: false, error: errShip });
    }

    const db = await getDb();

    // 1) Crear el kit (tracking)
    const tracking = "TRK-" + randomUUID().slice(0, 8).toUpperCase();
    const kitIns = await db.collection(KITS_COLL).insertOne({
      quoteIdExt: String(quote_id_ext),
      quoteId: requiredStr(quote_id) || null,
      reportId: requiredStr(report_id) || null,
      modelIdExt: requiredStr(model_id_ext) || null,
      shipping: shippingDoc,
      carrier: "DemoCarrier",
      trackingCode: tracking,
      labelUrl: "https://label.example/" + tracking,
      status: "CREATED",
      createdAt: new Date(),
    });

    // 2) Si vino shipping → crear también la confirmación
    if (shippingDoc) {
      const confDoc: ConfirmationDoc = {
        inboxId: null,
        userSub: userSub || null,
        quoteId: requiredStr(quote_id) || null,
        quoteIdExt: String(quote_id_ext),
        reportId: requiredStr(report_id) || null,
        modelIdExt: requiredStr(model_id_ext) || null,
        shipping: shippingDoc,
        status: "PENDING",
        createdAt: new Date(),
        processedAt: null,
      };
      await db.collection(CONF_COLL).insertOne(confDoc);
    }

    res.json({
      ok: true,
      id: String(kitIns.insertedId),
      trackingCode: tracking,
    });
  } catch (err) {
    console.error("[shipment-svc] POST /kits error", err);
    res.status(500).send("error");
  }
});

/* ======================= Notificación (kits) ======================= */
const notifyBases: string[] = [
  ...(NOTIFY_BASE_ENV ? [NOTIFY_BASE_ENV] : []),
  "http://localhost:3061",
  "http://127.0.0.1:3061",
  "http://localhost:8080/api/notify",
];
async function tryNotify(base: string, payload: any): Promise<boolean> {
  const b = base.replace(/\/+$/, "");
  const u1 = `${b}/send`;
  const u2 = `${b}/inbox`;
  const r1 = await postJson(u1, payload);
  if (r1.ok) {
    console.log(`[shipment-svc] notify via ${u1} OK (${r1.status})`);
    return true;
  }
  console.warn(`[shipment-svc] notify via ${u1} FAIL (${r1.status})`);
  const legacy = {
    user_sub: payload.to_sub,
    title: payload.title,
    body: payload.body,
    link: payload.meta?.link || undefined,
  };
  const r2 = await postJson(u2, legacy);
  if (r2.ok) {
    console.log(`[shipment-svc] notify via ${u2} OK (${r2.status})`);
    return true;
  }
  console.warn(`[shipment-svc] notify via ${u2} FAIL (${r2.status})`);
  return false;
}
async function sendNotification(
  toSub: string,
  title: string,
  body: string,
  meta?: any
) {
  for (const base of notifyBases) {
    try {
      const ok = await tryNotify(base, { to_sub: toSub, title, body, meta });
      if (ok) return true;
    } catch (e) {
      console.warn("[shipment-svc] notify error:", e);
    }
  }
  console.warn("[shipment-svc] ALL notify attempts failed for", toSub);
  return false;
}
async function notifyUserKitSent(
  toSub: string,
  confirmation: ConfirmationDoc & { _id?: any },
  trackingCode?: string | null
) {
  const title = "Tu kit de envío fue despachado";
  const dir = formatAddr(getShipFromConf(confirmation));

  const lines: string[] = [];
  lines.push(
    `¡Hola! Enviamos tu kit. Te llegará en ${EST_DELIVERY_DAYS} días hábiles.`,
    "",
    "Datos de entrega del kit:",
    dir
  );

  if (trackingCode) {
    lines.push("", `N.º de seguimiento: ${trackingCode}`);
  }

  lines.push(
    "",
    "Instrucciones para preparar el dispositivo:",
    "1) Apaga el equipo y, si es posible, restablécelo a valores de fábrica.",
    "2) Protégelo con material acolchado. No incluyas líquidos.",
    "3) Colócalo dentro de la caja del kit y sella todas las solapas con cinta resistente.",
    "4) Incluye una nota con tu Quote ID y, si corresponde, el ID de Reporte.",
    "",
    "Términos y condiciones:",
    "El transporte es realizado por el operador logístico. ReeUtil no se hace responsable por pérdidas o daños que ocurran durante el traslado."
  );

  const meta = {
    kind: "KIT_DISPATCHED",
    confirmationId: confirmation?._id ? String(confirmation._id) : null,
    quoteId: confirmation.quoteId || null,
    quoteIdExt: confirmation.quoteIdExt || null,
    modelIdExt: confirmation.modelIdExt || null,
    trackingCode: trackingCode || null,
    estimatedDays: EST_DELIVERY_DAYS,
  };

  await sendNotification(toSub, title, lines.join("\n"), meta);
}

/* ======================= Resolver userSub ======================= */
async function resolveUserSubForConfirmation(conf: ConfirmationDoc, db: any) {
  if (conf.userSub) return conf.userSub;

  if (conf.quoteId && ObjectId.isValid(conf.quoteId)) {
    try {
      const q = await fetchJson(
        `${QUOTE_BASE}/quotes/${encodeURIComponent(conf.quoteId)}`
      );
      if (q?.userId) return String(q.userId);
    } catch (e) {
      console.warn("[shipment-svc] resolve userSub via quote-svc failed:", e);
    }
  }

  try {
    const localQuote =
      conf.quoteId && ObjectId.isValid(conf.quoteId)
        ? await db
            .collection("quotes")
            .findOne({ _id: new ObjectId(conf.quoteId) })
        : null;
    if (localQuote?.userId) return String(localQuote.userId);
  } catch {
    /* noop */
  }

  return null;
}

/* ======================= Listado admin: Confirmations ======================= */
async function listConfirmations(req: Request, res: Response) {
  try {
    const db = await getDb();

    const q: any = {};
    const status = String(req.query?.status || "").toUpperCase();
    if (status === "PENDING" || status === "PROCESSED") q.status = status;

    const search = requiredStr(req.query?.search);
    if (search) {
      const rx = new RegExp(
        search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i"
      );
      q.$or = [
        {
          _id: (() => {
            try {
              return new ObjectId(search);
            } catch {
              return undefined as any;
            }
          })(),
        },
        { _id: search },
        { inboxId: rx },
        { userSub: rx },
        { quoteId: rx },
        { quoteIdExt: rx },
        { reportId: rx },
        { modelIdExt: rx },
        { "shipping.fullName": rx },
        { "shipping.city": rx },
        { "shipping.state": rx },
        { "shipping.addressLine1": rx },
        { "shipping.addressLine2": rx },
        { "shipping.postalCode": rx },
        { "shipping.phone": rx },
        { "shipping.notes": rx },
        { "address.fullName": rx },
        { "address.city": rx },
        { "address.state": rx },
        { "address.addressLine1": rx },
        { "address.addressLine2": rx },
        { "address.postalCode": rx },
        { "address.phone": rx },
        { "address.notes": rx },
      ].filter((x) => (x as any)._id || Object.values(x as any)[0]);
    }

    const list = await db
      .collection(CONF_COLL)
      .find(q)
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray();

    res.json(list);
  } catch (err) {
    console.error(
      "[shipment-svc] GET /admin/shipments/confirmations error",
      err
    );
    res.status(500).json({ ok: false, error: "error" });
  }
}
app.get("/admin/shipments/confirmations", listConfirmations);
app.get("/admin/shipment-confirmations", listConfirmations); // alias legacy

/* ======== GET Confirmation by ID ======== */
app.get(
  "/admin/shipments/confirmations/:id",
  async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const db = await getDb();

      const or: any[] = [{ _id: id }];
      if (ObjectId.isValid(id)) or.unshift({ _id: new ObjectId(id) });

      const doc = await db.collection(CONF_COLL).findOne({ $or: or });

      if (!doc) return res.status(404).json({ ok: false, error: "not found" });
      res.json(doc);
    } catch (e) {
      console.error("[shipment-svc] GET confirmation by id error", e);
      res.status(500).json({ ok: false, error: "error" });
    }
  }
);

/* ======================= PATCH Confirmations: process ======================= */
async function processConfirmationHandler(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const processed = !!req.body?.processed;

    const set: any = {
      status: processed ? "PROCESSED" : "PENDING",
      processedAt: processed ? new Date() : null,
    };

    const db = await getDb();
    const coll = db.collection(CONF_COLL);

    const or: any[] = [{ _id: id }];
    if (ObjectId.isValid(id)) or.unshift({ _id: new ObjectId(id) });

    const filter = { $or: or };

    const updRes = await coll.updateOne(filter, { $set: set });
    if (updRes.matchedCount === 0) {
      return res.status(404).json({ ok: false, error: "not found" });
    }

    const doc = (await coll.findOne(filter)) as ConfirmationDoc | null;

    if (doc && processed) {
      const toSub = await resolveUserSubForConfirmation(doc, db);
      if (toSub) {
        let tracking: string | null = null;
        try {
          const kitsQ: any = {};
          if (doc.quoteIdExt) kitsQ.quoteIdExt = doc.quoteIdExt;
          else if (
            doc.quoteId &&
            (ObjectId.isValid(doc.quoteId) || typeof doc.quoteId === "string")
          ) {
            kitsQ.$or = [
              {
                quoteId: (() => {
                  try {
                    return new ObjectId(String(doc.quoteId));
                  } catch {
                    return null as any;
                  }
                })(),
              },
              { quoteId: String(doc.quoteId) },
            ].filter((x) => (x as any).quoteId);
          }

          const kit = await db
            .collection(KITS_COLL)
            .find(kitsQ)
            .sort({ createdAt: -1 })
            .limit(1)
            .next();
          tracking = kit?.trackingCode || null;
        } catch (e) {
          console.warn("[shipment-svc] search kit tracking failed:", e);
        }

        await notifyUserKitSent(toSub, doc, tracking);
      }
    }

    res.json({ ok: true, id: String((doc as any)?._id || id), processed });
  } catch (err) {
    console.error("[shipment-svc] PATCH process error", err);
    res.status(500).json({ ok: false, error: "error" });
  }
}
app.patch(
  "/admin/shipments/confirmations/:id/process",
  processConfirmationHandler
);
app.patch(
  "/admin/shipment-confirmations/:id/process",
  processConfirmationHandler
);

/* ======================= Entregas (Recepción y Gestión) ======================= */
function parseConfirmationIdFromText(s: string) {
  if (!s || typeof s !== "string") return "";
  const m = s.match(/^\s*Confirmación:\s*([A-Za-z0-9]+)\s*$/m);
  return m?.[1] || "";
}

/** POST /deliveries/receive */
app.post("/deliveries/receive", async (req, res) => {
  try {
    const db = await getDb();

    const body = req.body || {};
    let confirmationId = String(body.confirmationId || "").trim();
    if (!confirmationId && typeof body.qrText === "string" && body.qrText) {
      confirmationId = parseConfirmationIdFromText(body.qrText);
      if (!confirmationId) {
        try {
          const obj = JSON.parse(body.qrText);
          if (obj?.confirmationId) confirmationId = String(obj.confirmationId);
        } catch {}
      }
    }
    if (!confirmationId) {
      return res
        .status(400)
        .json({ ok: false, error: "confirmationId or qrText with confirmation required" });
    }

    const or: any[] = [{ _id: confirmationId }];
    if (ObjectId.isValid(confirmationId)) or.unshift({ _id: new ObjectId(confirmationId) });

    const conf = await db.collection(CONF_COLL).findOne({ $or: or });
    if (!conf) return res.status(404).json({ ok: false, error: "confirmation not found" });

    // Items normalizados
    const rawItems: any[] = Array.isArray(body.items) ? body.items : [];
    const base = rawItems.map((row) => {
      const name = requiredStr(row?.name);
      const qNum = Number(row?.qty);
      const qty = Number.isFinite(qNum) && qNum > 0 ? Math.floor(qNum) : 0;
      const notes = requiredStr(row?.notes) || undefined;
      return { name, qty, notes };
    });
    const normalized = base.filter((row) => Boolean(row.name) && row.qty > 0) as DeliveryItem[];
    const items: DeliveryItem[] | undefined = normalized.length ? normalized : undefined;

    const trackingCode = body.trackingCode ? String(body.trackingCode) : null;
    const notes = body.notes ? String(body.notes) : null;

    const del: DeliveryDoc = {
      confirmationId: String((conf as any)._id),
      quoteId: (conf as any).quoteId || null,
      quoteIdExt: (conf as any).quoteIdExt || null,
      modelIdExt: (conf as any).modelIdExt || null,
      userSub: (conf as any).userSub || null,
      trackingCode,
      receivedAt: new Date(),
      status: "RECEIVED",
      notes,
      items,
    };

    const r = await db.collection(DELIVERIES_COLL).insertOne(del);
    return res.json({ ok: true, id: String(r.insertedId) });
  } catch (e) {
    console.error("[shipment-svc] POST /deliveries/receive error", e);
    return res.status(500).json({ ok: false, error: "error" });
  }
});

/** GET /admin/deliveries?status=&search= */
app.get("/admin/deliveries", async (req: Request, res: Response) => {
  try {
    const db = await getDb();

    const q: any = {};
    const status = String(req.query?.status || "").toUpperCase() as DeliveryStatus;
    const valid: DeliveryStatus[] = ["RECEIVED", "IN_INSPECTION", "CLOSED"];
    if (valid.includes(status)) q.status = status;

    const search = requiredStr(req.query?.search);
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      q.$or = [
        { _id: (() => { try { return new ObjectId(search); } catch { return undefined as any; } })() },
        { _id: search },
        { confirmationId: search },
        { quoteId: rx },
        { quoteIdExt: rx },
        { modelIdExt: rx },
        { userSub: rx },
        { trackingCode: rx },
        { notes: rx },
      ].filter((x) => (x as any)._id || Object.values(x as any)[0]);
    }

    const list = await db.collection(DELIVERIES_COLL)
      .find(q)
      .sort({ receivedAt: -1 })
      .limit(500)
      .toArray();

    return res.json(list);
  } catch (e) {
    console.error("[shipment-svc] GET /admin/deliveries error", e);
    return res.status(500).json({ ok: false, error: "error" });
  }
});

/** PATCH /admin/deliveries/:id/status  Body: { status, notes? } */
app.patch("/admin/deliveries/:id/status", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const next = String(req.body?.status || "").toUpperCase() as DeliveryStatus;
    const valid: DeliveryStatus[] = ["RECEIVED", "IN_INSPECTION", "CLOSED"];
    if (!valid.includes(next)) {
      return res.status(400).json({ ok: false, error: "invalid status" });
    }

    const set: any = { status: next };
    if (req.body?.notes) set.notes = String(req.body.notes);

    const db = await getDb();

    const coll = db.collection(DELIVERIES_COLL);
    const or: any[] = [{ _id: id }];
    if (ObjectId.isValid(id)) or.unshift({ _id: new ObjectId(id) });
    const filter = { $or: or };

    const prevDoc = await coll.findOne(filter);
    const r = await coll.updateOne(filter, { $set: set });
    if (r.matchedCount === 0) return res.status(404).json({ ok: false, error: "not found" });

    // ===== Sincronía con inspecciones dedicadas =====
    const inspections = db.collection(INSPECTIONS_COLL);

    if (next === "IN_INSPECTION") {
      const now = new Date();
      const inspFilter: any = { deliveryId: id, source: "SHIPMENT" };
      await inspections.updateOne(
        inspFilter,
        {
          $setOnInsert: { createdAt: now, source: "SHIPMENT" as const },
          $set: {
            deliveryId: id,
            confirmationId: (prevDoc as any)?.confirmationId || null,
            quoteId: (prevDoc as any)?.quoteId || null,
            quoteIdExt: (prevDoc as any)?.quoteIdExt || null,
            modelIdExt: (prevDoc as any)?.modelIdExt || null,
            userSub: (prevDoc as any)?.userSub || null,
            status: "IN_INSPECTION" as const,
            startedAt: now,
            updatedAt: now,
          } as Partial<InspectionDoc>,
        },
        { upsert: true }
      );
    }

    if (next === "CLOSED") {
      const now = new Date();
      await inspections.updateMany(
        { deliveryId: id, source: "SHIPMENT", status: { $in: ["IN_INSPECTION", "PASSED", "FAILED"] } },
        { $set: { status: "CLOSED", closedAt: now, updatedAt: now } }
      );
    }

    const doc = await coll.findOne(filter);
    return res.json({ ok: true, id: (doc as any)?._id ? String((doc as any)._id) : id, status: next });
  } catch (e) {
    console.error("[shipment-svc] PATCH /admin/deliveries/:id/status error", e);
    return res.status(500).json({ ok: false, error: "error" });
  }
});

/* ======================= Inspecciones (Listado y Estado) ======================= */
/**
 * GET /admin/inspections
 * Filtros:
 *  - status: IN_INSPECTION | PASSED | FAILED | CLOSED  (por defecto: IN_INSPECTION)
 *  - search: texto libre
 *  - source: "all" para ver TODO; por defecto solo source=SHIPMENT
 */
app.get("/admin/inspections", async (req: Request, res: Response) => {
  try {
    const db = await getDb();

    const q: any = {};
    const source = String(req.query?.source || "").toLowerCase();
    if (source !== "all") q.source = "SHIPMENT";

    const statusRaw = String(req.query?.status || "").toUpperCase() as InspectionStatus;
    const valid: InspectionStatus[] = ["IN_INSPECTION", "PASSED", "FAILED", "CLOSED"];
    if (valid.includes(statusRaw)) q.status = statusRaw;
    else q.status = "IN_INSPECTION";

    const search = requiredStr(req.query?.search);
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      q.$or = [
        { _id: (() => { try { return new ObjectId(search); } catch { return undefined as any; } })() },
        { _id: search },
        { deliveryId: rx },
        { confirmationId: rx },
        { quoteId: rx },
        { quoteIdExt: rx },
        { modelIdExt: rx },
        { userSub: rx },
        { notes: rx },
        { "findings.label": rx },
        { "findings.value": rx },
      ].filter((x) => (x as any)._id || Object.values(x as any)[0]);
    }

    const list = await db.collection(INSPECTIONS_COLL)
      .find(q)
      .sort({ startedAt: -1, createdAt: -1 })
      .limit(500)
      .toArray();

    return res.json(list);
  } catch (e) {
    console.error("[shipment-svc] GET /admin/inspections error", e);
    return res.status(500).json({ ok: false, error: "error" });
  }
});

/** GET /admin/inspections/:id */
app.get("/admin/inspections/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const db = await getDb();
    const or: any[] = [{ _id: id }];
    if (ObjectId.isValid(id)) or.unshift({ _id: new ObjectId(id) });
    const doc = await db.collection(INSPECTIONS_COLL).findOne({ $or: or, source: "SHIPMENT" });
    if (!doc) return res.status(404).json({ ok: false, error: "not found" });
    res.json(doc);
  } catch (e) {
    console.error("[shipment-svc] GET /admin/inspections/:id error", e);
    res.status(500).json({ ok: false, error: "error" });
  }
});

/** PATCH /admin/inspections/:id/status  Body: { status, notes? } */
app.patch("/admin/inspections/:id/status", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const next = String(req.body?.status || "").toUpperCase() as InspectionStatus;
    const valid: InspectionStatus[] = ["IN_INSPECTION", "PASSED", "FAILED", "CLOSED"];
    if (!valid.includes(next)) {
      return res.status(400).json({ ok: false, error: "invalid status" });
    }

    const set: any = { status: next, updatedAt: new Date() };
    if (req.body?.notes) set.notes = String(req.body.notes);
    if (next === "CLOSED") set.closedAt = new Date();

    const db = await getDb();
    const coll = db.collection(INSPECTIONS_COLL);
    const or: any[] = [{ _id: id }];
    if (ObjectId.isValid(id)) or.unshift({ _id: new ObjectId(id) });
    const filter = { $or: or, source: "SHIPMENT" };

    const r = await coll.updateOne(filter, { $set: set });
    if (r.matchedCount === 0) return res.status(404).json({ ok: false, error: "not found" });

    const doc = await coll.findOne(filter);

    // reflejar en delivery si corresponde
    if (doc?.deliveryId && (next === "CLOSED")) {
      const dFilter: any = {
        $or: [{ _id: doc.deliveryId }, ...(ObjectId.isValid(doc.deliveryId) ? [{ _id: new ObjectId(doc.deliveryId) }] : [])],
      };
      await db.collection(DELIVERIES_COLL).updateOne(dFilter, { $set: { status: "CLOSED" } });
    }

    return res.json({ ok: true, id: (doc as any)?._id ? String((doc as any)._id) : id, status: next });
  } catch (e) {
    console.error("[shipment-svc] PATCH /admin/inspections/:id/status error", e);
    return res.status(500).json({ ok: false, error: "error" });
  }
});

/* ======================= PROXY: quotes (evitar CORS en frontend) ======================= */
/** Proxy por ObjectId */
app.get("/proxy/quotes/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "");
    if (!id) return res.status(400).json({ ok: false, error: "missing id" });

    const url = `${QUOTE_BASE}/quotes/${encodeURIComponent(id)}`;
    const data = await fetchJson(url);
    return res.json(data);
  } catch (e: any) {
    console.error("[shipment-svc] /proxy/quotes/:id error", e?.message || e);
    return res.status(502).json({ ok: false, error: "upstream quotes error" });
  }
});

/** Proxy por ID externo */
app.get("/proxy/quotes/by-ext/:ext", async (req, res) => {
  try {
    const ext = String(req.params.ext || "");
    if (!ext) return res.status(400).json({ ok: false, error: "missing ext" });

    const url = `${QUOTE_BASE}/quotes/by-ext/${encodeURIComponent(ext)}`;
    const data = await fetchJson(url);
    return res.json(data);
  } catch (e: any) {
    console.error("[shipment-svc] /proxy/quotes/by-ext/:ext error", e?.message || e);
    return res.status(502).json({ ok: false, error: "upstream quotes error" });
  }
});

/** Obtener la cotización asociada a una inspección (por id de inspección) */
app.get("/admin/inspections/:id/quote", async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const id = String(req.params.id);

    const or: any[] = [{ _id: id }];
    if (ObjectId.isValid(id)) or.unshift({ _id: new ObjectId(id) });

    const insp = await db.collection(INSPECTIONS_COLL).findOne({ $or: or, source: "SHIPMENT" });
    if (!insp) return res.status(404).json({ ok: false, error: "inspection not found" });

    const quoteId = (insp as any).quoteId;
    const quoteIdExt = (insp as any).quoteIdExt;

    let data: any = null;
    if (quoteId) {
      try {
        data = await fetchJson(`${QUOTE_BASE}/quotes/${encodeURIComponent(String(quoteId))}`);
      } catch { /* fallback ext */ }
    }
    if (!data && quoteIdExt) {
      data = await fetchJson(`${QUOTE_BASE}/quotes/by-ext/${encodeURIComponent(String(quoteIdExt))}`);
    }

    if (!data) return res.status(404).json({ ok: false, error: "quote not found" });
    return res.json(data);
  } catch (e: any) {
    console.error("[shipment-svc] GET /admin/inspections/:id/quote error", e?.message || e);
    return res.status(500).json({ ok: false, error: "error" });
  }
});

/* ======================= Serve ======================= */
const PORT = process.env.PORT || 3031;
app.listen(PORT, () => console.log("shipment-svc on :" + PORT));
