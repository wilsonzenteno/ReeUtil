import { useEffect, useState } from "react";
import { get, post, put } from "../../lib/api";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";

type DeviceType = { id: string; name: string };
type FormDef = {
  _id?: string;
  typeId: string;
  name: string;
  version: number;
  isActive: boolean;
  schema: any;
};

export default function AdminFormEdit() {
  const { id } = useParams(); // "new" | ObjectId
  const navigate = useNavigate();

  const isNew = id === "new";
  const [types, setTypes] = useState<DeviceType[]>([]);
  const [model, setModel] = useState<FormDef>({
    typeId: "",
    name: "",
    version: 1,
    isActive: true,
    schema: { fields: [] },
  });
  const [schemaText, setSchemaText] = useState(JSON.stringify({ fields: [] }, null, 2));
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const t = await get<DeviceType[]>("/registry/types");
        setTypes(t);
        if (!isNew && id) {
          const f = await get<FormDef>(`/admin/forms/${id}`);
          setModel(f);
          setSchemaText(JSON.stringify(f.schema ?? { fields: [] }, null, 2));
        }
      } catch (e: any) {
        setErr(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isNew]);

  async function save() {
    try {
      let parsed: any;
      try {
        parsed = JSON.parse(schemaText || "{}");
      } catch {
        toast.error("El schema no es JSON válido");
        return;
      }

      const payload: FormDef = { ...model, schema: parsed };
      if (isNew) {
        await post("/admin/forms", payload);
        toast.success("Formulario creado");
      } else {
        await put(`/admin/forms/${id}`, payload);
        toast.success("Formulario actualizado");
      }
      navigate("/admin/forms");
    } catch (e: any) {
      toast.error(e.message || "No se pudo guardar");
    }
  }

  if (loading) return <div className="text-gray-500 text-sm">Cargando…</div>;
  if (err) return <div className="text-red-600 text-sm">{err}</div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{isNew ? "Nuevo formulario" : "Editar formulario"}</h1>
        <p className="text-sm text-gray-600">
          Define el <em>schema</em> dinámico para el formulario de cotización de un tipo.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="card space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Tipo</label>
            <select
              className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
              value={model.typeId}
              onChange={(e) => setModel((m) => ({ ...m, typeId: e.target.value }))}
            >
              <option value="">Selecciona…</option>
              {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Nombre</label>
            <input
              className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
              value={model.name}
              onChange={(e) => setModel((m) => ({ ...m, name: e.target.value }))}
              placeholder="Diagnóstico teléfonos v1"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Versión</label>
              <input
                type="number"
                className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
                value={model.version}
                onChange={(e) => setModel((m) => ({ ...m, version: Number(e.target.value || 1) }))}
                min={1}
              />
            </div>
            <div className="flex items-end">
              <label className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={model.isActive}
                  onChange={(e) => setModel((m) => ({ ...m, isActive: e.target.checked }))}
                />
                Activo
              </label>
            </div>
          </div>
        </div>

        <div className="card">
          <label className="block text-sm font-medium mb-1">Schema (JSON)</label>
          <textarea
            className="w-full h-80 rounded-lg border bg-white px-3 py-2 text-sm font-mono"
            value={schemaText}
            onChange={(e) => setSchemaText(e.target.value)}
          />
          <p className="text-xs text-gray-500 mt-2">
            Ejemplo: {"{ \"fields\": [{ \"name\": \"pantalla\", \"type\":\"radio\", \"options\":[\"intacta\",\"quebrada\"] }] }"}
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <button className="btn-primary" onClick={save}>Guardar</button>
        <button className="btn-secondary" onClick={() => history.back()}>Cancelar</button>
      </div>
    </div>
  );
}
