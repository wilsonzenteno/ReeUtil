// apps/web/src/lib/auth.ts
import React, { createContext, useContext, useEffect, useState } from "react";
import { get } from "./api";

export type Role = "admin" | "staff" | "user";
export type Me = {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  roles: Role[];
  status: "active" | "disabled";
};

type Ctx = {
  me: Me | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  setMe: React.Dispatch<React.SetStateAction<Me | null>>;
};

// Nota: Inicializamos el contexto como null y validamos en useAuth()
const AuthContext = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setErr] = useState("");

  async function refresh() {
    setLoading(true);
    setErr("");
    try {
      const data = await get<Me>("/auth/me"); // → /api/auth/me vía VITE_API_BASE
      setMe(data);
    } catch (e: any) {
      // 401/403 => no autenticado o sin permisos
      setMe(null);
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: Ctx = { me, setMe, loading, error, refresh };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within <AuthProvider>");
  }
  return ctx;
}
