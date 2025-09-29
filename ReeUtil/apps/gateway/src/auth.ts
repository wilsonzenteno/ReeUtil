// apps/gateway/src/auth.ts
import type { Request, Response, NextFunction } from "express";

export type Role = "admin" | "staff" | "user";
export type AuthUser = {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  roles: Role[];
  status: "active" | "disabled";
};

declare global {
  namespace Express {
    // Para que TypeScript reconozca req.user
    interface Request {
      user?: AuthUser;
    }
  }
}

const AUTH_BASE = process.env.AUTH_BASE ?? "http://localhost:3071";

/** Verifica el token contra auth-svc y adjunta req.user */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const auth = req.header("authorization") || "";
    if (!auth.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing Bearer token" });
    }
    const r = await fetch(`${AUTH_BASE}/me`, {
      method: "GET",
      headers: { authorization: auth },
    });
    if (!r.ok) {
      return res.status(401).json({ error: "Invalid token" });
    }
    const user = (await r.json()) as AuthUser;
    if (user.status === "disabled") {
      return res.status(403).json({ error: "User disabled" });
    }
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

/** Exige que el usuario tenga al menos uno de los roles requeridos */
export function requireRole(roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: "Unauthenticated" });
    const ok = user.roles.some((r) => roles.includes(r));
    if (!ok) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}
