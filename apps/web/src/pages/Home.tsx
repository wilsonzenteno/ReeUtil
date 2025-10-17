import { useEffect, useMemo, useState } from "react";
import { get, post } from "../lib/api";
import StatusBar from "../components/StatusBar";
import { Search, Plus, ChevronRight, RefreshCcw, ShieldCheck } from "lucide-react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";

type DeviceType = { id: string; name: string };
type DeviceModel = { typeId: string; brand: string; model: string; year?: number; extId?: string };

export default function Home() {
  const [types, setTypes] = useState<DeviceType[]>([]);
  const [models, setModels] = useState<DeviceModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingSeed, setLoadingSeed] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const apiBase = import.meta.env.VITE_API_BASE as string;
  const navigate = useNavigate();

  async function loadAll() {
    setLoading(true);
    setErr("");
    try {
      const [t, m] = await Promise.all([
        get<DeviceType[]>("/registry/types"),
        get<DeviceModel[]>("/registry/models"), // trae todos los modelos
      ]);
      setTypes(t);
      setModels(m);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function seedDemo() {
    try {
      setLoadingSeed(true);
      await post("/registry/types", {
        id: "11111111-1111-1111-1111-111111111111",
        name: "Teléfonos",
      });
      await post("/registry/models", {
        typeId: "11111111-1111-1111-1111-111111111111",
        brand: "Apple",
        model: "iPhone 12",
        year: 2020,
        extId: "iphone12-2020",
      });
      await loadAll();
      toast.success("Datos de ejemplo cargados");
    } catch (e: any) {
      toast.error(e.message || "No se pudo cargar el demo");
    } finally {
      setLoadingSeed(false);
    }
  }

  const counts = useMemo(() => {
    const byType = new Map<string, number>();
    for (const m of models) byType.set(m.typeId, (byType.get(m.typeId) || 0) + 1);
    return {
      totalTypes: types.length,
      totalModels: models.length,
      modelsByType: byType,
    };
  }, [types, models]);

  const filteredTypes = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return types;
    return types.filter((t) => t.name.toLowerCase().includes(term) || t.id.toLowerCase().includes(term));
  }, [types, q]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* HERO */}
      <section className="relative overflow-hidden bg-hero-gradient text-white">
        <div className="absolute inset-0 bg-dots opacity-20 pointer-events-none" />
        <div className="mx-auto max-w-6xl px-4 py-10 relative">
          <div className="flex items-start justify-between gap-6">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Bienvenido a ReeUtil</h1>
              <p className="mt-2 text-sm/6 text-slate-300">
                Gateway: <code className="rounded bg-slate-700/60 px-1 py-0.5">{apiBase}</code>
              </p>
              <div className="mt-4">
                <StatusBar />
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <button onClick={() => navigate("/quote/new")} className="btn-primary">
                  <Plus className="h-4 w-4" />
                  Nueva cotización
                </button>
                <a href="/quotes" className="btn-ghost">
                  Mis cotizaciones
                </a>
                <button onClick={seedDemo} disabled={loadingSeed} className="btn-ghost disabled:opacity-60">
                  <ShieldCheck className="h-4 w-4" />
                  {loadingSeed ? "Cargando demo…" : "Cargar datos de ejemplo"}
                </button>
              </div>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-2 gap-3">
              <Kpi label="Tipos" value={counts.totalTypes} />
              <Kpi label="Modelos" value={counts.totalModels} />
            </div>
          </div>
        </div>
      </section>

      {/* CONTENIDO */}
      <section className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold">Explorar tipos</h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar por nombre o ID…"
                className="field"
              />
            </div>
            <button onClick={loadAll} className="btn-secondary">
              <RefreshCcw className="h-4 w-4" />
              Actualizar
            </button>
          </div>
        </div>

        {/* Estados */}
        {loading && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}

        {!loading && err && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>
        )}

        {!loading && !err && filteredTypes.length === 0 && types.length > 0 && (
          <div className="card">
            <div className="text-sm text-gray-600">
              No se encontraron tipos para “<strong>{q}</strong>”.
            </div>
          </div>
        )}

        {!loading && !err && types.length === 0 && (
          <div className="card">
            <h3 className="mb-1 font-medium">No hay tipos aún</h3>
            <p className="mb-4 text-sm text-gray-600">
              Puedes insertarlos desde Atlas en <code>registry.device_types</code>, o crear datos de prueba con
              un clic.
            </p>
            <button onClick={seedDemo} disabled={loadingSeed} className="btn-primary disabled:opacity-60">
              {loadingSeed ? "Cargando demo…" : "Cargar datos de ejemplo"}
            </button>
          </div>
        )}

        {!loading && !err && filteredTypes.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {filteredTypes.map((t) => {
              const count = counts.modelsByType.get(t.id) || 0;
              return (
                <button
                  key={t.id}
                  onClick={() => navigate(`/quote/new?typeId=${encodeURIComponent(t.id)}`)}
                  className="card card-hover text-left"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold">{t.name}</div>
                      <div className="mt-1 text-xs text-gray-500">ID: {t.id}</div>
                    </div>
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700">
                      {count} modelo{count === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="mt-3 inline-flex items-center gap-1 text-sm text-slate-700">
                    Crear cotización
                    <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

/* ----------------------------- Subcomponentes ---------------------------- */

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="kpi">
      <div className="text-sm/5 text-slate-200">{label}</div>
      <div className="text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="card">
      <div className="h-5 w-28 animate-pulse rounded bg-gray-200" />
      <div className="mt-2 h-3 w-44 animate-pulse rounded bg-gray-200" />
      <div className="mt-4 h-9 w-32 animate-pulse rounded bg-gray-200" />
    </div>
  );
}
