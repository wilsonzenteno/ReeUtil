import "dotenv/config";
import express from "express";
import { getDb } from "./db";
import { randomUUID } from "node:crypto";

const app = express();
app.use(express.json());

/* -------------------------- Healthcheck -------------------------- */
app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "shipment-svc", time: new Date().toISOString() });
});

/* ----------------------------- Routes ---------------------------- */
// POST /kits  { quote_id_ext }
app.post("/kits", async (req, res) => {
  try {
    const { quote_id_ext } = req.body || {};
    if (!quote_id_ext) return res.status(400).send("quote_id_ext required");

    const db = await getDb();
    const tracking = "TRK-" + randomUUID().slice(0, 8);

    const r = await db.collection("kits").insertOne({
      quoteIdExt: String(quote_id_ext),
      carrier: "DemoCarrier",
      trackingCode: tracking,
      labelUrl: "https://label.example/" + tracking,
      status: "CREATED",
      createdAt: new Date(),
    });

    res.json({ id: String(r.insertedId), trackingCode: tracking });
  } catch (err) {
    console.error(err);
    res.status(500).send("error");
  }
});

/* ----------------------------- Serve ---------------------------- */
const PORT = process.env.PORT || 3031;
app.listen(PORT, () => console.log("shipment-svc on :" + PORT));
