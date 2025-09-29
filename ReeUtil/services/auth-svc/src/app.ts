import "dotenv/config";
import express from "express";
import cors from "cors";
import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose";
import { getDb } from "./db";

const app = express();
app.use(cors()); // si quieres restringir: cors({ origin: "http://localhost:5173" })
app.use(express.json());

// ----- Config -----
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ""; // Requerido para aud
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const PORT = Number(process.env.PORT || 3071);

// ----- Tipos -----
type Role = "admin" | "staff" | "user";
type UserDoc = {
  _id?: any;
  sub: string;               // ID único de Google
  email?: string;
  name?: string;
  picture?: string;
  roles: Role[];             // roles en BD
  status: "active" | "disabled";
  createdAt: Date;
  updatedAt: Date;
};

type Authed = {
  claims: JWTPayload & { sub: string; email?: string; name?: string; picture?: string };
  user: UserDoc;
};

// ----- Helpers -----
async function verifyGoogleToken(idToken: string) {
  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: CLIENT_ID || undefined, // si está vacío, no valida aud
  });
  return payload as JWTPayload & { sub: string; email?: string; name?: string; picture?: string };
}

async function upsertUserFromClaims(
  claims: { sub: string; email?: string; name?: string; picture?: string }
): Promise<UserDoc> {
  const db = await getDb();
  const now = new Date();
  const col = db.collection<UserDoc>("users");
  const existing = await col.findOne({ sub: claims.sub });

  if (existing) {
    const update: Partial<UserDoc> = {
      email: claims.email ?? existing.email,
      name: claims.name ?? existing.name,
      picture: claims.picture ?? existing.picture,
      updatedAt: now,
    };
    await col.updateOne({ sub: claims.sub }, { $set: update });
    return { ...existing, ...update };
  }

  const doc: UserDoc = {
    sub: claims.sub,
    email: claims.email,
    name: claims.name,
    picture: claims.picture,
    roles: ["user"], // por defecto
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  await col.insertOne(doc);
  return doc;
}

function hasAnyRole(user: UserDoc, roles: Role[]) {
  return user.roles.some((r) => roles.includes(r));
}

// ----- Middlewares -----
async function requireAuth(req: any, res: any, next: any) {
  try {
    const hdr = req.headers.authorization || "";
    const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Missing Bearer token" });
    const claims = await verifyGoogleToken(token);
    const user = await upsertUserFromClaims(claims);
    if (user.status === "disabled") return res.status(403).json({ error: "User disabled" });
    (req as any).auth = { claims, user } as Authed;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function requireRole(roles: Role[]) {
  return (req: any, res: any, next: any) => {
    const a: Authed | undefined = (req as any).auth;
    if (!a) return res.status(401).json({ error: "Unauthenticated" });
    if (!hasAnyRole(a.user, roles)) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}

// ----- Rutas -----
app.get("/healthz", (_req, res) =>
  res.json({ ok: true, service: "auth-svc", time: new Date().toISOString() })
);

app.get("/me", requireAuth, (req, res) => {
  const { user } = (req as any).auth as Authed;
  const { sub, email, name, picture, roles, status } = user;
  res.json({ sub, email, name, picture, roles, status });
});

app.get("/users", requireAuth, requireRole(["admin", "staff"]), async (_req, res) => {
  const db = await getDb();
  const users = await db
    .collection<UserDoc>("users")
    .find({}, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .toArray();
  res.json(users);
});

app.put("/users/:sub/roles", requireAuth, requireRole(["admin"]), async (req, res) => {
  const { sub } = req.params as { sub: string };
  const roles = Array.isArray(req.body?.roles) ? (req.body.roles as Role[]) : null;
  if (!roles || roles.some((r) => !["admin", "staff", "user"].includes(r))) {
    return res.status(400).json({ error: "roles must be array of ['admin','staff','user']" });
  }
  const db = await getDb();
  const result = await db.collection<UserDoc>("users").findOneAndUpdate(
    { sub },
    { $set: { roles, updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  const doc = (result as any)?.value;
  if (!doc) return res.status(404).json({ error: "User not found" });
  const { email, name, picture, status } = doc as UserDoc;
  res.json({ sub, email, name, picture, roles, status });
});

app.put("/users/:sub/status", requireAuth, requireRole(["admin"]), async (req, res) => {
  const { sub } = req.params as { sub: string };
  const status = req.body?.status as "active" | "disabled";
  if (!["active", "disabled"].includes(status))
    return res.status(400).json({ error: "status must be 'active' | 'disabled'" });
  const db = await getDb();
  const result = await db.collection<UserDoc>("users").findOneAndUpdate(
    { sub },
    { $set: { status, updatedAt: new Date() } },
    { returnDocument: "after" }
  );
  const doc = (result as any)?.value;
  if (!doc) return res.status(404).json({ error: "User not found" });
  const { email, name, picture, roles } = doc as UserDoc;
  res.json({ sub, email, name, picture, roles, status });
});

app.listen(PORT, () => console.log("auth-svc on :" + PORT));
