// apps/web/src/pages/admin/AdminFormsList.tsx
import { useEffect, useMemo, useState } from "react";
import { get, put } from "../../lib/api";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";

type DeviceType = { id: string; name: string };

type FormField = {
  key: string;
  label: string;
  kind: "text" | "number" | "boolean" | "select" | "radio" | "checkbox";
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
};

type FormDoc = {
  _id: string;
  typeId: string;
  name: string;
  version: number;
  isActive: boolean;
  fields: FormField[];
  createdAt: string;
};

export default function AdminFormsList() {
  const [types, setTypes] = useState<DeviceType[]>([]);
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [forms, setForms] = useState<FormDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  async function load() {
    try {
      setLoading(true);
      const t = await get<DeviceType[]>("/registry/types");
      setTypes(t);

      const url = typeFilter ? `/admin/forms?typeId=${encodeURIComponent(typeFilter)}` : "/admin/forms";
      const data = await get<FormDoc[]>(url);
      setForms(
        data.map((d: any) => ({
          ...d,
          _id: String(d._id),
          createdAt: d.createdAt ?? new Date().toISOString(),
        }))
      );
      setErr("");
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter]);

  const typesMap = useMemo(
    () => Object.fromEntries(types.map((t) => [t.id, t.name])),
    [types]
  );

  async function toggleActive(id: string, next: boolean) {
    try {
      await put(`/admin/forms/${encodeURIComponent(id)}/activate`, { active: next });
      setForms((prev) => prev.map((f) => (f._id === id ? { ...f, isActive: next } : f)));
      toast.success(next ? "Formulario activado" : "Formulario desactivado");
    } catch (e: any) {
      toast.error(e.message || "No se pudo actualizar");
    }
  }

  return (
    <section className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Formularios</h1>
          <p className="text-sm text-gray-600">
            Define campos de diagnóstico por tipo de dispositivo.
          </p>
        </div>
        <Link to="/admin/forms/new" className="btn-primary">
          Nuevo formulario
        </Link>
      </div>

      <div className="card mb-4">
        <div className="flex items-center gap-3">
          <div className="text-sm font-medium">Filtrar por tipo:</div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-lg border bg-white px-3 py-2 text-sm"
          >
            <option value="">Todos</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button className="btn-secondary" onClick={load}>
            Actualizar
          </button>
        </div>
      </div>

      {err && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 mb-3">
          {err}
        </div>
      )}
      {loading && <div className="text-gray-600">Cargando…</div>}

      {!loading && forms.length === 0 && !err && (
        <div className="card">
          <div className="font-medium mb-1">No hay formularios.</div>
          <p className="text-sm text-gray-600">
            Crea el primero con <span className="font-medium">“Nuevo formulario”</span>.
          </p>
        </div>
      )}

      {!loading && forms.length > 0 && (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="py-2 px-3 text-left">Tipo</th>
                <th className="py-2 px-3 text-left">Nombre</th>
                <th className="py-2 px-3 text-left">Versión</th>
                <th className="py-2 px-3 text-left">Activo</th>
                <th className="py-2 px-3 text-left">Creado</th>
                <th className="py-2 px-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {forms.map((f) => (
                <tr key={f._id} className="border-t">
                  <td className="py-2 px-3">{typesMap[f.typeId] || f.typeId}</td>
                  <td className="py-2 px-3">{f.name}</td>
                  <td className="py-2 px-3">v{f.version}</td>
                  <td className="py-2 px-3">{f.isActive ? "Sí" : "No"}</td>
                  <td className="py-2 px-3">
                    {f.createdAt ? new Date(f.createdAt).toLocaleString() : "—"}
                  </td>
                  <td className="py-2 px-3 text-right">
                    <button
                      className="btn-secondary"
                      onClick={() => toggleActive(f._id, !f.isActive)}
                    >
                      {f.isActive ? "Desactivar" : "Activar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
