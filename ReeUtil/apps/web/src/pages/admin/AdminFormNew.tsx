// apps/web/src/pages/admin/AdminFormNew.tsx
import { useEffect, useMemo, useState } from "react";
import { get, post } from "../../lib/api";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  Plus, Save, X, ArrowUp, ArrowDown, Trash2, Copy, Eye,
  Type as TypeIcon, Hash, ToggleLeft, List as ListIcon, Dot, CheckSquare,
  Tag, Building2, Barcode, Calendar, Link2, DollarSign, Info
} from "lucide-react";

/* ------------------------------ Tipos ------------------------------ */
type DeviceType = { id: string; name: string };
type FieldKind = "text" | "number" | "boolean" | "select" | "radio" | "checkbox";
type FieldRow = {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
};

type PricingRule = {
  basePrice: number;
  adjustments: Record<
    string,
    | { perUnit: number } // number
    | Record<string, number> // radio/select/checkbox/boolean
  >;
};

/* ---------------------------- Utils ---------------------------- */
function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}
function uid() {
  return (crypto?.randomUUID?.() || Math.random().toString(36).slice(2)).replace(/-/g, "");
}
function FieldIcon({ kind, className = "h-4 w-4" }: { kind: FieldKind; className?: string }) {
  switch (kind) {
    case "text": return <TypeIcon className={className} />;
    case "number": return <Hash className={className} />;
    case "boolean": return <ToggleLeft className={className} />;
    case "select": return <ListIcon className={className} />;
    case "radio": return <Dot className={className} />;
    case "checkbox": return <CheckSquare className={className} />;
  }
}

/* ---------------------------- Componente ---------------------------- */
export default function AdminFormNew() {
  const navigate = useNavigate();

  // Catálogo
  const [types, setTypes] = useState<DeviceType[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // Selección / creación de tipo
  const [typeId, setTypeId] = useState("");
  const [newTypeName, setNewTypeName] = useState("");

  // Crear modelo (opcional)
  const [newModelBrand, setNewModelBrand] = useState("");
  const [newModelModel, setNewModelModel] = useState("");
  const [newModelYear, setNewModelYear] = useState<number | "">("");
  const [newModelExtId, setNewModelExtId] = useState("");

  // Datos del formulario
  const [formName, setFormName] = useState("");
  const [active, setActive] = useState(true);
  const [version, setVersion] = useState<string>(""); // vacío => autoincrementa

  // Campos
  const [fields, setFields] = useState<FieldRow[]>([
    { key: "pantalla", label: "Estado de pantalla", kind: "radio", required: true, options: [
      { value: "intacta", label: "Intacta" },
      { value: "quebrada", label: "Quebrada" },
    ]},
    { key: "bateria_ok", label: "Batería en buen estado", kind: "boolean", required: false },
    { key: "almacenamiento_gb", label: "Almacenamiento (GB)", kind: "number", required: true },
  ]);

  // Precio y ajustes
  const [basePrice, setBasePrice] = useState<number>(500);
  // ajustes: por defecto para los campos precargados
  const [adjustments, setAdjustments] = useState<PricingRule["adjustments"]>({
    pantalla: { intacta: 0, quebrada: -150 },
    bateria_ok: { true: 0 }, // si está marcado, 0 (sin impacto)
    almacenamiento_gb: { perUnit: 2 }, // +2 por GB
  });

  // Simulador (respuestas de prueba)
  const [simAnswers, setSimAnswers] = useState<Record<string, any>>({
    pantalla: "intacta",
    bateria_ok: false,
    almacenamiento_gb: 128
  });

  /* ---------------------------- Carga inicial ---------------------------- */
  async function loadTypes() {
    try {
      setLoading(true);
      const t = await get<DeviceType[]>("/registry/types");
      setTypes(t);
      if (!typeId && t.length) setTypeId(t[0].id);
      setErr("");
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { loadTypes(); }, []); // eslint-disable-line

  const selectedType = useMemo(() => types.find(t => t.id === typeId) || null, [types, typeId]);

  /* ---------------------------- Catálogo: crear tipo/modelo ---------------------------- */
  async function createType() {
    const name = newTypeName.trim();
    if (!name) return toast.error("Escribe un nombre para el tipo");
    const id = uid();
    try {
      await post("/registry/types", { id, name });
      toast.success("Tipo creado");
      setNewTypeName("");
      await loadTypes();
      setTypeId(id);
    } catch (e: any) {
      toast.error(e.message || "No se pudo crear el tipo");
    }
  }

  async function addModel() {
    if (!typeId) return toast.error("Elige o crea un tipo primero");
    if (!newModelBrand.trim() || !newModelModel.trim())
      return toast.error("Marca y Modelo son obligatorios");
    try {
      await post("/registry/models", {
        typeId,
        brand: newModelBrand.trim(),
        model: newModelModel.trim(),
        year: newModelYear || undefined,
        extId: newModelExtId.trim() || undefined,
      });
      toast.success("Modelo registrado");
      setNewModelBrand(""); setNewModelModel(""); setNewModelYear(""); setNewModelExtId("");
    } catch (e: any) {
      toast.error(e.message || "No se pudo crear el modelo");
    }
  }

  /* ---------------------------- Builder helpers ---------------------------- */
  function ensureUniqueKey(base: string, ignoreIndex?: number) {
    let k = slugify(base || "campo");
    const existing = fields.map((f, i) => i !== ignoreIndex ? f.key : null).filter(Boolean);
    let n = 1;
    let cand = k;
    while (existing.includes(cand)) { n += 1; cand = `${k}_${n}`; }
    return cand;
  }

  function addField(kind: FieldKind) {
    const defaultLabel = {
      text: "Texto",
      number: "Número",
      boolean: "Selector (Sí/No)",
      select: "Lista desplegable",
      radio: "Opción única",
      checkbox: "Varias opciones",
    }[kind];
    const label = `${defaultLabel} ${fields.length + 1}`;
    const base: FieldRow = { key: ensureUniqueKey(label), label, kind, required: false };
    if (kind === "select" || kind === "radio" || kind === "checkbox") {
      base.options = [
        { value: "opcion_1", label: "Opción 1" },
        { value: "opcion_2", label: "Opción 2" },
      ];
    }
    setFields(prev => [...prev, base]);

    // añade estructura de ajuste para el nuevo campo
    setAdjustments(prev => {
      const next = { ...prev };
      if (kind === "number") next[base.key] = { perUnit: 0 };
      if (kind === "boolean") next[base.key] = { true: 0 };
      if (kind === "radio" || kind === "select" || kind === "checkbox") {
        next[base.key] = Object.fromEntries((base.options || []).map(o => [o.value, 0]));
      }
      return next;
    });
  }

  function duplicateField(idx: number) {
    setFields(prev => {
      const f = prev[idx];
      const copy: FieldRow = JSON.parse(JSON.stringify(f));
      copy.label = `${copy.label} (copia)`;
      copy.key = ensureUniqueKey(copy.key);
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
    });
  }

  function updateField(idx: number, patch: Partial<FieldRow>) {
    setFields(prev => prev.map((f, i) => i === idx ? { ...f, ...patch } : f));
  }

  function removeField(idx: number) {
    const fieldKey = fields[idx].key;
    setFields(prev => prev.filter((_, i) => i !== idx));
    setAdjustments(prev => {
      const { [fieldKey]: _, ...rest } = prev;
      return rest;
    });
    setSimAnswers(prev => {
      const { [fieldKey]: _, ...rest } = prev;
      return rest;
    });
  }

  function moveField(idx: number, dir: -1 | 1) {
    setFields(prev => {
      const arr = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= arr.length) return prev;
      const tmp = arr[idx]; arr[idx] = arr[j]; arr[j] = tmp;
      return arr;
    });
  }

  function ensureKeyFromLabel(idx: number, label: string) {
    const oldKey = fields[idx].key;
    const newKey = ensureUniqueKey(label, idx);
    updateField(idx, { key: newKey, label });

    // mueve ajustes y respuestas del simulador al nuevo key
    if (oldKey !== newKey) {
      setAdjustments(prev => {
        const next = { ...prev };
        if (oldKey in next) {
          next[newKey] = next[oldKey] as any;
          delete next[oldKey];
        }
        return next;
      });
      setSimAnswers(prev => {
        const next: any = { ...prev };
        if (oldKey in next) {
          next[newKey] = next[oldKey];
          delete next[oldKey];
        }
        return next;
      });
    }
  }

  function setOptionAdjust(fieldKey: string, optionValue: string, delta: number) {
    setAdjustments(prev => {
      const fieldAdj = (prev[fieldKey] as Record<string, number>) || {};
      return { ...prev, [fieldKey]: { ...fieldAdj, [optionValue]: delta } };
    });
  }

  function setPerUnitAdjust(fieldKey: string, perUnit: number) {
    setAdjustments(prev => ({ ...prev, [fieldKey]: { perUnit } }));
  }

  function syncOptionsAdjust(field: FieldRow) {
    // asegura que existan entradas para cada opción nueva, y elimina huérfanas
    setAdjustments(prev => {
      const current = prev[field.key];
      if (!current || typeof current === "object" && "perUnit" in current) {
        // si era number/perUnit pero el campo ahora es select/radio/checkbox => reinicia
        const mapped = Object.fromEntries((field.options || []).map(o => [o.value, 0]));
        return { ...prev, [field.key]: mapped };
      }
      const asMap = current as Record<string, number>;
      const next: Record<string, number> = {};
      (field.options || []).forEach(o => {
        next[o.value] = asMap[o.value] ?? 0;
      });
      return { ...prev, [field.key]: next };
    });
  }

  function addPreset(preset: "basic_phone" | "laptop") {
    if (!typeId) return toast.error("Elige un tipo primero");
    const newFields: FieldRow[] = preset === "basic_phone"
      ? [
          { key: ensureUniqueKey("pantalla"), label: "Estado de pantalla", kind: "radio", required: true,
            options: [{ value: "intacta", label: "Intacta" }, { value: "quebrada", label: "Quebrada" }] },
          { key: ensureUniqueKey("bateria_ok"), label: "Batería en buen estado", kind: "boolean" },
          { key: ensureUniqueKey("almacenamiento_gb"), label: "Almacenamiento (GB)", kind: "number", required: true },
        ]
      : [
          { key: ensureUniqueKey("pantalla"), label: "Pantalla", kind: "radio", required: true,
            options: [{ value: "ok", label: "Sin daños" }, { value: "pixeles", label: "Pixeles muertos" }, { value: "rota", label: "Rota" }] },
          { key: ensureUniqueKey("bateria_ok"), label: "Batería conserva carga", kind: "boolean" },
          { key: ensureUniqueKey("ram_gb"), label: "RAM (GB)", kind: "number", required: true },
          { key: ensureUniqueKey("almacenamiento_gb"), label: "Almacenamiento (GB)", kind: "number", required: true },
          { key: ensureUniqueKey("encendido"), label: "¿Enciende correctamente?", kind: "boolean" },
        ];
    setFields(prev => [...prev, ...newFields]);

    // Ajustes por defecto amigables
    setAdjustments(prev => {
      const next = { ...prev };
      newFields.forEach(f => {
        if (f.kind === "number") next[f.key] = { perUnit: 1 };
        else if (f.kind === "boolean") next[f.key] = { true: 0 };
        else if (f.kind === "radio" || f.kind === "select" || f.kind === "checkbox") {
          next[f.key] = Object.fromEntries((f.options || []).map(o => [o.value, 0]));
        }
      });
      return next;
    });
    toast.success("Plantilla añadida");
  }

  /* ---------------------------- Simulador: cálculo ---------------------------- */
  function computePrice(rule: PricingRule, answers: Record<string, any>) {
    let price = rule.basePrice || 0;
    const lines: Array<{ label: string; delta: number; detail?: string }> = [];

    for (const f of fields) {
      const a = answers[f.key];
      const adj = rule.adjustments[f.key];
      if (!adj) continue;

      if (f.kind === "number" && typeof a === "number" && "perUnit" in adj) {
        const delta = (adj as any).perUnit * a;
        if (delta !== 0) lines.push({ label: f.label, delta, detail: `+${(adj as any).perUnit} x ${a}` });
        price += delta;
      } else if (f.kind === "boolean") {
        if (a === true && (adj as any).true != null) {
          const delta = (adj as any).true;
          if (delta !== 0) lines.push({ label: f.label, delta, detail: "Marcado" });
          price += delta;
        }
      } else if (f.kind === "radio" || f.kind === "select") {
        const delta = (adj as Record<string, number>)[String(a)] ?? 0;
        if (delta !== 0) {
          const optLabel = f.options?.find(o => o.value === a)?.label || String(a);
          lines.push({ label: f.label, delta, detail: optLabel });
        }
        price += delta;
      } else if (f.kind === "checkbox") {
        const selected: string[] = Array.isArray(a) ? a : [];
        for (const val of selected) {
          const delta = (adj as Record<string, number>)[val] ?? 0;
          if (delta !== 0) {
            const optLabel = f.options?.find(o => o.value === val)?.label || val;
            lines.push({ label: f.label, delta, detail: optLabel });
          }
          price += delta;
        }
      }
    }

    return { price, lines };
  }

  const sim = computePrice({ basePrice, adjustments }, simAnswers);

  /* ---------------------------- Guardar ---------------------------- */
  async function saveFormAndRule() {
    if (!typeId) return toast.error("Selecciona un tipo");
    if (!formName.trim()) return toast.error("Ponle un nombre al formulario");
    if (fields.length === 0) return toast.error("Agrega al menos un campo");

    for (const f of fields) {
      if (!f.key || !f.label || !f.kind) {
        return toast.error("Todos los campos requieren clave, etiqueta y tipo");
      }
      if ((f.kind === "select" || f.kind === "radio" || f.kind === "checkbox")
        && (!f.options || f.options.length === 0)) {
        return toast.error(`El campo "${f.label}" requiere opciones`);
      }
    }

    try {
      // 1) Guardar formulario
      const bodyForm: any = {
        typeId,
        name: formName.trim(),
        isActive: active,
        fields: fields.map(f => ({
          ...f,
          options: f.options?.map(o => ({
            value: slugify(o.value || o.label),
            label: o.label
          }))
        })),
      };
      if (version.trim() !== "") bodyForm.version = Number(version);

      const formRes = await post<{ ok: boolean; id: string; version: number }>("/admin/forms", bodyForm);

      // 2) Guardar regla de precio simple
      const ruleBody = {
        typeId,
        kind: "quote",
        isActive: true,
        // si escribiste versión manual, reutilízala; si no, el backend autoasignará
        ...(version.trim() !== "" ? { version: Number(version) } : {}),
        rule: {
          basePrice,
          adjustments,
        } as PricingRule,
      };
      await post("/registry/rules", ruleBody);

      toast.success(`Formulario guardado (v${formRes.version}) y regla de precio actualizada`);
      navigate("/admin/forms");
    } catch (e: any) {
      toast.error(e.message || "No se pudo guardar");
    }
  }

  /* ---------------------------- Render ---------------------------- */
  return (
    <div className="min-h-screen">
      {/* Top bar pegajosa */}
      <div className="sticky top-0 z-40 border-b bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Eye className="h-5 w-5" />
            <div className="font-semibold">Nuevo formulario</div>
            <div className="text-xs text-gray-500">Guía paso a paso + simulador de precio</div>
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => navigate("/admin/forms")}>
              <X className="h-4 w-4" /> Cancelar
            </button>
            <button className="btn-primary" onClick={saveFormAndRule}>
              <Save className="h-4 w-4" /> Guardar
            </button>
          </div>
        </div>
      </div>

      <section className="mx-auto max-w-6xl px-4 py-6 grid gap-6 lg:grid-cols-5">
        {/* Columna izquierda: pasos + builder */}
        <div className="space-y-6 lg:col-span-3">
          {/* Paso 1: Tipo */}
          <div className="card">
            <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">Paso 1</div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium mb-1">Tipo</label>
                <div className="flex gap-2">
                  <Tag className="h-5 w-5 text-gray-400" />
                  <select
                    value={typeId}
                    onChange={e => setTypeId(e.target.value)}
                    className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
                    disabled={loading}
                  >
                    <option value="">{loading ? "Cargando…" : "Selecciona…"}</option>
                    {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                {selectedType && (
                  <div className="text-xs text-gray-500 mt-1">ID: {selectedType.id}</div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Crear nuevo tipo</label>
                <div className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-gray-400" />
                  <input
                    value={newTypeName}
                    onChange={e => setNewTypeName(e.target.value)}
                    placeholder="Ej. Teléfonos"
                    className="flex-1 rounded-lg border bg-white px-3 py-2 text-sm"
                  />
                  <button className="btn-secondary" onClick={createType}>
                    <Plus className="h-4 w-4" /> Crear
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">Crea “Teléfonos”, “Laptops”, etc.</p>
              </div>
            </div>
          </div>

          {/* Paso 2: Modelo (opcional) */}
          <div className="card">
            <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">Paso 2 (opcional)</div>
            <div className="grid gap-3 md:grid-cols-4">
              <div className="md:col-span-1">
                <label className="block text-sm font-medium mb-1">Marca</label>
                <div className="flex items-center gap-2">
                  <Tag className="h-4 w-4 text-gray-400" />
                  <input value={newModelBrand} onChange={e => setNewModelBrand(e.target.value)}
                         className="w-full rounded-lg border bg-white px-3 py-2 text-sm" placeholder="Apple" />
                </div>
              </div>
              <div className="md:col-span-1">
                <label className="block text-sm font-medium mb-1">Modelo</label>
                <div className="flex items-center gap-2">
                  <Barcode className="h-4 w-4 text-gray-400" />
                  <input value={newModelModel} onChange={e => setNewModelModel(e.target.value)}
                         className="w-full rounded-lg border bg-white px-3 py-2 text-sm" placeholder="iPhone 12" />
                </div>
              </div>
              <div className="md:col-span-1">
                <label className="block text-sm font-medium mb-1">Año</label>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-gray-400" />
                  <input type="number" value={newModelYear}
                         onChange={e => setNewModelYear(e.target.value ? Number(e.target.value) : "")}
                         className="w-full rounded-lg border bg-white px-3 py-2 text-sm" placeholder="2020" />
                </div>
              </div>
              <div className="md:col-span-1">
                <label className="block text-sm font-medium mb-1">extId (opcional)</label>
                <div className="flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-gray-400" />
                  <input value={newModelExtId} onChange={e => setNewModelExtId(e.target.value)}
                         className="w-full rounded-lg border bg-white px-3 py-2 text-sm" placeholder="iphone12-2020" />
                </div>
              </div>
            </div>
            <div className="mt-3">
              <button className="btn-secondary" onClick={addModel}>
                <Plus className="h-4 w-4" /> Agregar modelo
              </button>
            </div>
          </div>

          {/* Paso 3: Datos del formulario */}
          <div className="card">
            <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">Paso 3</div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1">Nombre</label>
                <input
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="Diagnóstico teléfonos v1"
                  className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Versión</label>
                <input
                  value={version}
                  onChange={e => setVersion(e.target.value)}
                  placeholder="(vacío = auto)"
                  className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">Si lo dejas vacío, se autoincrementa.</p>
              </div>
            </div>
            <div className="mt-3">
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
                Activo
              </label>
            </div>
          </div>

          {/* Paso 4: Form Builder */}
          <div className="card">
            <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">Paso 4 — Constructor</div>

            {/* Presets */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-sm text-gray-600">Plantillas rápidas:</span>
              <button className="btn-secondary" onClick={() => addPreset("basic_phone")}>Smartphone básico</button>
              <button className="btn-secondary" onClick={() => addPreset("laptop")}>Laptop básica</button>
            </div>

            {/* Paleta */}
            <div className="mb-4 flex flex-wrap gap-2">
              <span className="text-sm text-gray-600">Agregar campo:</span>
              <button className="btn-secondary" onClick={() => addField("text")}><TypeIcon className="h-4 w-4" /> Texto</button>
              <button className="btn-secondary" onClick={() => addField("number")}><Hash className="h-4 w-4" /> Número</button>
              <button className="btn-secondary" onClick={() => addField("boolean")}><ToggleLeft className="h-4 w-4" /> Booleano</button>
              <button className="btn-secondary" onClick={() => addField("select")}><ListIcon className="h-4 w-4" /> Select</button>
              <button className="btn-secondary" onClick={() => addField("radio")}><Dot className="h-4 w-4" /> Radio</button>
              <button className="btn-secondary" onClick={() => addField("checkbox")}><CheckSquare className="h-4 w-4" /> Checkbox</button>
            </div>

            {/* Lista de campos */}
            <div className="grid gap-3">
              {fields.map((f, idx) => (
                <div key={idx} className="rounded-xl border p-3 bg-white">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <FieldIcon kind={f.kind} />
                      <input
                        value={f.label}
                        onChange={e => ensureKeyFromLabel(idx, e.target.value)}
                        className="rounded-lg border bg-white px-3 py-2 text-sm"
                        placeholder="Etiqueta"
                        aria-label="Etiqueta del campo"
                      />
                      <input
                        value={f.key}
                        onChange={e => updateField(idx, { key: ensureUniqueKey(e.target.value, idx) })}
                        className="rounded-lg border bg-white px-3 py-2 text-sm"
                        placeholder="clave_interna"
                        aria-label="Clave interna del campo"
                      />
                      <label className="text-sm inline-flex items-center gap-2 ml-2">
                        <input
                          type="checkbox"
                          checked={!!f.required}
                          onChange={e => updateField(idx, { required: e.target.checked })}
                        />
                        Requerido
                      </label>
                    </div>

                    <div className="flex items-center gap-2">
                      <button className="btn-secondary" onClick={() => moveField(idx, -1)} title="Subir"><ArrowUp className="h-4 w-4" /></button>
                      <button className="btn-secondary" onClick={() => moveField(idx, +1)} title="Bajar"><ArrowDown className="h-4 w-4" /></button>
                      <button className="btn-secondary" onClick={() => duplicateField(idx)} title="Duplicar"><Copy className="h-4 w-4" /></button>
                      <button className="btn-secondary" onClick={() => removeField(idx)} title="Eliminar"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>

                  {/* Opciones (si aplica) */}
                  {(f.kind === "select" || f.kind === "radio" || f.kind === "checkbox") && (
                    <div className="mt-3">
                      <div className="text-xs text-gray-600 mb-1">Opciones</div>
                      <div className="grid gap-2">
                        {(f.options || []).map((opt, j) => (
                          <div key={j} className="flex items-center gap-2">
                            <input
                              value={opt.label}
                              onChange={e => {
                                const label = e.target.value;
                                const value = slugify(label);
                                const copy = [...(f.options || [])];
                                copy[j] = { label, value };
                                updateField(idx, { options: copy });
                                // sincroniza mapa de ajustes
                                const updatedField = { ...f, options: copy };
                                syncOptionsAdjust(updatedField);
                              }}
                              className="rounded-lg border bg-white px-3 py-2 text-sm flex-1"
                              placeholder={`Opción ${j + 1}`}
                            />
                            <span className="text-xs text-gray-500">({opt.value})</span>
                            <button
                              className="btn-secondary"
                              onClick={() => {
                                const copy = [...(f.options || [])];
                                copy.splice(j, 1);
                                updateField(idx, { options: copy });
                                syncOptionsAdjust({ ...f, options: copy });
                              }}
                            >
                              Quitar
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="mt-2">
                        <button
                          className="btn-secondary"
                          onClick={() => {
                            const copy = [...(f.options || [])];
                            const next = (copy?.length || 0) + 1;
                            copy.push({ label: `Opción ${next}`, value: `opcion_${next}` });
                            updateField(idx, { options: copy });
                            syncOptionsAdjust({ ...f, options: copy });
                          }}
                        >
                          Agregar opción
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Paso 5: Precio y reglas */}
          <div className="card">
            <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">Paso 5 — Precio y reglas</div>

            {/* Precio base */}
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">Precio base</label>
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-gray-500" />
                <input
                  type="number"
                  value={basePrice}
                  onChange={e => setBasePrice(Number(e.target.value || 0))}
                  className="w-44 rounded-lg border bg-white px-3 py-2 text-sm"
                />
                <span className="text-xs text-gray-500">Este es el punto de partida.</span>
              </div>
            </div>

            {/* Ajustes por campo */}
            <div className="space-y-3">
              {fields.map((f) => {
                const adj = adjustments[f.key] as any;
                return (
                  <div key={f.key} className="rounded-lg border p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <FieldIcon kind={f.kind} />
                      <div className="font-medium">{f.label}</div>
                      <div className="text-xs text-gray-500">({f.key})</div>
                    </div>

                    {f.kind === "number" && (
                      <div className="flex items-center gap-2">
                        <span className="text-sm">Por cada unidad:</span>
                        <input
                          type="number"
                          value={typeof adj?.perUnit === "number" ? adj.perUnit : 0}
                          onChange={e => setPerUnitAdjust(f.key, Number(e.target.value || 0))}
                          className="w-36 rounded-lg border bg-white px-3 py-2 text-sm"
                        />
                        <span className="text-xs text-gray-500">Ej: +2 por GB</span>
                      </div>
                    )}

                    {f.kind === "boolean" && (
                      <div className="flex items-center gap-2">
                        <span className="text-sm">Si está marcado, suma/resta:</span>
                        <input
                          type="number"
                          value={typeof adj?.true === "number" ? adj.true : 0}
                          onChange={e => setOptionAdjust(f.key, "true", Number(e.target.value || 0))}
                          className="w-36 rounded-lg border bg-white px-3 py-2 text-sm"
                        />
                        <span className="text-xs text-gray-500">Si no se marca, no impacta.</span>
                      </div>
                    )}

                    {(f.kind === "radio" || f.kind === "select") && (
                      <div className="grid gap-2">
                        {(f.options || []).map(o => (
                          <div key={o.value} className="flex items-center gap-2">
                            <span className="w-48 text-sm">{o.label}</span>
                            <input
                              type="number"
                              value={typeof adj?.[o.value] === "number" ? adj[o.value] : 0}
                              onChange={e => setOptionAdjust(f.key, o.value, Number(e.target.value || 0))}
                              className="w-36 rounded-lg border bg-white px-3 py-2 text-sm"
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    {f.kind === "checkbox" && (
                      <div className="grid gap-2">
                        {(f.options || []).map(o => (
                          <div key={o.value} className="flex items-center gap-2">
                            <span className="w-48 text-sm">{o.label}</span>
                            <input
                              type="number"
                              value={typeof adj?.[o.value] === "number" ? adj[o.value] : 0}
                              onChange={e => setOptionAdjust(f.key, o.value, Number(e.target.value || 0))}
                              className="w-36 rounded-lg border bg-white px-3 py-2 text-sm"
                            />
                            <span className="text-xs text-gray-500">Se suma si se marca.</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {f.kind === "text" && (
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Info className="h-4 w-4" />
                        Campo informativo, no afecta el precio.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Columna derecha: Vista previa + Simulador */}
        <aside className="space-y-6 lg:col-span-2">
          {/* Vista previa básica */}
          <div className="card">
            <div className="mb-1 text-sm font-medium">Vista previa</div>
            <p className="text-xs text-gray-600 mb-3">
              Así verán los usuarios el formulario (campos deshabilitados de ejemplo).
            </p>

            <div className="space-y-4">
              <div>
                <div className="text-xs text-gray-500">Tipo</div>
                <div className="font-medium">{selectedType ? selectedType.name : "—"}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Nombre</div>
                <div className="font-medium">{formName || "—"}</div>
              </div>
              <hr className="my-2" />

              {/* Render de campos (disabled) */}
              <div className="space-y-3">
                {fields.map((f, i) => (
                  <div key={i} className="text-sm">
                    <label className="block mb-1 font-medium">
                      {f.label}{f.required ? " *" : ""}
                    </label>

                    {f.kind === "text" && (
                      <input disabled className="w-full rounded-lg border bg-gray-50 px-3 py-2 text-sm" placeholder="Texto" />
                    )}

                    {f.kind === "number" && (
                      <input disabled type="number" className="w-full rounded-lg border bg-gray-50 px-3 py-2 text-sm" placeholder="0" />
                    )}

                    {f.kind === "boolean" && (
                      <label className="inline-flex items-center gap-2">
                        <input type="checkbox" disabled /> Sí / No
                      </label>
                    )}

                    {(f.kind === "select") && (
                      <select disabled className="w-full rounded-lg border bg-gray-50 px-3 py-2 text-sm">
                        <option>Selecciona…</option>
                        {f.options?.map((o, j) => <option key={j}>{o.label}</option>)}
                      </select>
                    )}

                    {(f.kind === "radio") && (
                      <div className="flex flex-wrap gap-3">
                        {f.options?.map((o, j) => (
                          <label key={j} className="inline-flex items-center gap-2">
                            <input type="radio" disabled /> {o.label}
                          </label>
                        ))}
                      </div>
                    )}

                    {(f.kind === "checkbox") && (
                      <div className="flex flex-wrap gap-3">
                        {f.options?.map((o, j) => (
                          <label key={j} className="inline-flex items-center gap-2">
                            <input type="checkbox" disabled /> {o.label}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {fields.length === 0 && (
                  <div className="text-xs text-gray-500">Agrega campos desde la paleta para verlos aquí.</div>
                )}
              </div>
            </div>
          </div>

          {/* Simulador de precio en vivo */}
          <div className="card">
            <div className="mb-1 text-sm font-medium">Simulador (prueba tus reglas)</div>
            <p className="text-xs text-gray-600 mb-3">
              Elige respuestas y mira cómo cambia el precio. Lo verán así de fácil tus operadores.
            </p>

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                <div className="text-sm">Precio base: <span className="font-medium">${basePrice}</span></div>
              </div>

              {fields.map((f) => (
                <div key={f.key} className="text-sm">
                  <label className="block mb-1 font-medium">{f.label}</label>

                  {f.kind === "text" && (
                    <input
                      className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
                      placeholder="Texto"
                      value={simAnswers[f.key] ?? ""}
                      onChange={e => setSimAnswers(prev => ({ ...prev, [f.key]: e.target.value }))}
                    />
                  )}

                  {f.kind === "number" && (
                    <input
                      type="number"
                      className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
                      value={simAnswers[f.key] ?? 0}
                      onChange={e => setSimAnswers(prev => ({ ...prev, [f.key]: Number(e.target.value || 0) }))}
                    />
                  )}

                  {f.kind === "boolean" && (
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!simAnswers[f.key]}
                        onChange={e => setSimAnswers(prev => ({ ...prev, [f.key]: e.target.checked }))}
                      />
                      Sí
                    </label>
                  )}

                  {f.kind === "select" && (
                    <select
                      className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
                      value={simAnswers[f.key] ?? ""}
                      onChange={e => setSimAnswers(prev => ({ ...prev, [f.key]: e.target.value }))}
                    >
                      <option value="">Selecciona…</option>
                      {(f.options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  )}

                  {f.kind === "radio" && (
                    <div className="flex flex-wrap gap-3">
                      {(f.options || []).map(o => (
                        <label key={o.value} className="inline-flex items-center gap-2">
                          <input
                            type="radio"
                            name={`sim_${f.key}`}
                            value={o.value}
                            checked={simAnswers[f.key] === o.value}
                            onChange={() => setSimAnswers(prev => ({ ...prev, [f.key]: o.value }))}
                          />
                          {o.label}
                        </label>
                      ))}
                    </div>
                  )}

                  {f.kind === "checkbox" && (
                    <div className="flex flex-wrap gap-3">
                      {(f.options || []).map(o => {
                        const arr: string[] = Array.isArray(simAnswers[f.key]) ? simAnswers[f.key] : [];
                        const checked = arr.includes(o.value);
                        return (
                          <label key={o.value} className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const next = new Set(arr);
                                if (e.target.checked) next.add(o.value);
                                else next.delete(o.value);
                                setSimAnswers(prev => ({ ...prev, [f.key]: Array.from(next) }));
                              }}
                            />
                            {o.label}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}

              <hr />

              <div className="space-y-1 text-sm">
                {sim.lines.length === 0 ? (
                  <div className="text-gray-600">Sin ajustes aplicados (solo precio base).</div>
                ) : (
                  sim.lines.map((ln, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="text-gray-700">
                        {ln.label}{ln.detail ? ` · ${ln.detail}` : ""}
                      </div>
                      <div className={ln.delta >= 0 ? "text-green-700" : "text-red-700"}>
                        {ln.delta >= 0 ? "+" : ""}${ln.delta}
                      </div>
                    </div>
                  ))
                )}
                <div className="flex items-center justify-between font-semibold pt-1 border-t">
                  <div>Total</div>
                  <div>${sim.price}</div>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}
