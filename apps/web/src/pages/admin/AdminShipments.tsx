// apps/web/src/pages/admin/AdminShipments.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { get, patch } from "../../lib/api";
import {
  RefreshCcw,
  Search,
  Check,
  PackageCheck,
  Download,
  QrCode,
  X,
  Copy,
  Printer,
  User,
  MapPin,
  FileText,
} from "lucide-react";
import QRCode from "react-qr-code";

/* ======================= Tipos ======================= */
type ShipAddr = {
  fullName: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state?: string;
  postalCode?: string;
  phone?: string;
  notes?: string;
};

type Confirmation = {
  _id: string;
  inboxId?: string | null;
  userSub?: string | null;
  quoteId?: string | null;
  reportId?: string | null;
  modelIdExt?: string | null;
  // puede venir en cualquiera de los dos campos:
  address?: ShipAddr | null;
  shipping?: ShipAddr | null;
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
    return iso as string;
  }
}

function copyToClipboard(s: string) {
  if (!s) return;
  navigator.clipboard.writeText(s).catch(() => alert("No se pudo copiar"));
}

/** Normaliza la dirección venga en `address` o `shipping` */
function getAddr(item: Confirmation): ShipAddr {
  const src = (item.address as any) || (item.shipping as any) || {};
  return {
    fullName: String(src.fullName || ""),
    addressLine1: String(src.addressLine1 || ""),
    addressLine2: src.addressLine2 ? String(src.addressLine2) : undefined,
    city: String(src.city || ""),
    state: src.state ? String(src.state) : undefined,
    postalCode: src.postalCode ? String(src.postalCode) : undefined,
    phone: src.phone ? String(src.phone) : undefined,
    notes: src.notes ? String(src.notes) : undefined,
  };
}

/** Serializa el SVG y descarga como .svg */
function downloadSvg(svgEl: SVGSVGElement, fileName = "qr.svg") {
  const serializer = new XMLSerializer();
  let source = serializer.serializeToString(svgEl);

  if (!/^<svg[^>]+xmlns=/.test(source)) {
    source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (!/^<svg[^>]+xmlns:xlink=/.test(source)) {
    source = source.replace(
      /^<svg/,
      '<svg xmlns:xlink="http://www.w3.org/1999/xlink"'
    );
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

/** Convierte el SVG a PNG y descarga */
async function downloadSvgAsPng(
  svgEl: SVGSVGElement,
  fileName = "qr.png",
  px = 240
) {
  const serializer = new XMLSerializer();
  let source = serializer.serializeToString(svgEl);

  if (!/^<svg[^>]+xmlns=/.test(source)) {
    source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (!/^<svg[^>]+xmlns:xlink=/.test(source)) {
    source = source.replace(
      /^<svg/,
      '<svg xmlns:xlink="http://www.w3.org/1999/xlink"'
    );
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

/* ======= Construcción de contenidos (QR / Etiqueta) ======= */
function buildQrJson(item: Confirmation) {
  const addr = getAddr(item);
  return {
    kind: "shipment-kit",
    confirmationId: item._id,
    inboxId: item.inboxId || null,
    userSub: item.userSub || null,
    quote: {
      id: item.quoteId || null,
      modelIdExt: item.modelIdExt || null,
      reportId: item.reportId || null,
    },
    shipping: {
      fullName: addr.fullName || null,
      addressLine1: addr.addressLine1 || null,
      addressLine2: addr.addressLine2 || null,
      city: addr.city || null,
      state: addr.state || null,
      postalCode: addr.postalCode || null,
      phone: addr.phone || null,
      notes: addr.notes || null,
    },
    createdAt: item.createdAt,
  };
}

/** Texto legible en español para mostrar al ESCANEAR */
function buildQrTextEs(payload: ReturnType<typeof buildQrJson>) {
  const p = payload;
  const s = p.shipping || ({} as any);
  const q = p.quote || ({} as any);
  return [
    "ReeUtil · Kit de envío",
    `Confirmación: ${p.confirmationId}`,
    `Usuario: ${p.userSub || "—"}`,
    `Quote: ${q.id || "—"} · Modelo: ${q.modelIdExt || "—"}`,
    q.reportId ? `Reporte: ${q.reportId}` : null,
    `Creado: ${formatDT(p.createdAt)}`,
    "",
    "Dirección de envío:",
    `${s.fullName || "—"}`,
    `${s.addressLine1 || "—"}`,
    s.addressLine2 ? `${s.addressLine2}` : null,
    `${s.city || "—"}${s.state ? `, ${s.state}` : ""} ${s.postalCode || ""}`.trim(),
    s.phone ? `Tel: ${s.phone}` : null,
    s.notes ? `Notas: ${s.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Nombre base para archivos */
function baseNameFrom(item: Confirmation) {
  return `kit_${item.quoteId || item.modelIdExt || item.userSub || item._id}`;
}

/** HTML imprimible de etiqueta (A6 apaisado) */
function buildPrintableHtml({
  svgMarkup,
  payload,
  title = "ReeUtil · Kit de envío",
}: {
  svgMarkup: string;
  payload: ReturnType<typeof buildQrJson>;
  title?: string;
}) {
  const addr = payload.shipping || ({} as any);
  const meta = payload.quote || ({} as any);

  const addrLines = [
    addr.fullName,
    addr.addressLine1,
    addr.addressLine2,
    `${addr.city || ""}${addr.state ? ", " + addr.state : ""} ${
      addr.postalCode || ""
    }`.trim(),
    addr.phone ? `Tel: ${addr.phone}` : "",
    addr.notes ? `Notas: ${addr.notes}` : "",
  ]
    .filter(Boolean)
    .join("<br/>");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      *{box-sizing:border-box}
      body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial,"Noto Sans",sans-serif; margin:0; padding:0; color:#111; background:#fff}
      .sheet{width:148mm; height:105mm; padding:10mm; display:flex; gap:10mm; align-items:center; justify-content:space-between;}
      .left{flex:0 0 auto; border:1px solid #eee; padding:6px; background:#fff}
      .right{flex:1 1 auto}
      h1{margin:0 0 6px 0; font-size:16px}
      .meta{font-size:12px; color:#333; margin-bottom:8px}
      .block{border:1px dashed #ccc; padding:8px; border-radius:8px; background:#fafafa}
      .small{font-size:12px; color:#444}
      .row{margin-top:8px}
      @media print {.no-print{display:none !important}}
    </style>
  </head>
  <body>
    <div class="sheet">
      <div class="left">${svgMarkup}</div>
      <div class="right">
        <h1>${title}</h1>
        <div class="meta">
          Confirmación: <b>${payload.confirmationId}</b><br/>
          Quote: <b>${meta.id || "—"}</b> · Modelo: <b>${meta.modelIdExt || "—"}</b><br/>
          Usuario: <b>${payload.userSub || "—"}</b><br/>
          Creado: <b>${new Date(payload.createdAt).toLocaleString()}</b>
        </div>
        <div class="block">
          <div class="small">Dirección de envío</div>
          <div>${addrLines || "—"}</div>
        </div>
      </div>
    </div>
    <div class="no-print" style="padding:10px; text-align:center;">
      <button onclick="window.print()">Imprimir</button>
    </div>
  </body>
</html>`;
}

/** Descarga una etiqueta PNG (QR + datos a la derecha) lista para pegar */
async function downloadLabelPngFromSvg(
  svgEl: SVGSVGElement,
  payload: ReturnType<typeof buildQrJson>,
  fileNameBase = "etiqueta"
) {
  const W = 1000;
  const H = 600;
  const P = 32;
  const QR = 360;

  const serializer = new XMLSerializer();
  let source = serializer.serializeToString(svgEl);
  if (!/^<svg[^>]+xmlns=/.test(source)) {
    source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (!/^<svg[^>]+xmlns:xlink=/.test(source)) {
    source = source.replace(
      /^<svg/,
      '<svg xmlns:xlink="http://www.w3.org/1999/xlink"'
    );
  }
  const svgBlob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (e) => reject(e as any);
      img.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;

    const c = canvas.getContext("2d") as CanvasRenderingContext2D | null;
    if (!c) throw new Error("No se pudo obtener el contexto 2D del canvas");

    // Fondo y borde
    c.fillStyle = "#FFFFFF";
    c.fillRect(0, 0, W, H);
    c.strokeStyle = "#E5E7EB";
    c.lineWidth = 2;
    c.strokeRect(0.5, 0.5, W - 1, H - 1);

    // QR (izquierda)
    c.drawImage(img, P, (H - QR) / 2, QR, QR);

    // Texto (derecha)
    const X0 = P + QR + 32;
    let y = P + 8;

    const fontStack =
      'system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, Arial';

    const line = (text: string, size = 28, bold = false) => {
      c.font = `${bold ? "600" : "400"} ${size}px ${fontStack}`;
      c.fillStyle = "#111827";
      c.textBaseline = "top";
      c.fillText(text, X0, y);
      y += size + 10;
    };

    const small = (text: string) => {
      c.font = `400 22px ${fontStack}`;
      c.fillStyle = "#374151";
      c.textBaseline = "top";
      c.fillText(text, X0, y);
      y += 22 + 8;
    };

    const q = payload.quote || ({} as any);
    const s = payload.shipping || ({} as any);

    line("ReeUtil · Kit de envío", 30, true);
    small(`Confirmación: ${payload.confirmationId}`);
    small(`Quote: ${q.id || "—"} · Modelo: ${q.modelIdExt || "—"}`);
    small(`Usuario: ${payload.userSub || "—"}`);
    small(`Creado: ${formatDT(payload.createdAt)}`);

    y += 10;
    line("Dirección de envío", 26, true);
    small(s.fullName || "—");
    small(s.addressLine1 || "—");
    if (s.addressLine2) small(s.addressLine2);
    small(
      `${s.city || "—"}${s.state ? `, ${s.state}` : ""} ${
        s.postalCode || ""
      }`.trim()
    );
    if (s.phone) small(`Tel: ${s.phone}`);
    if (s.notes) small(`Notas: ${s.notes}`);

    const pngUrl = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = pngUrl;
    a.download = `${fileNameBase}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ======================= Componente ======================= */
export default function AdminShipments() {
  const [list, setList] = useState<Confirmation[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | "PENDING" | "PROCESSED">(
    "PENDING"
  );

  // Modal QR
  const [qrOpen, setQrOpen] = useState(false);
  const [qrMode, setQrMode] = useState<"ES" | "JSON">("ES");
  const [qrText, setQrText] = useState("");
  const [qrFileBase, setQrFileBase] = useState("label");
  const [qrPayload, setQrPayload] =
    useState<ReturnType<typeof buildQrJson> | null>(null);
  const qrBoxRef = useRef<HTMLDivElement | null>(null);

  async function load() {
    try {
      setLoading(true);
      setErr("");
      const usp = new URLSearchParams();
      if (status) usp.set("status", status);
      if (q.trim()) usp.set("search", q.trim());
      const data = await get<Confirmation[]>(
        `/admin/shipments/confirmations?${usp.toString()}`
      );
      setList(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setErr(e?.message || "Error al cargar confirmaciones");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // init

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Cerrar modal con Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setQrOpen(false);
    }
    if (qrOpen) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [qrOpen]);

  async function markProcessed(id: string, processed = true) {
    try {
      // ruta nueva
      await patch(
        `/admin/shipments/confirmations/${encodeURIComponent(id)}/process`,
        { processed }
      );
      // fallback legacy lo maneja api.ts automáticamente, no hace falta doble intento aquí
      await load();
    } catch (e: any) {
      alert(e?.message || "No se pudo actualizar");
    }
  }

  const filtered = useMemo(() => list, [list]); // server-side filtering

  /** Abre modal QR */
  function openQR(item: Confirmation) {
    const payload = buildQrJson(item);
    const baseName = baseNameFrom(item);
    setQrPayload(payload);
    setQrFileBase(baseName);
    setQrMode("ES");
    setQrText(buildQrTextEs(payload));
    setQrOpen(true);
  }

  /** Descarga directa (SVG/PNG) con contenido legible ES (por defecto) */
  function downloadRowQR(item: Confirmation, mode: "svg" | "png") {
    const host = document.getElementById(`qrhidden-${item._id}`);
    const svg = host?.querySelector("svg") as SVGSVGElement | null;
    if (!svg) {
      alert("No se pudo generar el QR");
      return;
    }
    const baseName = baseNameFrom(item);
    if (mode === "svg") downloadSvg(svg, `${baseName}.svg`);
    else downloadSvgAsPng(svg, `${baseName}.png`, 240);
  }

  /** Texto de dirección copiable */
  function addressText(payload: ReturnType<typeof buildQrJson> | null) {
    if (!payload?.shipping) return "";
    const s = payload.shipping;
    return [
      s.fullName,
      s.addressLine1,
      s.addressLine2,
      `${s.city || ""}${s.state ? `, ${s.state}` : ""} ${s.postalCode || ""}`.trim(),
      s.phone ? `Tel: ${s.phone}` : "",
      s.notes ? `Notas: ${s.notes}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  /** Imprimir etiqueta A6 desde el modal */
  function printLabelFromModal() {
    const svg = qrBoxRef.current?.querySelector("svg") as SVGSVGElement | null;
    if (!svg || !qrPayload) {
      alert("No se pudo preparar la etiqueta");
      return;
    }
    const svgMarkup = svg.outerHTML;
    const html = buildPrintableHtml({
      svgMarkup,
      payload: qrPayload,
      title: "ReeUtil · Kit de envío",
    });
    const w = window.open("", "_blank", "noopener,noreferrer");
    if (!w) {
      alert("Bloqueado por el navegador. Habilita ventanas emergentes.");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  /** Descargar etiqueta PNG desde el modal (lista para pegar) */
  function downloadLabelPngFromModal() {
    const svg = qrBoxRef.current?.querySelector("svg") as SVGSVGElement | null;
    if (!svg || !qrPayload) {
      alert("No se pudo preparar la etiqueta");
      return;
    }
    downloadLabelPngFromSvg(svg, qrPayload, qrFileBase);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Validación de envíos</h1>
          <p className="text-sm text-gray-600">
            Confirmaciones de usuarios (dirección de envío y datos de contacto).
          </p>
        </div>
      </header>

      {/* Filtros */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por Quote ID, nombre, ciudad…"
            className="w-80 rounded-lg border bg-white pl-8 pr-3 py-2 text-sm outline-none ring-0 focus:border-slate-400"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as any)}
            className="rounded-lg border bg-white px-3 py-2 text-sm"
          >
            <option value="PENDING">Pendientes</option>
            <option value="PROCESSED">Procesadas</option>
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
          {loading ? "Cargando…" : "Sin confirmaciones"}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2">Confirmado</th>
                <th className="px-3 py-2">Quote</th>
                <th className="px-3 py-2">Modelo</th>
                <th className="px-3 py-2">Usuario</th>
                <th className="px-3 py-2">Dirección</th>
                <th className="px-3 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((x) => {
                const payload = buildQrJson(x);
                const textEs = buildQrTextEs(payload);
                const baseName = baseNameFrom(x);
                const addr = payload.shipping || ({} as any);
                return (
                  <tr key={x._id} className="border-t">
                    <td className="px-3 py-2 whitespace-nowrap align-top">
                      {formatDT(x.createdAt)}
                      <div className="text-xs">
                        {x.status === "PROCESSED" ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-800">
                            <Check className="h-3.5 w-3.5" />
                            Procesada{" "}
                            {x.processedAt ? `(${formatDT(x.processedAt)})` : ""}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-800">
                            Pendiente
                          </span>
                        )}
                      </div>
                      {x.inboxId && (
                        <div className="mt-1 text-[11px] text-gray-500">
                          inbox: {x.inboxId}
                        </div>
                      )}
                    </td>

                    <td className="px-3 py-2 align-top">
                      <div className="font-mono break-all">{x.quoteId || "—"}</div>
                    </td>

                    <td className="px-3 py-2 align-top">
                      <div className="font-mono break-all">
                        {x.modelIdExt || "—"}
                      </div>
                    </td>

                    <td className="px-3 py-2 align-top">
                      <div className="font-mono break-all">{x.userSub || "—"}</div>
                    </td>

                    <td className="px-3 py-2 align-top">
                      <div className="font-medium">{addr.fullName || "—"}</div>
                      <div>{addr.addressLine1 || "—"}</div>
                      {addr.addressLine2 ? (
                        <div>{addr.addressLine2}</div>
                      ) : null}
                      <div>
                        {(addr.city || "—") +
                          (addr.state ? `, ${addr.state}` : "") +
                          (addr.postalCode ? ` ${addr.postalCode}` : "")}
                      </div>
                      {addr.phone ? (
                        <div className="text-xs text-gray-500">
                          Tel: {addr.phone}
                        </div>
                      ) : null}
                      {addr.notes ? (
                        <div className="text-xs text-gray-500">
                          Notas: {addr.notes}
                        </div>
                      ) : null}
                    </td>

                    <td className="px-3 py-2 align-top">
                      {/* QR oculto para descargas directas (contenido ES legible) */}
                      <div
                        id={`qrhidden-${x._id}`}
                        className="absolute -left-[9999px] -top-[9999px]"
                        aria-hidden
                      >
                        <QRCode
                          value={textEs}
                          size={240}
                          bgColor="#ffffff"
                          fgColor="#000000"
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          className="btn-secondary"
                          onClick={() => openQR(x)}
                          title="Ver QR / etiqueta"
                        >
                          <QrCode className="h-4 w-4" />
                          QR / etiqueta
                        </button>

                        <button
                          className="btn-secondary"
                          onClick={() => downloadRowQR(x, "svg")}
                          title="Descargar QR (SVG)"
                        >
                          <Download className="h-4 w-4" />
                          QR SVG
                        </button>
                        <button
                          className="btn-secondary"
                          onClick={() => downloadRowQR(x, "png")}
                          title="Descargar QR (PNG)"
                        >
                          <Download className="h-4 w-4" />
                          QR PNG
                        </button>

                        {x.status === "PENDING" ? (
                          <button
                            className="btn-primary"
                            onClick={() => markProcessed(x._id, true)}
                            title="Marcar como procesada"
                          >
                            <PackageCheck className="h-4 w-4" />
                            Procesar
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal QR — con scroll y encabezado/ pie fijos */}
      {qrOpen && (
        <div className="fixed inset-0 z-50">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setQrOpen(false)}
            aria-hidden="true"
          />
          {/* Scroll container */}
          <div className="absolute inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <div className="w-full max-w-3xl rounded-xl border bg-white shadow-lg flex flex-col max-h-[90vh]">
                {/* Header (sticky) */}
                <div className="flex items-center justify-between border-b px-5 py-3 sticky top-0 bg-white">
                  <h3 className="text-lg font-semibold">Etiqueta / QR del kit</h3>
                  <button
                    className="rounded-md p-1 hover:bg-gray-100"
                    onClick={() => setQrOpen(false)}
                    aria-label="Cerrar"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                {/* Selector de formato */}
                <div className="border-b px-5 py-3 flex items-center gap-2">
                  <span className="text-sm text-gray-600">Contenido del QR:</span>
                  <div className="flex gap-2">
                    <button
                      className={`rounded-full border px-3 py-1 text-sm ${
                        qrMode === "ES"
                          ? "bg-black text-white border-black"
                          : "bg-white hover:bg-gray-50 border-gray-300 text-gray-700"
                      }`}
                      onClick={() => {
                        if (qrPayload) setQrText(buildQrTextEs(qrPayload));
                        setQrMode("ES");
                      }}
                    >
                      Legible (ES)
                    </button>
                    <button
                      className={`rounded-full border px-3 py-1 text-sm ${
                        qrMode === "JSON"
                          ? "bg-black text-white border-black"
                          : "bg-white hover:bg-gray-50 border-gray-300 text-gray-700"
                      }`}
                      onClick={() => {
                        if (qrPayload) setQrText(JSON.stringify(qrPayload));
                        setQrMode("JSON");
                      }}
                    >
                      JSON
                    </button>
                  </div>
                </div>

                {/* Contenido (scrollable) */}
                <div className="px-5 py-4 overflow-y-auto">
                  {qrText && qrPayload ? (
                    <div className="grid gap-5 sm:grid-cols-[260px,1fr]">
                      {/* QR grande */}
                      <div className="flex flex-col items-center">
                        <div className="rounded-lg border bg-white p-2" ref={qrBoxRef}>
                          <QRCode
                            value={qrText}
                            style={{ width: 240, height: 240 }}
                            bgColor="#ffffff"
                            fgColor="#000000"
                          />
                        </div>

                        {/* Acciones del QR */}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            className="btn-secondary"
                            onClick={() => {
                              const svg = qrBoxRef.current?.querySelector(
                                "svg"
                              ) as SVGSVGElement | null;
                              if (svg) downloadSvg(svg, `${qrFileBase}.svg`);
                              else alert("No se encontró el SVG del QR");
                            }}
                            title="Descargar QR (SVG)"
                          >
                            <Download className="h-4 w-4" />
                            QR SVG
                          </button>
                          <button
                            className="btn-secondary"
                            onClick={() => {
                              const svg = qrBoxRef.current?.querySelector(
                                "svg"
                              ) as SVGSVGElement | null;
                              if (svg) downloadSvgAsPng(svg, `${qrFileBase}.png`, 240);
                              else alert("No se pudo generar el PNG");
                            }}
                            title="Descargar QR (PNG)"
                          >
                            <Download className="h-4 w-4" />
                            QR PNG
                          </button>
                          <button
                            className="btn-secondary"
                            onClick={printLabelFromModal}
                            title="Imprimir etiqueta (A6)"
                          >
                            <Printer className="h-4 w-4" />
                            Imprimir etiqueta
                          </button>
                          <button
                            className="btn-secondary"
                            onClick={downloadLabelPngFromModal}
                            title="Descargar etiqueta (PNG)"
                          >
                            <Download className="h-4 w-4" />
                            Etiqueta PNG
                          </button>
                        </div>
                      </div>

                      {/* Resumen y dirección */}
                      <div className="space-y-4">
                        <section className="rounded-lg border bg-gray-50 p-3">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <User className="h-4 w-4" />
                            Resumen
                          </div>
                          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 text-sm">
                            <div>
                              <div className="text-gray-500">Confirmación</div>
                              <div className="font-mono break-all">
                                {qrPayload.confirmationId}
                              </div>
                            </div>
                            <div>
                              <div className="text-gray-500">Usuario</div>
                              <div className="font-mono break-all">
                                {qrPayload.userSub || "—"}
                              </div>
                            </div>
                            <div>
                              <div className="text-gray-500">Quote</div>
                              <div className="font-mono break-all">
                                {qrPayload.quote?.id || "—"}
                              </div>
                            </div>
                            <div>
                              <div className="text-gray-500">Modelo</div>
                              <div className="font-mono break-all">
                                {qrPayload.quote?.modelIdExt || "—"}
                              </div>
                            </div>
                            <div>
                              <div className="text-gray-500">Reporte</div>
                              <div className="font-mono break-all">
                                {qrPayload.quote?.reportId || "—"}
                              </div>
                            </div>
                            <div>
                              <div className="text-gray-500">Creado</div>
                              <div>{formatDT(qrPayload.createdAt)}</div>
                            </div>
                          </div>

                          <div className="mt-2">
                            <button
                              className="btn-secondary"
                              onClick={() =>
                                copyToClipboard(
                                  [
                                    `Confirmación: ${qrPayload.confirmationId}`,
                                    `Usuario: ${qrPayload.userSub || "—"}`,
                                    `Quote: ${qrPayload.quote?.id || "—"}`,
                                    `Modelo: ${qrPayload.quote?.modelIdExt || "—"}`,
                                    `Reporte: ${qrPayload.quote?.reportId || "—"}`,
                                    `Creado: ${formatDT(qrPayload.createdAt)}`,
                                  ].join("\n")
                                )
                              }
                            >
                              <Copy className="h-4 w-4" />
                              Copiar resumen
                            </button>
                          </div>
                        </section>

                        <section className="rounded-lg border bg-white p-3">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <MapPin className="h-4 w-4" />
                            Dirección de envío
                          </div>
                          <div className="mt-2 text-sm leading-5">
                            <div className="font-medium">
                              {qrPayload.shipping?.fullName || "—"}
                            </div>
                            <div>{qrPayload.shipping?.addressLine1 || "—"}</div>
                            {qrPayload.shipping?.addressLine2 ? (
                              <div>{qrPayload.shipping?.addressLine2}</div>
                            ) : null}
                            <div>
                              {(qrPayload.shipping?.city || "—") +
                                (qrPayload.shipping?.state
                                  ? `, ${qrPayload.shipping?.state}`
                                  : "") +
                                (qrPayload.shipping?.postalCode
                                  ? ` ${qrPayload.shipping?.postalCode}`
                                  : "")}
                            </div>
                            {qrPayload.shipping?.phone ? (
                              <div className="text-gray-600">
                                Tel: {qrPayload.shipping?.phone}
                              </div>
                            ) : null}
                            {qrPayload.shipping?.notes ? (
                              <div className="text-gray-600">
                                Notas: {qrPayload.shipping?.notes}
                              </div>
                            ) : null}
                          </div>

                          <div className="mt-2">
                            <button
                              className="btn-secondary"
                              onClick={() => copyToClipboard(addressText(qrPayload))}
                            >
                              <Copy className="h-4 w-4" />
                              Copiar dirección
                            </button>
                          </div>
                        </section>

                        <section className="rounded-lg border bg-white p-3">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <FileText className="h-4 w-4" />
                            Contenido del QR
                          </div>
                          <details className="mt-2" open>
                            <summary className="cursor-pointer text-sm text-gray-600">
                              Ver/ocultar
                            </summary>
                            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs text-gray-800 bg-gray-50 border rounded p-2">
                              {qrMode === "JSON"
                                ? JSON.stringify(qrPayload, null, 2)
                                : qrText}
                            </pre>
                          </details>
                          <div className="mt-2">
                            <button
                              className="btn-secondary"
                              onClick={() =>
                                copyToClipboard(
                                  qrMode === "JSON"
                                    ? JSON.stringify(qrPayload, null, 2)
                                    : qrText
                                )
                              }
                            >
                              <Copy className="h-4 w-4" />
                              Copiar contenido
                            </button>
                          </div>
                        </section>
                      </div>
                    </div>
                  ) : (
                    <div className="py-10 text-center text-gray-600">
                      Generando QR…
                    </div>
                  )}
                </div>

                {/* Footer (sticky) */}
                <div className="flex justify-end gap-2 border-t px-5 py-3 sticky bottom-0 bg-white">
                  <button className="btn-secondary" onClick={() => setQrOpen(false)}>
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
