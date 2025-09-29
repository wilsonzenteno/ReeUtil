// apps/web/src/pages/admin/AdminUsers.tsx
import { useEffect, useState } from "react";
import { get, put } from "../../lib/api";
import toast from "react-hot-toast";

type Role = "admin" | "staff" | "user";
type User = {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  roles: Role[];
  status: "active" | "disabled";
};

export default function AdminUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const data = await get<User[]>("/admin/users");
      setUsers(data);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function setRoles(sub: string, roles: Role[]) {
    try {
      await put(`/admin/users/${encodeURIComponent(sub)}/roles`, { roles });
      toast.success("Roles actualizados");
      load();
    } catch (e: any) {
      toast.error(e.message || "Error actualizando roles");
    }
  }

  async function setStatus(sub: string, status: "active" | "disabled") {
    try {
      await put(`/admin/users/${encodeURIComponent(sub)}/status`, { status });
      toast.success("Estado actualizado");
      load();
    } catch (e: any) {
      toast.error(e.message || "Error actualizando estado");
    }
  }

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-medium">Usuarios</h2>
        <button className="btn-secondary" onClick={load}>
          Actualizar
        </button>
      </div>

      {loading && <p className="text-sm text-gray-600">Cargando…</p>}
      {err && <p className="text-sm text-red-600">{err}</p>}

      {!loading && !err && users.length === 0 && (
        <p className="text-sm text-gray-600">No hay usuarios aún.</p>
      )}

      {!loading && users.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-3">Usuario</th>
                <th className="py-2 pr-3">Email</th>
                <th className="py-2 pr-3">Roles</th>
                <th className="py-2 pr-3">Estado</th>
                <th className="py-2 pr-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.sub} className="border-b last:border-0">
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      {u.picture && (
                        <img src={u.picture} className="h-7 w-7 rounded-full" />
                      )}
                      <div>
                        <div className="font-medium">{u.name || u.sub}</div>
                        <div className="text-xs text-gray-500">sub: {u.sub}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-2 pr-3">{u.email || "—"}</td>
                  <td className="py-2 pr-3">
                    <span className="inline-flex gap-1 flex-wrap">
                      {u.roles.map((r) => (
                        <span
                          key={r}
                          className="rounded-full border px-2 py-0.5 text-xs bg-gray-50"
                        >
                          {r}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={u.status === "active" ? "chip-ok" : "chip-bad"}
                    >
                      {u.status}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="btn-secondary"
                        onClick={() => setRoles(u.sub, ["admin"])}
                      >
                        Hacer admin
                      </button>
                      <button
                        className="btn-secondary"
                        onClick={() => setRoles(u.sub, ["staff"])}
                      >
                        Hacer staff
                      </button>
                      <button
                        className="btn-secondary"
                        onClick={() => setRoles(u.sub, ["user"])}
                      >
                        Solo user
                      </button>
                      {u.status === "active" ? (
                        <button
                          className="btn-ghost"
                          onClick={() => setStatus(u.sub, "disabled")}
                        >
                          Deshabilitar
                        </button>
                      ) : (
                        <button
                          className="btn-primary"
                          onClick={() => setStatus(u.sub, "active")}
                        >
                          Habilitar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
