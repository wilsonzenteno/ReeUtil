// apps/web/src/pages/QuoteNew.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { get, post } from "../lib/api";
import DynamicForm, { DFSchema } from "../components/DynamicForm";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  Calculator,
  CheckCircle2,
  ChevronRight,
  Save,
  Send,
} from "lucide-react";
import toast from "react-hot-toast";

/** Debe ser ABSOLUTA para que quote-svc pueda resolverla (y reescribir si hace falta). */
const API_BASE: string =
  (import.meta as any)?.env?.VITE_API_BASE || "http://localhost:8080/api";

type DeviceType = { id: string; name: string; code?: string };
type DeviceModel = {
  _id: string;
  typeId?: string | null;
  name: string;
  extId: string;
  brand?: string;
  model?: string;
  year?: number | null;
};

type PriceResp = {
  prelimPrice: number;
  ruleVersion?: number;
  ruleSnapshot?: any;
};

export default function QuoteNew() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const modelsRef = useRef<HTMLDivElement | null>(null);

  /* Paso 1 */
  const [types, setTypes] = useState<DeviceType[]>([]);
  const [typeId, setTypeId] = useState<string>("");

  /* Paso 2 */
  const [models, setModels] = useState<DeviceModel[]>([]);
  const [modelExt, setModelExt] = useState<string>("");

  /* Paso 3 - form dinámico */
  const [schema, setSchema] = useState<DFSchema | null>(null);
  const [answers, setAnswers] = useState<Record<string, any>>({});

  /* Precio + meta */
  const [calcing, setCalcing] = useState(false);
  const [price, setPrice] = useState<number | null>(null);
  const [ruleMeta, setRuleMeta] = useState<{ version?: number; snapshot?: any } | null>(null);

  /* Guardado + revisión */
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [savedQuoteId, setSavedQuoteId] = useState<string | null>(null);

  const [err, setErr] = useState("");

  const canCalc = useMemo(() => !!typeId, [typeId]);
  const canSave = useMemo(() => !!typeId && !!modelExt, [typeId, modelExt]);

  /* Lee ?typeId=... si viene desde Home */
  useEffect(() => {
    const tid = searchParams.get("typeId");
    if (tid) setTypeId(tid);
  }, [searchParams]);

  /* Cargar tipos */
  useEffect(() => {
    (async () => {
      try {
        const t = await get<DeviceType[]>("/registry/types");
        setTypes(Array.isArray(t) ? t : []);
      } catch (e: any) {
        setErr(e?.message || "Error cargando tipos");
      }
    })();
  }, []);

  /* Al elegir tipo → cargar modelos + form activo */
  useEffect(() => {
    if (!typeId) {
      setModels([]);
      setModelExt("");
      setSchema(null);
      setAnswers({});
      setPrice(null);
      setRuleMeta(null);
      return;
    }

    (async () => {
      setErr("");
      setPrice(null);
      setRuleMeta(null);

      // Modelos
      try {
        // Usa typeId (el gateway lo traduce para registry)
        const ms = await get<DeviceModel[]>(`/registry/models?typeId=${encodeURIComponent(typeId)}`);
        const list = Array.isArray(ms) ? ms : [];
        setModels(list);
        setModelExt(list.length ? (list[0].extId || "") : "");
      } catch (e: any) {
        setModels([]);
        setModelExt("");
        setErr(e?.message || "Error cargando modelos");
      }

      // Form activo (endpoint correcto del gateway)
      try {
        const form = await get<any>(`/forms/active?typeId=${encodeURIComponent(typeId)}`);
        const fields = form?.fields || form?.body?.fields || [];
        const title = form?.title || form?.name || "Diagnóstico";
        const description = form?.description || "";

        if (Array.isArray(fields) && fields.length > 0) {
          const mapped: DFSchema = {
            title,
            description,
            fields: fields.map((f: any) => {
              const rawType = f.type ?? f.kind ?? "text";
              const normalizedType =
                rawType === "radio" ? "radio" :
                rawType === "select" ? "select" :
                rawType === "number" ? "number" :
                rawType === "textarea" ? "textarea" :
                rawType === "checkbox" ? "checkbox" :
                rawType === "switch" ? "checkbox" :      // renderiza switch como checkbox
                rawType === "boolean" ? "checkbox" :     // idem boolean
                "text";

              return {
                name: f.name || f.key, // soporta key/name
                label: f.label || f.title || f.name || f.key,
                type: normalizedType,
                required: !!(f.required ?? f.isRequired),
                placeholder: f.placeholder,
                help: f.help || f.hint,
                min: typeof f.min === "number" ? f.min : undefined,
                max: typeof f.max === "number" ? f.max : undefined,
                step: typeof f.step === "number" ? f.step : undefined,
                options: Array.isArray(f.options)
                  ? f.options.map((o: any) => ({
                      label: o.label || String(o.value),
                      value: o.value,
                    }))
                  : undefined,
                visibleIf: f.visibleIf && typeof f.visibleIf === "object" ? f.visibleIf : undefined,
              };
            }),
          };
          setSchema(mapped);

          // valores por defecto (default/value)
          const initial: Record<string, any> = {};
          for (const f of fields) {
            const key = f.name || f.key;
            if (!key) continue;
            if (f.default !== undefined) initial[key] = f.default;
            else if (f.value !== undefined) initial[key] = f.value;
          }
          setAnswers(initial);
        } else {
          // Fallback por si no hay formulario
          setSchema({
            title: "Diagnóstico",
            description: "Cuéntanos el estado del dispositivo",
            fields: [
              {
                name: "pantalla",
                label: "Pantalla",
                type: "radio",
                required: true,
                options: [
                  { label: "Intacta", value: "intacta" },
                  { label: "Quebrada", value: "quebrada" },
                ],
              },
              { name: "bateria_ok", label: "Batería en buen estado", type: "checkbox" },
              { name: "almacenamiento_gb", label: "Almacenamiento (GB)", type: "number", min: 0, step: 1 },
            ],
          });
          setAnswers({});
        }
      } catch {
        // Fallback si /forms/active 404/500
        setSchema({
          title: "Diagnóstico",
          description: "Cuéntanos el estado del dispositivo",
          fields: [
            {
              name: "pantalla",
              label: "Pantalla",
              type: "radio",
              required: true,
              options: [
                { label: "Intacta", value: "intacta" },
                { label: "Quebrada", value: "quebrada" },
              ],
            },
            { name: "bateria_ok", label: "Batería en buen estado", type: "checkbox" },
            { name: "almacenamiento_gb", label: "Almacenamiento (GB)", type: "number", min: 0, step: 1 },
          ],
        });
        setAnswers({});
      }

      // scroll a modelos
      setTimeout(() => modelsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    })();
  }, [typeId]);

  const selectedType = useMemo(() => types.find((t) => t.id === typeId) || null, [types, typeId]);
  const selectedModel = useMemo(() => models.find((m) => m.extId === modelExt) || null, [models, modelExt]);

  /* Calcular precio */
  async function calcPrice() {
    if (!typeId) return;
    try {
      setCalcing(true);
      setErr("");

      // Usa el endpoint aplanado del gateway (kind=pricing)
      const ruleUrl = `${API_BASE.replace(/\/$/, "")}/rules/active?type_id=${encodeURIComponent(
        typeId
      )}&kind=pricing`;

      const resp = await post<PriceResp>("/quote/price", {
        answers,
        registryRuleUrl: ruleUrl,
      });

      setPrice(resp.prelimPrice ?? null);
      setRuleMeta({ version: resp.ruleVersion, snapshot: resp.ruleSnapshot });
      toast.success(`Precio preliminar: $${resp.prelimPrice}`);
    } catch (e: any) {
      setErr(e?.message || "No se pudo calcular el precio");
      setPrice(null);
      setRuleMeta(null);
    } finally {
      setCalcing(false);
    }
  }

  /* Guardar cotización (requiere login) */
  async function saveQuote(): Promise<string | null> {
    if (!canSave) return null;
    try {
      setSaving(true);
      const body: any = {
        model_id_ext: modelExt || null,
        answers,
      };
      if (price != null) body.prelim_price = price;
      if (ruleMeta?.version !== undefined) body.rule_version = ruleMeta.version;
      if (ruleMeta?.snapshot) body.rule_snapshot = ruleMeta.snapshot;

      const r = await post<{ ok: boolean; id: string }>("/quotes", body);
      setSavedQuoteId(r.id);
      toast.success("Cotización guardada");
      return r.id;
    } catch (e: any) {
      if (String(e?.message || "").toLowerCase().includes("unauthorized")) {
        toast.error("Inicia sesión para guardar tu cotización");
      } else {
        toast.error(e?.message || "No se pudo guardar la cotización");
      }
      return null;
    } finally {
      setSaving(false);
    }
  }

  function openConfirm() {
    if (!canSave) {
      toast.error("Elige un modelo");
      return;
    }
    if (price == null) {
      toast.error("Calcula el precio primero");
      return;
    }
    setConfirmOpen(true);
  }

  /* Enviar a revisión (asegura guardar primero) */
  async function sendToReview() {
    try {
      setSending(true);

      let quoteId = savedQuoteId;
      if (!quoteId) {
        quoteId = await saveQuote();
      }
      if (!quoteId) throw new Error("No se pudo crear la cotización");

      await post("/inspection/reports", {
        quote_id: quoteId,
        model_id_ext: selectedModel?.extId || modelExt || "modelo-desconocido",
        answers,
      });

      toast.success("Enviado a revisión");
      setConfirmOpen(false);
      nav("/quotes");
    } catch (e: any) {
      toast.error(e?.message || "No se pudo enviar a revisión");
    } finally {
      setSending(false);
    }
  }

  /* UI */
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Nueva cotización</h1>
          <p className="text-sm text-gray-600">
            Selecciona el tipo, el modelo y completa el diagnóstico para calcular el precio.
          </p>
        </header>

        {err && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            {err}
          </div>
        )}

        {/* Paso 1 */}
        <section className="mb-6">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500">Paso 1</div>
              <h2 className="text-lg font-semibold">Elige el tipo</h2>
            </div>
            {selectedType && (
              <div className="text-sm text-gray-600">
                Seleccionado: <span className="font-medium">{selectedType.name}</span>
              </div>
            )}
          </div>

          {types.length === 0 ? (
            <div className="card">No hay tipos configurados.</div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              {types.map((t) => {
                const active = t.id === typeId;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTypeId(t.id)}
                    className={`card card-hover flex items-center justify-between text-left ${
                      active ? "ring-2 ring-black" : ""
                    }`}
                    aria-pressed={active}
                  >
                    <div className="font-medium">{t.name}</div>
                    <ChevronRight className="h-4 w-4 text-gray-400" />
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {/* Columna izquierda */}
          <div className="md:col-span-2 rounded-xl border bg-white p-4">
            {/* Paso 2 */}
            <div className="mb-2" ref={modelsRef}>
              <div className="text-xs uppercase tracking-wide text-gray-500">Paso 2</div>
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium">Elige el modelo</label>
                {selectedType && <span className="text-xs text-gray-500">Tipo: {selectedType.name}</span>}
              </div>
            </div>

            <div className="mb-4">
              {!typeId ? (
                <select className="w-full rounded-lg border bg-white px-3 py-2 text-sm" disabled>
                  <option>Elige un tipo primero</option>
                </select>
              ) : (
                <select
                  className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
                  value={modelExt}
                  onChange={(e) => setModelExt(e.target.value)}
                >
                  {models.length === 0 ? (
                    <option value="">No hay modelos para este tipo</option>
                  ) : (
                    <>
                      {models.map((m) => (
                        <option key={m._id} value={m.extId}>
                          {m.name}
                        </option>
                      ))}
                    </>
                  )}
                </select>
              )}
            </div>

            {/* Paso 3 */}
            <div className="mb-2">
              <div className="text-xs uppercase tracking-wide text-gray-500">Paso 3</div>
              <label className="block text-sm font-medium">{schema?.title || "Diagnóstico"}</label>
            </div>

            <DynamicForm
              schema={schema}
              value={answers}
              onChange={(patch) => setAnswers((prev) => ({ ...prev, ...patch }))}
            />

            {/* Acciones */}
            <div className="mt-6 flex flex-wrap gap-2">
              <button
                className="btn-primary disabled:opacity-60"
                onClick={calcPrice}
                disabled={!canCalc || calcing}
              >
                <Calculator className="h-4 w-4" />
                {calcing ? "Calculando…" : "Calcular precio"}
              </button>

              <button className="btn-secondary" onClick={saveQuote} disabled={!canSave || saving}>
                <Save className="h-4 w-4" />
                {saving ? "Guardando…" : "Guardar cotización"}
              </button>

              <button className="btn-secondary" onClick={() => nav(-1)}>
                Volver
              </button>
            </div>
          </div>

          {/* Resumen derecha */}
          <aside className="rounded-xl border bg-white p-4">
            <h3 className="font-medium mb-3">Resumen</h3>

            <div className="space-y-3 text-sm">
              <div>
                <div className="text-gray-500">Tipo</div>
                <div className="font-medium">{selectedType ? selectedType.name : "—"}</div>
              </div>

              <div>
                <div className="text-gray-500">Modelo</div>
                <div className="font-medium">{selectedModel ? selectedModel.name : "—"}</div>
                {selectedModel?.extId && (
                  <div className="text-xs text-gray-500">extId: {selectedModel.extId}</div>
                )}
              </div>

              <hr />

              <div className="flex items-center justify-between">
                <span className="text-gray-500">Precio preliminar</span>
                <span className="text-lg font-semibold">{price != null ? `$${price}` : "—"}</span>
              </div>
              <div className="text-xs text-gray-500">
                {ruleMeta?.version ? (
                  <span className="inline-flex items-center gap-1 text-green-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Regla v{ruleMeta.version} aplicada
                  </span>
                ) : (
                  "Sin cálculo aún"
                )}
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  className="btn-primary w-full disabled:opacity-60"
                  onClick={openConfirm}
                  disabled={!canSave || price == null}
                >
                  <Send className="h-4 w-4" />
                  Aceptar y enviar a revisión
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* Modal confirmación */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border bg-white p-5 shadow-lg">
            <h4 className="text-lg font-semibold mb-2">Confirmar envío a revisión</h4>
            <p className="text-sm text-gray-600">
              ¿Deseas enviar tu cotización a revisión? Nuestro equipo verificará los datos y te contactará.
            </p>

            <div className="mt-4 rounded-lg bg-gray-50 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Precio preliminar</span>
                <span className="font-semibold">{price != null ? `$${price}` : "—"}</span>
              </div>
              {selectedType && selectedModel && (
                <div className="mt-1 text-xs text-gray-500">
                  {selectedType.name} · {selectedModel.name}
                </div>
              )}
            </div>

            <div className="mt-5 flex flex-wrap gap-2 justify-end">
              <button className="btn-secondary" onClick={() => setConfirmOpen(false)} disabled={sending}>
                Cancelar
              </button>
              <button className="btn-primary disabled:opacity-60" onClick={sendToReview} disabled={sending}>
                {sending ? "Enviando…" : "Enviar a revisión"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
