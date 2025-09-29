// apps/web/src/pages/QuoteNew.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { get, post } from "../lib/api";
import { useLocation, useNavigate } from "react-router-dom";
import { useForm, type SubmitHandler, type Resolver } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import toast from "react-hot-toast";
import {
  Calculator,
  Save,
  AlertCircle,
  CheckCircle2,
  Smartphone,
  Laptop,
  Tablet,
  Tv,
  Watch,
  Headphones,
  Camera,
  Printer,
  Monitor,
  Speaker,
  Box,
  ChevronRight,
  Send,
} from "lucide-react";

/* ------------------------------- Tipos base ------------------------------- */
type DeviceType = { id: string; name: string };
type DeviceModel = {
  typeId: string;
  brand: string;
  model: string;
  year?: number | null;
  extId?: string | null;
};

/* ------------------------------ Validaciones ------------------------------ */
const allowedPantalla = ["intacta", "quebrada"] as const;

const formSchema = z.object({
  typeId: z.string().min(1, { message: "Selecciona un tipo" }),
  // modelExtId guarda un string JSON: {extId} o {brand,model,year}
  modelExtId: z.string().min(1, { message: "Selecciona un modelo" }),
  pantalla: z
    .string()
    .refine((v) => (allowedPantalla as readonly string[]).includes(v), {
      message: "Selecciona el estado de pantalla",
    }),
  bateria_ok: z.boolean(),
  almacenamiento_gb: z
    .coerce.number()
    .int({ message: "Ingresa un número entero" })
    .min(16, { message: "Mínimo 16 GB" })
    .max(1024, { message: "Máximo 1024 GB" }),
});

type FormValues = z.infer<typeof formSchema>;

/* ----------------------------- Iconos por tipo ---------------------------- */
function TypeIcon({ name }: { name: string }) {
  const n = name.toLowerCase();
  const cls = "h-8 w-8";
  if (n.includes("tel") || n.includes("phone") || n.includes("móvil")) return <Smartphone className={cls} />;
  if (n.includes("laptop") || n.includes("notebook") || n.includes("portátil")) return <Laptop className={cls} />;
  if (n.includes("tablet") || n.includes("ipad")) return <Tablet className={cls} />;
  if (n.includes("tv") || n.includes("tele")) return <Tv className={cls} />;
  if (n.includes("reloj") || n.includes("watch")) return <Watch className={cls} />;
  if (n.includes("aud") || n.includes("head") || n.includes("ear")) return <Headphones className={cls} />;
  if (n.includes("cámara") || n.includes("camera")) return <Camera className={cls} />;
  if (n.includes("impres") || n.includes("print")) return <Printer className={cls} />;
  if (n.includes("monitor")) return <Monitor className={cls} />;
  if (n.includes("parlante") || n.includes("speaker")) return <Speaker className={cls} />;
  return <Box className={cls} />;
}

/* ------------------------------ Helpers modelo ---------------------------- */
type ModelKeyByExt = { extId: string };
type ModelKeyByAttrs = { brand: string; model: string; year: number | null };

function makeOptionValue(m: DeviceModel): string {
  if (m.extId) return JSON.stringify({ extId: m.extId } satisfies ModelKeyByExt);
  return JSON.stringify({
    brand: m.brand,
    model: m.model,
    year: m.year ?? null,
  } satisfies ModelKeyByAttrs);
}

function parseModelKey(s: string | null | undefined): ModelKeyByExt | ModelKeyByAttrs | null {
  try {
    if (!s) return null;
    const obj = JSON.parse(s);
    if (obj && typeof obj === "object") return obj;
    return null;
  } catch {
    return null;
  }
}

function matchModel(models: DeviceModel[], key: ModelKeyByExt | ModelKeyByAttrs | null): DeviceModel | null {
  if (!key) return null;
  if ("extId" in key) {
    return models.find((m) => (m.extId ?? null) === key.extId) || null;
  }
  return (
    models.find(
      (m) =>
        m.brand === key.brand &&
        m.model === key.model &&
        ((m.year ?? null) === (key.year ?? null))
    ) || null
  );
}

/* -------------------------------- Componente -------------------------------- */
export default function QuoteNew() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const urlTypeId = new URLSearchParams(search).get("typeId") || "";
  const modelsRef = useRef<HTMLDivElement | null>(null);

  const [types, setTypes] = useState<DeviceType[]>([]);
  const [models, setModels] = useState<DeviceModel[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [loadingModels, setLoadingModels] = useState(false);
  const [err, setErr] = useState("");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [savedQuoteId, setSavedQuoteId] = useState<string | null>(null);

  const apiBase = import.meta.env.VITE_API_BASE as string;

  // Resolver tipado
  const resolver = zodResolver(formSchema) as unknown as Resolver<FormValues>;

  const form = useForm<FormValues>({
    resolver,
    defaultValues: {
      typeId: urlTypeId || "",
      modelExtId: "",
      pantalla: "intacta",
      bateria_ok: true,
      almacenamiento_gb: 128,
    },
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  const typeId = watch("typeId");
  const modelKeyStr = watch("modelExtId");

  // Resultado de cálculo
  const [prelim, setPrelim] = useState<{
    prelimPrice: number | null;
    ruleVersion: number | null;
    ruleSnapshot: any;
  }>({ prelimPrice: null, ruleVersion: null, ruleSnapshot: {} });

  // Cargar tipos
  useEffect(() => {
    (async () => {
      try {
        setLoadingTypes(true);
        const t = await get<DeviceType[]>("/registry/types");
        setTypes(t);
        setErr("");
        if (!urlTypeId && t.length) setValue("typeId", t[0].id);
      } catch (e: any) {
        setErr(e.message || String(e));
      } finally {
        setLoadingTypes(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cargar modelos cuando cambia el tipo
  useEffect(() => {
    (async () => {
      if (!typeId) return;
      try {
        setLoadingModels(true);
        const m = await get<DeviceModel[]>(`/registry/models?type_id=${encodeURIComponent(typeId)}`);
        setModels(m);

        // Autoselección si el actual no es válido
        const parsed = parseModelKey(modelKeyStr);
        const stillValid = matchModel(m, parsed);
        if (!stillValid) {
          if (m.length > 0) {
            setValue("modelExtId", makeOptionValue(m[0]), { shouldDirty: true });
          } else {
            setValue("modelExtId", "", { shouldDirty: true });
          }
        }
      } catch (e: any) {
        toast.error(e.message || "No se pudieron cargar modelos");
      } finally {
        setLoadingModels(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeId]);

  const selectedType = useMemo(() => types.find((t) => t.id === typeId) || null, [types, typeId]);

  const selectedModel = useMemo(() => {
    const key = parseModelKey(modelKeyStr);
    return matchModel(models, key);
  }, [models, modelKeyStr]);

  const onCalculate: SubmitHandler<FormValues> = async (values) => {
    try {
      if (!values.modelExtId) {
        setError("modelExtId", { message: "Selecciona un modelo" });
        return;
      }
      const registryRuleUrl = `${apiBase}/registry/rules?type_id=${encodeURIComponent(values.typeId)}&kind=quote`;
      const payload = {
        answers: {
          pantalla: values.pantalla,
          bateria_ok: values.bateria_ok,
          almacenamiento_gb: values.almacenamiento_gb,
        },
        registryRuleUrl,
      };

      const r = await post<{
        prelimPrice: number;
        ruleVersion: number;
        ruleSnapshot: any;
      }>("/quote/price", payload);

      setPrelim(r);
      setSavedQuoteId(null); // si recalcula, forzamos nuevo guardado antes de revisión
      toast.success(`Precio preliminar: $${r.prelimPrice}`);
    } catch (e: any) {
      toast.error(e.message || "Error calculando precio");
    }
  };

  async function saveQuote(values: FormValues) {
    const parsed = parseModelKey(values.modelExtId);
    const model = parsed ? matchModel(models, parsed) : null;

    const fallbackExt = model
      ? [model.brand, model.model, model.year ?? ""].filter(Boolean).join("-")
      : "modelo-desconocido";

    const model_id_ext =
      parsed && "extId" in parsed && parsed.extId ? parsed.extId : fallbackExt;

    const body = {
      user_id: "demo-user",
      model_id_ext,
      model_identity: model
        ? { brand: model.brand, model: model.model, year: model.year ?? null }
        : undefined,
      answers: {
        pantalla: values.pantalla,
        bateria_ok: values.bateria_ok,
        almacenamiento_gb: values.almacenamiento_gb,
      },
      prelim_price: prelim.prelimPrice,
      rule_version: prelim.ruleVersion,
      rule_snapshot: prelim.ruleSnapshot,
    };
    const r = await post<{ id: string }>("/quotes", body);
    setSavedQuoteId(r.id);
    return r.id;
  }

  const onSave: SubmitHandler<FormValues> = async (values) => {
    if (prelim.prelimPrice == null) {
      toast.error("Primero calcula el precio");
      return;
    }
    if (!values.modelExtId) {
      setError("modelExtId", { message: "Selecciona un modelo" });
      return;
    }
    try {
      const id = await saveQuote(values);
      toast.success("Cotización guardada");
      console.log("Nueva cotización ID:", id);
      // navigate(`/quotes/${id}`)
    } catch (e: any) {
      toast.error(e.message || "Error guardando cotización");
    }
  };

  /* ----------- Botón “Aceptar cotización” + Modal de confirmación ----------- */
  function openConfirm() {
    if (prelim.prelimPrice == null) {
      toast.error("Primero calcula el precio");
      return;
    }
    if (!modelKeyStr) {
      setError("modelExtId", { message: "Selecciona un modelo" });
      return;
    }
    setConfirmOpen(true);
  }

  async function confirmSendReview() {
    try {
      setSubmittingReview(true);
      const values = form.getValues();

      let qid = savedQuoteId;
      if (!qid) {
        qid = await saveQuote(values);
      }

      await post("/inspection/reports", {
        quote_id: qid,
        model_id_ext: (() => {
          const parsed = parseModelKey(values.modelExtId);
          if (parsed && "extId" in parsed && parsed.extId) return parsed.extId;
          const m = parsed ? matchModel(models, parsed) : null;
          return m ? [m.brand, m.model, m.year ?? ""].filter(Boolean).join("-") : "modelo-desconocido";
        })(),
        answers: {
          pantalla: values.pantalla,
          bateria_ok: values.bateria_ok,
          almacenamiento_gb: values.almacenamiento_gb,
        },
      });

      setConfirmOpen(false);
      toast.success("Solicitud enviada a revisión");
      // navigate("/quotes");
    } catch (e: any) {
      toast.error(e.message || "No se pudo enviar a revisión");
    } finally {
      setSubmittingReview(false);
    }
  }

  /* ------------------------------ UI Helpers ------------------------------ */
  function handlePickType(id: string) {
    setValue("typeId", id, { shouldValidate: true, shouldDirty: true });
    setPrelim({ prelimPrice: null, ruleVersion: null, ruleSnapshot: {} });
    setSavedQuoteId(null);
    setValue("modelExtId", ""); // será autoseleccionado al cargar modelos
    setTimeout(() => modelsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  /* --------------------------------- Render -------------------------------- */
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Nueva cotización</h1>
          <p className="text-sm text-gray-600">
            Selecciona el tipo de electrodoméstico, el modelo y completa el diagnóstico para calcular el precio.
          </p>
        </header>

        {err && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            {err}
          </div>
        )}

        {/* PASO 1: Selección por tarjetas */}
        <section className="mb-6">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500">Paso 1</div>
              <h2 className="text-lg font-semibold">¿Qué tipo de electrodoméstico es?</h2>
            </div>
            {selectedType && (
              <div className="text-sm text-gray-600">
                Seleccionado: <span className="font-medium">{selectedType.name}</span>
              </div>
            )}
          </div>

          {loadingTypes ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="card">
                  <div className="h-8 w-8 rounded-lg bg-gray-200 animate-pulse" />
                  <div className="mt-3 h-4 w-24 rounded bg-gray-200 animate-pulse" />
                </div>
              ))}
            </div>
          ) : types.length === 0 ? (
            <div className="card">
              <div className="font-medium mb-1">No hay tipos configurados</div>
              <p className="text-sm text-gray-600">
                Crea tipos en <code>registry.device_types</code> o usa la carga de demo desde la página de inicio.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              {types.map((t) => {
                const active = t.id === typeId;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handlePickType(t.id)}
                    className={`card card-hover flex items-center gap-3 text-left ${
                      active ? "ring-2 ring-black" : ""
                    }`}
                    aria-pressed={active}
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100">
                      <TypeIcon name={t.name} />
                    </div>
                    <div className="flex-1">
                      <div className="font-medium">{t.name}</div>
                      <div className="text-xs text-gray-500 truncate">ID: {t.id}</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-gray-400" />
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {/* Columna izquierda: formulario */}
          <form onSubmit={handleSubmit(onCalculate)} className="md:col-span-2 rounded-xl border bg-white p-4">
            {/* Encabezado Paso 2 */}
            <div className="mb-2" ref={modelsRef}>
              <div className="text-xs uppercase tracking-wide text-gray-500">Paso 2</div>
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium">Elige el modelo</label>
                {selectedType && <span className="text-xs text-gray-500">Tipo: {selectedType.name}</span>}
              </div>
            </div>

            {/* Modelo */}
            <div className="mb-4">
              <select
                {...register("modelExtId")}
                className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
                disabled={!typeId || loadingModels}
                value={modelKeyStr}
                onChange={(e) => setValue("modelExtId", e.target.value, { shouldValidate: true })}
              >
                <option value="">
                  {!typeId ? "Elige un tipo primero" : loadingModels ? "Cargando…" : "Selecciona…"}
                </option>
                {models.map((m) => {
                  const value = makeOptionValue(m);
                  return (
                    <option key={value} value={value}>
                      {m.brand} {m.model}
                      {m.year ? ` (${m.year})` : ""}
                    </option>
                  );
                })}
              </select>
              {errors.modelExtId && <p className="mt-1 text-xs text-red-600">{errors.modelExtId.message}</p>}
              {!loadingModels && typeId && models.length === 0 && (
                <p className="mt-2 text-xs text-gray-600">
                  No hay modelos para este tipo. Agrega en <code>registry.device_models</code>.
                </p>
              )}
            </div>

            {/* Paso 3: Diagnóstico */}
            <div className="mb-2">
              <div className="text-xs uppercase tracking-wide text-gray-500">Paso 3</div>
              <label className="block text-sm font-medium">Diagnóstico</label>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Pantalla */}
              <div>
                <label className="block text-sm font-medium mb-1">Pantalla</label>
                <div className="flex gap-2">
                  <label className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                    <input type="radio" value="intacta" {...register("pantalla")} />
                    Intacta
                  </label>
                  <label className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                    <input type="radio" value="quebrada" {...register("pantalla")} />
                    Quebrada
                  </label>
                </div>
                {errors.pantalla && <p className="mt-1 text-xs text-red-600">{errors.pantalla.message}</p>}
              </div>

              {/* Batería */}
              <div>
                <label className="block text-sm font-medium mb-1">Batería</label>
                <label className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <input type="checkbox" {...register("bateria_ok")} />
                  Batería en buen estado
                </label>
              </div>

              {/* Almacenamiento */}
              <div>
                <label className="block text-sm font-medium mb-1">Almacenamiento (GB)</label>
                <input
                  type="number"
                  step="1"
                  {...register("almacenamiento_gb")}
                  className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
                  min={16}
                  max={1024}
                />
                {errors.almacenamiento_gb && (
                  <p className="mt-1 text-xs text-red-600">{errors.almacenamiento_gb.message}</p>
                )}
              </div>
            </div>

            {/* Acciones */}
            <div className="mt-6 flex flex-wrap gap-2">
              <button type="submit" disabled={isSubmitting} className="btn-primary disabled:opacity-60">
                <Calculator className="h-4 w-4" />
                {isSubmitting ? "Calculando…" : "Calcular precio"}
              </button>

              <button type="button" onClick={handleSubmit(onSave)} className="btn-secondary">
                <Save className="h-4 w-4" />
                Guardar cotización
              </button>

              <button type="button" onClick={() => navigate(-1)} className="btn-secondary">
                Volver
              </button>
            </div>
          </form>

          {/* Columna derecha: resumen */}
          <aside className="rounded-xl border bg-white p-4">
            <h3 className="font-medium mb-3">Resumen</h3>

            <div className="space-y-3 text-sm">
              <div>
                <div className="text-gray-500">Tipo</div>
                <div className="font-medium">{selectedType ? `${selectedType.name}` : "—"}</div>
              </div>
              <div>
                <div className="text-gray-500">Modelo</div>
                <div className="font-medium">
                  {selectedModel
                    ? `${selectedModel.brand} ${selectedModel.model}${selectedModel.year ? ` (${selectedModel.year})` : ""}`
                    : "—"}
                </div>
                {selectedModel?.extId && <div className="text-xs text-gray-500">extId: {selectedModel.extId}</div>}
              </div>

              <hr />

              <div className="flex items-center justify-between">
                <span className="text-gray-500">Precio preliminar</span>
                <span className="text-lg font-semibold">
                  {prelim.prelimPrice != null ? `$${prelim.prelimPrice}` : "—"}
                </span>
              </div>
              <div className="text-xs text-gray-500">
                {prelim.ruleVersion ? (
                  <span className="inline-flex items-center gap-1 text-green-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Regla v{prelim.ruleVersion} aplicada
                  </span>
                ) : (
                  "Sin cálculo aún"
                )}
              </div>

              {/* Aceptar + modal */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={openConfirm}
                  disabled={prelim.prelimPrice == null || !selectedModel}
                  className="btn-primary w-full disabled:opacity-60"
                >
                  <Send className="h-4 w-4" />
                  Aceptar cotización
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* Modal de confirmación */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl border bg-white p-5 shadow-lg">
            <h4 className="text-lg font-semibold mb-2">Confirmar envío a revisión</h4>
            <p className="text-sm text-gray-600">
              ¿Usted está de acuerdo en enviar el estado de su dispositivo a revisión? Nuestro equipo verificará los
              datos y se comunicará con usted para continuar el proceso.
            </p>

            <div className="mt-4 rounded-lg bg-gray-50 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Precio preliminar</span>
                <span className="font-semibold">{prelim.prelimPrice != null ? `$${prelim.prelimPrice}` : "—"}</span>
              </div>
              {selectedType && selectedModel && (
                <div className="mt-1 text-xs text-gray-500">
                  {selectedType.name} · {selectedModel.brand} {selectedModel.model}
                  {selectedModel.year ? ` (${selectedModel.year})` : ""}
                </div>
              )}
            </div>

            <div className="mt-5 flex flex-wrap gap-2 justify-end">
              <button className="btn-secondary" onClick={() => setConfirmOpen(false)} disabled={submittingReview}>
                Cancelar
              </button>
              <button className="btn-primary disabled:opacity-60" onClick={confirmSendReview} disabled={submittingReview}>
                {submittingReview ? "Enviando…" : "Enviar a revisión"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
