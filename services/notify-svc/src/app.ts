// services/notify-svc/src/app.ts
import "dotenv/config";
import express from "express";
import { ObjectId } from "mongodb";
import { getDb } from "./db";
import * as http from "node:http";
import * as https from "node:https";

/* -------------------------- App / ENV -------------------------- */
const app = express();
app.use(express.json());

const SHIPMENT_BASE = (process.env.SHIPMENT_BASE || "http://localhost:3031").replace(/\/+$/, "");
const FRONTEND_ORIGIN = (process.env.FRONTEND_ORIGIN || "http://localhost:5173").trim();

/* -------------------------- CORS (con preflight) -------------------------- */
app.use((req, res, next) => {
  const origin = req.headers.origin || "";
  const allowThisOrigin = FRONTEND_ORIGIN === "*" || origin === FRONTEND_ORIGIN;

  if (allowThisOrigin) {
    // Si usas credentials en el fetch del front, NO puedes usar "*"
    res.setHeader("Access-Control-Allow-Origin", origin as string);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, X-Requested-With, x-user-sub"
    );
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Max-Age", "600");
  }

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});

/* -------------------------- Helpers -------------------------- */
function isValidObjectId(s: string) {
  return /^[0-9a-fA-F]{24}$/.test(String(s || ""));
}

function requiredStr(v: any): string {
  if (typeof v !== "string") return "";
  return v.trim();
}

function parseDateOrNow(v: any): Date {
  if (typeof v === "string" && v.trim()) {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
}

/** POST JSON con fetch (si existe) y fallback http/https */
async function postJson(urlStr: string, body: any): Promise<{ ok: boolean; status?: number }> {
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
    console.warn("[notify-svc] fetch POST failed:", e);
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
          resolve({ ok: (res.statusCode || 500) >= 200 && (res.statusCode || 500) < 300, status: res.statusCode });
        }
      );
      req.on("error", (err) => {
        console.warn("[notify-svc] http/https POST error:", err);
        resolve({ ok: false });
      });
      req.write(data);
      req.end();
    } catch (err) {
      console.warn("[notify-svc] http/https POST build error:", err);
      resolve({ ok: false });
    }
  });
}

/* -------------------------- Healthcheck -------------------------- */
app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "notify-svc", time: new Date().toISOString() });
});

/* -------------------------- Auth mínima -------------------------- */
/** Requiere que el Gateway envíe x-user-sub (ya lo hace al estar autenticado) */
function requireUserSub(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const sub = req.header("x-user-sub") || "";
  if (!sub) return res.status(401).send("unauthorized");
  (req as any).userSub = sub;
  next();
}

/* ----------------------------- EMAIL (demo) ---------------------------- */
// POST /send-email  { to, subject, body }
app.post("/send-email", async (req, res) => {
  try {
    const { to, subject, body } = req.body || {};
    if (!to || !subject || !body) {
      return res.status(400).send("to, subject and body are required");
    }

    const db = await getDb();
    const r = await db.collection("messages").insertOne({
      kind: "email",
      to,
      subject,
      body,
      status: "SENT",
      createdAt: new Date(),
    });

    res.json({ id: String(r.insertedId) });
  } catch (err) {
    console.error(err);
    res.status(500).send("error");
  }
});

/* ----------------------------- INBOX (campanita) ---------------------------- */
/**
 * GET /inbox?unread=1
 * Header requerido: x-user-sub
 * Normaliza ambos esquemas: {isRead} y {read}.
 */
app.get("/inbox", requireUserSub, async (req, res) => {
  try {
    const userSub = (req as any).userSub as string;
    const onlyUnread = String(req.query.unread || "") === "1";

    const db = await getDb();
    const raw = await db
      .collection("inbox")
      .find({ userSub })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    // Normaliza campos y aplica filtro unread si se pide
    const list = raw
      .map((x: any) => ({
        _id: String(x._id),
        userSub: x.userSub,
        title: x.title,
        body: x.body,
        meta: x.meta || (x.link ? { link: x.link } : {}),
        link: x.link || null, // legacy, por si lo usa otro UI
        isRead: !!(x.isRead ?? x.read),
        createdAt: x.createdAt,
      }))
      .filter((x: any) => (onlyUnread ? !x.isRead : true));

    res.json(list);
  } catch (err) {
    console.error("[notify-svc] GET /inbox error", err);
    res.status(500).send("error");
  }
});

/**
 * PATCH /inbox/:id/read
 * body: { read?: boolean } // default true
 * Header requerido: x-user-sub (sólo dueño puede marcar)
 * Actualiza ambos campos: isRead y read (compatibilidad).
 */
app.patch("/inbox/:id/read", requireUserSub, async (req, res) => {
  try {
    const userSub = (req as any).userSub as string;
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) return res.status(400).send("invalid id");

    const read = typeof req.body?.read === "boolean" ? !!req.body.read : true;

    const db = await getDb();
    const result = await db.collection("inbox").updateOne(
      { _id: new ObjectId(id), userSub },
      { $set: { isRead: read, read } }
    );

    if (result.matchedCount === 0) return res.status(404).send("not found");
    res.json({ ok: true, id, read });
  } catch (err) {
    console.error("[notify-svc] PATCH /inbox/:id/read error", err);
    res.status(500).send("error");
  }
});

/**
 * POST /send
 * body: { to_sub: string, title: string, body: string, meta?: any }
 * Inserta una notificación (formato nuevo con isRead/meta).
 */
app.post("/send", async (req, res) => {
  try {
    const { to_sub, title, body, meta } = req.body || {};
    if (!to_sub || !title || !body) {
      return res.status(400).send("to_sub, title and body are required");
    }
    const db = await getDb();
    const r = await db.collection("inbox").insertOne({
      userSub: String(to_sub),
      title: String(title),
      body: String(body),
      meta: meta && typeof meta === "object" ? meta : {},
      isRead: false,
      read: false, // compatibilidad
      createdAt: new Date(),
    });
    res.json({ ok: true, id: String(r.insertedId) });
  } catch (err) {
    console.error("[notify-svc] POST /send error", err);
    res.status(500).send("error");
  }
});

/**
 * POST /inbox (compatibilidad con código antiguo)
 * body: { user_sub: string, title: string, body: string, link?: string }
 */
app.post("/inbox", async (req, res) => {
  try {
    const { user_sub, title, body, link } = req.body || {};
    if (!user_sub || !title || !body) {
      return res.status(400).send("user_sub, title and body are required");
    }

    const db = await getDb();
    const r = await db.collection("inbox").insertOne({
      userSub: String(user_sub),
      title: String(title),
      body: String(body),
      link: link ? String(link) : null, // legacy
      meta: link ? { link: String(link) } : {},
      isRead: false,
      read: false, // compatibilidad
      createdAt: new Date(),
    });

    res.json({ ok: true, id: String(r.insertedId) });
  } catch (err) {
    console.error("[notify-svc] POST /inbox error", err);
    res.status(500).send("error");
  }
});

/* ------------------------- ENDPOINTS NUEVOS (admin/compat) ------------------------- */
/**
 * POST /admin/notify/inbox
 * Cuerpo esperado (compatible con tu front):
 * {
 *   userSub?: string|null, confirmationId?: string|null, quoteId?: string|null, quoteIdExt?: string|null,
 *   modelIdExt?: string|null, title: string, body: string,
 *   channel?: string, status?: "pending"|"sent"|"read", read?: boolean, createdAt?: string, meta?: any
 * }
 */
app.post("/admin/notify/inbox", async (req, res) => {
  try {
    const {
      userSub = null,
      confirmationId = null,
      quoteId = null,
      quoteIdExt = null,
      modelIdExt = null,
      title,
      body,
      channel = "inbox",
      status = "pending",
      read = false,
      createdAt,
      meta = {},
    } = req.body || {};

    if (!title || !body) return res.status(400).send("title and body are required");

    const db = await getDb();
    const r = await db.collection("inbox").insertOne({
      userSub: userSub ? String(userSub) : null,
      title: String(title),
      body: String(body),
      channel: String(channel),
      status: String(status),
      isRead: !!read,
      read: !!read, // compat
      meta: meta && typeof meta === "object"
        ? {
            ...meta,
            confirmationId: confirmationId || meta.confirmationId || null,
            quoteId: quoteId || meta.quoteId || null,
            quoteIdExt: quoteIdExt || meta.quoteIdExt || null,
            modelIdExt: modelIdExt || meta.modelIdExt || null,
            userSub: userSub || meta.userSub || null,
          }
        : {},
      createdAt: parseDateOrNow(createdAt),
    });

    res.json({ ok: true, id: String(r.insertedId) });
  } catch (err) {
    console.error("[notify-svc] POST /admin/notify/inbox error", err);
    res.status(500).send("error");
  }
});

/**
 * POST /notify/inbox
 * Mismo comportamiento que el admin (ruta pública de compatibilidad).
 */
app.post("/notify/inbox", async (req, res) => {
  try {
    const {
      userSub = null,
      confirmationId = null,
      quoteId = null,
      quoteIdExt = null,
      modelIdExt = null,
      title,
      body,
      channel = "inbox",
      status = "pending",
      read = false,
      createdAt,
      meta = {},
    } = req.body || {};

    if (!title || !body) return res.status(400).send("title and body are required");

    const db = await getDb();
    const r = await db.collection("inbox").insertOne({
      userSub: userSub ? String(userSub) : null,
      title: String(title),
      body: String(body),
      channel: String(channel),
      status: String(status),
      isRead: !!read,
      read: !!read,
      meta: meta && typeof meta === "object"
        ? {
            ...meta,
            confirmationId: confirmationId || meta.confirmationId || null,
            quoteId: quoteId || meta.quoteId || null,
            quoteIdExt: quoteIdExt || meta.quoteIdExt || null,
            modelIdExt: modelIdExt || meta.modelIdExt || null,
            userSub: userSub || meta.userSub || null,
          }
        : {},
      createdAt: parseDateOrNow(createdAt),
    });

    res.json({ ok: true, id: String(r.insertedId) });
  } catch (err) {
    console.error("[notify-svc] POST /notify/inbox error", err);
    res.status(500).send("error");
  }
});

/**
 * POST /admin/notify/shipment_confirmations
 * Cuerpo esperado (lo que envía tu front al crear vínculo):
 * {
 *   confirmationId: string,
 *   quoteId?: string|null,
 *   quoteIdExt?: string|null,
 *   userSub?: string|null,
 *   inboxRef?: { title?: string, createdAt?: string } // opcional, resumen
 * }
 * Guarda un documento de tipo LINK en shipment_confirmations para trazar la relación.
 */
app.post("/admin/notify/shipment_confirmations", async (req, res) => {
  try {
    const {
      confirmationId,
      quoteId = null,
      quoteIdExt = null,
      userSub = null,
      inboxRef = null,
    } = req.body || {};

    if (!confirmationId) return res.status(400).send("confirmationId is required");

    const db = await getDb();
    const doc = {
      kind: "LINK",
      confirmationId: String(confirmationId),
      quoteId: quoteId ? String(quoteId) : null,
      quoteIdExt: quoteIdExt ? String(quoteIdExt) : null,
      userSub: userSub ? String(userSub) : null,
      inboxRef: inboxRef && typeof inboxRef === "object"
        ? { title: String(inboxRef.title || ""), createdAt: parseDateOrNow(inboxRef.createdAt) }
        : null,
      status: "LINKED",
      createdAt: new Date(),
      processedAt: null,
    };

    const r = await db.collection("shipment_confirmations").insertOne(doc);
    res.json({ ok: true, id: String(r.insertedId) });
  } catch (err) {
    console.error("[notify-svc] POST /admin/notify/shipment_confirmations error", err);
    res.status(500).send("error");
  }
});

/**
 * POST /notify/shipment_confirmations
 * Misma semántica que la admin (compatibilidad).
 */
app.post("/notify/shipment_confirmations", async (req, res) => {
  try {
    const {
      confirmationId,
      quoteId = null,
      quoteIdExt = null,
      userSub = null,
      inboxRef = null,
    } = req.body || {};

    if (!confirmationId) return res.status(400).send("confirmationId is required");

    const db = await getDb();
    const doc = {
      kind: "LINK",
      confirmationId: String(confirmationId),
      quoteId: quoteId ? String(quoteId) : null,
      quoteIdExt: quoteIdExt ? String(quoteIdExt) : null,
      userSub: userSub ? String(userSub) : null,
      inboxRef: inboxRef && typeof inboxRef === "object"
        ? { title: String(inboxRef.title || ""), createdAt: parseDateOrNow(inboxRef.createdAt) }
        : null,
      status: "LINKED",
      createdAt: new Date(),
      processedAt: null,
    };

    const r = await db.collection("shipment_confirmations").insertOne(doc);
    res.json({ ok: true, id: String(r.insertedId) });
  } catch (err) {
    console.error("[notify-svc] POST /notify/shipment_confirmations error", err);
    res.status(500).send("error");
  }
});

/* ----------------------------- ACK de notificaciones ---------------------------- */
/**
 * POST /inbox/:id/ack
 * Header: x-user-sub  (dueño del inbox)
 * body: {
 *   accept?: boolean,              // default true
 *   shipping?: { ... }             // requerido si action.key === 'approve_shipment' y accept === true
 * }
 * Efectos:
 *  - Marca la notificación como leída.
 *  - Si es approve_shipment + accept === true → guarda confirmación en shipment_confirmations
 *    en ESTE servicio (compatibilidad) **y además** la REPLICA en shipment-svc,
 *    para que el admin la vea y al "procesarla" se notifique al usuario.
 */
app.post("/inbox/:id/ack", requireUserSub, async (req, res) => {
  try {
    const userSub = (req as any).userSub as string;
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) return res.status(400).send("invalid id");

    const accept = req.body?.accept === undefined ? true : !!req.body.accept;
    const shipping = req.body?.shipping && typeof req.body.shipping === "object" ? req.body.shipping : null;

    const db = await getDb();
    const inbox = await db.collection("inbox").findOne({ _id: new ObjectId(id), userSub });
    if (!inbox) return res.status(404).send("not found");

    const meta = inbox.meta || {};
    const actionKey = meta?.action?.key || null;

    // 1) marcar como leído
    await db.collection("inbox").updateOne(
      { _id: new ObjectId(id), userSub },
      { $set: { isRead: true, read: true } }
    );

    // 2) si es approve_shipment y aceptó, validar y guardar confirmación
    if (accept && actionKey === "approve_shipment") {
      const required = ["fullName", "addressLine1", "city"];
      for (const k of required) {
        if (!shipping?.[k]) {
          return res.status(400).send(`shipping.${k} required`);
        }
      }

      const doc = {
        inboxId: String(inbox._id),
        userSub,
        quoteId: meta?.quoteId || null,
        reportId: meta?.reportId || null,
        modelIdExt: meta?.modelIdExt || null,
        quoteIdExt: meta?.quoteIdExt || null, // por si viene externo
        address: { // compat (además guardamos shipping abajo)
          fullName: String(shipping.fullName),
          addressLine1: String(shipping.addressLine1),
          addressLine2: shipping.addressLine2 ? String(shipping.addressLine2) : "",
          city: String(shipping.city),
          state: shipping.state ? String(shipping.state) : "",
          postalCode: shipping.postalCode ? String(shipping.postalCode) : "",
          phone: shipping.phone ? String(shipping.phone) : "",
          notes: shipping.notes ? String(shipping.notes) : "",
        },
        shipping: {  // esquema nuevo
          fullName: String(shipping.fullName),
          addressLine1: String(shipping.addressLine1),
          addressLine2: shipping.addressLine2 ? String(shipping.addressLine2) : "",
          city: String(shipping.city),
          state: shipping.state ? String(shipping.state) : "",
          postalCode: shipping.postalCode ? String(shipping.postalCode) : "",
          phone: shipping.phone ? String(shipping.phone) : "",
          notes: shipping.notes ? String(shipping.notes) : "",
        },
        status: "PENDING",
        createdAt: new Date(),
        processedAt: null,
      };

      // Guardar en ESTA DB (compat para historiales/consultas previas)
      await db.collection("shipment_confirmations").insertOne(doc);

      // Replica hacia shipment-svc (para que el admin la vea allí y al "procesar" dispare la notificación)
      try {
        const payload = {
          inbox_id: doc.inboxId,
          user_sub: userSub,
          quote_id: doc.quoteId || null,
          quote_id_ext: doc.quoteIdExt || null,
          report_id: doc.reportId || null,
          model_id_ext: doc.modelIdExt || null,
          shipping: doc.shipping,
        };
        const r = await postJson(`${SHIPMENT_BASE}/confirmations`, payload);
        if (!r.ok) console.warn(`[notify-svc] mirror to shipment-svc failed (${r.status})`, payload);
        else console.log("[notify-svc] mirrored confirmation to shipment-svc OK");
      } catch (e) {
        console.warn("[notify-svc] mirror to shipment-svc error:", e);
      }

      return res.json({ ok: true, mirrored: true });
    }

    // 3) para cualquier otra acción (o decline), basta con el read
    return res.json({ ok: true, id });
  } catch (err) {
    console.error("[notify-svc] POST /inbox/:id/ack error", err);
    res.status(500).send("error");
  }
});

/* ----------------------------- Admin: Confirmaciones de envío ---------------------------- */
/**
 * GET /shipments/confirmations?search=&status=PENDING|PROCESSED
 * Lista (para admin): últimas 200
 */
app.get("/shipments/confirmations", async (req, res) => {
  try {
    const db = await getDb();
    const q: any = {};

    const status = String(req.query.status || "").toUpperCase();
    if (["PENDING", "PROCESSED"].includes(status)) q.status = status;

    const search = String(req.query.search || "").trim().toLowerCase();
    if (search) {
      q.$or = [
        { quoteId: { $regex: search, $options: "i" } },
        { userSub: { $regex: search, $options: "i" } },
        { "address.fullName": { $regex: search, $options: "i" } },
        { "address.city": { $regex: search, $options: "i" } },
        { modelIdExt: { $regex: search, $options: "i" } },
      ];
    }

    const list = await db
      .collection("shipment_confirmations")
      .find(q)
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();

    res.json(
      list.map((x: any) => ({
        _id: String(x._id),
        inboxId: x.inboxId || null,
        userSub: x.userSub,
        quoteId: x.quoteId || null,
        quoteIdExt: x.quoteIdExt || null,
        reportId: x.reportId || null,
        modelIdExt: x.modelIdExt || null,
        shipping: x.shipping || x.address,
        status: x.status,
        createdAt: x.createdAt,
        processedAt: x.processedAt,
      }))
    );
  } catch (err) {
    console.error("[notify-svc] GET /shipments/confirmations error", err);
    res.status(500).send("error");
  }
});

/* ----------------------------- Serve ---------------------------- */
const PORT = process.env.PORT || 3061;
app.listen(PORT, () => console.log("notify-svc on :" + PORT));
