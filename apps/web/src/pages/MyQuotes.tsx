import { useEffect, useMemo, useState } from "react";
import { get, post, patch } from "../lib/api";
import {
  RefreshCcw,
  Search,
  Check,
  Copy,
  Eye,
  X,
  Inbox,
  PackageCheck,
  Info,
  AlertTriangle,
  Truck,
} from "lucide-react";
import toast from "react-hot-toast";

/* ----------------------- Tipos ----------------------- */
type Quote = {
  _id: string;
  userId: string;
  deviceType?: string | null;
  modelIdExt?: string | null;
  answers?: Record<string, any>;
  offeredPrice?: number | null;
  prelimPrice?: number | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "NEEDS_INFO";
  createdAt: string;
  updatedAt?: string;
};

type QuoteDetail = Quote & {
  ruleVersion?: number | null;
  ruleSnapshot?: any;
};

type DeviceModel = {
  _id: string;
  typeId?: string | null;
  name: string;
  extId: string;
};

type InboxMessage = {
  _id: string;
  title: string;
  body: string;
  isRead?: boolean;
  createdAt: string;
  link?: string | null;
  meta?: {
    // existentes
    reportId?: string;
    quoteId?: string | null;
    quoteIdExt?: string | null;
    modelIdExt?: string | null;
    newStatus?: Quote["status"];
    nextStep?: string;
    actionRequired?: boolean;
    action?: {
      key: string;
      label: string;
      type: "ACK";
      onAccept?: { createShipmentKit?: boolean };
    } | null;
    infoRequest?: {
      message?: string | null;
      fields?: Array<{ name: string; label?: string; hint?: string }>;
      options?: Array<{ key: string; label: string; hint?: string }>;
    };
    // NUEVO: usados por shipment-svc
    kind?: string; // "KIT_DISPATCHED"
    trackingCode?: string | null;
    estimatedDays?: string | null;
  };
};

/* ----------------------- Utils ----------------------- */
function money(n: number | null | undefined) {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `$${Math.round(n)}`;
  }
}

function formatDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function statusMeta(st: Quote["status"]) {
  switch (st) {
    case "PENDING":
      return { label: "Pendiente", cls: "bg-amber-100 text-amber-800 border-amber-200" };
    case "APPROVED":
      return { label: "Aprobada", cls: "bg-emerald-100 text-emerald-800 border-emerald-200" };
    case "REJECTED":
      return { label: "Rechazada", cls: "bg-rose-100 text-rose-800 border-rose-200" };
    case "NEEDS_INFO":
      return { label: "Requiere info", cls: "bg-sky-100 text-sky-800 border-sky-200" };
    default:
      return { label: st, cls: "bg-gray-100 text-gray-800 border-gray-200" };
  }
}

const STATUS_TABS: Array<{ value: "" | Quote["status"]; label: string }> = [
  { value: "", label: "Todas" },
  { value: "PENDING", label: "Pendientes" },
  { value: "APPROVED", label: "Aprobadas" },
  { value: "REJECTED", label: "Rechazadas" },
  { value: "NEEDS_INFO", label: "Req. info" },
];

/* ===================================================== */

export default function MyQuotes() {
  const [list, setList] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [status, setStatus] = useState<"" | Quote["status"]>("");
  const [q, setQ] = useState("");

  const [models, setModels] = useState<DeviceModel[]>([]);

  const [inbox, setInbox] = useState<InboxMessage[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);

  // Modal Detalle
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr] = useState("");
  const [detail, setDetail] = useState<QuoteDetail | null>(null);
  const [detailModelLabel, setDetailModelLabel] = useState<string>("");

  // Modal Shipping
  const [shipOpen, setShipOpen] = useState(false);
  const [shipBusy, setShipBusy] = useState(false);
  const [shipForMsg, setShipForMsg] = useState<InboxMessage | null>(null);
  const [shipForQuote, setShipForQuote] = useState<Quote | null>(null);
  const [shipForm, setShipForm] = useState({
    recipientName: "",
    phone: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "BO",
    notes: "",
  });
  const [shipErr, setShipErr] = useState("");

  /* ---------------------- Loaders ---------------------- */
  async function loadQuotes(st?: "" | Quote["status"]) {
    const token = localStorage.getItem("idToken");
    if (!token) {
      setList([]);
      setErr("");
      return;
    }
    try {
      setLoading(true);
      const qs = st ? `?status=${encodeURIComponent(st)}` : "";
      const data = await get<Quote[]>(`/quotes${qs}`);
      setList(Array.isArray(data) ? data : []);
      setErr("");
    } catch (e: any) {
      setErr(e?.message || "Error al cargar");
    } finally {
      setLoading(false);
    }
  }

  async function loadModelsCatalog() {
    try {
      const all = await get<DeviceModel[]>(`/registry/models`);
      setModels(Array.isArray(all) ? all : []);
    } catch {
      setModels([]);
    }
  }

  async function loadInbox() {
    try {
      setInboxLoading(true);
      const data = await get<InboxMessage[]>(`/notify/inbox`);
      setInbox(Array.isArray(data) ? data : []);
    } catch {
      setInbox([]);
    } finally {
      setInboxLoading(false);
    }
  }

  useEffect(() => {
    loadQuotes(status);
    loadModelsCatalog();
    loadInbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadQuotes(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  /* ---------------------- Memos ---------------------- */
  const modelsByExt = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of models) {
      if (m.extId) map.set(m.extId, m.name || m.extId);
    }
    return map;
  }, [models]);

  // index auxiliar por quoteId, quoteIdExt y modelIdExt (para búsquedas rápidas)
  const indexMsgs = useMemo(() => {
    const byQuoteId = new Map<string, InboxMessage[]>();
    const byQuoteIdExt = new Map<string, InboxMessage[]>();
    const byModelExt = new Map<string, InboxMessage[]>();
    const push = (map: Map<string, InboxMessage[]>, key: string, msg: InboxMessage) => {
      if (!key) return;
      const arr = map.get(key) || [];
      arr.push(msg);
      map.set(key, arr);
    };
    for (const m of inbox) {
      const qid = m.meta?.quoteId || "";
      const qidExt = m.meta?.quoteIdExt || "";
      const midExt = m.meta?.modelIdExt || "";
      if (qid) push(byQuoteId, qid, m);
      if (qidExt) push(byQuoteIdExt, qidExt, m);
      if (midExt) push(byModelExt, midExt, m);
    }
    return { byQuoteId, byQuoteIdExt, byModelExt };
  }, [inbox]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return list;
    return list.filter((x) => {
      const id = x._id.toLowerCase();
      const modelExt = (x.modelIdExt || "").toLowerCase();
      const modelName = (modelsByExt.get(x.modelIdExt || "") || "").toLowerCase();
      const deviceType = (x.deviceType || "").toLowerCase();
      return (
        id.includes(term) ||
        modelExt.includes(term) ||
        modelName.includes(term) ||
        deviceType.includes(term)
      );
    });
  }, [list, q, modelsByExt]);

  const filteredUnique = useMemo(() => {
    const seen = new Set<string>();
    const out: Quote[] = [];
    for (const item of filtered) {
      if (seen.has(item._id)) continue;
      seen.add(item._id);
      out.push(item);
    }
    return out;
  }, [filtered]);

  /* ---------------------- Detalle ---------------------- */
  async function openDetail(id: string, modelExt: string | null | undefined) {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailErr("");
    setDetail(null);
    setDetailModelLabel(modelsByExt.get(modelExt || "") || modelExt || "Modelo sin nombre");

    try {
      const data = await get<QuoteDetail>(`/quotes/${encodeURIComponent(id)}`);
      setDetail(data);
    } catch (e: any) {
      setDetailErr(e?.message || "No se pudo cargar el detalle");
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setDetailOpen(false);
    setDetail(null);
    setDetailErr("");
    setDetailModelLabel("");
  }

  /* ---------------------- Acciones Inbox ---------------------- */
  async function markRead(msgId: string) {
    try {
      await patch(`/notify/inbox/${encodeURIComponent(msgId)}/read`, { read: true });
      await loadInbox();
    } catch (e: any) {
      toast.error(e?.message || "No se pudo marcar como leído");
    }
  }

  async function ackInbox(msgId: string, payload: any = {}) {
    await post(`/notify/inbox/${encodeURIComponent(msgId)}/ack`, payload);
    await loadInbox();
  }

  function onActionClick(msg: InboxMessage, q: Quote) {
    const key = msg?.meta?.action?.key || "";
    // Solo abre modal para approve_shipment
    if (key === "approve_shipment") {
      beginAcceptShipment(msg, q);
      return;
    }
    // Para cualquier otro ACK (ej. "Entendido" en RECHAZADA o NEEDS_INFO), solo confirmar
    ackInbox(msg._id, { accept: true })
      .then(() => toast.success("Confirmado"))
      .catch((e) => toast.error(e?.message || "No se pudo confirmar"));
  }

  function beginAcceptShipment(msg: InboxMessage, q: Quote) {
    setShipForMsg(msg);
    setShipForQuote(q);
    setShipErr("");
    setShipForm((prev) => ({
      ...prev,
      country: prev.country || "AR",
    }));
    setShipOpen(true);
  }

  async function submitShipment() {
    if (!shipForQuote || !shipForMsg) return;

    const required: Array<keyof typeof shipForm> = [
      "recipientName",
      "phone",
      "addressLine1",
      "city",
      "state",
      "postalCode",
      "country",
    ];
    for (const k of required) {
      if (!String(shipForm[k]).trim()) {
        setShipErr("Completa todos los campos obligatorios.");
        return;
      }
    }

    try {
      setShipBusy(true);
      setShipErr("");

      // Enviar ACK con datos de envío → notify-svc creará shipment_confirmations (admin los verá)
      await ackInbox(shipForMsg._id, {
        accept: true,
        shipping: {
          fullName: shipForm.recipientName,
          addressLine1: shipForm.addressLine1,
          addressLine2: shipForm.addressLine2,
          city: shipForm.city,
          state: shipForm.state,
          postalCode: shipForm.postalCode,
          phone: shipForm.phone,
          // Guardamos país y notas juntos (notify-svc soporta "notes")
          notes: [shipForm.country, shipForm.notes].filter(Boolean).join(" · "),
        },
      });

      setShipOpen(false);
      toast.success("Confirmación enviada. Te avisaremos cuando el kit esté en camino.");
    } catch (e: any) {
      setShipErr(e?.message || "No se pudo enviar la confirmación");
    } finally {
      setShipBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Mis cotizaciones</h1>
          <p className="text-sm text-gray-600">
            Revisa el estado, responde solicitudes y confirma el envío del kit cuando tu cotización sea aprobada.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por modelo, ID…"
              className="w-64 rounded-lg border bg-white pl-8 pr-3 py-2 text-sm outline-none ring-0 focus:border-slate-400"
            />
          </div>
          <button
            className="btn-secondary"
            onClick={() => {
              loadQuotes(status);
              loadInbox();
            }}
            disabled={loading || inboxLoading}
          >
            <RefreshCcw className="h-4 w-4" />
            {loading || inboxLoading ? "Actualizando…" : "Actualizar"}
          </button>
        </div>
      </div>

      {/* Tabs de estado */}
      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_TABS.map((t) => {
          const active = status === t.value;
          return (
            <button
              key={t.value || "all"}
              onClick={() => setStatus(t.value)}
              className={`rounded-full border px-3 py-1 text-sm ${
                active
                  ? "bg-black text-white border-black"
                  : "bg-white hover:bg-gray-50 border-gray-300 text-gray-700"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}

      {filteredUnique.length === 0 && !loading ? (
        <div className="rounded-xl border bg-white p-10 text-center text-gray-600">
          {localStorage.getItem("idToken")
            ? "No hay cotizaciones que coincidan."
            : "Inicia sesión para ver tus cotizaciones."}
        </div>
      ) : null}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : filteredUnique.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {filteredUnique.map((q) => {
            // Mensajes mapeados (no leídos) por id interno y por modelo
            const msgsBase = [
              ...(indexMsgs.byQuoteId.get(q._id) || []),
              ...(q.modelIdExt ? indexMsgs.byModelExt.get(q.modelIdExt) || [] : []),
            ].filter((m) => !m.isRead);

            // NUEVO: agregar siempre los de KIT_DISPATCHED que hagan match por quoteId o por modelIdExt
            const kitMsgs = inbox.filter(
              (m) =>
                !m.isRead &&
                m.meta?.kind === "KIT_DISPATCHED" &&
                ((m.meta?.quoteId && m.meta.quoteId === q._id) ||
                  (q.modelIdExt && m.meta?.modelIdExt === q.modelIdExt))
            );

            // Unir y de-duplicar por _id
            const seen = new Set<string>();
            const messages = [...msgsBase, ...kitMsgs].filter((m) => {
              if (seen.has(m._id)) return false;
              seen.add(m._id);
              return true;
            }).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

            return (
              <QuoteCard
                key={q._id}
                q={q}
                modelLabel={modelsByExt.get(q.modelIdExt || "") || q.modelIdExt || "Modelo sin nombre"}
                onOpenDetail={() => openDetail(q._id, q.modelIdExt)}
                messages={messages}
                onAction={(m) => onActionClick(m, q)}
                onDismiss={(m) => markRead(m._id)}
              />
            );
          })}
        </div>
      ) : null}

      {/* Modal Detalle */}
      {detailOpen && (
        <DetailModal
          open={detailOpen}
          onClose={closeDetail}
          loading={detailLoading}
          error={detailErr}
          data={detail}
          modelLabel={detailModelLabel}
        />
      )}

      {/* Modal Shipping */}
      {shipOpen && (
        <ShippingModal
          open={shipOpen}
          onClose={() => setShipOpen(false)}
          busy={shipBusy}
          error={shipErr}
          value={shipForm}
          onChange={(patch) => setShipForm((p) => ({ ...p, ...patch }))}
          onSubmit={submitShipment}
        />
      )}
    </div>
  );
}

/* ---------------------- Subcomponentes ---------------------- */

function QuoteCard({
  q,
  modelLabel,
  onOpenDetail,
  messages,
  onAction,
  onDismiss,
}: {
  q: Quote;
  modelLabel: string;
  onOpenDetail: () => void;
  messages: InboxMessage[];
  onAction: (m: InboxMessage) => void;
  onDismiss: (m: InboxMessage) => void;
}) {
  const meta = statusMeta(q.status);
  const [copied, setCopied] = useState(false);

  async function copyId() {
    try {
      await navigator.clipboard.writeText(q._id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* noop */
    }
  }

  const priceText =
    typeof q.prelimPrice === "number"
      ? money(q.prelimPrice)
      : typeof q.offeredPrice === "number"
      ? money(q.offeredPrice)
      : "—";

  const actionable = messages.find((m) => m.meta?.actionRequired && m.meta?.action?.type === "ACK");
  const others = messages.filter((m) => m !== actionable);

  return (
    <div className="rounded-xl border bg-white p-4 hover:shadow transition">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-gray-500">{formatDateTime(q.createdAt)}</div>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${meta.cls}`}
        >
          {meta.label}
        </span>
      </div>

      {/* Título / modelo */}
      <div className="mt-2">
        <div className="text-base font-semibold">{modelLabel}</div>
        <div className="text-xs text-gray-500">
          {q.modelIdExt ? `extId: ${q.modelIdExt}` : q.deviceType ? `Tipo: ${q.deviceType}` : "—"}
        </div>
      </div>

      {/* Precio */}
      <div className="mt-3 flex items-center justify-between">
        <div className="text-sm text-gray-600">Precio preliminar / oferta</div>
        <div className="text-lg font-semibold">{priceText}</div>
      </div>

      {/* Mensaje accionable */}
      {actionable && (
        <div className="mt-3 rounded-lg border bg-amber-50 p-3">
          <div className="flex items-start gap-2">
            {actionable.meta?.newStatus === "APPROVED" ? (
              <PackageCheck className="h-5 w-5 text-amber-700" />
            ) : actionable.meta?.newStatus === "NEEDS_INFO" ? (
              <Info className="h-5 w-5 text-amber-700" />
            ) : actionable.meta?.newStatus === "REJECTED" ? (
              <AlertTriangle className="h-5 w-5 text-amber-700" />
            ) : (
              <Inbox className="h-5 w-5 text-amber-700" />
            )}
            <div className="flex-1">
              <div className="text-sm font-medium text-amber-900">{actionable.title}</div>
              <p className="mt-1 text-sm text-amber-900 whitespace-pre-wrap">{actionable.body}</p>

              {actionable.meta?.infoRequest && (
                <div className="mt-2 text-xs text-amber-900">
                  {Array.isArray(actionable.meta.infoRequest.fields) &&
                    actionable.meta.infoRequest.fields.length > 0 && (
                      <>
                        <div className="font-medium">Campos solicitados</div>
                        <ul className="list-disc pl-5">
                          {actionable.meta.infoRequest.fields.map((f, i) => (
                            <li key={`${f.name || f.label || "field"}-${i}`}>
                              {f.label || f.name}
                              {f.hint ? ` — ${f.hint}` : ""}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  {Array.isArray(actionable.meta.infoRequest.options) &&
                    actionable.meta.infoRequest.options.length > 0 && (
                      <>
                        <div className="mt-2 font-medium">Opciones</div>
                        <ul className="list-disc pl-5">
                          {actionable.meta.infoRequest.options.map((o, i) => (
                            <li key={`${o.key || o.label || "opt"}-${i}`}>
                              {o.label || o.key}
                              {o.hint ? ` — ${o.hint}` : ""}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn-primary" onClick={() => onAction(actionable)}>
                  {actionable.meta?.action?.label || "Aceptar"}
                </button>
                <button className="btn-secondary" onClick={() => onDismiss(actionable)}>
                  Descartar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Otros mensajes (máx 2) */}
      {others.slice(0, 2).map((m, i) => {
        const isKit = m.meta?.kind === "KIT_DISPATCHED";
        return (
          <div key={`${m._id}-${i}`} className="mt-3 rounded-lg border bg-gray-50 p-3">
            <div className="flex items-start gap-2">
              {isKit ? <Truck className="h-5 w-5 text-gray-700" /> : <Inbox className="h-5 w-5 text-gray-700" />}
              <div className="flex-1">
                <div className="text-sm font-medium">{m.title}</div>
                <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">{m.body}</p>
                <div className="mt-2">
                  <button className="btn-secondary" onClick={() => onDismiss(m)}>
                    Marcar como leído
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* Acciones */}
      <div className="mt-3 flex items-center justify-between text-xs text-gray-600">
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline">ID:</span>
          <span className="font-mono">{q._id}</span>
          <button
            className="inline-flex items-center gap-1 rounded border px-2 py-0.5 hover:bg-gray-50"
            onClick={copyId}
            title="Copiar ID"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copiado" : "Copiar"}
          </button>
        </div>
        <button className="btn-secondary" onClick={onOpenDetail} title="Ver detalle">
          <Eye className="h-4 w-4" />
          Detalle
        </button>
      </div>
    </div>
  );
}

function DetailModal({
  open,
  onClose,
  loading,
  error,
  data,
  modelLabel,
}: {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  error: string;
  data: QuoteDetail | null;
  modelLabel: string;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const meta = statusMeta((data?.status || "PENDING") as Quote["status"]);

  const basePrice =
    (data as any)?.ruleSnapshot?.basePrice ??
    (data as any)?.ruleSnapshot?.formula?.basePrice ??
    null;
  const minPrice =
    (data as any)?.ruleSnapshot?.minPrice ??
    (data as any)?.ruleSnapshot?.formula?.minPrice ??
    null;
  const adjustmentsCount = Array.isArray((data as any)?.ruleSnapshot?.adjustments)
    ? (data as any)?.ruleSnapshot?.adjustments.length
    : Array.isArray((data as any)?.ruleSnapshot?.formula?.adjustments)
    ? (data as any)?.ruleSnapshot?.formula?.adjustments.length
    : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-2xl rounded-xl border bg-white shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <div className="text-sm text-gray-500">
              {data ? formatDateTime(data.createdAt) : ""}
            </div>
            <h3 className="text-lg font-semibold">{modelLabel}</h3>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${meta.cls}`}
            >
              {meta.label}
            </span>
            <button
              className="rounded-md p-1 hover:bg-gray-100"
              onClick={onClose}
              aria-label="Cerrar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="max-h-[75vh] overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="py-12 text-center text-gray-600">Cargando detalle…</div>
          ) : error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : data ? (
            <div className="space-y-5">
              {/* Precios */}
              <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <InfoTile label="Precio preliminar" value={money(data.prelimPrice)} />
                <InfoTile label="Oferta" value={money(data.offeredPrice)} />
                <InfoTile
                  label="Versión de regla"
                  value={data.ruleVersion != null ? `v${data.ruleVersion}` : "—"}
                />
              </section>

              {/* Regla (resumen) */}
              <section className="rounded-lg border bg-gray-50 p-3">
                <div className="mb-1 text-sm font-medium">Regla aplicada</div>
                <div className="grid grid-cols-1 gap-2 text-sm text-gray-700 sm:grid-cols-3">
                  <div>
                    Base:{" "}
                    <strong>{money(typeof basePrice === "number" ? basePrice : null)}</strong>
                  </div>
                  <div>
                    Mínimo:{" "}
                    <strong>{money(typeof minPrice === "number" ? minPrice : null)}</strong>
                  </div>
                  <div>
                    Ajustes: <strong>{adjustmentsCount}</strong>
                  </div>
                </div>
                {data.ruleSnapshot && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm text-gray-600">
                      Ver snapshot
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap text-xs text-gray-700">
                      {JSON.stringify(data.ruleSnapshot, null, 2)}
                    </pre>
                  </details>
                )}
              </section>

              {/* Respuestas */}
              {data.answers && Object.keys(data.answers).length > 0 && (
                <section className="rounded-lg border bg-white p-3">
                  <div className="mb-1 text-sm font-medium">Respuestas</div>
                  <pre className="whitespace-pre-wrap text-xs text-gray-700">
                    {JSON.stringify(data.answers, null, 2)}
                  </pre>
                </section>
              )}

              {/* Identificadores */}
              <section className="rounded-lg border bg-white p-3">
                <div className="mb-2 text-sm font-medium">Identificadores</div>
                <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                  <div className="truncate">
                    <span className="text-gray-500">ID: </span>
                    <span className="font-mono">{data._id}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Modelo: </span>
                    <span>{data.modelIdExt || "—"}</span>
                  </div>
                  <div className="truncate">
                    <span className="text-gray-500">Tipo: </span>
                    <span>{data.deviceType || "—"}</span>
                  </div>
                  <div className="truncate">
                    <span className="text-gray-500">Usuario: </span>
                    <span className="font-mono">{data.userId}</span>
                  </div>
                  <div className="truncate">
                    <span className="text-gray-500">Creado: </span>
                    <span>{formatDateTime(data.createdAt)}</span>
                  </div>
                  {data.updatedAt && (
                    <div className="truncate">
                      <span className="text-gray-500">Actualizado: </span>
                      <span>{formatDateTime(data.updatedAt)}</span>
                    </div>
                  )}
                </div>
              </section>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <button className="btn-secondary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

function ShippingModal({
  open,
  onClose,
  busy,
  error,
  value,
  onChange,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  busy: boolean;
  error: string;
  value: {
    recipientName: string;
    phone: string;
    addressLine1: string;
    addressLine2: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    notes?: string;
  };
  onChange: (patch: Partial<typeof value>) => void;
  onSubmit: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-xl border bg-white shadow-lg">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h3 className="text-lg font-semibold">Dirección para envío del kit</h3>
          <button className="rounded-md p-1 hover:bg-gray-100" onClick={onClose} aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Nombre completo *">
              <input
                className="field w-full"
                value={value.recipientName}
                onChange={(e) => onChange({ recipientName: e.target.value })}
              />
            </Field>
            <Field label="Teléfono *">
              <input
                className="field w-full"
                value={value.phone}
                onChange={(e) => onChange({ phone: e.target.value })}
              />
            </Field>
          </div>

          <Field label="Dirección (línea 1) *">
            <input
              className="field w-full"
              value={value.addressLine1}
              onChange={(e) => onChange({ addressLine1: e.target.value })}
            />
          </Field>
          <Field label="Dirección (línea 2)">
            <input
              className="field w-full"
              value={value.addressLine2}
              onChange={(e) => onChange({ addressLine2: e.target.value })}
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Ciudad *">
              <input className="field w-full" value={value.city} onChange={(e) => onChange({ city: e.target.value })} />
            </Field>
            <Field label="Provincia/Estado *">
              <input
                className="field w-full"
                value={value.state}
                onChange={(e) => onChange({ state: e.target.value })}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Código postal *">
              <input
                className="field w-full"
                value={value.postalCode}
                onChange={(e) => onChange({ postalCode: e.target.value })}
              />
            </Field>
            <Field label="País *">
              <input
                className="field w-full"
                value={value.country}
                onChange={(e) => onChange({ country: e.target.value })}
              />
            </Field>
          </div>

          <Field label="Notas (opcional)">
            <textarea
              className="field w-full"
              rows={2}
              value={value.notes || ""}
              onChange={(e) => onChange({ notes: e.target.value })}
            />
          </Field>
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn-primary disabled:opacity-60" onClick={onSubmit} disabled={busy}>
            {busy ? "Enviando…" : "Confirmar y solicitar kit"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-sm font-medium">{label}</div>
      {children}
    </label>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-base font-semibold">{value}</div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="h-3 w-36 animate-pulse rounded bg-gray-200" />
      <div className="mt-2 h-5 w-48 animate-pulse rounded bg-gray-200" />
      <div className="mt-3 h-6 w-24 animate-pulse rounded bg-gray-200" />
      <div className="mt-3 h-24 w-full animate-pulse rounded bg-gray-100" />
    </div>
  );
}
