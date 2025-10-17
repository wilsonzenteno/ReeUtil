import { useEffect, useState } from "react";
import { get, post, put, del } from "../../lib/api";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";

type DeviceType = { id: string; name: string };
type FormDef = {
  _id?: string;
  typeId: string;
  name: string;
  version: number;
  isActive: boolean;
  schema: any;
  createdAt?: string;
  updatedAt?: string;
};

export default function AdminForms() {
  const [types, setTypes] = useState<DeviceType[]>([]);
  const [forms, setForms] = useState<FormDef[]>([]);
  const [qType, setQType] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const [t, f] = await Promise.all([
        get<DeviceType[]>("/registry/types"),
        get<FormDef[]>(`/admin/forms${qType ? `?typeId=${encodeURIComponent(qType)}` : ""}`),
      ]);
      setTypes(t);
      setForms(f);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [qType]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleActive(form: FormDef) {
    try {
      await put(`/admin/forms/${form._id}`, { ...form, isActive: !form.isActive });
      toast.success(form.isActive ? "Desactivado" : "Activado");
      load();
    } catch (e: any) {
      toast.error(e.message || "No se pudo actualizar");
    }
  }

  async function removeForm(id?: string) {
    if (!id) return;
    if (!confirm("¿Eliminar este formulario?")) return;
    try {
      await del(`/admin/forms/${id}`);
      toast.success("Formulario eliminado");
      load();
    } catch (e: any) {
      toast.error(e.message || "No se pudo eliminar");
    }
  }

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Formularios</h1>
          <p className="text-sm text-gray-600">Define campos de diagnóstico por tipo de dispositivo.</p>
        </div>
        <Link to="/admin/forms/new" className="btn-primary">Nuevo formulario</Link>
      </header>

      <div className="mb-4 flex gap-2 items-center">
        <label className="text-sm text-gray-600">Filtrar por tipo:</label>
        <select
          className="rounded-lg border bg-white px-3 py-2 text-sm"
          value={qType}
          onChange={(e) => setQType(e.target.value)}
        >
          <option value="">Todos</option>
          {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      {err && <div className="text-red-600 text-sm mb-3">{err}</div>}
      {loading && <div className="text-gray-500 text-sm">Cargando…</div>}

      {!loading && forms.length === 0 && (
        <div className="card">No hay formularios.</div>
      )}

      {!loading && forms.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="p-3">Nombre</th>
                <th className="p-3">Tipo</th>
                <th className="p-3">Versión</th>
                <th className="p-3">Activo</th>
                <th className="p-3 w-40">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {forms.map(f => (
                <tr key={f._id} className="border-b last:border-0">
                  <td className="p-3">{f.name}</td>
                  <td className="p-3">{types.find(t => t.id === f.typeId)?.name || f.typeId}</td>
                  <td className="p-3">v{f.version}</td>
                  <td className="p-3">
                    <span className={f.isActive ? "chip-ok" : "chip-bad"}>
                      {f.isActive ? "Sí" : "No"}
                    </span>
                  </td>
                  <td className="p-3 flex gap-2">
                    <Link to={`/admin/forms/${f._id}`} className="btn-secondary">Editar</Link>
                    <button onClick={() => toggleActive(f)} className="btn-secondary">
                      {f.isActive ? "Desactivar" : "Activar"}
                    </button>
                    <button onClick={() => removeForm(f._id)} className="btn-secondary">Eliminar</button>
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
