// apps/web/src/components/NotificationBell.tsx
import { useEffect, useRef, useState } from "react";
import { Bell, Check } from "lucide-react";
import { get, patch } from "../lib/api";

type InboxItem = {
  _id: string;
  userSub?: string;
  title: string;
  body: string;
  link?: string | null;
  meta?: any;
  isRead?: boolean;     // notify-svc usa isRead
  read?: boolean;       // por si tuvieras la otra variante
  createdAt: string;
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");

  const btnRef = useRef<HTMLButtonElement | null>(null);

  async function load() {
    // Evita 401 en consola si aún no hay login
    const token = localStorage.getItem("idToken");
    if (!token) return;

    try {
      setLoading(true);
      const list = await get<InboxItem[]>("/notify/inbox?unread=1");
      setItems(Array.isArray(list) ? list : []);
      setErr("");
    } catch (e: any) {
      setErr(e?.message || "Error al cargar notificaciones");
    } finally {
      setLoading(false);
    }
  }

  async function markRead(id: string) {
    try {
      await patch(`/notify/inbox/${encodeURIComponent(id)}/read`, { read: true });
      setItems((prev) => prev.filter((it) => it._id !== id));
    } catch {
      // noop
    }
  }

  useEffect(() => {
    load(); // inicial
    const iv = setInterval(load, 15000); // polling 15s
    return () => clearInterval(iv);
  }, []);

  // Cerrar al click fuera
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!open) return;
      const target = e.target as Node;
      if (btnRef.current && !btnRef.current.contains(target)) {
        const pop = document.getElementById("notif-popover");
        if (pop && !pop.contains(target)) setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const count = items.length;

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-full p-2 hover:bg-gray-100"
        aria-label="Notificaciones"
      >
        <Bell className="h-5 w-5" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center h-5 min-w-[20px] px-1 text-[11px] font-semibold rounded-full bg-red-600 text-white">
            {count}
          </span>
        )}
      </button>

      {open && (
        <div
          id="notif-popover"
          className="absolute right-0 mt-2 w-80 rounded-xl border bg-white shadow-lg z-50"
        >
          <div className="p-3 border-b">
            <div className="font-medium">Notificaciones</div>
            <div className="text-xs text-gray-500">
              {loading
                ? "Cargando…"
                : count === 0
                ? "No hay nuevas notificaciones"
                : `Tienes ${count}`}
            </div>
            {err && <div className="mt-1 text-xs text-red-600">{err}</div>}
          </div>

          <div className="max-h-80 overflow-auto">
            {items.map((n) => (
              <div key={n._id} className="p-3 border-b last:border-b-0">
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <div className="font-medium">{n.title}</div>
                    <div className="text-sm text-gray-700">{n.body}</div>
                    <div className="mt-1 text-[11px] text-gray-500">
                      {new Date(n.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <button
                    className="ml-2 inline-flex items-center gap-1 text-xs text-green-700 hover:text-green-900"
                    onClick={() => markRead(n._id)}
                    title="Marcar como leída"
                  >
                    <Check className="h-4 w-4" /> Leer
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="p-2 text-right">
            <button
              onClick={() => {
                setOpen(false);
                load();
              }}
              className="text-xs text-gray-600 hover:text-gray-900 px-2 py-1"
            >
              Actualizar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
