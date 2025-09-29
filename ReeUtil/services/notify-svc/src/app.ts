import "dotenv/config";
import express from "express";
import { getDb } from "./db";
import { ObjectId } from "mongodb";

const app = express();
app.use(express.json());

/* -------------------------- Healthcheck -------------------------- */
app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "notify-svc", time: new Date().toISOString() });
});

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
 */
app.get("/inbox", async (req, res) => {
  try {
    const sub = String(req.header("x-user-sub") || "");
    if (!sub) return res.status(401).send("unauthorized");

    const onlyUnread = String(req.query.unread || "") === "1";

    const db = await getDb();
    const q: any = { userSub: sub };
    if (onlyUnread) q.read = { $ne: true };

    const list = await db
      .collection("inbox")
      .find(q)
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    res.json(
      list.map((x) => ({
        _id: String(x._id),
        title: x.title,
        body: x.body,
        link: x.link || null,
        read: !!x.read,
        createdAt: x.createdAt,
      }))
    );
  } catch (err) {
    console.error("[notify-svc] GET /inbox error", err);
    res.status(500).send("error");
  }
});

/**
 * POST /inbox
 * body: { user_sub: string, title: string, body: string, link?: string }
 * (lo usa inspection-svc u otros servicios para generar notificaciones)
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
      link: link ? String(link) : null,
      read: false,
      createdAt: new Date(),
    });

    res.json({ id: String(r.insertedId) });
  } catch (err) {
    console.error("[notify-svc] POST /inbox error", err);
    res.status(500).send("error");
  }
});

/**
 * PATCH /inbox/:id/read { read: boolean }
 * Header requerido: x-user-sub (solo dueño puede marcar)
 */
app.patch("/inbox/:id/read", async (req, res) => {
  try {
    const sub = String(req.header("x-user-sub") || "");
    if (!sub) return res.status(401).send("unauthorized");

    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) return res.status(400).send("invalid id");

    const read = !!req.body?.read;

    const db = await getDb();
    const result = await db.collection("inbox").updateOne(
      { _id: new ObjectId(id), userSub: sub },
      { $set: { read } }
    );

    if (result.matchedCount === 0) return res.status(404).send("not found");
    res.json({ ok: true, id, read });
  } catch (err) {
    console.error("[notify-svc] PATCH /inbox/:id/read error", err);
    res.status(500).send("error");
  }
});

/* ----------------------------- Serve ---------------------------- */
const PORT = process.env.PORT || 3061;
app.listen(PORT, () => console.log("notify-svc on :" + PORT));
