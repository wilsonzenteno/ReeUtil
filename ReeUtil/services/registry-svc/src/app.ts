// services/registry-svc/src/app.ts
import "dotenv/config";
import express from "express";
import { MongoClient, ObjectId } from "mongodb";

const app = express();
app.use(express.json());

// --------------------- Tipos ---------------------
type FormField = {
  key: string;
  label: string;
  kind: "text" | "number" | "boolean" | "select" | "radio" | "checkbox";
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
};

type FormDoc = {
  _id?: ObjectId;
  typeId: string;
  name: string;
  version: number;
  isActive: boolean;
  fields: FormField[];
  createdAt: Date;
};

// --------------------- Conexión Mongo ---------------------
let client: MongoClient;
async function getDb() {
  if (!client) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI is required");
    client = new MongoClient(uri);
    await client.connect();
  }
  // Usa la DB que pusiste al final de la URI (por ejemplo /registry)
  const dbName =
    new URL(process.env.MONGODB_URI!).pathname.replace("/", "") || "registry";
  return client.db(dbName);
}

// --------------------- Health ---------------------
app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "registry-svc", time: new Date().toISOString() });
});

// --------------------- Types ---------------------
app.get("/types", async (_req, res) => {
  const db = await getDb();
  const types = await db.collection("device_types").find().sort({ name: 1 }).toArray();
  res.json(types);
});

app.post("/types", async (req, res) => {
  const db = await getDb();
  const b = req.body || {};
  if (!b.id || !b.name) return res.status(400).send("id and name required");
  await db.collection("device_types").updateOne(
    { id: b.id },
    {
      $setOnInsert: {
        id: b.id,
        name: b.name,
        status: b.status || "active",
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );
  res.json({ ok: true });
});

// --------------------- Models ---------------------
app.get("/models", async (req, res) => {
  const db = await getDb();
  const q: any = {};
  if (req.query.typeId) q.typeId = String(req.query.typeId);
  const models = await db.collection("device_models").find(q).sort({ brand: 1, model: 1 }).toArray();
  res.json(models);
});

app.post("/models", async (req, res) => {
  const db = await getDb();
  const b = req.body || {};
  if (!b.typeId || !b.brand || !b.model) return res.status(400).send("typeId, brand, model required");
  await db.collection("device_models").updateOne(
    { typeId: b.typeId, brand: b.brand, model: b.model },
    {
      $setOnInsert: {
        typeId: b.typeId,
        brand: b.brand,
        model: b.model,
        year: b.year || null,
        extId: b.extId || null,
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );
  res.json({ ok: true });
});

// --------------------- Rules ---------------------
app.get("/rules", async (req, res) => {
  const db = await getDb();
  const { typeId, kind } = req.query as any;
  const rule = await db
    .collection("rules")
    .find({ typeId, kind, isActive: true })
    .sort({ version: -1 })
    .limit(1)
    .next();
  res.json(rule || null);
});

app.post("/rules", async (req, res) => {
  const db = await getDb();
  const body = req.body || {};
  if (!body?.typeId || !body?.kind) return res.status(400).send("typeId and kind required");

  // si no viene versión, autoincrementa
  if (!body.version) {
    const prev = await db
      .collection("rules")
      .find({ typeId: body.typeId, kind: body.kind })
      .sort({ version: -1 })
      .limit(1)
      .next();
    body.version = (prev?.version || 0) + 1;
  }

  await db.collection("rules").insertOne({
    ...body,
    isActive: body.isActive ?? true,
    createdAt: new Date(),
  });
  res.json({ ok: true, version: body.version });
});

// --------------------- Forms (ADMIN) ---------------------
/**
 * Colección: forms
 * Doc: ver tipo FormDoc arriba
 */

// Listado (opcional ?typeId=...)
// Soporta ?active=true|false, y ?latest=true con typeId para devolver solo la última versión
app.get("/forms", async (req, res) => {
  const db = await getDb();
  const q: Partial<FormDoc> = {};
  if (req.query.typeId) q.typeId = String(req.query.typeId);

  const activeParam = String(req.query.active || "").toLowerCase();
  if (activeParam === "true") q.isActive = true as any;
  if (activeParam === "false") q.isActive = false as any;

  const latest = String(req.query.latest || "").toLowerCase() === "true";
  if (latest) {
    if (!q.typeId) return res.status(400).send("typeId required when latest=true");
    const doc = await db
      .collection<FormDoc>("forms")
      .find(q as any)
      .sort({ version: -1, createdAt: -1 })
      .limit(1)
      .next();
    return res.json(doc || null);
  }

  const list = await db
    .collection<FormDoc>("forms")
    .find(q as any)
    .sort({ typeId: 1, version: -1, createdAt: -1 })
    .toArray();

  res.json(list);
});

// Crear nueva versión de formulario
app.post("/forms", async (req, res) => {
  const db = await getDb();
  const b = req.body || {};
  if (!b.typeId) return res.status(400).send("typeId required");
  if (!Array.isArray(b.fields)) return res.status(400).send("fields must be an array");

  // validación básica de fields
  for (const f of b.fields as FormField[]) {
    if (!f?.key || !f?.label || !f?.kind) {
      return res.status(400).send("each field requires key, label and kind");
    }
  }

  const prev = await db
    .collection<FormDoc>("forms")
    .find({ typeId: String(b.typeId) })
    .sort({ version: -1 })
    .limit(1)
    .next();

  const version = Number(b.version) || (prev?.version || 0) + 1;

  const doc: FormDoc = {
    typeId: String(b.typeId),
    name: String(b.name || `Formulario ${version}`),
    version,
    isActive: b.isActive ?? true,
    fields: b.fields as FormField[],
    createdAt: new Date(),
  };

  const insertRes = await db.collection<FormDoc>("forms").insertOne(doc);
  res.json({ ok: true, id: String(insertRes.insertedId), version });
});

// Activar / desactivar formulario (updateOne + findOne para evitar .value)
app.put("/forms/:id/activate", async (req, res) => {
  const db = await getDb();
  const id = req.params.id;
  const active = Boolean(req.body?.active);
  if (!ObjectId.isValid(id)) return res.status(400).send("invalid id");

  const updateRes = await db
    .collection<FormDoc>("forms")
    .updateOne({ _id: new ObjectId(id) }, { $set: { isActive: active } });

  if (updateRes.matchedCount === 0) {
    return res.status(404).send("Form not found");
  }

  const updated = await db
    .collection<FormDoc>("forms")
    .findOne({ _id: new ObjectId(id) }, { projection: { _id: 1, isActive: 1 } });

  res.json({ ok: true, id, isActive: !!updated?.isActive });
});

// --------------------- Listen ---------------------
const PORT = process.env.PORT || 3011;
app.listen(PORT, () => console.log("registry-svc on :" + PORT));
