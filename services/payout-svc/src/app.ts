import "dotenv/config";
import express from "express";
import cors, { CorsOptions } from "cors";
import { getDb } from "./db";

const app = express();

/**
 * CORS:
 * - Por defecto: permite credenciales y cualquier origen (origin: true).
 * - Para restringir: ALLOWED_ORIGINS="http://localhost:5173,http://localhost:3000"
 */
const allowed = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const corsOptions: CorsOptions = allowed.length
  ? {
      origin: (origin, cb) => {
        if (!origin || allowed.includes(origin)) return cb(null, true);
        return cb(new Error("Not allowed by CORS"));
      },
      credentials: true,
    }
  : { origin: true, credentials: true };

app.use(cors(corsOptions));
app.use(express.json());

/* -------------------------- Healthcheck -------------------------- */
app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "payout-svc", time: new Date().toISOString() });
});

/* ----------------------------- Routes ---------------------------- */
// POST /payouts  { quote_id_ext, method, amount }
// - method: "Transferencia" | "Depósito"
// - amount: number > 0 (BOB)
app.post("/payouts", async (req, res) => {
  try {
    const { quote_id_ext, method, amount } = req.body || {};

    if (!quote_id_ext || !method || typeof amount !== "number" || !(amount > 0)) {
      return res.status(400).send("quote_id_ext, method and positive numeric amount required");
    }
    if (!["Transferencia", "Depósito"].includes(String(method))) {
      return res.status(400).send("method must be 'Transferencia' or 'Depósito'");
    }

    const db = await getDb();
    const r = await db.collection("payouts").insertOne({
      quoteIdExt: String(quote_id_ext),
      method: String(method),
      amount: Number(amount),
      currency: "BOB",     // moneda fija en BOB
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
const PORT = Number(process.env.PORT || 3051);
app.listen(PORT, () => console.log("payout-svc on :" + PORT));
