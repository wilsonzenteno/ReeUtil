import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get } from "../../lib/api";
import {
  Users,
  FileText,
  Tag,
  PackageCheck,
  ActivitySquare,
  ExternalLink,
  AlertTriangle,
  ShieldCheck,
  Truck, 
  Wrench,
} from "lucide-react";

type StatusItem = {
  ok: boolean;
  url?: string;
  service?: string;
  time?: string;
  error?: string;
};
type StatusMap = Record<string, StatusItem>;

function Pill({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
        ok
          ? "bg-emerald-100 text-emerald-800 border-emerald-200"
          : "bg-rose-100 text-rose-800 border-rose-200"
      }`}
    >
      {ok ? (
        <>
          <ShieldCheck className="h-3.5 w-3.5" />
          OK
        </>
      ) : (
        <>
          <AlertTriangle className="h-3.5 w-3.5" />
          DOWN
        </>
      )}
    </span>
  );
}

function QuickCard({
  to,
  icon,
  title,
  desc,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <Link
      to={to}
      className="rounded-xl border bg-white p-4 hover:shadow transition"
    >
      <div className="flex items-center gap-3">
        <div className="rounded-lg border bg-gray-50 p-2">{icon}</div>
        <div>
          <div className="font-medium">{title}</div>
          <div className="text-sm text-gray-600">{desc}</div>
        </div>
      </div>
    </Link>
  );
}

export default function AdminDashboard() {
  const [status, setStatus] = useState<StatusMap | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const s = await get<StatusMap>("/_status");
        setStatus(s);
        setErr("");
      } catch (e: any) {
        setErr(e.message || String(e));
      }
    })();
  }, []);

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold">Resumen</h1>
        <p className="text-sm text-gray-600">
          Acceso rápido a las secciones de administración y estado de servicios.
        </p>
      </section>

      {/* Acciones rápidas */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Acciones rápidas
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <QuickCard
            to="/admin/users"
            icon={<Users className="h-5 w-5" />}
            title="Administrar usuarios"
            desc="Roles, estado y permisos"
          />
          <QuickCard
            to="/admin/forms"
            icon={<FileText className="h-5 w-5" />}
            title="Formularios"
            desc="Crear, editar y activar"
          />
          <QuickCard
            to="/admin/quotes"
            icon={<Tag className="h-5 w-5" />}
            title="Cotizaciones"
            desc="Revisar y cambiar estados"
          />
          {/* Validación de envíos */}
          <QuickCard
            to="/admin/shipments"
            icon={<PackageCheck className="h-5 w-5" />}
            title="Validación de envíos"
            desc="Confirmaciones y direcciones de envío"
          />
          {/* ✅ NUEVO: Gestión de entregas */}
          <QuickCard
            to="/admin/deliveries"
            icon={<Truck className="h-5 w-5" />}
            title="Gestión de entregas"
            desc="Recepción y seguimiento de dispositivos"
          />
          <QuickCard
            to="/admin/inspections"
            icon={<Wrench className="h-5 w-5" />}
            title="Inspección de dispositivos"
            desc="Revisar reportes y cambiar estado"
          />
          {/* Salud de servicios */}
          <QuickCard
            to="/admin"
            icon={<ActivitySquare className="h-5 w-5" />}
            title="Salud de servicios"
            desc="Estado de microservicios"
          />
        </div>
      </section>

      {/* Salud de servicios */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Salud de servicios
        </h2>

        {err && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {err}
          </div>
        )}

        {!status && !err && (
          <div className="text-sm text-gray-600">Cargando…</div>
        )}

        {status && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(status).map(([name, info]) => (
              <div key={name} className="rounded-xl border bg-white p-4">
                <div className="mb-1 flex items-center justify-between">
                  <div className="font-medium">{name}</div>
                  <Pill ok={!!info.ok} />
                </div>
                <div className="text-xs text-gray-600">
                  {info.time
                    ? `Último ping: ${new Date(info.time).toLocaleString()}`
                    : "—"}
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="text-xs text-gray-500 truncate">
                    {info.url || "Sin URL"}
                  </div>
                  {info.url && (
                    <a
                      href={info.url}
                      target="_blank"
                      rel="noreferrer"
                      title="Abrir"
                      className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs hover:bg-gray-50"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Abrir
                    </a>
                  )}
                </div>
                {info.error && (
                  <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-800">
                    {info.error}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
