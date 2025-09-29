import "dotenv/config";
import express from "express";
import { getDb } from "./db";
import jsonLogic from "json-logic-js";

const app = express();
app.use(express.json());

/* -------------------------- Healthcheck -------------------------- */
app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "quote-svc", time: new Date().toISOString() });
});

/* -------------------- Tipos y helpers de normalización -------------------- */
type LogicAdj = { if: any; then: number };
type NewRuleBody = {
  basePrice?: number;
  minPrice?: number;
  adjustments?: LogicAdj[];
};
type LegacyRuleBody = {
  basePrice?: number;
  minPrice?: number;
  adjustments?: {
    // ejemplos legacy:
    // pantalla: { intacta: 0, quebrada: -150 }
    // bateria_ok: { true: 0 }
    // almacenamiento_gb: { perUnit: 2 }
    [key: string]:
      | { [option: string]: number }
      | { perUnit?: number };
  };
};

function normalizeRule(raw: any): { version: number; body: NewRuleBody & { __perUnit?: Record<string, number> } } {
  const container = raw?.body ?? raw?.rule ?? raw ?? {};
  const version = Number(raw?.version ?? container?.version ?? 1);

  // Caso formato nuevo (ajustes ya en array json-logic)
  if (Array.isArray(container?.adjustments)) {
    return {
      version,
      body: {
        basePrice: Number(container.basePrice ?? 0),
        minPrice: Number(container.minPrice ?? 0),
        adjustments: container.adjustments as LogicAdj[],
      },
    };
  }

  // Caso legacy: convertir a json-logic y detectar perUnit
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
      // Añadimos una regla “neutra” para que exista el campo (luego aplicamos perUnit aparte)
      adjList.push({ if: { "var": key }, then: 0 });
    } else if (def && typeof def === "object") {
      for (const opt of Object.keys(def)) {
        const delta = Number(def[opt] ?? 0);
        const val = opt === "true" ? true : (opt === "false" ? false : opt);
        adjList.push({
          if: { "==": [ { "var": key }, val ] },
          then: delta,
        });
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

/* ----------------------------- Routes ---------------------------- */
/**
 * POST /price
 * body: { answers, registryRuleUrl }
 *
 * Registry puede devolver:
 *  - NUEVO:
 *    { version, body: { basePrice, minPrice?, adjustments?: [{if, then}] } }
 *  - LEGACY:
 *    { version?, rule: { basePrice?, minPrice?, adjustments: {...} } }
 *    o directamente { basePrice, ... }
 */
app.post("/price", async (req, res) => {
  try {
    const { answers, registryRuleUrl } = req.body || {};
    if (!registryRuleUrl) return res.status(400).send("registryRuleUrl required");

    const ruleRes = await fetch(registryRuleUrl);
    if (!ruleRes.ok) return res.status(502).send("Registry error");
    const rawRule = await ruleRes.json();

    if (!rawRule) return res.status(404).send("No active pricing rule (rule not found)");

    const norm = normalizeRule(rawRule);
    const body = norm.body;

    if (typeof body.basePrice !== "number") {
      return res.status(404).send("No active pricing rule (missing body/basePrice)");
    }

    let price = Number(body.basePrice ?? 0);

    // Ajustes json-logic
    const adjustments: LogicAdj[] = Array.isArray(body.adjustments) ? body.adjustments : [];
    for (const adj of adjustments) {
      try {
        if (jsonLogic.apply(adj.if, answers)) price += Number(adj.then ?? 0);
      } catch {
        // ignorar regla malformada
      }
    }

    // Ajustes por unidad (legacy)
    if (body.__perUnit && typeof body.__perUnit === "object") {
      for (const key of Object.keys(body.__perUnit)) {
        const per = Number(body.__perUnit[key] ?? 0);
        const val = Number(answers?.[key] ?? 0);
        if (!Number.isNaN(per) && !Number.isNaN(val)) {
          price += per * val;
        }
      }
    }

    const minPrice = Number(body.minPrice ?? 0);
    if (!Number.isNaN(minPrice)) price = Math.max(price, minPrice);

    res.json({
      prelimPrice: Math.max(0, Math.round(price)),
      ruleVersion: norm.version,
      ruleSnapshot: body,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("error");
  }
});

/**
 * POST /quotes
 * body: {
 *   user_id, model_id_ext, answers, prelim_price, rule_version, rule_snapshot
 * }
 */
app.post("/quotes", async (req, res) => {
  try {
    const db = await getDb();
    const doc = {
      userId: req.body?.user_id || "demo-user",
      modelIdExt: req.body?.model_id_ext || null,
      answers: req.body?.answers ?? {},
      prelimPrice: req.body?.prelim_price ?? null,
      ruleVersion: req.body?.rule_version ?? null,
      ruleSnapshot: req.body?.rule_snapshot ?? {},
      status: "PRELIM",
      createdAt: new Date(),
    };

    const r = await db.collection("quotes").insertOne(doc);
    res.json({ id: String(r.insertedId) });
  } catch (err) {
    console.error(err);
    res.status(500).send("error");
  }
});

/**
 * GET /quotes/:id
 */
app.get("/quotes/:id", async (req, res) => {
  try {
    const { ObjectId } = await import("mongodb");
    const db = await getDb();
    const doc = await db.collection("quotes").findOne({ _id: new ObjectId(req.params.id) });
    if (!doc) return res.status(404).send("Not found");
    res.json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).send("error");
  }
});

/* ----------------------------- Serve ---------------------------- */
const PORT = process.env.PORT || 3021;
app.listen(PORT, () => console.log("quote-svc on :" + PORT));
