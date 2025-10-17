// apps/web/src/pages/admin/AdminShipValidations.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { get, patch } from "../../lib/api";
import { Download, QrCode, RefreshCcw, Search, X, Check, Copy } from "lucide-react";
import QRCode from "react-qr-code";
import toast from "react-hot-toast";

type ShipAddress = {
  fullName: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state?: string;
  postalCode?: string;
  phone?: string;
  notes?: string;
};

type ShipConfirmation = {
  _id: string;
  inboxId?: string | null;
  userSub?: string | null;
  quoteId?: string | null;
  quoteIdExt?: string | null;
  reportId?: string | null;
  modelIdExt?: string | null;
  shipping?: ShipAddress | null;
  createdAt: string;
  processedAt?: string | null;
};

function formatDateTime(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso as string;
  }
}

function copy(text: string) {
  if (!text) return;
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success("Copiado"))
    .catch(() => toast.error("No se pudo copiar"));
}

/** Convierte el SVG dentro de `svgEl` a PNG y lo descarga */
async function downloadSvgAsPng(svgEl: SVGSVGElement, fileName = "qr.png", px = 240) {
  const serializer = new XMLSerializer();
  let source = serializer.serializeToString(svgEl);

  if (!/^<svg[^>]+xmlns=/.test(source)) {
    source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (!/^<svg[^>]+xmlns:xlink=/.test(source)) {
    source = source.replace(/^<svg/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  }

  const svgBlob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  const img = new Image();
  const size = px || 240;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  await new Promise<void>((resolve, reject) => {
    img.onload = () => {
      try {
        ctx?.clearRect(0, 0, size, size);
        ctx?.drawImage(img, 0, 0, size, size);
        URL.revokeObjectURL(url);
        resolve();
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e as any);
    };
    img.src = url;
  });

  const pngUrl = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = pngUrl;
  a.download = fileName.endsWith(".png") ? fileName : `${fileName}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Descarga el SVG tal cual como archivo .svg */
function downloadSvg(svgEl: SVGSVGElement, fileName = "qr.svg") {
  const serializer = new XMLSerializer();
  let source = serializer.serializeToString(svgEl);

  if (!/^<svg[^>]+xmlns=/.test(source)) {
    source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (!/^<svg[^>]+xmlns:xlink=/.test(source)) {
    source = source.replace(/^<svg/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  }

  const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.endsWith(".svg") ? fileName : `${fileName}.svg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function AdminShipValidations() {
  const [list, setList] = useState<ShipConfirmation[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [q, setQ] = useState("");
  const [showProcessed, setShowProcessed] = useState(true);

  // QR modal
  const [qrOpen, setQrOpen] = useState(false);
  const [qrText, setQrText] = useState("");
  const [qrFileBase, setQrFileBase] = useState("label");
  const qrBoxRef = useRef<HTMLDivElement | null>(null);
  const QR_SIZE = 240;

  async function load() {
    try {
      setLoading(true);
      setErr("");
      const data = await get<ShipConfirmation[]>("/admin/shipments/confirmations");
      setList(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setErr(e?.message || "No se pudo cargar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (list || [])
      .filter((x) => (showProcessed ? true : !x.processedAt))
      .filter((x) => {
        if (!term) return true;
        const s = [
          x._id,
          x.inboxId,
          x.userSub,
          x.quoteId,
          x.quoteIdExt,
          x.modelIdExt,
          x.shipping?.fullName,
          x.shipping?.city,
          x.shipping?.state,
          x.shipping?.addressLine1,
          x.shipping?.addressLine2,
          x.shipping?.postalCode,
          x.shipping?.phone,
          x.shipping?.notes,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return s.includes(term);
      })
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }, [list, q, showProcessed]);

  async function markProcessed(id: string) {
    try {
      await patch(`/admin/shipments/confirmations/${encodeURIComponent(id)}/process`, { processed: true });
      toast.success("Procesado. Se notificó al usuario el envío del kit.");
      load();
    } catch (e: any) {
      toast.error(e?.message || "No se pudo marcar como procesado");
    }
  }

  function openQR(item: ShipConfirmation) {
    if (!item.shipping) {
      toast.error("No hay datos de envío");
      return;
    }
    const payload = {
      kind: "shipment-kit",
      confirmationId: item._id,
      inboxId: item.inboxId || null,
      userSub: item.userSub || null,
      quote: {
        id: item.quoteId || null,
        idExt: item.quoteIdExt || null,
        modelIdExt: item.modelIdExt || null,
      },
      shipping: item.shipping || null,
      createdAt: item.createdAt,
    };
    const text = JSON.stringify(payload);
    const baseName =
      item.quoteIdExt ||
      item.quoteId ||
      item.modelIdExt ||
      item._id;

    setQrText(text);
    setQrFileBase(`kit_${baseName}`);
    setQrOpen(true);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Validación de envíos</h1>
          <p className="text-sm text-gray-600">
            Confirmaciones de usuarios (dirección de envío y datos de contacto).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por Quote ID, nombre, ciudad…"
              className="w-72 rounded-lg border bg-white pl-8 pr-3 py-2 text-sm outline-none ring-0 focus:border-slate-400"
            />
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={showProcessed}
              onChange={(e) => setShowProcessed(e.target.checked)}
            />
            Mostrar procesadas
          </label>
          <button className="btn-secondary" onClick={load} disabled={loading}>
            <RefreshCcw className="h-4 w-4" />
            {loading ? "Actualizando…" : "Actualizar"}
          </button>
        </div>
      </div>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-xl border bg-white p-8 text-center text-gray-600">
          {loading ? "Cargando…" : "Sin confirmaciones"}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Confirmado</th>
                <th className="px-3 py-2 font-medium">Quote</th>
                <th className="px-3 py-2 font-medium">Modelo</th>
                <th className="px-3 py-2 font-medium">Usuario</th>
                <th className="px-3 py-2 font-medium">Dirección</th>
                <th className="px-3 py-2 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => (
                <tr key={it._id} className="border-t">
                  <td className="px-3 py-2 align-top">
                    <div>{formatDateTime(it.createdAt)}</div>
                    {it.processedAt ? (
                      <div className="text-xs text-green-700">
                        Procesada ({formatDateTime(it.processedAt)})
                      </div>
                    ) : (
                      <div className="text-xs text-amber-700">Pendiente</div>
                    )}
                    {it.inboxId && (
                      <div className="mt-1 text-[11px] text-gray-500">
                        inbox: {it.inboxId}
                      </div>
                    )}
                  </td>

                  <td className="px-3 py-2 align-top">
                    <div className="font-mono">
                      {it.quoteId || it.quoteIdExt || "—"}
                    </div>
                    <button
                      className="mt-1 inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs hover:bg-gray-50"
                      onClick={() =>
                        copy(it.quoteId || it.quoteIdExt || "")
                      }
                    >
                      <Copy className="h-3.5 w-3.5" /> Copiar
                    </button>
                  </td>

                  <td className="px-3 py-2 align-top">
                    <div className="font-mono">{it.modelIdExt || "—"}</div>
                  </td>

                  <td className="px-3 py-2 align-top">
                    <div className="font-mono">{it.userSub || "—"}</div>
                  </td>

                  <td className="px-3 py-2 align-top">
                    {it.shipping ? (
                      <div className="space-y-0.5">
                        <div>
                          <span className="font-medium">{it.shipping.fullName}</span>
                        </div>
                        <div>{it.shipping.addressLine1}</div>
                        {it.shipping.addressLine2 && <div>{it.shipping.addressLine2}</div>}
                        <div>
                          {it.shipping.city}{it.shipping.state ? `, ${it.shipping.state}` : ""} {it.shipping.postalCode || ""}
                        </div>
                        {it.shipping.phone && <div>Tel: {it.shipping.phone}</div>}
                        {it.shipping.notes && <div>Notas: {it.shipping.notes}</div>}
                      </div>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>

                  <td className="px-3 py-2 align-top">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        className="btn-secondary"
                        onClick={() => openQR(it)}
                        title="Ver QR / etiqueta"
                      >
                        <QrCode className="h-4 w-4" />
                        QR / etiqueta
                      </button>

                      <button
                        className="btn-primary disabled:opacity-60"
                        onClick={() => markProcessed(it._id)}
                        disabled={!!it.processedAt}
                        title="Marcar como procesado"
                      >
                        <Check className="h-4 w-4" />
                        Procesar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal QR (SVG + descarga PNG) */}
      {qrOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-xl border bg-white shadow-lg">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <h3 className="text-lg font-semibold">Etiqueta / QR del kit</h3>
              <button
                className="rounded-md p-1 hover:bg-gray-100"
                onClick={() => setQrOpen(false)}
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-5 py-4">
              {qrText ? (
                <div className="flex flex-col items-center">
                  {/* SVG (react-qr-code) */}
                  <div className="rounded-lg border bg-white p-2" ref={qrBoxRef}>
                    <QRCode value={qrText} size={QR_SIZE} bgColor="#ffffff" fgColor="#000000" />
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="btn-secondary inline-flex items-center gap-2"
                      onClick={() => {
                        const svg = qrBoxRef.current?.querySelector("svg") as SVGSVGElement | null;
                        if (svg) downloadSvg(svg, `${qrFileBase}.svg`);
                        else toast.error("No se encontró el SVG del QR");
                      }}
                    >
                      <Download className="h-4 w-4" />
                      Descargar SVG
                    </button>

                    <button
                      className="btn-secondary inline-flex items-center gap-2"
                      onClick={() => {
                        const svg = qrBoxRef.current?.querySelector("svg") as SVGSVGElement | null;
                        if (svg) downloadSvgAsPng(svg, `${qrFileBase}.png`, QR_SIZE);
                        else toast.error("No se pudo generar el PNG");
                      }}
                    >
                      <Download className="h-4 w-4" />
                      Descargar PNG
                    </button>
                  </div>

                  <details className="mt-4 w-full">
                    <summary className="cursor-pointer text-sm text-gray-600">Ver contenido del QR</summary>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs text-gray-700">
                      {qrText}
                    </pre>
                  </details>
                </div>
              ) : (
                <div className="py-10 text-center text-gray-600">Generando QR…</div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t px-5 py-3">
              <button className="btn-secondary" onClick={() => setQrOpen(false)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
