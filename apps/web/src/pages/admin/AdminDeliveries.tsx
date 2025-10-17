import { useEffect, useMemo, useRef, useState } from "react";
import { get, post, patch } from "../../lib/api";
import {
  RefreshCcw,
  Search,
  Download,
  PackageOpen,
  ClipboardCheck,
  ScanLine,
  CameraOff,
  Info,
  Loader2,
} from "lucide-react";
import BarcodeScannerComponent from "react-qr-barcode-scanner";

/* ======================= Tipos ======================= */
type Delivery = {
  _id: string;
  confirmationId?: string | null;
  quoteId?: string | null;
  quoteIdExt?: string | null;
  modelIdExt?: string | null;
  userSub?: string | null;
  trackingCode?: string | null;
  receivedAt: string;
  status: "RECEIVED" | "IN_INSPECTION" | "CLOSED";
  notes?: string | null;
  items?: Array<{ name: string; qty: number; notes?: string }>;
};

type ReceiveBody =
  | { confirmationId: string; qrText?: never }
  | { qrText: string; confirmationId?: never };

type ShippingAddr = {
  fullName: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  notes?: string;
};

type Confirmation = {
  _id: string;
  inboxId?: string | null;
  userSub?: string | null;
  quoteId?: string | null;
  quoteIdExt?: string | null;
  reportId?: string | null;
  modelIdExt?: string | null;
  shipping?: ShippingAddr;
  address?: ShippingAddr; // compat
  status: "PENDING" | "PROCESSED";
  createdAt: string;
  processedAt?: string | null;
};

/* ======================= Utils ======================= */
function formatDT(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

function pickShippingFromConf(conf?: Confirmation | null): ShippingAddr | null {
  if (!conf) return null;
  return (conf.shipping as any) || (conf.address as any) || null;
}

/** Igual que en el backend: busca confirmationId desde un texto QR en ES o JSON */
function extractConfirmationId(raw: string): string {
  const t = raw?.trim() || "";
  if (!t) return "";
  // JSON?
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      const o = JSON.parse(t);
      if (o?.confirmationId) return String(o.confirmationId);
    } catch {
      /* noop */
    }
  }
  // “Confirmación: ABC123”
  const m = t.match(/^\s*Confirmaci[oó]n:\s*([A-Za-z0-9]+)\s*$/m);
  if (m?.[1]) return m[1];
  // Si es una sola palabra sin espacios, lo tomamos como ID directo
  if (!t.includes("\n") && !t.includes(" ")) return t;
  return "";
}

/* Debounce simple para no disparar varias veces por el mismo frame de cámara */
function useDebounceFlag(ms = 1500) {
  const flagRef = useRef(false);
  return {
    canRun() {
      return !flagRef.current;
    },
    run() {
      flagRef.current = true;
      setTimeout(() => (flagRef.current = false), ms);
    },
  };
}

/* ======================= Componente ======================= */
export default function AdminDeliveries() {
  const [list, setList] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | Delivery["status"]>("RECEIVED");

  // Escaneo / entrada de texto/ID
  const [scanOpen, setScanOpen] = useState(false);
  const [camError, setCamError] = useState<string>("");
  const [inputQR, setInputQR] = useState(""); // campo único: ID o texto QR
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewConf, setPreviewConf] = useState<Confirmation | null>(null);
  const [previewSourceText, setPreviewSourceText] = useState<string>(""); // mantiene el texto/ID que originó la vista previa
  const debouncer = useDebounceFlag(1600);

  async function load() {
    try {
      setLoading(true);
      setErr("");
      const usp = new URLSearchParams();
      if (status) usp.set("status", status);
      if (q.trim()) usp.set("search", q.trim());
      // tu helper ya antepone /api
      const data = await get<Delivery[]>(`/admin/deliveries?${usp.toString()}`);
      setList(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setErr(e?.message || "Error al cargar entregas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  /* ======================= Preview de Confirmation ======================= */
  async function fetchPreviewByTextOrId(raw: string) {
    const text = raw.trim();
    if (!text) return;

    setPreviewLoading(true);
    setPreviewError("");
    setPreviewConf(null);
    setPreviewSourceText(text);

    const confId = extractConfirmationId(text);
    if (!confId) {
      setPreviewLoading(false);
      setPreviewError("No pude extraer un Confirmation ID válido.");
      return;
    }

    try {
      // tu helper ya antepone /api
      const conf = await get<Confirmation>(
        `/admin/shipments/confirmations/${encodeURIComponent(confId)}`
      );
      setPreviewConf(conf);
    } catch (e: any) {
      setPreviewError(e?.message || "No se encontró la confirmación.");
    } finally {
      setPreviewLoading(false);
    }
  }

  function handleManualLookup() {
    if (!inputQR.trim()) {
      alert("Ingresá el Confirmation ID o pegá el texto del QR.");
      return;
    }
    fetchPreviewByTextOrId(inputQR);
  }

  /* ======================= Registrar recepción ======================= */
  async function registerFromPreview() {
    if (!previewConf) return;

    const text = previewSourceText;
    const confId = extractConfirmationId(text);

    // armamos body: preferimos usar el mismo “origen” que originó el preview
    const body: ReceiveBody = text && !confId ? { qrText: text } : { confirmationId: confId || previewConf._id };

    try {
      await post("/deliveries/receive", body);
      // limpiar vista previa y recargar lista
      setPreviewConf(null);
      setPreviewSourceText("");
      setInputQR("");
      await load();
    } catch (e: any) {
      alert(e?.message || "No se pudo registrar la entrega");
    }
  }

  /* ======================= Handlers QR ======================= */
  async function onQrUpdate(err: any, result: any) {
    if (err) {
      if (!camError && String(err?.message || err)) setCamError(String(err?.message || err));
      return;
    }
    const text: string | undefined =
      result?.getText ? result.getText() : result?.text;
    if (!text || !debouncer.canRun()) return;

    debouncer.run();

    setInputQR(text);
    fetchPreviewByTextOrId(text);
  }

  const filtered = useMemo(() => list, [list]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Gestión de entregas</h1>
          <p className="text-sm text-gray-600">
            Recepción de envíos con dispositivos y transición a inspección.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            className={`btn-secondary ${scanOpen ? "bg-black text-white" : ""}`}
            onClick={() => {
              setCamError("");
              setScanOpen((s) => !s);
            }}
            title={scanOpen ? "Cerrar escáner" : "Abrir escáner"}
          >
            {scanOpen ? <CameraOff className="h-4 w-4" /> : <ScanLine className="h-4 w-4" />}
            {scanOpen ? "Cerrar cámara" : "Escanear QR"}
          </button>
        </div>
      </header>

      {/* Escáner */}
      {scanOpen && (
        <div className="mb-4 rounded-xl border bg-white p-3">
          <div className="mb-2 text-xs text-gray-600 flex items-center gap-2">
            <Info className="h-4 w-4" />
            <span>
              Usa <b>localhost</b> o <b>https</b> para que el navegador permita la cámara. Si ves pantalla
              negra, cambia de navegador o revisa permisos del sitio.
            </span>
          </div>
          <div className="flex flex-col items-center gap-3">
            <div className="w-full max-w-[520px] overflow-hidden rounded-lg border">
              {/* @ts-ignore: algunas versiones no traen tipos completos */}
              <BarcodeScannerComponent width={520} height={320} onUpdate={onQrUpdate} />
            </div>
            {camError && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {camError}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Búsqueda/Entrada simple (ID o texto QR) */}
      <div className="mb-4 rounded-xl border bg-white p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="block text-xs text-gray-600 mb-1">Confirmation ID o texto del QR</label>
            <input
              value={inputQR}
              onChange={(e) => setInputQR(e.target.value)}
              placeholder="Escribí el Confirmation ID o pegá el contenido del QR"
              className="w-full rounded-lg border bg-white p-2 text-sm"
            />
          </div>
          <div>
            <button className="btn-secondary" onClick={handleManualLookup} title="Buscar detalle">
              <Search className="h-4 w-4" />
              Ver detalles
            </button>
          </div>
        </div>

        {/* Panel de vista previa */}
        <div className="mt-3">
          {previewLoading && (
            <div className="inline-flex items-center gap-2 rounded-md border bg-white px-3 py-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando confirmación…
            </div>
          )}
          {previewError && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {previewError}
            </div>
          )}
          {previewConf && (
            <div className="rounded-lg border bg-gray-50 p-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div>
                  <div className="text-xs text-gray-500">Confirmation ID</div>
                  <div className="font-mono text-sm">{previewConf._id}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Estado</div>
                  <div className="text-sm">{previewConf.status}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Creada</div>
                  <div className="text-sm">{formatDT(previewConf.createdAt)}</div>
                </div>

                <div>
                  <div className="text-xs text-gray-500">Quote</div>
                  <div className="font-mono text-sm">
                    {previewConf.quoteId || previewConf.quoteIdExt || "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Modelo</div>
                  <div className="font-mono text-sm">{previewConf.modelIdExt || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Usuario</div>
                  <div className="font-mono text-sm">{previewConf.userSub || "—"}</div>
                </div>
              </div>

              <div className="mt-3">
                <div className="text-xs text-gray-500 mb-1">Dirección de envío</div>
                {(() => {
                  const s = pickShippingFromConf(previewConf);
                  if (!s) return <div className="text-sm">—</div>;
                  return (
                    <pre className="whitespace-pre-wrap rounded-md border bg-white p-2 text-sm">{[
                      s.fullName,
                      s.addressLine1,
                      s.addressLine2,
                      `${s.city || ""}${s.state ? ", " + s.state : ""} ${s.postalCode || ""}`.trim(),
                      s.country,
                      s.phone ? `Tel: ${s.phone}` : "",
                      s.notes ? `Notas: ${s.notes}` : "",
                    ].filter(Boolean).join("\n")}</pre>
                  );
                })()}
              </div>

              <div className="mt-3">
                <button className="btn-primary" onClick={registerFromPreview} title="Registrar recepción">
                  <PackageOpen className="h-4 w-4" />
                  Registrar recepción
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Filtros */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por ID, quote, tracking, usuario…"
            className="w-80 rounded-lg border bg-white pl-8 pr-3 py-2 text-sm outline-none ring-0 focus:border-slate-400"
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as any)}
            className="rounded-lg border bg-white px-3 py-2 text-sm"
          >
            <option value="RECEIVED">Recibidas</option>
            <option value="IN_INSPECTION">En inspección</option>
            <option value="CLOSED">Cerradas</option>
            <option value="">Todas</option>
          </select>
          <button className="btn-secondary" onClick={load} disabled={loading}>
            <RefreshCcw className="h-4 w-4" />
            {loading ? "Actualizando…" : "Actualizar"}
          </button>
        </div>
      </div>

      {err && (
        <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {err}
        </div>
      )}

      {/* Tabla */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border bg-white p-8 text-center text-gray-600">
          {loading ? "Cargando…" : "Sin entregas"}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2">Recibido</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Confirmación</th>
                <th className="px-3 py-2">Quote</th>
                <th className="px-3 py-2">Modelo</th>
                <th className="px-3 py-2">Usuario</th>
                <th className="px-3 py-2">Tracking</th>
                <th className="px-3 py-2">Notas</th>
                <th className="px-3 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d._id} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap align-top">
                    {formatDT(d.receivedAt)}
                  </td>
                  <td className="px-3 py-2 align-top">{d.status}</td>
                  <td className="px-3 py-2 align-top font-mono break-all">
                    {d.confirmationId || "—"}
                  </td>
                  <td className="px-3 py-2 align-top font-mono break-all">
                    {d.quoteId || d.quoteIdExt || "—"}
                  </td>
                  <td className="px-3 py-2 align-top font-mono break-all">
                    {d.modelIdExt || "—"}
                  </td>
                  <td className="px-3 py-2 align-top font-mono break-all">
                    {d.userSub || "—"}
                  </td>
                  <td className="px-3 py-2 align-top">{d.trackingCode || "—"}</td>
                  <td className="px-3 py-2 align-top">{d.notes || "—"}</td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex flex-wrap items-center gap-2">
                      {d.status !== "IN_INSPECTION" && (
                        <button
                          className="btn-secondary"
                          onClick={() => patch(`/admin/deliveries/${encodeURIComponent(d._id)}/status`, { status: "IN_INSPECTION" }).then(load)}
                          title="Mover a inspección"
                        >
                          <ClipboardCheck className="h-4 w-4" />
                          A inspección
                        </button>
                      )}
                      {d.status !== "CLOSED" && (
                        <button
                          className="btn-secondary"
                          onClick={() => patch(`/admin/deliveries/${encodeURIComponent(d._id)}/status`, { status: "CLOSED" }).then(load)}
                          title="Cerrar entrega"
                        >
                          <Download className="h-4 w-4" />
                          Cerrar
                        </button>
                      )}
                    </div>
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
