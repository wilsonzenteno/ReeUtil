import "dotenv/config";
import express from "express";
import { getDb } from "./db";

const app = express();
app.use(express.json());

/* -------------------------- Healthcheck -------------------------- */
app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "payout-svc", time: new Date().toISOString() });
});

/* ----------------------------- Routes ---------------------------- */
// POST /payouts  { quote_id_ext, method, amount }
app.post("/payouts", async (req, res) => {
  try {
    const { quote_id_ext, method, amount } = req.body || {};
    if (!quote_id_ext || !method || typeof amount !== "number") {
      return res.status(400).send("quote_id_ext, method and numeric amount required");
    }

    const db = await getDb();
    const r = await db.collection("payouts").insertOne({
      quoteIdExt: String(quote_id_ext),
      method,
      amount,
      status: "INITIATED",
      createdAt: new Date(),
    });

    res.json({ id: String(r.insertedId) });
  } catch (err) {
    console.error(err);
    res.status(500).send("error");
  }
});

/* ----------------------------- Serve ---------------------------- */
const PORT = process.env.PORT || 3051;
app.listen(PORT, () => console.log("payout-svc on :" + PORT));
