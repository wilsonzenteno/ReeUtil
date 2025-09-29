// apps/web/src/components/NotificationBell.tsx
import { useEffect, useState } from "react";
import { get } from "../lib/api";
import { Bell, Check } from "lucide-react";

type Noti = {
  _id: string;
  title: string;
  body: string;
  link?: string | null;
  read: boolean;
  createdAt: string;
};

export default function NotificationBell({ enabled = false }: { enabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Noti[]>([]);
  const [loading, setLoading] = useState(false);
  const apiBase = import.meta.env.VITE_API_BASE as string;

  async function load(unreadOnly = false) {
    if (!enabled) return;
    try {
      setLoading(true);
      const qs = unreadOnly ? "?unread=1" : "";
      const data = await get<Noti[]>(`/notify/inbox${qs}`);
      setItems(data);
    } catch {
      // silencioso
    } finally {
      setLoading(false);
    }
  }

  async function markRead(id: string, read = true) {
    if (!enabled) return;
    try {
      await fetch(`${apiBase}/notify/inbox/${encodeURIComponent(id)}/read`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ read }),
      });
      setItems(prev => prev.map(n => (n._id === id ? { ...n, read } : n)));
    } catch {
      // noop
    }
  }

  useEffect(() => {
    if (!enabled) return;
    load(true);
    const t = setInterval(() => load(true), 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const unread = items.filter(i => !i.read).length;

  return (
    <div className="relative">
      <button
        className="relative rounded-lg p-2 hover:bg-gray-100"
        onClick={async () => {
          if (!open) await load(false);
          setOpen(!open);
        }}
        aria-label="Notificaciones"
        title="Notificaciones"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border bg-white shadow-lg">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="font-medium text-sm">Notificaciones</div>
            <button
              className="text-xs text-gray-600 hover:underline"
              onClick={() => load(false)}
            >
              {loading ? "Actualizando…" : "Actualizar"}
            </button>
          </div>

          {items.length === 0 && (
            <div className="p-4 text-sm text-gray-600">No tienes notificaciones.</div>
          )}

          {items.length > 0 && (
            <ul className="max-h-80 overflow-auto">
              {items.map(n => (
                <li key={n._id} className="border-b last:border-0">
                  <div className="flex gap-2 p-3">
                    <div className={`mt-0.5 h-2.5 w-2.5 rounded-full ${n.read ? "bg-gray-300" : "bg-blue-600"}`} />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium">{n.title}</div>
                        <div className="text-[10px] text-gray-500">
                          {new Date(n.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="text-xs text-gray-700 whitespace-pre-wrap">{n.body}</div>
                      <div className="mt-1 flex items-center gap-2">
                        {!n.read && (
                          <button
                            className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs hover:bg-gray-50"
                            onClick={() => markRead(n._id, true)}
                          >
                            <Check className="h-3.5 w-3.5" />
                            Marcar leído
                          </button>
                        )}
                        {n.link && (
                          <a
                            href={n.link}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            Ver detalle
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
