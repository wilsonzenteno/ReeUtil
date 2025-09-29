// apps/web/src/pages/admin/AdminDashboard.tsx
import { useEffect, useState } from "react";
import { get } from "../../lib/api";

type StatusMap = Record<string, { ok: boolean; url?: string }>;

export default function AdminDashboard() {
  const [status, setStatus] = useState<StatusMap | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const s = await get<StatusMap>("/_status");
        setStatus(s);
      } catch (e: any) {
        setErr(e.message || String(e));
      }
    })();
  }, []);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="card">
        <h2 className="font-medium mb-2">Salud de servicios</h2>
        {err && <p className="text-sm text-red-600">{err}</p>}
        {!status && !err && <p className="text-sm text-gray-600">Cargando…</p>}
        {status && (
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(status).map(([k, v]) => (
              <div key={k} className="rounded-lg border px-3 py-2 flex items-center justify-between">
                <div className="text-sm">{k}</div>
                <span className={v.ok ? "chip-ok" : "chip-bad"}>{v.ok ? "OK" : "DOWN"}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="font-medium mb-2">Acciones rápidas</h2>
        <div className="flex gap-2">
          <a href="/admin/users" className="btn-primary">Administrar usuarios</a>
        </div>
      </div>
    </div>
  );
}
