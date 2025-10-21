// services/inspection-svc/src/app.ts
import "dotenv/config";
import express from "express";
import { getDb } from "./db";
import { ObjectId } from "mongodb";

const app = express();
app.use(express.json());

/* Bases de otros servicios */
const QUOTE_BASE = process.env.QUOTE_BASE ?? "http://localhost:3021";
const NOTIFY_BASE = process.env.NOTIFY_BASE ?? "http://localhost:3061";

/* Lista de admins (subs) para notificar confirmaciones de envío) */
const ADMIN_SUBS: string[] = String(process.env.ADMIN_SUBS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/* ---------------- utils ---------------- */
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
  if (!r.ok) throw new Error(String(r.status));
  return await r.json();
}

function requireUserSub(req: express.Request, res: express.Response, next: express.NextFunction) {
  const sub = String(req.header("x-user-sub") || "");
  if (!sub) return res.status(401).send("unauthorized");
  (req as any).userSub = sub;
  next();
}

function summarizeAddress(sh: any) {
  if (!sh || typeof sh !== "object") return "(sin dirección)";
  const parts = [
    sh.fullName,
    sh.phone,
    sh.addressLine1,
    sh.addressLine2,
    [sh.city, sh.state, sh.zip].filter(Boolean).join(", "),
    sh.country,
  ]
    .filter(Boolean)
    .map(String);
  return parts.join("\n");
}

/* -------------------------- Healthcheck -------------------------- */
app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    service: "inspection-svc",
    time: new Date().toISOString(),
  });
});

/* ----------------------------- Create report ---------------------------- */
/**
 * POST /reports
 *
 * Acepta dos formatos:
 * A) { quote_id: string, model_id_ext?: string, answers?: object }
 * B) {
 *      quote_id_ext: string,
 *      findings?: object,
 *      photos?: string[],
 *      suggested_price?: number,
 *      decision?: "PENDING" | "APPROVED" | "REJECTED" | "NEEDS_INFO"
 *    }
 * Además, lee "x-user-sub" desde el Gateway para asociar el reporte al usuario solicitante.
 */
app.post("/reports", async (req, res) => {
  try {
    const b = req.body || {};

    const hasA = typeof b.quote_id === "string";
    const hasB = typeof b.quote_id_ext === "string";
    if (!hasA && !hasB) {
      return res.status(400).send("quote_id or quote_id_ext required");
    }

    const quoteId: string | null = hasA ? String(b.quote_id) : null;
    const quoteIdExt: string | null = hasB ? String(b.quote_id_ext) : null;

    const modelIdExt: string | null =
      typeof b.model_id_ext === "string" ? b.model_id_ext : null;

    const answers = b.answers && typeof b.answers === "object" ? b.answers : {};
    const findings = b.findings && typeof b.findings === "object" ? b.findings : {};

    const photos: string[] = Array.isArray(b.photos) ? b.photos : [];
    const suggestedPrice =
      typeof b.suggested_price === "number" ? b.suggested_price : null;

    const allowed = ["PENDING", "APPROVED", "REJECTED", "NEEDS_INFO"] as const;
    const decisionRaw =
      typeof b.decision === "string" ? b.decision.toUpperCase() : "PENDING";
    const status = (allowed as readonly string[]).includes(decisionRaw)
      ? (decisionRaw as (typeof allowed)[number])
      : "PENDING";

    const requesterSub = String(req.header("x-user-sub") || "");

    const db = await getDb();
    const r = await db.collection("reports").insertOne({
      quoteId,        // A
      quoteIdExt,     // B
      modelIdExt,     // A
      answers,        // A
      findings,       // B
      photos,         // B
      suggestedPrice, // B
      status,
      inspectorId: "system",
      requesterSub: requesterSub || null, // quién envió la revisión
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.json({ ok: true, id: String(r.insertedId) });
  } catch (err) {
    console.error("[inspection-svc] POST /reports error", err);
    res.status(500).send("error");
  }
});

/* ----------------------------- List reports ---------------------------- */
/**
 * GET /reports?status=PENDING|APPROVED|REJECTED|NEEDS_INFO&search=...
 * Devuelve últimos 200 por defecto (ordenados por fecha desc).
 */
app.get("/reports", async (req, res) => {
  try {
    const db = await getDb();
    const q: any = {};

    if (req.query.status) {
      const st = String(req.query.status).toUpperCase();
      if (["PENDING", "APPROVED", "REJECTED", "NEEDS_INFO"].includes(st)) {
        q.status = st;
      }
    }

    if (req.query.search) {
      const s = String(req.query.search).trim();
      if (s) {
        q.$or = [{ quoteId: s }, { quoteIdExt: s }, { modelIdExt: s }];
      }
    }

    const list = await db
      .collection("reports")
      .find(q)
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();

    res.json(list);
  } catch (err) {
    console.error("[inspection-svc] GET /reports error", err);
    res.status(500).send("error");
  }
});

/* ----------------------------- Update status ---------------------------- */
/**
 * PUT /reports/:id/status
 * body:
 * {
 *   status: "PENDING"|"APPROVED"|"REJECTED"|"NEEDS_INFO",
 *   reason?: string, // para REJECTED
 *   info?: {
 *     message?: string,
 *     fields?: Array<{ name: string; label?: string; hint?: string; type?: "text"|"number"|"boolean"|"photo"; required?: boolean }>,
 *     options?: Array<{ key: string; label: string; hint?: string }>
 *   }
 * }
 *
 * Efectos:
 *  - Actualiza el reporte (+ guarda reason / infoRequest si corresponde)
 *  - Sincroniza el estado en quote-svc si existe quoteId
 *  - Notifica al usuario (notify-svc /send) con mensajes personalizados y ACCIÓN (ack)
 */
app.put("/reports/:id/status", async (req, res) => {
  try {
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) return res.status(400).send("invalid id");

    const allowed = ["PENDING", "APPROVED", "REJECTED", "NEEDS_INFO"] as const;
    const status = String(req.body?.status || "").toUpperCase();
    if (!allowed.includes(status as any)) {
      return res.status(400).send("invalid status");
    }

    // Extras
    const reason: string =
      typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    const info = (req.body?.info && typeof req.body.info === "object") ? req.body.info : null;
    const infoMessage: string = info?.message && typeof info.message === "string" ? info.message.trim() : "";
    const infoFields: any[] = Array.isArray(info?.fields) ? info!.fields : [];
    const infoOptions: any[] = Array.isArray(info?.options) ? info!.options : [];

    const db = await getDb();

    // 1) update del reporte (+ datos extra)
    const setDoc: any = { status, updatedAt: new Date() };
    if (status === "REJECTED" && reason) setDoc.rejectReason = reason;
    if (status === "NEEDS_INFO") {
      setDoc.infoRequest = {
        message: infoMessage || "Necesitamos más información para continuar.",
        fields: infoFields,
        options: infoOptions,
      };
    }

    const upd = await db.collection("reports").updateOne(
      { _id: new ObjectId(id) },
      { $set: setDoc }
    );
    if (upd.matchedCount === 0) return res.status(404).send("not found");

    // 2) leer actualizado
    const doc = await db.collection("reports").findOne({ _id: new ObjectId(id) });
    if (!doc) return res.status(404).send("not found");

    // 3) sincronizar estado con quote-svc si hay quoteId
    if (doc.quoteId) {
      try {
        await fetchWithTimeout(
          `${QUOTE_BASE}/admin/quotes/${encodeURIComponent(String(doc.quoteId))}/status`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ status }),
            timeoutMs: 7000,
          }
        );
      } catch (err) {
        console.warn("[inspection-svc] failed to sync quote status", err);
      }
    }

    // 4) notificar (best-effort) - mensajes con acción (ack)
    try {
      // Determinar destinatario
      let userSub: string | null = doc.requesterSub || null;

      // Fallback: buscar dueño de la cotización en quote-svc si hace falta
      if (!userSub && doc.quoteId) {
        try {
          const q = await fetchJson(
            `${QUOTE_BASE}/quotes/${encodeURIComponent(String(doc.quoteId))}`,
            { method: "GET" },
            7000
          );
          if (q?.userId) userSub = String(q.userId);
        } catch {
          // si falla, no bloquea el flujo
        }
      }

      if (userSub) {
        let title = "Estado de tu cotización";
        let body = "";
        const baseMeta: any = {
          reportId: String(doc._id),
          quoteId: doc.quoteId || null,
          quoteIdExt: doc.quoteIdExt || null,
          modelIdExt: doc.modelIdExt || null,
          newStatus: status,
          actionRequired: false,
          action: null,
        };

        switch (status) {
          case "APPROVED": {
            title = "📦 Cotización aprobada — confirma el envío del kit";
            body =
              "Tu cotización fue aprobada.\n\n" +
              "Para continuar, **confirma que deseas recibir la caja de envío** donde deberás introducir el dispositivo. " +
              "Te enviaremos instrucciones y el número de seguimiento una vez confirmes.";
            baseMeta.nextStep = "SHIPMENT_KIT";
            baseMeta.actionRequired = true;
            baseMeta.action = {
              key: "approve_shipment",
              label: "Aceptar envío del kit",
              type: "ACK",
              onAccept: { createShipmentKit: true },
            };
            break;
          }
          case "REJECTED": {
            title = "❌ Cotización rechazada";
            body =
              (reason ? `Motivo: ${reason}\n\n` : "") +
              "Puedes crear una nueva cotización o contactarnos para revisar tu caso.";
            baseMeta.rejectReason = reason || null;
            baseMeta.actionRequired = true;
            baseMeta.action = {
              key: "reject_ack",
              label: "Entendido",
              type: "ACK",
            };
            break;
          }
          case "NEEDS_INFO": {
            title = "ℹ️ Necesitamos más información";
            const msg = infoMessage || "Para continuar, necesitamos que nos envíes más detalles del dispositivo.";
            body = msg;

            // Resumen textual de campos/opciones
            const lines: string[] = [];
            if (Array.isArray(infoFields) && infoFields.length) {
              lines.push("\nCampos solicitados:");
              for (const f of infoFields) {
                const lbl = f?.label || f?.name || "Campo";
                const hint = f?.hint ? ` — ${f.hint}` : "";
                lines.push(`• ${lbl}${hint}`);
              }
            }
            if (Array.isArray(infoOptions) && infoOptions.length) {
              lines.push("\nOpciones:");
              for (const o of infoOptions) {
                const lbl = o?.label || o?.key || "Opción";
                const hint = o?.hint ? ` — ${o.hint}` : "";
                lines.push(`• ${lbl}${hint}`);
              }
            }
            if (lines.length) body += "\n" + lines.join("\n");

            baseMeta.infoRequest = {
              message: infoMessage || null,
              fields: infoFields,
              options: infoOptions,
            };
            baseMeta.actionRequired = true;
            baseMeta.action = {
              key: "needs_info_ack",
              label: "Entendido",
              type: "ACK",
            };
            break;
          }
          case "PENDING":
          default: {
            title = "⏳ Cotización en revisión";
            body = "Tu cotización quedó en estado pendiente. Te avisaremos cuando haya una decisión.";
            break;
          }
        }

        try {
          await fetchWithTimeout(`${NOTIFY_BASE}/send`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              to_sub: userSub,
              title,
              body,
              meta: baseMeta,
            }),
            timeoutMs: 7000,
          });
        } catch (err) {
          console.warn("[inspection-svc] notify /send failed (best-effort)", err);
        }
      }
    } catch (notifyErr) {
      console.warn("[inspection-svc] notify logic error (non-fatal)", notifyErr);
    }

    res.json({ ok: true, id, status });
  } catch (err) {
    console.error("[inspection-svc] PUT /reports/:id/status error", err);
    res.status(500).send("error");
  }
});

/* ------------------- Confirmación de envío por el usuario ------------------- */
/**
 * POST /reports/confirm-shipment
 * Header: x-user-sub (inyectado por Gateway con requireAuth)
 * body: {
 *   quote_id: string,
 *   shipping: {
 *     fullName: string, phone?: string,
 *     addressLine1: string, addressLine2?: string,
 *     city: string, state?: string, zip?: string, country: string
 *   }
 * }
 *
 * Efectos:
 *  - Guarda la confirmación + datos de envío en el último reporte del quote
 *  - Notifica al usuario (recibido) y a los administradores con el detalle
 */
app.post("/reports/confirm-shipment", requireUserSub, async (req, res) => {
  try {
    const userSub = (req as any).userSub as string;
    const { quote_id, shipping } = req.body || {};
    if (!quote_id || !shipping || typeof shipping !== "object") {
      return res.status(400).send("quote_id and shipping are required");
    }

    const db = await getDb();

    // Buscar último reporte del quote
    let report = await db
      .collection("reports")
      .find({ quoteId: String(quote_id) })
      .sort({ createdAt: -1 })
      .limit(1)
      .next();

    // Si no existe, creamos uno mínimo para registrar la confirmación
    if (!report) {
      const r = await db.collection("reports").insertOne({
        quoteId: String(quote_id),
        status: "APPROVED",
        inspectorId: "system",
        requesterSub: userSub,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      report = await db.collection("reports").findOne({ _id: r.insertedId });
    }

    // Guardar confirmación
    await db.collection("reports").updateOne(
      { _id: report!._id },
      {
        $set: {
          shipmentConfirmation: {
            ...shipping,
            confirmedAt: new Date(),
            userSub,
          },
          updatedAt: new Date(),
        },
      }
    );

    const reportId = String(report!._id);

    // 1) Notificar al usuario: recibido
    try {
      await fetchWithTimeout(`${NOTIFY_BASE}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          to_sub: userSub,
          title: "✅ Confirmación recibida",
          body:
            "Gracias. Recibimos tu confirmación para el envío del kit.\n" +
            "Pronto te compartiremos el número de seguimiento.",
          meta: {
            reportId,
            quoteId: String(quote_id),
            newStatus: "APPROVED",
            ackOf: "approve_shipment",
            shipping,
          },
        }),
        timeoutMs: 7000,
      });
    } catch (err) {
      console.warn("[inspection-svc] notify user confirm failed", err);
    }

    // 2) Notificar a administradores: detalle de envío
    const adminBody =
      "El usuario confirmó el envío del kit para la cotización.\n\n" +
      "**Quote ID:** " +
      String(quote_id) +
      "\n**Report ID:** " +
      reportId +
      "\n\n**Datos de envío:**\n" +
      summarizeAddress(shipping);

    for (const adminSub of ADMIN_SUBS) {
      try {
        await fetchWithTimeout(`${NOTIFY_BASE}/send`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            to_sub: adminSub,
            title: "🟢 Usuario confirmó envío de kit",
            body: adminBody,
            meta: {
              reportId,
              quoteId: String(quote_id),
              shipping,
              event: "USER_CONFIRMED_SHIPMENT",
            },
          }),
          timeoutMs: 7000,
        });
      } catch (err) {
        console.warn("[inspection-svc] notify admin confirm failed", err);
      }
    }

    res.json({ ok: true, reportId });
  } catch (err) {
    console.error("[inspection-svc] POST /reports/confirm-shipment error", err);
    res.status(500).send("error");
  }
});

/* ------------------ NUEVO: Listado de confirmaciones de envío --------------- */
/**
 * GET /shipments?search=&limit=200
 * Devuelve reportes que tienen shipmentConfirmation (usuario aceptó + dirección)
 */
app.get("/shipments", async (req, res) => {
  try {
    const db = await getDb();

    const limit = Math.max(
      1,
      Math.min(1000, Number(req.query.limit ?? 200) || 200)
    );
    const search = String(req.query.search || "").trim();

    const q: any = { "shipmentConfirmation.confirmedAt": { $exists: true } };

    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      q.$or = [
        { quoteId: search },
        { quoteIdExt: search },
        { requesterSub: search },
        { "shipmentConfirmation.fullName": rx },
        { "shipmentConfirmation.phone": rx },
        { "shipmentConfirmation.addressLine1": rx },
        { "shipmentConfirmation.addressLine2": rx },
        { "shipmentConfirmation.city": rx },
        { "shipmentConfirmation.state": rx },
        { "shipmentConfirmation.zip": rx },
        { "shipmentConfirmation.country": rx },
      ];
    }

    const list = await db
      .collection("reports")
      .find(q)
      .sort({ "shipmentConfirmation.confirmedAt": -1 })
      .limit(limit)
      .toArray();

    res.json(
      list.map((r) => ({
        _id: String(r._id),
        quoteId: r.quoteId ?? null,
        quoteIdExt: r.quoteIdExt ?? null,
        modelIdExt: r.modelIdExt ?? null,
        status: r.status ?? null,
        requesterSub: r.requesterSub ?? null,
        shipmentConfirmation: r.shipmentConfirmation ?? null,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }))
    );
  } catch (err) {
    console.error("[inspection-svc] GET /shipments error", err);
    res.status(500).send("error");
  }
});

/* ----------------------------- Serve ---------------------------- */
const PORT = process.env.PORT || 3041;
app.listen(PORT, () => console.log("inspection-svc on :" + PORT));
