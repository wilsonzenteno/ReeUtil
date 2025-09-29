// apps/web/src/pages/admin/AdminQuotes.tsx
import { useEffect, useState } from "react";
import { get, put } from "../../lib/api";
import toast from "react-hot-toast";

type ReportStatus = "PENDING" | "APPROVED" | "REJECTED" | "NEEDS_INFO";

type InspectionReport = {
  _id: string;
  quoteId?: string | null;
  quoteIdExt?: string | null;
  modelIdExt?: string | null;
  answers?: Record<string, any>;
  findings?: Record<string, any>;
  photos?: string[];
  suggestedPrice?: number | null;
  status: ReportStatus;
  inspectorId?: string;
  createdAt: string;
};

const STATUS_LABEL: Record<ReportStatus, string> = {
  PENDING: "Pendiente",
  APPROVED: "Aprobada",
  REJECTED: "Rechazada",
  NEEDS_INFO: "Requiere info",
};

const STATUS_CHIP_CLS: Record<ReportStatus, string> = {
  PENDING:
    "inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-amber-50 border-amber-200 text-amber-700",
  APPROVED:
    "inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-green-50 border-green-200 text-green-700",
  REJECTED:
    "inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-red-50 border-red-200 text-red-700",
  NEEDS_INFO:
    "inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-blue-50 border-blue-200 text-blue-700",
};

const TABS: Array<{ code: ReportStatus; label: string }> = [
  { code: "PENDING", label: STATUS_LABEL.PENDING },
  { code: "APPROVED", label: STATUS_LABEL.APPROVED },
  { code: "REJECTED", label: STATUS_LABEL.REJECTED },
  { code: "NEEDS_INFO", label: STATUS_LABEL.NEEDS_INFO },
];

export default function AdminQuotes() {
  const [status, setStatus] = useState<ReportStatus>("PENDING");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<InspectionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  async function load() {
    try {
      setLoading(true);
      setErr("");
      const qp = new URLSearchParams();
      qp.set("status", status);
      if (search.trim()) qp.set("search", search.trim());
      const data = await get<InspectionReport[]>(
        `/admin/inspections?${qp.toString()}`
      );
      setItems(data);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function setReportStatus(id: string, next: ReportStatus) {
    try {
      await put(`/admin/inspections/${encodeURIComponent(id)}/status`, {
        status: next,
      });
      toast.success(`Estado cambiado a "${STATUS_LABEL[next]}"`);
      load();
    } catch (e: any) {
      toast.error(e.message || "No se pudo cambiar el estado");
    }
  }

  return (
    <section className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Administración de cotizaciones
          </h1>
          <p className="text-sm text-gray-600">
            Revisiones enviadas por los usuarios.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por QuoteID, QuoteIDExt o Modelo…"
            className="rounded-lg border bg-white px-3 py-2 text-sm"
          />
          <button className="btn-secondary" onClick={load}>
            Actualizar
          </button>
        </div>
      </div>

      {/* Tabs de estado en español */}
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.code}
            onClick={() => setStatus(t.code)}
            className={`px-3 py-1.5 rounded-lg text-sm border ${
              status === t.code ? "bg-black text-white" : "bg-white hover:bg-gray-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {err && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}
      {loading && <div className="text-sm text-gray-600">Cargando…</div>}

      {!loading && !err && items.length === 0 && (
        <div className="card">
          <div className="font-medium mb-1">No hay solicitudes.</div>
          <p className="text-sm text-gray-600">
            Cuando un usuario acepte una cotización, aparecerá aquí.
          </p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="grid gap-3">
          {items.map((r) => (
            <div key={r._id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className={STATUS_CHIP_CLS[r.status]}>
                      {STATUS_LABEL[r.status]}
                    </div>
                    <div className="text-xs text-gray-500">
                      {new Date(r.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="mt-1 font-medium">
                    {r.modelIdExt || r.quoteIdExt || r.quoteId || "(sin id)"}
                  </div>
                  <div className="text-xs text-gray-600 break-all">
                    QuoteID: {r.quoteId || "—"} · QuoteIDExt: {r.quoteIdExt || "—"}
                  </div>
                  {typeof r.suggestedPrice === "number" && (
                    <div className="mt-1 text-sm">
                      Precio sugerido: <b>${r.suggestedPrice}</b>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {r.status !== "APPROVED" && (
                    <button
                      className="btn-primary"
                      onClick={() => setReportStatus(r._id, "APPROVED")}
                    >
                      Aprobar
                    </button>
                  )}
                  {r.status !== "REJECTED" && (
                    <button
                      className="btn-ghost"
                      onClick={() => setReportStatus(r._id, "REJECTED")}
                    >
                      Rechazar
                    </button>
                  )}
                  {r.status !== "NEEDS_INFO" && (
                    <button
                      className="btn-secondary"
                      onClick={() => setReportStatus(r._id, "NEEDS_INFO")}
                    >
                      Pedir info
                    </button>
                  )}
                  {r.status !== "PENDING" && (
                    <button
                      className="btn-secondary"
                      onClick={() => setReportStatus(r._id, "PENDING")}
                    >
                      Marcar pendiente
                    </button>
                  )}
                </div>
              </div>

              {/* Detalles sencillos */}
              <div className="mt-3 grid gap-2 text-xs text-gray-600 sm:grid-cols-2">
                {r.answers && Object.keys(r.answers).length > 0 && (
                  <div>
                    <div className="font-medium text-gray-800 mb-1">
                      Respuestas del usuario
                    </div>
                    <pre className="rounded bg-gray-50 p-2 overflow-auto">
                      {JSON.stringify(r.answers, null, 2)}
                    </pre>
                  </div>
                )}
                {r.findings && Object.keys(r.findings).length > 0 && (
                  <div>
                    <div className="font-medium text-gray-800 mb-1">
                      Hallazgos del inspector
                    </div>
                    <pre className="rounded bg-gray-50 p-2 overflow-auto">
                      {JSON.stringify(r.findings, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
