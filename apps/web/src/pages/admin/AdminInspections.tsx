// AdminInspections.tsx (completo y funcional)
import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  RefreshCcw,
  Search,
  Eye,
  X,
  PackageSearch,
  User,
  Tag,
  FileText,
  CheckCircle2,
  ListChecks,
  Battery,
  MonitorSmartphone,
  HardDrive,
  Wrench,
  Info,
  Clock,
  BadgeCheck,
  Wifi,
  Mic,
  Camera,
  Touchpad,
  PlugZap,
  ToggleLeft,
  Keyboard,
  MousePointer,
  Tv,
  RadioTower,
  Gamepad2,
  Cpu,
  Plug,
  DollarSign,
  Recycle,
  Store,
  ChevronRight,
  ArrowLeft,
  SendHorizonal,
  Check,
  XCircle,
} from "lucide-react";

/* ======================= Tipos ======================= */
type Finding = { label: string; value: string };

type Inspection = {
  _id: string;
  source?: string;
  deliveryId?: string | null;
  confirmationId?: string | null;
  quoteId?: string | null;
  quoteIdExt?: string | null;
  modelIdExt?: string | null;
  userSub?: string | null;
  startedAt?: string | null;
  closedAt?: string | null;
  status: "IN_INSPECTION" | "PASSED" | "FAILED" | "CLOSED";
  notes?: string | null;
  findings?: Finding[];
};

type Status = Inspection["status"] | "";
type QA = { label: string; value: string };

type DeviceType =
  | "phone"
  | "laptop"
  | "tv"
  | "washing_machine"
  | "tablet"
  | "console"
  | "desktop"
  | "unknown";

type RiskResult = { level: "Bajo" | "Medio" | "Alto"; color: string; reasons: string[] };
type OfferStatus = "NONE" | "SENT" | "ACCEPTED" | "REJECTED";

/* ======================= Utils ======================= */
function formatDT(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}
function cls(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}
function toStr(v: unknown) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
function titleize(s: string) {
  const t = (s || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return t.replace(/(^\w)|(\s\w)/g, (m) => m.toUpperCase());
}
function niceStatus(s: string) {
  return (s || "").split("_").join(" ");
}

/* ======================= Config ======================= */
const SHIPMENT_API = (import.meta.env.VITE_SHIPMENT_API || "http://localhost:3031").replace(/\/+$/, "");
const PAYOUT_API   = (import.meta.env.VITE_PAYOUT_API   || "http://localhost:3051").replace(/\/+$/, "");
const QUOTE_API    = (import.meta.env.VITE_QUOTE_API    || SHIPMENT_API).replace(/\/+$/, "");
const NOTIFY_API   = (import.meta.env.VITE_NOTIFY_API   || "http://localhost:3061").replace(/\/+$/, "");

/* ======================= Fetch helpers ======================= */
async function GET_ABS<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  const ctype = res.headers.get("content-type") || "";
  const isJson = ctype.includes("application/json");
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new Error(typeof body === "string" && body ? body : res.statusText);
  return body as T;
}
async function PATCH_ABS<T>(url: string, data: any): Promise<T> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  const ctype = res.headers.get("content-type") || "";
  const isJson = ctype.includes("application/json");
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new Error(typeof body === "string" && body ? body : res.statusText);
  return body as T;
}
/** POST payout-svc */
async function POST_PAYOUT(body: { quote_id_ext: string; method: "Transferencia" | "Depósito"; amount: number }) {
  const res = await fetch(`${PAYOUT_API}/payouts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = (await res.text()) || res.statusText;
    throw new Error(msg);
  }
  return res.json() as Promise<{ id: string }>;
}

/** POST opcional (devuelve true si 2xx, false si 404) para contraoferta */
async function POST_OPTIONAL(url: string, data: any): Promise<boolean> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (res.status === 404) return false;
  if (!res.ok) {
    const msg = (await res.text()) || res.statusText;
    throw new Error(msg);
  }
  return true;
}

/** Bandeja de notificaciones */
async function POST_NOTIFY_INBOX(payload: {
  userSub?: string | null;
  confirmationId?: string | null;
  quoteId?: string | null;
  quoteIdExt?: string | null;
  modelIdExt?: string | null;
  title: string;
  body: string;
  meta?: any;
}) {
  const baseDoc = {
    userSub: payload.userSub || null,
    title: payload.title,
    body: payload.body,
    meta: {
      quoteId: payload.quoteId || null,
      quoteIdExt: payload.quoteIdExt || null,
      modelIdExt: payload.modelIdExt || null,
      confirmationId: payload.confirmationId || null,
      ...(payload.meta || {}),
    },
  };

  // preferir notify-svc /send
  try {
    const res = await fetch(`${NOTIFY_API}/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        to_sub: baseDoc.userSub,
        title: baseDoc.title,
        body: baseDoc.body,
        meta: baseDoc.meta,
      }),
    });
    if (res.ok) return true;
  } catch {}

  // compat /inbox
  try {
    const res = await fetch(`${NOTIFY_API}/inbox`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        user_sub: baseDoc.userSub,
        title: baseDoc.title,
        body: baseDoc.body,
      }),
    });
    if (res.ok) return true;
  } catch {}

  throw new Error("No se pudo persistir la notificación en notify-svc.");
}

/* ======================= Helpers de cotización ======================= */
function getNumberAtPaths(obj: any, paths: string[]): number | null {
  const parseNum = (v: any): number | null => {
    if (v == null) return null;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const only = v.trim().replace(/[^\d.,-]/g, "");
      const normalized =
        only.includes(",") && !only.includes(".")
          ? only.replace(",", ".")
          : only.replace(/(?<=\d)[.,](?=\d{3}\b)/g, "").replace(",", ".");
      const n = Number(normalized);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };

  for (const p of paths) {
    const v = p.split(".").reduce((acc, k) => (acc ? (acc as any)[k] : undefined), obj as any);
    const n = parseNum(v);
    if (n != null && Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function extractCurrencyFlexible(quoteObj: any): string | null {
  const directKeys = ["currency", "curr", "moneda"];
  for (const k of directKeys) {
    const v = quoteObj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim().toUpperCase();
  }
  const nestedKeys = [
    "quote.currency","data.currency","payload.currency",
    "pricing.currency","result.currency","summary.currency","confirmation.currency",
    "answers.currency"
  ];
  for (const path of nestedKeys) {
    const v = path.split(".").reduce((acc, k) => (acc ? (acc as any)[k] : undefined), quoteObj as any);
    if (typeof v === "string" && v.trim()) return v.trim().toUpperCase();
  }
  const candidates = [
    "prelimPrice","offeredPrice","payout","offer","price","amount","valuation","total","monto",
    "answers.prelimPrice","answers.offeredPrice"
  ];
  for (const c of candidates) {
    const v = c.split(".").reduce((acc, k) => (acc ? (acc as any)[k] : undefined), quoteObj as any);
    if (typeof v === "string") {
      const m = v.match(/\b([A-Z]{3})\b/);
      if (m) return m[1].toUpperCase();
    }
  }
  return null;
}

async function fetchQuoteAny(detail: Inspection): Promise<{ quote: any; via: string } | null> {
  try {
    const q = await GET_ABS<any>(`${SHIPMENT_API}/admin/inspections/${encodeURIComponent(detail._id)}/quote`);
    if (q) return { quote: q, via: "inspections/:id/quote (shipment)" };
  } catch {}

  try {
    if (detail.confirmationId) {
      const conf = await GET_ABS<any>(`${SHIPMENT_API}/admin/confirmations/${encodeURIComponent(detail.confirmationId)}`);
      const embedded = conf?.quote ?? conf?.data?.quote ?? conf?.payload?.quote ?? null;
      if (embedded) return { quote: embedded, via: "confirmations/:id (embedded quote)" };

      const qidFromConf =
        conf?.quote_id_ext ||
        conf?.quoteIdExt ||
        conf?.quoteId ||
        conf?.data?.quote_id_ext ||
        null;

      if (qidFromConf) {
        try {
          const q = await GET_ABS<any>(`${QUOTE_API}/admin/quotes/${encodeURIComponent(qidFromConf)}`);
          if (q) return { quote: q, via: "quotes-svc /admin/quotes/:id (from confirmation)" };
        } catch {}
        try {
          const q = await GET_ABS<any>(`${QUOTE_API}/quotes/${encodeURIComponent(qidFromConf)}`);
          if (q) return { quote: q, via: "quotes-svc /quotes/:id (from confirmation)" };
        } catch {}
      }
    }
  } catch {}

  try {
    const qid = detail.quoteIdExt || detail.quoteId;
    if (qid) {
      try {
        const q = await GET_ABS<any>(`${QUOTE_API}/admin/quotes/${encodeURIComponent(qid)}`);
        if (q) return { quote: q, via: "quotes-svc /admin/quotes/:id" };
      } catch {}
      try {
        const q = await GET_ABS<any>(`${QUOTE_API}/quotes/${encodeURIComponent(qid)}`);
        if (q) return { quote: q, via: "quotes-svc /quotes/:id" };
      } catch {}
      try {
        const q = await GET_ABS<any>(`${SHIPMENT_API}/admin/quotes/${encodeURIComponent(qid)}`);
        if (q) return { quote: q, via: "shipment /admin/quotes/:id (legacy)" };
      } catch {}
    }
  } catch {}

  return null;
}

function extractSuggestedAmountFlexible(quoteObj: any, answers: QA[]): number | null {
  if (!quoteObj) return null;

  const directOrder = [
    "prelimPrice","offeredPrice","payout","offer","price","amount","valuation","total","monto",
    "prelim_price","offered_price",
    "answers.prelimPrice","answers.offeredPrice","answers.payout","answers.offer","answers.price","answers.amount"
  ];
  const rootHit = getNumberAtPaths(quoteObj, directOrder);
  if (rootHit) return rootHit;

  const nestedPaths = [
    "summary.prelimPrice","summary.offeredPrice",
    "result.prelimPrice","result.offeredPrice",
    "data.prelimPrice","data.offeredPrice",
    "payload.prelimPrice","payload.offeredPrice",
    "confirmation.amount","confirmation.offer.amount","confirmation.quote.amount",
    "data.amount","data.offer.amount","data.quote.amount",
    "quote.amount","quote.offer.amount",
    "payload.amount","payload.offer.amount",
    "pricing.amount","result.amount","summary.amount"
  ];
  const nested = getNumberAtPaths(quoteObj, nestedPaths);
  if (nested) return nested;

  return guessPayoutFromQuote(quoteObj, answers);
}

/* ======================= UI básicos ======================= */
function StatusBadge({ status, large }: { status: Inspection["status"]; large?: boolean }) {
  const map: Record<Inspection["status"], string> = {
    IN_INSPECTION: "bg-amber-50 text-amber-700 border-amber-200",
    PASSED: "bg-emerald-50 text-emerald-700 border-emerald-200",
    FAILED: "bg-rose-50 text-rose-700 border-rose-200",
    CLOSED: "bg-gray-50 text-gray-700 border-gray-200",
  };
  const icon =
    status === "PASSED" ? <BadgeCheck className={large ? "h-5 w-5" : "h-4 w-4"} /> :
    status === "FAILED" ? <XCircle className={large ? "h-5 w-5" : "h-4 w-4"} /> :
    status === "IN_INSPECTION" ? <Clock className={large ? "h-5 w-5" : "h-4 w-4"} /> :
    <FileText className={large ? "h-5 w-5" : "h-4 w-4"} />;

  return (
    <span className={cls(
      "inline-flex items-center gap-2 rounded-full border px-3 py-1 font-medium",
      large ? "text-sm" : "text-xs",
      map[status]
    )}>
      {icon}
      {niceStatus(status)}
    </span>
  );
}

function SectionCard({
  icon,
  title,
  children,
  right,
}: {
  icon?: React.ReactNode;
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <div className="font-medium">{title}</div>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

/* ======================= Modal ======================= */
function Modal({
  open,
  title,
  onClose,
  footer,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />
      <div className="absolute inset-0 p-4 sm:p-8 flex items-center justify-center overflow-auto">
        <div className="w-full max-w-5xl rounded-xl border bg-white shadow-xl max-h-[90vh] flex flex-col">
          <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-white z-10">
            <h3 className="text-lg font-semibold">{title}</h3>
            <button
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
              Cerrar
            </button>
          </div>
          <div className="p-4 overflow-y-auto">{children}</div>
          {footer ? (
            <div className="p-3 border-t bg-white sticky bottom-0">
              <div className="flex flex-wrap items-center justify-end gap-2">{footer}</div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ======================= Checklists por tipo ======================= */
type ChecklistItem = { key: string; label: string };

const CHECKLIST_TEMPLATES: Record<DeviceType, ChecklistItem[]> = {
  phone: [
    { key: "camera", label: "Cámara" },
    { key: "mic_speaker", label: "Micrófono / Parlante" },
    { key: "charge_port", label: "Puerto de carga" },
    { key: "wifi_bt", label: "Wi-Fi / Bluetooth" },
    { key: "touch_display", label: "Pantalla táctil" },
    { key: "buttons", label: "Botones físicos" },
  ],
  laptop: [
    { key: "display", label: "Display (manchas/líneas)" },
    { key: "keyboard", label: "Teclado" },
    { key: "trackpad", label: "Trackpad" },
    { key: "battery_health", label: "Batería / Ciclos" },
    { key: "ports", label: "Puertos (USB/HDMI/Audio)" },
    { key: "wifi_bt", label: "Wi-Fi / Bluetooth" },
  ],
  tv: [
    { key: "panel", label: "Panel (manchas/líneas/píxeles)" },
    { key: "inputs", label: "Entradas (HDMI/USB/Antena)" },
    { key: "speakers", label: "Audio integrado" },
    { key: "remote", label: "Control remoto" },
    { key: "wifi", label: "Conectividad (Wi-Fi/Ethernet)" },
  ],
  washing_machine: [
    { key: "drum_spin", label: "Tambor / Centrifugado" },
    { key: "water_in_out", label: "Entrada / Salida de agua" },
    { key: "leaks", label: "Fugas visibles" },
    { key: "vibration", label: "Vibración / Ruido" },
    { key: "control_panel", label: "Panel / Botonera" },
  ],
  tablet: [
    { key: "touch_display", label: "Pantalla táctil" },
    { key: "battery_health", label: "Batería" },
    { key: "ports", label: "Puertos" },
    { key: "wifi_bt", label: "Wi-Fi / Bluetooth" },
    { key: "buttons", label: "Botones" },
  ],
  console: [
    { key: "hdmi_out", label: "Salida HDMI" },
    { key: "usb_ports", label: "Puertos USB" },
    { key: "optical_drive", label: "Lector (si aplica)" },
    { key: "fan_noise", label: "Ventilación / Ruido" },
    { key: "controller_sync", label: "Sincronización mandos" },
    { key: "network", label: "Conectividad (LAN/Wi-Fi)" },
  ],
  desktop: [
    { key: "video_out", label: "Salida de video" },
    { key: "usb_ports", label: "USB/Audio frontal" },
    { key: "storage_health", label: "Almacenamiento (SMART)" },
    { key: "fan_noise", label: "Ventilación / Ruido" },
    { key: "network", label: "Red (LAN/Wi-Fi)" },
  ],
  unknown: [
    { key: "power_on", label: "Enciende" },
    { key: "physical", label: "Integridad física" },
    { key: "io", label: "Conectividad I/O" },
  ],
};

const COLORS = {
  Alto:  "text-rose-700 bg-rose-50 border-rose-200",
  Medio: "text-amber-700 bg-amber-50 border-amber-200",
  Bajo:  "text-emerald-700 bg-emerald-50 border-emerald-200",
};

/* ======================= Reglas de riesgo ======================= */
type Rule = { when: (L: string, V: string, raw: string) => number | { score: number; reason?: string } };

const RISK_RULES: Record<DeviceType, Rule[]> = {
  phone: [
    { when: (_l, _v, raw) => (/pantalla|display|screen/.test(raw) && /(quebrad|rota|línea|manch|crack|dead)/i.test(raw)) ? {score:3, reason:"Pantalla dañada declarada"} : 0 },
    { when: (l, v) => (/bateri|battery/.test(l) && /(no|false)/.test(v)) ? {score:2, reason:"Batería no OK"} : 0 },
    { when: (l, _v, raw) => (/(almacenamiento|storage|gb)/.test(l) && Number(raw.replace(/[^\d.]/g,"")) < 32) ? {score:1, reason:"Almacenamiento bajo"} : 0 },
  ],
  laptop: [
    { when: (_l, _v, raw) => (/display|pantalla/.test(raw) && /(manch|línea|bleed|dead|pixel)/i.test(raw)) ? {score:2, reason:"Posibles defectos de display"} : 0 },
    { when: (l, v) => (/bateri|ciclos|battery/.test(l) && /(mala|pobre|debil|weak|replace|> ?800|alta)/i.test(v)) ? {score:2, reason:"Batería deteriorada"} : 0 },
    { when: (_l, _v, raw) => (/teclado|keyboard|trackpad/.test(raw) && /(no|falla|broken|dead)/i.test(raw)) ? {score:2, reason:"Entradas con fallas"} : 0 },
  ],
  tv: [
    { when: (_l, _v, raw) => (/panel|pantalla/.test(raw) && /(línea|mancha|pixel|quebrad|rota)/i.test(raw)) ? {score:3, reason:"Panel con daños"} : 0 },
    { when: (_l, _v, raw) => (/hdmi|entrad(a|as)|input|usb/.test(raw) && /(no funciona|falla|intermit)/i.test(raw)) ? {score:2, reason:"Entradas con fallas"} : 0 },
    { when: (_l, _v, raw) => (/audio|parlante|speaker/.test(raw) && /(distorsi|ruido|falla)/i.test(raw)) ? {score:1, reason:"Audio a revisar"} : 0 },
  ],
  washing_machine: [
    { when: (_l, _v, raw) => (/fuga|leak|agua|mojad/.test(raw)) ? {score:3, reason:"Posible fuga de agua"} : 0 },
    { when: (_l, _v, raw) => (/vibraci[oó]n|ruido|desbalance/.test(raw)) ? {score:2, reason:"Vibración/ruido anómalo"} : 0 },
    { when: (_l, _v, raw) => (/centrifug|spin|gira/.test(raw) && /(no|falla)/i.test(raw)) ? {score:2, reason:"Centrifugado con fallas"} : 0 },
  ],
  tablet: [
    { when: (_l, _v, raw) => (/pantalla|display|touch/.test(raw) && /(quebrad|rota|sin respuesta|dead)/i.test(raw)) ? {score:3, reason:"Pantalla/touch con fallas"} : 0 },
    { when: (l, v) => (/bateri|battery/.test(l) && /(no|false)/.test(v)) ? {score:2, reason:"Batería no OK"} : 0 },
  ],
  console: [
    { when: (_l, _v, raw) => (/hdmi|video/.test(raw) && /(no|falla)/i.test(raw)) ? {score:3, reason:"Salida de video con fallas"} : 0 },
    { when: (_l, _v, raw) => (/ventilaci[oó]n|fan|ruido/.test(raw) && /(alto|an[oó]malo|falla)/i.test(raw)) ? {score:2, reason:"Ventilación/ruido"} : 0 },
    { when: (_l, _v, raw) => (/lector|disco|optical/.test(raw) && /(no|falla)/i.test(raw)) ? {score:1, reason:"Lector con fallas"} : 0 },
  ],
  desktop: [
    { when: (_l, _v, raw) => (/video|gpu|display/.test(raw) && /(no|falla)/i.test(raw)) ? {score:3, reason:"Salida de video con fallas"} : 0 },
    { when: (_l, _v, raw) => (/(smart|disco|almacenamiento|storage|hdd|ssd|bad sector)/i.test(raw)) ? {score:2, reason:"Almacenamiento con riesgo"} : 0 },
    { when: (_l, _v, raw) => (/ventilaci[oó]n|fan|ruido/.test(raw) && /(alto|an[oó]malo|falla)/i.test(raw)) ? {score:1, reason:"Ventilación/ruido"} : 0 },
  ],
  unknown: [
    { when: (_l, _v, raw) => (/no enciende|no prende|no power|dead|brick/i.test(raw)) ? {score:3, reason:"No enciende"} : 0 },
]};

/* ====== Detectar tipo ====== */
function detectDeviceType(qa: QA[], modelIdExt?: string | null): DeviceType {
  const text = (qa.map(q => `${q.label} ${q.value}`).join(" ") + " " + (modelIdExt || "")).toLowerCase();
  const has = (rx: RegExp) => rx.test(text);

  if (has(/iphone|android|celular|smart ?phone|mobile|tel[eé]fono/)) return "phone";
  if (has(/laptop|notebook|macbook|ultrabook/)) return "laptop";
  if (has(/\btv\b|televisor|smart ?tv|oled|lcd|led/)) return "tv";
  if (has(/lavadora|washing ?machine|washer/)) return "washing_machine";
  if (has(/tablet|ipad|galaxy tab/)) return "tablet";
  if (has(/playstation|xbox|nintendo|switch|ps[345]/)) return "console";
  if (has(/desktop|pc de escritorio|torre|workstation/)) return "desktop";
  return "unknown";
}

/* ====== Riesgo ====== */
function computeRiskScoreByType(qa: QA[], deviceType: DeviceType): RiskResult {
  const rules = RISK_RULES[deviceType] || [];
  let score = 0;
  const reasons: string[] = [];
  const s = (x: string) => (x || "").toLowerCase();

  qa.forEach((row) => {
    const L = s(row.label);
    const V = s(row.value);
    const raw = `${row.label} ${row.value}`;
    for (const r of rules) {
      const res = r.when(L, V, raw);
      if (!res) continue;
      const sc = typeof res === "number" ? res : res.score;
      const reason = typeof res === "number" ? undefined : res.reason;
      if (sc > 0) {
        score += sc;
        if (reason && !reasons.includes(reason)) reasons.push(reason);
      }
    }
  });

  const level: RiskResult["level"] = score >= 4 ? "Alto" : score >= 2 ? "Medio" : "Bajo";
  const color = COLORS[level];
  return { level, color, reasons };
}

/* ======================= Agrupación de QA ======================= */
type GroupedQA = {
  summary: Array<{ icon: React.ReactNode; label: string; tone: "ok" | "warn" | "bad" | "info" }>;
  booleans: QA[];
  numbers: QA[];
  texts: QA[];
  misc: QA[];
};

function Pill({ tone, children }: { tone: "ok" | "warn" | "bad" | "info"; children: React.ReactNode }) {
  const map = {
    ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
    warn: "bg-amber-50 text-amber-700 border-amber-200",
    bad: "bg-rose-50 text-rose-700 border-rose-200",
    info: "bg-sky-50 text-sky-700 border-sky-200",
  } as const;
  return (
    <span className={cls("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs", map[tone])}>
      {children}
    </span>
  );
}

function groupQA(qa: QA[]): GroupedQA {
  const booleans: QA[] = [];
  const numbers: QA[] = [];
  const texts: QA[] = [];
  const misc: QA[] = [];
  const summary: GroupedQA["summary"] = [];

  const toBool = (v: string) => {
    const s = (v ?? "").trim().toLowerCase();
    return s === "true" || s === "si" || s === "sí" || s === "yes";
  };

  qa.forEach((row) => {
    const L = row.label?.toLowerCase() || "";
    const Vraw = (row.value ?? "").toString().trim();
    const V = Vraw.toLowerCase();

    if (["true", "false", "si", "sí", "no", "yes"].includes(V)) {
      booleans.push({ ...row, value: toBool(V) ? "Sí" : "No" });
      if (/pantalla|display|screen/.test(L)) {
        const bad = /rota|quebrad|trizad|crack|dead|línea|manch/i.test(Vraw);
        summary.push({
          icon: <MonitorSmartphone className="h-4 w-4" />,
          label: `Pantalla: ${bad ? "daños declarados" : "OK"}`,
          tone: bad ? "bad" : "ok",
        });
      }
      if (/bateri|battery/.test(L)) {
        const ok = toBool(V);
        summary.push({
          icon: <Battery className="h-4 w-4" />,
          label: `Batería: ${ok ? "OK" : "revisar"}`,
          tone: ok ? "ok" : "warn",
        });
      }
      return;
    }

    const num = Number(Vraw);
    if (!Number.isNaN(num) && Vraw !== "") {
      numbers.push(row);
      if (/almacenamiento|storage|ssd|hdd|gb|tb/.test(L)) {
        summary.push({
          icon: <HardDrive className="h-4 w-4" />,
          label: `Almacenamiento: ${num}${/tb/i.test(Vraw) ? "TB" : "GB"}`,
          tone: "info",
        });
      }
      return;
    }

    if (Vraw) {
      texts.push(row);
      if (/pantalla|display|screen/.test(L) && /(quebrad|rot|línea|manch|dead)/i.test(Vraw)) {
        summary.push({
          icon: <MonitorSmartphone className="h-4 w-4" />,
          label: "Pantalla: daños declarados",
          tone: "bad",
        });
      }
      return;
    }

    misc.push(row);
  });

  if (!summary.some((s) => /Pantalla/.test(s.label))) {
    summary.push({ icon: <MonitorSmartphone className="h-4 w-4" />, label: "Pantalla: sin datos", tone: "info" });
  }
  if (!summary.some((s) => /Batería/.test(s.label))) {
    summary.push({ icon: <Battery className="h-4 w-4" />, label: "Batería: sin datos", tone: "info" });
  }
  if (!summary.some((s) => /Almacenamiento/.test(s.label))) {
    summary.push({ icon: <HardDrive className="h-4 w-4" />, label: "Almacenamiento: sin datos", tone: "info" });
  }

  return { summary, booleans, numbers, texts, misc };
}

function QAChipsSummary({ grouped }: { grouped: GroupedQA }) {
  if (!grouped.summary.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {grouped.summary.map((s, i) => (
        <Pill key={i} tone={s.tone}>
          {s.icon}
          {s.label}
        </Pill>
      ))}
    </div>
  );
}

function QATable({
  title,
  icon,
  rows,
  renderValue,
}: {
  title: string;
  icon: React.ReactNode;
  rows: QA[];
  renderValue?: (row: QA) => React.ReactNode;
}) {
  if (!rows.length) return null;
  return (
    <div className="rounded-lg border">
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-gray-50 text-sm font-medium">
        {icon}
        {title}
      </div>
      <div className="divide-y">
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-3 gap-3 px-3 py-2">
            <div className="text-xs uppercase tracking-wide text-gray-500">{titleize(row.label || "—")}</div>
            <div className="col-span-2 whitespace-pre-wrap break-words">
              {renderValue ? renderValue(row) : <AnswerPretty label={row.label} value={row.value} />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnswerPretty({ label, value }: { label: string; value: string }) {
  const raw = (value ?? "").trim();
  const lower = raw.toLowerCase();

  if (["true", "false", "sí", "si", "no", "yes"].includes(lower)) {
    const yes = ["true", "sí", "si", "yes"].includes(lower);
    return (
      <span
        className={cls(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
          yes ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-700 border-rose-200"
        )}
      >
        {yes ? "Sí" : "No"}
      </span>
    );
  }

  const num = Number(raw);
  if (!Number.isNaN(num) && raw !== "") {
    if (/_?gb$|almacenamiento|storage|ssd|ram/i.test(label)) return <span>{num} GB</span>;
    if (/_?tb$/i.test(label)) return <span>{num} TB</span>;
    if (/bateri|battery|ciclos/i.test(label)) return <span>{num} ciclos</span>;
    return <span>{raw}</span>;
  }

  if (raw.includes(",") && raw.split(",").length > 1) {
    return (
      <div className="flex flex-wrap gap-1">
        {raw.split(",").map((chip, i) => (
          <span
            key={i}
            className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-gray-50 text-gray-700 border-gray-200"
          >
            {chip.trim()}
          </span>
        ))}
      </div>
    );
  }

  return <span>{raw || "—"}</span>;
}

/* ======================= Normalización de respuestas ======================= */
function normalizeQuoteAnswers(quote: any): QA[] {
  const out: QA[] = [];
  const seen = new Set<string>();

  const pushQA = (label: any, value: any) => {
    const L = (toStr(label) || "").trim();
    const V = (toStr(value) || "").trim();
    if (!L && !V) return;
    const key = `${L}::${V}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ label: L || "(campo)", value: V || "—" });
  };

  const tryArray = (arr: any[]) => {
    arr.forEach((row: any) => {
      if (!row) return;
      const label = row.label ?? row.question ?? row.title ?? row.key ?? "";
      const value = row.value ?? row.answer ?? row.text ?? row.selected ?? row.choice ?? row.response;
      if (Array.isArray(value)) pushQA(label, value.join(", "));
      else pushQA(label, value);
    });
  };

  const tryObject = (obj: Record<string, any>) => {
    Object.entries(obj).forEach(([k, v]) => {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        if ("label" in v || "value" in v) {
          const label = (v as any).label ?? k;
          const value = (v as any).value ?? (v as any).answer ?? (v as any).text ?? v;
          pushQA(label, value);
        } else {
          pushQA(k, JSON.stringify(v));
        }
      } else if (Array.isArray(v)) {
        pushQA(k, v.join(", "));
      } else {
        pushQA(k, v);
      }
    });
  };

  if (Array.isArray(quote?.answers)) tryArray(quote.answers);
  if (quote?.answers && typeof quote.answers === "object" && !Array.isArray(quote.answers)) tryObject(quote.answers);

  const candidates = [quote?.form?.answers, quote?.formAnswers, quote?.attributes, quote?.meta?.answers].filter(Boolean);
  candidates.forEach((c) => {
    if (Array.isArray(c)) tryArray(c);
    else if (c && typeof c === "object") tryObject(c);
  });

  if (Array.isArray(quote?.steps)) {
    quote.steps.forEach((step: any) => {
      if (!step) return;
      const label = step.title || step.name || step.key || "Paso";
      if (Array.isArray(step.answers)) {
        step.answers.forEach((row: any) => {
          const qLabel = row?.label ?? row?.question ?? row?.title ?? "";
          const qValue = row?.value ?? row?.answer ?? row?.text ?? row?.selected ?? row?.choice;
          pushQA(`${label}: ${qLabel}`, qValue);
        });
      } else if (step.answers && typeof step.answers === "object") {
        Object.entries(step.answers).forEach(([k, v]) => {
          pushQA(`${label}: ${k}`, v);
        });
      }
    });
  }

  if (out.length === 0) {
    const keys = ["model", "modelId", "modelIdExt", "condition", "storage", "ram", "color", "issues", "notes", "offer", "price", "payout", "amount", "currency"];
    keys.forEach((k) => {
      if (quote && k in quote) pushQA(k, (quote as any)[k]);
    });
  }

  const currency = extractCurrencyFlexible(quote) || "";
  const moneyPairs: Array<[string, any]> = [
    ["prelimPrice", quote?.prelimPrice ?? quote?.prelim_price ?? quote?.answers?.prelimPrice],
    ["offeredPrice", quote?.offeredPrice ?? quote?.offered_price ?? quote?.answers?.offeredPrice],
  ];
  moneyPairs.forEach(([k, v]) => {
    if (v != null) {
      const n =
        typeof v === "number"
          ? v
          : getNumberAtPaths({ tmp: v }, ["tmp"]);
      if (typeof n === "number" && Number.isFinite(n)) {
        pushQA(k, `${n} ${currency}`.trim());
      } else {
        pushQA(k, String(v));
      }
    }
  });

  return out;
}

/* ======================= Pago/decisión helpers ======================= */
function guessPayoutFromQuote(quote: any, answers: QA[]): number | null {
  const direct =
    quote?.prelimPrice ??
    quote?.offeredPrice ??
    quote?.payout ??
    quote?.offer ??
    quote?.price ??
    quote?.amount ??
    quote?.valuation ??
    null;

  if (typeof direct === "number" && direct > 0) return Number(direct);

  const look = (k: RegExp) => {
    const row = answers.find((r) => k.test((r.label || "").toLowerCase()));
    if (!row) return null;
    const n = Number((row.value || "").toString().replace(/[^\d.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return look(/prelim|offered|payout|pago|oferta|precio|monto|cotizaci[oó]n/) || null;
}

function autoDecision(deviceType: DeviceType, risk: RiskResult, qa: QA[]): { choice: "RESELL" | "RECYCLE"; reason: string } {
  if (risk.level === "Alto") return { choice: "RECYCLE", reason: "Riesgo alto declarado por el usuario / pruebas" };
  const text = qa.map(q => `${q.label} ${q.value}`.toLowerCase()).join(" ");
  if (deviceType === "tv" && /panel.*(línea|mancha|pixel|quebrad|rota)/i.test(text))
    return { choice: "RECYCLE", reason: "Panel de TV con daños severos" };
  if (deviceType === "washing_machine" && /(fuga|leak|no enciende|motor)/i.test(text))
    return { choice: "RECYCLE", reason: "Posibles fallas mayores (agua/motor)" };
  return { choice: "RESELL", reason: risk.level === "Medio" ? "Riesgo moderado, viable con reacondicionamiento" : "Riesgo bajo" };
}

/* ======================= Componente principal ======================= */
export default function AdminInspections() {
  const [list, setList] = useState<Inspection[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status>("");

  // Modal / detalle
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Inspection | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr] = useState("");
  const [detailNotes, setDetailNotes] = useState("");

  // Steps
  const [step, setStep] = useState<"inspect" | "resolve">("inspect");

  // Cotización
  const [qaLoading, setQaLoading] = useState(false);
  const [qaErr, setQaErr] = useState("");
  const [qa, setQa] = useState<QA[]>([]);
  const [quoteRaw, setQuoteRaw] = useState<any>(null);
  const [quoteVia, setQuoteVia] = useState<string>("");
  const [initialQuoteAmount, setInitialQuoteAmount] = useState<number | null>(null);
  const [initialQuoteCurrency, setInitialQuoteCurrency] = useState<string>("");

  // Tipo & checklist
  const [deviceType, setDeviceType] = useState<DeviceType>("unknown");
  const [checklistState, setChecklistState] = useState<Record<string, boolean>>({});

  // Resolución y pago
  const [decision, setDecision] = useState<"RESELL" | "RECYCLE">("RESELL");
  const [decisionReason, setDecisionReason] = useState("");
  const [payAmount, setPayAmount] = useState<number | "">("");
  const payCurrency = "BOB";
  const [payMethod, setPayMethod] = useState<"Transferencia" | "Depósito">("Transferencia");
  const [decSaving, setDecSaving] = useState(false);
  const [paySaving, setPaySaving] = useState(false);
  const [decMsg, setDecMsg] = useState("");
  const [payMsg, setPayMsg] = useState("");

  // Contraoferta
  const [counterAmount, setCounterAmount] = useState<number | "">("");
  const [offerStatus, setOfferStatus] = useState<OfferStatus>("NONE");
  const [offerMsg, setOfferMsg] = useState("");

  async function load() {
    try {
      setLoading(true);
      setErr("");

      const usp = new URLSearchParams();
      usp.set("source", "shipment");
      if (status) usp.set("status", status);
      if (q.trim()) usp.set("search", q.trim());

      const url = `${SHIPMENT_API}/admin/inspections?${usp.toString()}`;
      const data = await GET_ABS<Inspection[]>(url);

      const onlyShipment = (Array.isArray(data) ? data : []).filter(
        (it) => it.source === "SHIPMENT" || !!it.deliveryId
      );

      setList(onlyShipment);
    } catch (e: any) {
      setErr(e?.message || "Error al cargar inspecciones");
      setList([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-line */ }, []);
  useEffect(() => { load(); /* eslint-disable-line */ }, [status]);

  const filtered = useMemo(() => list, [list]);

  /** Abrir detalle y preparar paso 1 */
  async function openDetail(id: string) {
    try {
      setDetail(null);
      setDetailErr("");
      setDetailLoading(true);

      setStep("inspect");
      setQa([]);
      setQaErr("");
      setQaLoading(true);
      setQuoteRaw(null);
      setQuoteVia("");
      setInitialQuoteAmount(null);
      setInitialQuoteCurrency("");

      setChecklistState({});
      setDecision("RESELL");
      setDecisionReason("");
      setPayAmount("");
      setDecMsg("");
      setPayMsg("");

      setCounterAmount("");
      setOfferStatus("NONE");
      setOfferMsg("");

      const data = await GET_ABS<Inspection>(`${SHIPMENT_API}/admin/inspections/${encodeURIComponent(id)}`);
      setDetail(data);
      setDetailNotes(data?.notes || "");
      setOpen(true);

      try {
        const found = await fetchQuoteAny(data);
        if (!found) throw new Error("No se encontró la cotización asociada.");
        const { quote, via } = found;
        setQuoteRaw(quote);
        setQuoteVia(via || "");

        const answers = normalizeQuoteAnswers(quote);
        setQa(answers);

        const inferred = detectDeviceType(answers, data?.modelIdExt);
        setDeviceType(inferred);
        const template = CHECKLIST_TEMPLATES[inferred] || CHECKLIST_TEMPLATES.unknown;
        const initial: Record<string, boolean> = {};
        template.forEach((it) => (initial[it.key] = false));
        setChecklistState(initial);

        const suggest = extractSuggestedAmountFlexible(quote, answers);
        setInitialQuoteAmount(typeof suggest === "number" ? suggest : null);
        if (typeof suggest === "number" && !Number.isNaN(suggest)) {
          setCounterAmount(suggest);
          setPayAmount(suggest);
        } else {
          setCounterAmount("");
          setPayAmount("");
        }

        const ccy = extractCurrencyFlexible(quote);
        setInitialQuoteCurrency(ccy || "");

        const riskNow = computeRiskScoreByType(answers, inferred);
        const auto = autoDecision(inferred, riskNow, answers);
        setDecision(auto.choice);
        if (auto.reason) setDecisionReason(auto.reason);
      } catch (e: any) {
        setQaErr(e?.message || "No se pudo obtener la cotización.");
      } finally {
        setQaLoading(false);
      }
    } catch (e: any) {
      setDetailErr(e?.message || "No se pudo cargar el detalle");
      setOpen(true);
    } finally {
      setDetailLoading(false);
    }
  }

  async function changeStatus(id: string, next: Inspection["status"], notes?: string) {
    // Compat: tu gateway acepta PATCH para status
    await PATCH_ABS(`${SHIPMENT_API}/admin/inspections/${encodeURIComponent(id)}/status`, {
      status: next,
      ...(typeof notes === "string" ? { notes } : {}),
    });
  }

  const risk = useMemo(() => computeRiskScoreByType(qa, deviceType), [qa, deviceType]);
  const grouped = useMemo(() => groupQA(qa), [qa]);

  // Notas finales (todo consolidado)
  const buildFinalNotes = useCallback(() => {
    const lines: string[] = [];
    const base = (detailNotes || "").trim();
    if (base) lines.push(base);

    lines.push("", `Riesgo estimado: ${risk.level}`);
    if (risk.reasons.length) {
      lines.push("Motivos:");
      risk.reasons.forEach((r) => lines.push(`- ${r}`));
    }

    lines.push("", "Resolución:");
    lines.push(`- Decisión: ${decision === "RESELL" ? "Reventa" : "Reciclaje"}`);
    if (decisionReason?.trim()) lines.push(`- Motivo: ${decisionReason.trim()}`);

    if (counterAmount !== "" && Number(counterAmount) > 0) {
      lines.push(
        "",
        "Contraoferta:",
        `- Monto propuesto: ${Number(counterAmount).toFixed(2)} BOB`,
        `- Estado: ${offerStatus}`
      );
    }

    if (payAmount !== "") {
      lines.push(
        "",
        "Pago:",
        `- Monto: ${Number(payAmount).toFixed(2)} ${payCurrency}`,
        `- Método: ${payMethod}`
      );
    }

    const tpl = CHECKLIST_TEMPLATES[deviceType] || CHECKLIST_TEMPLATES.unknown;
    lines.push("", `Checklist (${deviceType}):`);
    tpl.forEach((it) => lines.push(`- ${it.label}: ${checklistState[it.key] ? "OK" : "Pendiente"}`));

    if (quoteVia) lines.push("", `Origen de cotización: ${quoteVia}`);

    return lines.join("\n");
  }, [detailNotes, risk, deviceType, checklistState, decision, decisionReason, payAmount, payCurrency, payMethod, counterAmount, offerStatus, quoteVia]);

  // Guardar decisión (feedback local)
  async function saveDecision() {
    try {
      setDecSaving(true);
      setDecMsg("");
      setDecMsg("Decisión registrada; se incluirá en notas al finalizar.");
    } finally {
      setDecSaving(false);
    }
  }

  // Enviar contraoferta
  async function sendCounterOffer() {
    if (!detail) return;
    const n = Number(counterAmount);
    if (!Number.isFinite(n) || n <= 0) {
      setOfferMsg("Ingrese un monto válido (> 0) para contraoferta.");
      return;
    }
    try {
      setOfferMsg("");
      const quoteExt = detail.quoteIdExt || detail.quoteId || "";
      if (!quoteExt) throw new Error("Falta quote_id_ext/quoteId para enviar la contraoferta");

      let ok = false;
      const paths = [
        `${QUOTE_API}/admin/quotes/${encodeURIComponent(String(quoteExt))}/counter-offer`,
        `${QUOTE_API}/quotes/${encodeURIComponent(String(quoteExt))}/counter-offer`,
        `${SHIPMENT_API}/admin/quotes/${encodeURIComponent(String(quoteExt))}/counter-offer`,
      ];

      for (const p of paths) {
        try {
          ok = await POST_OPTIONAL(p, { amount: n, currency: "BOB" });
          if (ok) break;
        } catch (e) {
          const msg = (e as Error)?.message || "";
          if (!/404|not found/i.test(msg)) throw e;
        }
      }

      const prettyAmount = `${n.toFixed(2)} BOB`;
      const model = detail.modelIdExt || "tu dispositivo";
      await POST_NOTIFY_INBOX({
        userSub: detail.userSub || undefined,
        quoteId: detail.quoteId || undefined,
        quoteIdExt: detail.quoteIdExt || undefined,
        modelIdExt: detail.modelIdExt || undefined,
        title: "Nueva contraoferta",
        body: `Te proponemos ${prettyAmount} por ${model}. Podés aceptarla desde la tarjeta de cotización.`,
        meta: {
          actionRequired: true,
          action: { key: "counter_offer_ack", label: "Aceptar oferta", type: "ACK" },
          kind: "COUNTER_OFFER",
          counterOffer: { amount: n, currency: "BOB" },
        },
      });

      // 🔸 Mantener la inspección en IN_INSPECTION hasta que se acepte/pague
      await changeStatus(detail._id, "IN_INSPECTION");

      setOfferStatus("SENT");
      setOfferMsg(ok
        ? "Contraoferta enviada y notificada al usuario."
        : "No existe endpoint de contraoferta. Se notificó al usuario de todos modos.");
    } catch (e: any) {
      setOfferMsg(e?.message || "No se pudo enviar la contraoferta.");
    }
  }

  function markOfferAccepted() {
    setOfferStatus("ACCEPTED");
    setOfferMsg("Contraoferta marcada como ACEPTADA.");
    if (counterAmount !== "" && Number(counterAmount) > 0) setPayAmount(Number(counterAmount));
  }
  function markOfferRejected() {
    setOfferStatus("REJECTED");
    setOfferMsg("Contraoferta marcada como RECHAZADA.");
  }

  // Pago
  async function savePayment() {
    if (!detail) return;

    if (offerStatus === "SENT") {
      setPayMsg("Esperando respuesta del usuario a la contraoferta (acepta para habilitar el pago).");
      return;
    }
    if (offerStatus === "REJECTED") {
      setPayMsg("La contraoferta fue rechazada. Ajusta el monto o envía otra contraoferta.");
      return;
    }
    if (payAmount === "" || Number(payAmount) <= 0) {
      setPayMsg("Ingrese un monto válido (> 0).");
      return;
    }
    try {
      setPaySaving(true);
      setPayMsg("");

      const quoteExt = detail.quoteIdExt || detail.quoteId || "";
      if (!quoteExt) throw new Error("Falta quote_id_ext/quoteId para registrar el pago");

      await POST_PAYOUT({
        quote_id_ext: String(quoteExt),
        method: payMethod,
        amount: Number(payAmount),
      });

      setPayMsg("Pago registrado en payout-svc.");
    } catch (e: any) {
      setPayMsg(e?.message || "No se pudo registrar el pago.");
    } finally {
      setPaySaving(false);
    }
  }

  // Finalizar (con nueva lógica de estado)
  async function finalizeInspection() {
    if (!detail) return;
    try {
      const finalNotes = buildFinalNotes();

      let nextStatus: Inspection["status"];
      if (offerStatus === "SENT") {
        nextStatus = "IN_INSPECTION"; // esperando respuesta
      } else if (decision === "RECYCLE") {
        nextStatus = "CLOSED";
      } else {
        // RESELL
        const paid = typeof payAmount === "number" && payAmount > 0;
        const accepted = offerStatus === "ACCEPTED" || offerStatus === "NONE";
        nextStatus = paid || accepted ? "PASSED" : "IN_INSPECTION";
      }

      await changeStatus(detail._id, nextStatus, finalNotes);
      setOpen(false);
      await load();
    } catch (e: any) {
      alert(e?.message || "No se pudo finalizar la inspección");
    }
  }

  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") load();
  }

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (!open || !detail) return;
      if (e.key === "Escape") setOpen(false);
      if (e.key.toLowerCase() === "enter" && step === "inspect") {
        e.preventDefault();
        setStep("resolve");
      }
    },
    [open, detail, step]
  );

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  /* ======= RENDER ======= */
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Inspección de dispositivos</h1>
        <p className="text-sm text-gray-600">
          Lista de reportes de inspección. Filtra por estado y busca por ID, quote, usuario o modelo.
        </p>
      </header>

      {/* Filtros */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder="Buscar por ID, quote, usuario, modelo…"
            className="w-80 rounded-lg border bg-white pl-8 pr-3 py-2 text-sm outline-none ring-0 focus:border-slate-400"
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as Status)}
            className="rounded-lg border bg-white px-3 py-2 text-sm"
          >
            <option value="">Todas</option>
            <option value="IN_INSPECTION">En inspección</option>
            <option value="PASSED">Aprobadas</option>
            <option value="FAILED">Rechazadas</option>
            <option value="CLOSED">Cerradas</option>
          </select>
          <button className="btn-secondary inline-flex items-center gap-2" onClick={load} disabled={loading}>
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
          {loading ? "Cargando…" : "Sin inspecciones"}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2">Inicio</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Delivery</th>
                <th className="px-3 py-2">Confirmación</th>
                <th className="px-3 py-2">Quote</th>
                <th className="px-3 py-2">Modelo</th>
                <th className="px-3 py-2">Usuario</th>
                <th className="px-3 py-2">Notas</th>
                <th className="px-3 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => (
                <tr key={it._id} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap align-top">{formatDT(it.startedAt)}</td>
                  <td className="px-3 py-2 align-top"><StatusBadge status={it.status} /></td>
                  <td className="px-3 py-2 align-top font-mono break-all">{it.deliveryId || "—"}</td>
                  <td className="px-3 py-2 align-top font-mono break-all">{it.confirmationId || "—"}</td>
                  <td className="px-3 py-2 align-top font-mono break-all">{it.quoteId || it.quoteIdExt || "—"}</td>
                  <td className="px-3 py-2 align-top font-mono break-all">{it.modelIdExt || "—"}</td>
                  <td className="px-3 py-2 align-top font-mono break-all">{it.userSub || "—"}</td>
                  <td className="px-3 py-2 align-top">{it.notes || "—"}</td>
                  <td className="px-3 py-2 align-top">
                    <button
                      className="btn-secondary inline-flex items-center gap-2"
                      title="Ver"
                      onClick={() => openDetail(it._id)}
                    >
                      <Eye className="h-4 w-4" />
                      Ver
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* MODAL DETALLE */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Inspección del dispositivo"
        footer={
          detail ? (
            step === "inspect" ? (
              <>
                <span className={cls("mr-auto inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs",
                  computeRiskScoreByType(qa, deviceType).color
                )}>
                  <Info className="h-4 w-4" />
                  Riesgo: {computeRiskScoreByType(qa, deviceType).level}
                </span>
                <button
                  className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                  onClick={() => setStep("resolve")}
                  title="Ir a oferta y pago"
                >
                  Siguiente
                  <ChevronRight className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                <button
                  className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                  onClick={() => setStep("inspect")}
                >
                  <ArrowLeft className="h-4 w-4" />
                  Volver
                </button>
                <button
                  className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                  onClick={finalizeInspection}
                  title="Guardar y finalizar"
                >
                  Finalizar
                  <CheckCircle2 className="h-4 w-4" />
                </button>
              </>
            )
          ) : (
            <button
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
              onClick={() => setOpen(false)}
            >
              <X className="h-4 w-4" />
              Cerrar
            </button>
          )
        }
      >
        {detail ? (
          step === "inspect" ? (
            <InspectStep
              detail={detail}
              deviceType={deviceType}
              setDeviceType={setDeviceType}
              risk={risk}
              grouped={grouped}
              detailNotes={detailNotes}
              setDetailNotes={setDetailNotes}
              qaLoading={qaLoading}
              qaErr={qaErr}
              qa={qa}
              checklistState={checklistState}
              setChecklistState={setChecklistState}
            />
          ) : (
            <OfferAndPaymentStep
              initialQuoteAmount={initialQuoteAmount}
              initialQuoteCurrency={initialQuoteCurrency}
              risk={risk}
              decision={decision}
              setDecision={setDecision}
              decisionReason={decisionReason}
              setDecisionReason={setDecisionReason}
              decSaving={decSaving}
              decMsg={decMsg}
              saveDecision={saveDecision}
              // único monto sincronizado
              amount={
                typeof counterAmount === "number"
                  ? counterAmount
                  : (typeof payAmount === "number" ? payAmount : 0)
              }
              setAmount={(v: number | "") => { setCounterAmount(v); setPayAmount(v); }}
              payCurrency={payCurrency}
              payMethod={payMethod}
              setPayMethod={setPayMethod}
              paySaving={paySaving}
              payMsg={payMsg}
              savePayment={savePayment}
              // estado contraoferta
              offerStatus={offerStatus}
              offerMsg={offerMsg}
              sendCounterOffer={sendCounterOffer}
              markOfferAccepted={markOfferAccepted}
              markOfferRejected={markOfferRejected}
              // NUEVO: bloquear si no hay quote
              hasQuote={!!quoteRaw}
              quoteVia={quoteVia}
            />
          )
        ) : detailLoading ? (
          <div className="text-sm text-gray-600">Cargando detalle…</div>
        ) : detailErr ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {detailErr}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

/* ======================= Steps ======================= */
function InspectStep(props: {
  detail: Inspection;
  deviceType: DeviceType;
  setDeviceType: (t: DeviceType) => void;
  risk: RiskResult;
  grouped: GroupedQA;
  detailNotes: string;
  setDetailNotes: (s: string) => void;
  qaLoading: boolean;
  qaErr: string;
  qa: QA[];
  checklistState: Record<string, boolean>;
  setChecklistState: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {
  const {
    detail, deviceType, setDeviceType, risk, grouped,
    detailNotes, setDetailNotes, qaLoading, qaErr, qa,
    checklistState, setChecklistState
  } = props;

  return (
    <div className="space-y-4">
      {/* Cabecera */}
      <div className="rounded-xl border p-4 bg-gray-50">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={detail.status} large />
          <div className="text-sm text-gray-600">Inspección</div>
          <span className="font-mono text-xs text-gray-500">{detail._id}</span>

          <div className="ml-auto flex items-center gap-2">
            <span className={cls("inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs", risk.color)}>
              <Info className="h-4 w-4" />
              Riesgo estimado: {risk.level}
            </span>
            <select
              className="rounded-md border px-2 py-1 text-xs"
              value={deviceType}
              onChange={(e) => {
                const newType = e.target.value as DeviceType;
                setDeviceType(newType);
                const template = CHECKLIST_TEMPLATES[newType] || CHECKLIST_TEMPLATES.unknown;
                const base: Record<string, boolean> = {};
                template.forEach((it) => (base[it.key] = false));
                setChecklistState(base);
              }}
              title="Tipo de dispositivo"
            >
              <option value="unknown">Tipo: (auto)</option>
              <option value="phone">Teléfono</option>
              <option value="laptop">Laptop</option>
              <option value="tv">TV</option>
              <option value="washing_machine">Lavadora</option>
              <option value="tablet">Tablet</option>
              <option value="console">Consola</option>
              <option value="desktop">Desktop</option>
            </select>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <Clock className="h-4 w-4" />
          <span>Inicio: {formatDT(detail.startedAt)}</span>
          <span className="mx-1 text-gray-300">•</span>
          <span>Cierre: {formatDT(detail.closedAt)}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Identificadores */}
        <SectionCard icon={<PackageSearch className="h-5 w-5" />} title="Identificadores">
          <KV label="Estado"><StatusBadge status={detail.status} /></KV>
          <KV label="Delivery"><Mono text={detail.deliveryId} /></KV>
          <KV label="Confirmación"><Mono text={detail.confirmationId} /></KV>
          <KV label="Quote"><Mono text={detail.quoteId || detail.quoteIdExt} /></KV>
          <KV label="Modelo"><Mono text={detail.modelIdExt} /></KV>
          <KV label="Usuario"><Mono text={detail.userSub} /></KV>
        </SectionCard>

        {/* Notas */}
        <SectionCard icon={<User className="h-5 w-5" />} title="Notas">
          <label className="text-xs uppercase tracking-wide text-gray-500">Observaciones del técnico</label>
          <textarea
            value={detailNotes}
            onChange={(e) => setDetailNotes(e.target.value)}
            className="mt-1 w-full min-h-[140px] rounded-lg border bg-white px-3 py-2 text-sm"
            placeholder="Escribe notas de la inspección…"
          />
          <p className="mt-1 text-xs text-gray-500">Se incluirán al finalizar.</p>
        </SectionCard>
      </div>

      {/* Respuestas del usuario */}
      <SectionCard icon={<ListChecks className="h-5 w-5" />} title="Respuestas del usuario (cotización)">
        {qaLoading ? (
          <div className="text-sm text-gray-600">Cargando respuestas…</div>
        ) : qaErr ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {qaErr}
          </div>
        ) : qa.length === 0 ? (
          <div className="text-sm text-gray-500">Sin respuestas disponibles.</div>
        ) : (
          <>
            <div className="mb-3">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1 flex items-center gap-1">
                <Wrench className="h-4 w-4" />
                Resumen rápido
              </div>
              <QAChipsSummary grouped={grouped} />
            </div>
            <div className="space-y-3">
              <QATable title="Estado declarado (checks)" icon={<ToggleLeft className="h-4 w-4" />} rows={grouped.booleans} />
              <QATable title="Especificaciones" icon={<HardDrive className="h-4 w-4" />} rows={grouped.numbers} />
              <QATable title="Observaciones" icon={<FileText className="h-4 w-4" />} rows={grouped.texts} />
              <QATable title="Otros" icon={<Tag className="h-4 w-4" />} rows={grouped.misc} />
            </div>
          </>
        )}
      </SectionCard>

      {/* Checklist */}
      <SectionCard icon={<Wrench className="h-5 w-5" />} title="Checklist de pruebas técnicas">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {(CHECKLIST_TEMPLATES[deviceType] || CHECKLIST_TEMPLATES.unknown).map((item) => {
            const icon = (() => {
              switch (item.key) {
                case "camera": return <Camera className="h-4 w-4" />;
                case "mic_speaker": return <Mic className="h-4 w-4" />;
                case "charge_port": return <PlugZap className="h-4 w-4" />;
                case "wifi_bt": return <Wifi className="h-4 w-4" />;
                case "touch_display": return <Touchpad className="h-4 w-4" />;
                case "buttons": return <MousePointer className="h-4 w-4" />;
                case "display": return <MonitorSmartphone className="h-4 w-4" />;
                case "keyboard": return <Keyboard className="h-4 w-4" />;
                case "trackpad": return <Touchpad className="h-4 w-4" />;
                case "battery_health": return <Battery className="h-4 w-4" />;
                case "ports": return <Plug className="h-4 w-4" />;
                case "panel": return <Tv className="h-4 w-4" />;
                case "inputs": return <Cpu className="h-4 w-4" />;
                case "speakers": return <Mic className="h-4 w-4" />;
                case "remote": return <Gamepad2 className="h-4 w-4" />;
                case "wifi": return <RadioTower className="h-4 w-4" />;
                case "drum_spin": return <Cpu className="h-4 w-4" />;
                case "water_in_out": return <Plug className="h-4 w-4" />;
                case "leaks": return <Info className="h-4 w-4" />;
                case "vibration": return <Info className="h-4 w-4" />;
                case "control_panel": return <ToggleLeft className="h-4 w-4" />;
                case "hdmi_out": return <Cpu className="h-4 w-4" />;
                case "usb_ports": return <Plug className="h-4 w-4" />;
                case "optical_drive": return <Cpu className="h-4 w-4" />;
                case "fan_noise": return <Info className="h-4 w-4" />;
                case "controller_sync": return <Gamepad2 className="h-4 w-4" />;
                case "network": return <Wifi className="h-4 w-4" />;
                case "video_out": return <MonitorSmartphone className="h-4 w-4" />;
                case "storage_health": return <HardDrive className="h-4 w-4" />;
                case "power_on": return <Plug className="h-4 w-4" />;
                case "physical": return <Info className="h-4 w-4" />;
                case "io": return <Cpu className="h-4 w-4" />;
                default: return <Wrench className="h-4 w-4" />;
              }
            })();
            return (
              <label key={item.key} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">
                <span className="inline-flex items-center gap-2">{icon}{item.label}</span>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={!!checklistState[item.key]}
                  onChange={(e) => setChecklistState((s) => ({ ...s, [item.key]: e.target.checked }))}
                />
              </label>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Este checklist se adapta al tipo de dispositivo y se adjunta automáticamente al finalizar.
        </p>
      </SectionCard>

      {/* Hallazgos */}
      <SectionCard icon={<Tag className="h-5 w-5" />} title="Hallazgos">
        {detail.findings && detail.findings.length > 0 ? (
          <div className="rounded-lg border">
            <div className="grid grid-cols-3 gap-3 px-3 py-2 bg-gray-50 border-b text-xs font-medium text-gray-600">
              <div>Ítem</div>
              <div className="col-span-2">Detalle</div>
            </div>
            <div className="divide-y">
              {detail.findings.map((f, i) => (
                <div key={i} className="grid grid-cols-3 gap-3 px-3 py-2">
                  <div className="text-xs uppercase tracking-wide text-gray-500">{titleize(f.label || "—")}</div>
                  <div className="col-span-2">{f.value || "—"}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-500">Sin hallazgos reportados.</div>
        )}
      </SectionCard>
    </div>
  );
}

function OfferAndPaymentStep(props: {
  initialQuoteAmount: number | null;
  initialQuoteCurrency: string;
  risk: RiskResult;
  decision: "RESELL" | "RECYCLE";
  setDecision: (d: "RESELL" | "RECYCLE") => void;
  decisionReason: string;
  setDecisionReason: (s: string) => void;
  decSaving: boolean;
  decMsg: string;
  saveDecision: () => Promise<void>;

  amount: number | "";
  setAmount: (v: number | "") => void;

  payCurrency: string;
  payMethod: "Transferencia" | "Depósito";
  setPayMethod: (v: "Transferencia" | "Depósito") => void;
  paySaving: boolean;
  payMsg: string;
  savePayment: () => Promise<void>;

  offerStatus: OfferStatus;
  offerMsg: string;
  sendCounterOffer: () => Promise<void>;
  markOfferAccepted: () => void;
  markOfferRejected: () => void;

  hasQuote: boolean;
  quoteVia?: string;
}) {
  const {
    initialQuoteAmount,
    initialQuoteCurrency,
    risk, decision, setDecision, decisionReason, setDecisionReason,
    decSaving, decMsg, saveDecision,
    amount, setAmount,
    payCurrency, payMethod, setPayMethod,
    paySaving, payMsg, savePayment,
    offerStatus, offerMsg, sendCounterOffer, markOfferAccepted, markOfferRejected,
    hasQuote, quoteVia
  } = props;

  const isAmountValid = typeof amount === "number" && Number.isFinite(amount) && amount > 0;
  const isComparable = typeof initialQuoteAmount === "number" && Number.isFinite(initialQuoteAmount);
  const isChanged = isComparable && typeof amount === "number" && Math.abs(amount - (initialQuoteAmount as number)) > 0.009;

  const disableCounter =
    !hasQuote ||
    !isAmountValid ||
    !isChanged ||
    offerStatus === "SENT";

  const disablePayButton =
    !hasQuote ||
    !isAmountValid ||
    isChanged ||
    offerStatus === "SENT" ||
    offerStatus === "REJECTED";

  // Normaliza coma/punto en el input numérico
  const onAmountChange = (raw: string) => {
    const normalized = raw.replace(",", ".");
    props.setAmount(raw === "" ? "" : Number(normalized));
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border p-4 bg-gray-50 flex items-center justify-between">
        <div className="text-sm font-medium">Oferta y pago</div>
        <span className={cls("inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs", risk.color)}>
          <Info className="h-4 w-4" />
          Riesgo: {risk.level}
        </span>
      </div>

      {!hasQuote && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Aún no se recupera la cotización; verifica los endpoints/env. La contraoferta y el pago se habilitan cuando exista la cotización.
        </div>
      )}

      {quoteVia && (
        <div className="text-[11px] text-gray-500">Quote vía: {quoteVia}</div>
      )}

      {/* Decisión */}
      <SectionCard icon={<Store className="h-5 w-5" />} title="Decisión sobre el dispositivo">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="col-span-1">
            <label className="text-xs uppercase tracking-wide text-gray-500">Elección</label>
            <select
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              value={decision}
              onChange={(e) => setDecision(e.target.value as "RESELL" | "RECYCLE")}
            >
              <option value="RESELL">Apto para reventa</option>
              <option value="RECYCLE">Reciclaje completo</option>
            </select>
            <p className="mt-1 text-xs text-gray-500">Puedes ajustarlo antes de finalizar.</p>
          </div>
          <div className="col-span-2">
            <label className="text-xs uppercase tracking-wide text-gray-500">Justificación</label>
            <textarea
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm min-h-[80px]"
              placeholder="Explica brevemente la razón de la decisión…"
              value={decisionReason}
              onChange={(e) => setDecisionReason(e.target.value)}
            />
          </div>
          <div className="col-span-3">
            <button
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
              onClick={saveDecision}
              disabled={decSaving}
              title="Registrar decisión"
            >
              {decision === "RESELL" ? <Store className="h-4 w-4" /> : <Recycle className="h-4 w-4" />}
              {decSaving ? "Guardando…" : "Registrar decisión"}
            </button>
            {decMsg && <span className="ml-2 text-xs text-gray-600">{decMsg}</span>}
          </div>
        </div>
      </SectionCard>

      {/* Oferta + Pago unificados */}
      <SectionCard icon={<DollarSign className="h-5 w-5" />} title="Oferta y pago al usuario">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <div className="rounded-md border bg-gray-50 px-3 py-2 text-sm">
              Cotización inicial del usuario:{" "}
              <strong>
                {typeof initialQuoteAmount === "number"
                  ? `${initialQuoteAmount.toFixed(2)} ${initialQuoteCurrency || "BOB"}`
                  : "—"}
              </strong>
            </div>
          </div>

          <div className="md:col-span-2">
            <label className="text-xs uppercase tracking-wide text-gray-500">Monto a proponer / pagar (BOB)</label>
            <input
              type="text"
              inputMode="decimal"
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              placeholder="0.00"
              value={typeof amount === "number" ? amount.toString() : ""}
              onChange={(e) => onAmountChange(e.target.value)}
            />
            <p className="mt-1 text-xs text-gray-500">
              {typeof initialQuoteAmount === "number"
                ? "Precargado desde la cotización inicial del usuario."
                : "Si la cotización incluía un monto, aparecerá aquí como sugerencia."}
            </p>
          </div>

          <div>
            <label className="text-xs uppercase tracking-wide text-gray-500">Moneda</label>
            <input
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm bg-gray-50"
              value={payCurrency}
              readOnly
            />
          </div>

          <div>
            <label className="text-xs uppercase tracking-wide text-gray-500">Método</label>
            <select
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              value={payMethod}
              onChange={(e) => setPayMethod(e.target.value as "Transferencia" | "Depósito")}
            >
              <option>Transferencia</option>
              <option>Depósito</option>
            </select>
          </div>

          {/* Estado de propuesta */}
          <div className="md:col-span-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-md border bg-white px-3 py-2 text-sm">
              Propuesta actual:{" "}
              <strong>
                {typeof amount === "number" && isAmountValid ? `${amount.toFixed(2)} BOB` : "—"}
              </strong>
            </div>
            {offerStatus !== "NONE" && (
              <div className={cls(
                "rounded-md border px-3 py-2 text-sm",
                offerStatus === "SENT" ? "bg-amber-50 border-amber-200 text-amber-800" :
                offerStatus === "ACCEPTED" ? "bg-emerald-50 border-emerald-200 text-emerald-800" :
                "bg-rose-50 border-rose-200 text-rose-800"
              )}>
                {offerStatus === "SENT" && `Contraoferta enviada: ${typeof amount === "number" ? amount.toFixed(2) : "—"} BOB`}
                {offerStatus === "ACCEPTED" && `Usuario aceptó: ${typeof amount === "number" ? amount.toFixed(2) : "—"} BOB`}
                {offerStatus === "REJECTED" && "Usuario rechazó la contraoferta"}
              </div>
            )}
          </div>

          {/* Acciones */}
          <div className="md:col-span-4 flex flex-wrap items-center gap-2">
            {isChanged ? (
              <button
                className={cls(
                  "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                  disableCounter ? "opacity-60 cursor-not-allowed" : "hover:bg-gray-50"
                )}
                onClick={sendCounterOffer}
                title="Enviar contraoferta al usuario"
                disabled={disableCounter}
              >
                <SendHorizonal className="h-4 w-4" />
                Enviar contraoferta
              </button>
            ) : (
              <button
                className={cls(
                  "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                  disablePayButton ? "opacity-60 cursor-not-allowed" : "hover:bg-gray-50"
                )}
                onClick={savePayment}
                disabled={paySaving || disablePayButton}
                title={
                  !hasQuote
                    ? "No hay cotización recuperada"
                    : offerStatus === "SENT"
                    ? "Esperando aceptación de la contraoferta para pagar"
                    : offerStatus === "REJECTED"
                    ? "La contraoferta fue rechazada"
                    : isChanged
                    ? "El monto cambió: envía contraoferta"
                    : "Registrar pago en payout-svc"
                }
              >
                <DollarSign className="h-4 w-4" />
                {paySaving ? "Registrando…" : "Registrar pago"}
              </button>
            )}

            {/* Chips de estado / fallback */}
            {offerStatus === "SENT" && (
              <>
                <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
                  Contraoferta enviada — esperando respuesta
                </span>
                <button
                  className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-gray-50"
                  onClick={markOfferAccepted}
                  title="Marcar como aceptada (fallback)"
                >
                  <Check className="h-3 w-3" /> Marcar aceptada
                </button>
                <button
                  className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-gray-50"
                  onClick={markOfferRejected}
                  title="Marcar como rechazada (fallback)"
                >
                  <XCircle className="h-3 w-3" /> Marcar rechazada
                </button>
              </>
            )}
            {offerStatus === "ACCEPTED" && (
              <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded">
                Usuario aceptó la contraoferta
              </span>
            )}
            {offerStatus === "REJECTED" && (
              <span className="text-xs text-rose-700 bg-rose-50 border border-rose-200 px-2 py-1 rounded">
                Usuario rechazó la contraoferta
              </span>
            )}
            {(offerMsg || payMsg) && (
              <span className="text-xs text-gray-600">
                {offerMsg || payMsg}
              </span>
            )}
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

/* ======================= Subcomponentes ======================= */
function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-3 py-2 border-b last:border-none">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="col-span-2">{children}</div>
    </div>
  );
}
function Mono({ text }: { text?: string | null }) {
  return <span className="font-mono break-all">{text || "—"}</span>;
}
