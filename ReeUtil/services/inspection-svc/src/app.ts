// services/inspection-svc/src/app.ts
import "dotenv/config";
import express from "express";
import { getDb } from "./db";
import { ObjectId } from "mongodb";

const app = express();
app.use(express.json());

/* Bases para llamar a otros servicios */
const QUOTE_BASE = process.env.QUOTE_BASE ?? "http://localhost:3021";
const NOTIFY_BASE = process.env.NOTIFY_BASE ?? "http://localhost:3061";

/* Helper fetch con timeout */
async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    if (!r.ok) throw new Error(`${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
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
 * A) { quote_id: string, model_id_ext?: string, answers?: object }
 * B) { quote_id_ext: string, findings?: object, photos?: string[], suggested_price?: number, decision?: "PENDING"|"APPROVED"|"REJECTED"|"NEEDS_INFO" }
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

    const answers =
      b.answers && typeof b.answers === "object" ? b.answers : {};
    const findings =
      b.findings && typeof b.findings === "object" ? b.findings : {};

    const photos: string[] = Array.isArray(b.photos) ? b.photos : [];
    const suggestedPrice =
      typeof b.suggested_price === "number" ? b.suggested_price : null;

    const allowed = ["PENDING", "APPROVED", "REJECTED", "NEEDS_INFO"] as const;
    const decisionRaw =
      typeof b.decision === "string" ? b.decision.toUpperCase() : "PENDING";
    const status = (allowed as readonly string[]).includes(decisionRaw)
      ? (decisionRaw as (typeof allowed)[number])
      : "PENDING";

    const db = await getDb();
    const r = await db.collection("reports").insertOne({
      quoteId,        // formato A
      quoteIdExt,     // formato B
      modelIdExt,     // A
      answers,        // A
      findings,       // B
      photos,         // B
      suggestedPrice, // B
      status,         // estado
      inspectorId: "system",
      createdAt: new Date(),
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
 * body: { status: "PENDING"|"APPROVED"|"REJECTED"|"NEEDS_INFO" }
 * Efecto lateral: envía notificación al usuario dueño de la cotización si se conoce.
 */
app.put("/reports/:id/status", async (req, res) => {
  try {
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) return res.status(400).send("invalid id");

    const allowed = ["PENDING", "APPROVED", "REJECTED", "NEEDS_INFO"];
    const status = String(req.body?.status || "").toUpperCase();
    if (!allowed.includes(status)) {
      return res.status(400).send("invalid status");
    }

    const db = await getDb();

    // update
    const upd = await db.collection("reports").updateOne(
      { _id: new ObjectId(id) },
      { $set: { status } }
    );
    if (upd.matchedCount === 0) return res.status(404).send("not found");

    const doc = await db.collection("reports").findOne({ _id: new ObjectId(id) });
    if (!doc) return res.status(404).send("not found");

    // Notificar al usuario si podemos determinarlo
    try {
      let userSub: string | null = null;
      let quoteId: string | null = null;

      if (doc.quoteId) {
        quoteId = String(doc.quoteId);
        // Consulta quote-svc para obtener userId (sub)
        const q = await fetchJson(`${QUOTE_BASE}/quotes/${encodeURIComponent(quoteId)}`, { method: "GET" });
        if (q?.userId) userSub = String(q.userId);
      }

      if (userSub) {
        let title = "Actualización de tu cotización";
        let body = "";
        if (status === "APPROVED") body = "¡Tu cotización ha sido aprobada!";
        else if (status === "REJECTED") body = "Tu cotización fue rechazada.";
        else if (status === "NEEDS_INFO") body = "Necesitamos más información sobre tu dispositivo.";
        else body = "El estado de tu revisión ha sido actualizado.";

        const link = quoteId ? `/quotes/${quoteId}` : null;

        await fetchJson(`${NOTIFY_BASE}/inbox`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            user_sub: userSub,
            title,
            body,
            link,
          }),
        });
      }
    } catch (notifyErr) {
      console.warn("[inspection-svc] notify error (non-fatal)", notifyErr);
    }

    res.json({ ok: true, id, status: doc.status });
  } catch (err) {
    console.error("[inspection-svc] PUT /reports/:id/status error", err);
    res.status(500).send("error");
  }
});

/* ----------------------------- Serve ---------------------------- */
const PORT = process.env.PORT || 3041;
app.listen(PORT, () => console.log("inspection-svc on :" + PORT));
