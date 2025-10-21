import "dotenv/config";
import express from "express";
import { ObjectId } from "mongodb";
import { getDb } from "./db";

const app = express();
app.use(express.json());

/* -------------------------- Healthcheck -------------------------- */
app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "registry-svc", time: new Date().toISOString() });
});

/* -------------------------- Helpers -------------------------- */
function isObjectIdLike(s: string) {
  return /^[0-9a-fA-F]{24}$/.test(String(s || ""));
}

async function expandTypeKeys(db: any, typeIdParam: string): Promise<string[]> {
  const keys = new Set<string>();
  const val = String(typeIdParam || "").trim();
  if (!val) return [];
  keys.add(val);

  if (isObjectIdLike(val)) {
    const t = await db.collection("device_types").findOne({ _id: new ObjectId(val) });
    if (t) {
      if (t.code) keys.add(String(t.code));
      if (t.name) keys.add(String(t.name));
      if (t.id)   keys.add(String(t.id));
      keys.add(String(t._id));
    }
  }
  return Array.from(keys);
}

function modelLabel(m: any) {
  const label = m.name || [m.brand, m.model, m.year ? `(${m.year})` : ""].filter(Boolean).join(" ");
  return String(label || m.code || m.extId || m._id || "").trim();
}

/* =================================================================
 * DEVICE TYPES
 * ================================================================= */
app.get("/types", async (_req, res) => {
  try {
    const db = await getDb();
    const list = await db.collection("device_types").find({}).sort({ name: 1 }).toArray();
    res.json(list.map((t: any) => ({
      id: String(t._id),
      code: t.code ?? null,
      name: t.name ?? t.title ?? t.code ?? String(t._id),
    })));
  } catch (err) {
    console.error("[registry-svc] GET /types error", err);
    res.status(500).send("error");
  }
});

app.post("/types", async (req, res) => {
  try {
    const { code, name, title } = req.body || {};
    const db = await getDb();
    const r = await db.collection("device_types").insertOne({
      code: code ?? null,
      name: name ?? title ?? null,
      createdAt: new Date(),
    });
    res.json({ ok: true, id: String(r.insertedId) });
  } catch (err) {
    console.error("[registry-svc] POST /types error", err);
    res.status(500).send("error");
  }
});

/* =================================================================
 * DEVICE MODELS  (?typeId=... soporta id y code)
 * ================================================================= */
app.get("/models", async (req, res) => {
  try {
    const db = await getDb();
    const typeIdParam = String(req.query.typeId || "");
    const q: any = {};

    if (typeIdParam) {
      const keys = await expandTypeKeys(db, typeIdParam);
      q.$or = [{ typeId: { $in: keys } }, { type_id: { $in: keys } }, { typeCode: { $in: keys } }];
    }

    const list = await db.collection("device_models").find(q).sort({ brand: 1, model: 1, year: -1 }).toArray();

    res.json(list.map((m: any) => ({
      _id: String(m._id),
      typeId: m.typeId ?? m.type_id ?? null,
      typeCode: m.typeCode ?? null,
      brand: m.brand ?? "",
      model: m.model ?? "",
      year: m.year ?? null,
      code: m.code ?? null,
      extId: m.extId ?? m.model_id_ext ?? m.code ?? String(m._id),
      name: modelLabel(m),
      createdAt: m.createdAt,
    })));
  } catch (err) {
    console.error("[registry-svc] GET /models error", err);
    res.status(500).send("error");
  }
});

app.post("/models", async (req, res) => {
  try {
    const { typeId, typeCode, brand, model, year, code, extId, name } = req.body || {};
    if (!typeId && !typeCode) return res.status(400).send("typeId or typeCode required");

    const db = await getDb();
    const doc = {
      typeId: typeId ? String(typeId) : undefined,
      typeCode: typeCode ? String(typeCode) : undefined,
      brand: brand ?? "",
      model: model ?? "",
      year: typeof year === "number" ? year : null,
      code: code ?? null,
      extId: extId ?? null,
      name: name ?? null,
      createdAt: new Date(),
    };
    const r = await db.collection("device_models").insertOne(doc);
    res.json({ ok: true, id: String(r.insertedId) });
  } catch (err) {
    console.error("[registry-svc] POST /models error", err);
    res.status(500).send("error");
  }
});

/* =================================================================
 * RULES
 * ================================================================= */
app.get("/rules", async (req, res) => {
  try {
    const db = await getDb();
    const q: any = {};
    if (req.query.typeId) {
      const keys = await expandTypeKeys(db, String(req.query.typeId));
      q.$or = [{ typeId: { $in: keys } }, { typeCode: { $in: keys } }];
    }
    if (req.query.kind) q.kind = String(req.query.kind);

    const list = await db.collection("rules").find(q).sort({ createdAt: -1 }).toArray();
    res.json(list.map((r: any) => ({
      _id: String(r._id),
      typeId: r.typeId ?? null,
      typeCode: r.typeCode ?? null,
      kind: r.kind ?? "pricing",
      version: r.version ?? 1,
      isActive: !!r.isActive,
      body: r.body ?? r.rule ?? {},
      createdAt: r.createdAt,
    })));
  } catch (err) {
    console.error("[registry-svc] GET /rules error", err);
    res.status(500).send("error");
  }
});

app.post("/rules", async (req, res) => {
  try {
    const { typeId, typeCode, kind, version, isActive, body, rule } = req.body || {};
    if (!typeId && !typeCode) return res.status(400).send("typeId or typeCode required");

    const db = await getDb();
    const doc = {
      typeId: typeId ? String(typeId) : undefined,
      typeCode: typeCode ? String(typeCode) : undefined,
      kind: String(kind || "pricing"),
      version: typeof version === "number" ? version : 1,
      isActive: !!isActive,
      body: body ?? rule ?? {},
      createdAt: new Date(),
    };
    const r = await db.collection("rules").insertOne(doc);

    if (doc.isActive) {
      await db.collection("rules").updateMany(
        {
          kind: doc.kind,
          _id: { $ne: r.insertedId },
          $or: [doc.typeId ? { typeId: doc.typeId } : { typeCode: doc.typeCode }],
        },
        { $set: { isActive: false } }
      );
    }

    res.json({ ok: true, id: String(r.insertedId) });
  } catch (err) {
    console.error("[registry-svc] POST /rules error", err);
    res.status(500).send("error");
  }
});

app.get("/rules/active", async (req, res) => {
  try {
    const db = await getDb();
    const typeIdParam = String(req.query.typeId || "");
    const kind = String(req.query.kind || "pricing");
    if (!typeIdParam) return res.status(400).send("typeId required");

    const keys = await expandTypeKeys(db, typeIdParam);
    const or = [{ typeId: { $in: keys } }, { typeCode: { $in: keys } }];

    let doc =
      (await db.collection("rules").findOne({ kind, isActive: true, $or: or })) ||
      (await db.collection("rules").find({ kind, $or: or }).sort({ createdAt: -1 }).limit(1).next());

    if (!doc) return res.status(404).send("active rule not found");

    res.json({
      _id: String(doc._id),
      typeId: doc.typeId ?? null,
      typeCode: doc.typeCode ?? null,
      kind: doc.kind,
      version: doc.version ?? 1,
      body: doc.body ?? doc.rule ?? {},
      isActive: !!doc.isActive,
      createdAt: doc.createdAt,
    });
  } catch (err) {
    console.error("[registry-svc] GET /rules/active error", err);
    res.status(500).send("error");
  }
});

/* =================================================================
 * FORMS
 * ================================================================= */
app.get("/forms", async (req, res) => {
  try {
    const db = await getDb();
    const q: any = {};
    if (req.query.typeId) {
      const keys = await expandTypeKeys(db, String(req.query.typeId));
      q.$or = [{ typeId: { $in: keys } }, { typeCode: { $in: keys } }];
    }
    const list = await db.collection("forms").find(q).sort({ createdAt: -1 }).toArray();
    res.json(list.map((f: any) => ({
      _id: String(f._id),
      typeId: f.typeId ?? null,
      typeCode: f.typeCode ?? null,
      title: f.title ?? f.name ?? "Formulario",
      description: f.description ?? "",
      fields: Array.isArray(f.fields) ? f.fields : [],
      isActive: !!f.isActive,
      createdAt: f.createdAt,
    })));
  } catch (err) {
    console.error("[registry-svc] GET /forms error", err);
    res.status(500).send("error");
  }
});

app.post("/forms", async (req, res) => {
  try {
    const { typeId, typeCode, title, name, description, fields, isActive } = req.body || {};
    if (!typeId && !typeCode) return res.status(400).send("typeId or typeCode required");

    const db = await getDb();
    const doc = {
      typeId: typeId ? String(typeId) : undefined,
      typeCode: typeCode ? String(typeCode) : undefined,
      title: title ?? name ?? "Diagnóstico",
      description: description ?? "",
      fields: Array.isArray(fields) ? fields : [],
      isActive: !!isActive,
      createdAt: new Date(),
    };
    const r = await db.collection("forms").insertOne(doc);

    if (doc.isActive) {
      await db.collection("forms").updateMany(
        { _id: { $ne: r.insertedId }, $or: [doc.typeId ? { typeId: doc.typeId } : { typeCode: doc.typeCode }] },
        { $set: { isActive: false } }
      );
    }

    res.json({ ok: true, id: String(r.insertedId) });
  } catch (err) {
    console.error("[registry-svc] POST /forms error", err);
    res.status(500).send("error");
  }
});

app.put("/forms/:id/activate", async (req, res) => {
  try {
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) return res.status(400).send("invalid id");

    const db = await getDb();
    const doc = await db.collection("forms").findOne({ _id: new ObjectId(id) });
    if (!doc) return res.status(404).send("not found");

    await db.collection("forms").updateMany(
      { $or: [doc.typeId ? { typeId: doc.typeId } : { typeCode: doc.typeCode }] },
      { $set: { isActive: false } }
    );
    await db.collection("forms").updateOne({ _id: new ObjectId(id) }, { $set: { isActive: true } });

    res.json({ ok: true, id, typeId: doc.typeId ?? null, typeCode: doc.typeCode ?? null });
  } catch (err) {
    console.error("[registry-svc] PUT /forms/:id/activate error", err);
    res.status(500).send("error");
  }
});

app.get("/forms/active", async (req, res) => {
  try {
    const db = await getDb();
    const typeIdParam = String(req.query.typeId || "");
    if (!typeIdParam) return res.status(400).send("typeId required");

    const keys = await expandTypeKeys(db, typeIdParam);
    const or = [{ typeId: { $in: keys } }, { typeCode: { $in: keys } }];

    let form =
      (await db.collection("forms").findOne({ isActive: true, $or: or })) ||
      (await db.collection("forms").find({ $or: or }).sort({ createdAt: -1 }).limit(1).next());

    if (!form) return res.status(404).send("active form not found");

    res.json({
      _id: String(form._id),
      typeId: form.typeId ?? null,
      typeCode: form.typeCode ?? null,
      title: form.title ?? form.name ?? "Diagnóstico",
      description: form.description ?? "",
      fields: Array.isArray(form.fields) ? form.fields : [],
      isActive: !!form.isActive,
      createdAt: form.createdAt,
    });
  } catch (err) {
    console.error("[registry-svc] GET /forms/active error", err);
    res.status(500).send("error");
  }
});

/* ----------------------------- Serve ---------------------------- */
const PORT = process.env.PORT || 3011;
app.listen(PORT, () => console.log("registry-svc on :" + PORT));
