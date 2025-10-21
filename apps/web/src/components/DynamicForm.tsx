import React from "react";

export type DFOption = { label: string; value: any };
export type DFField = {
  name: string;
  label?: string;
  type?: "text" | "number" | "textarea" | "radio" | "select" | "checkbox" | "switch" | "boolean";
  required?: boolean;
  placeholder?: string;
  help?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: DFOption[];
  visibleIf?: Record<string, any>; // { fieldName: expectedValue }
};
export type DFSchema = {
  title?: string;
  description?: string;
  fields: DFField[];
};

function isVisible(field: DFField, value: Record<string, any>) {
  if (!field.visibleIf) return true;
  return Object.entries(field.visibleIf).every(([k, v]) => value?.[k] === v);
}

type Props = {
  schema: DFSchema | null;
  value: Record<string, any>;
  onChange: (patch: Record<string, any>) => void;
};

export default function DynamicForm({ schema, value, onChange }: Props) {
  if (!schema || !Array.isArray(schema.fields)) {
    return <div className="text-sm text-gray-500">No hay formulario configurado.</div>;
  }

  return (
    <div className="space-y-4">
      {schema.title && <div className="text-base font-medium">{schema.title}</div>}
      {schema.description && <div className="text-xs text-gray-500">{schema.description}</div>}

      {schema.fields.map((f) => {
        if (!isVisible(f, value)) return null;
        const t = f.type || "text";
        const val = value?.[f.name];

        return (
          <div key={f.name} className="space-y-1">
            {f.label && (
              <label className="block text-sm font-medium">
                {f.label} {f.required ? <span className="text-rose-600">*</span> : null}
              </label>
            )}

            {t === "text" && (
              <input
                className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
                type="text"
                value={val ?? ""}
                placeholder={f.placeholder}
                onChange={(e) => onChange({ [f.name]: e.target.value })}
              />
            )}

            {t === "number" && (
              <input
                className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
                type="number"
                value={val ?? ""}
                min={f.min}
                max={f.max}
                step={f.step}
                placeholder={f.placeholder}
                onChange={(e) => onChange({ [f.name]: e.target.value === "" ? null : Number(e.target.value) })}
              />
            )}

            {t === "textarea" && (
              <textarea
                className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
                rows={3}
                value={val ?? ""}
                placeholder={f.placeholder}
                onChange={(e) => onChange({ [f.name]: e.target.value })}
              />
            )}

            {t === "checkbox" || t === "switch" || t === "boolean" ? (
              <label className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!val}
                  onChange={(e) => onChange({ [f.name]: e.target.checked })}
                />
                {f.placeholder || "Sí"}
              </label>
            ) : null}

            {t === "radio" && (
              <div className="flex flex-wrap gap-2">
                {(f.options || []).map((opt) => (
                  <label key={String(opt.value)} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                    <input
                      type="radio"
                      name={f.name}
                      value={opt.value}
                      checked={val === opt.value}
                      onChange={() => onChange({ [f.name]: opt.value })}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            )}

            {t === "select" && (
              <select
                className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
                value={val ?? ""}
                onChange={(e) => onChange({ [f.name]: e.target.value })}
              >
                <option value="">{f.placeholder || "Selecciona…"}</option>
                {(f.options || []).map((opt) => (
                  <option key={String(opt.value)} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )}

            {f.help && <div className="text-xs text-gray-500">{f.help}</div>}
          </div>
        );
      })}
    </div>
  );
}
