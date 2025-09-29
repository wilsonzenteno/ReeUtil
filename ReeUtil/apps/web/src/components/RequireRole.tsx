// apps/web/src/components/RequireRole.tsx
import { ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { Link } from "react-router-dom";

export default function RequireRole({
  roles,
  children,
}: {
  roles: ("admin" | "staff")[];
  children: ReactNode;
}) {
  const { me, loading } = useAuth();

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <div className="card">Cargando permisos…</div>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <div className="card">
          <h2 className="text-lg font-semibold mb-1">Inicia sesión</h2>
          <p className="text-sm text-gray-600">
            Esta sección requiere autenticación. Inicia sesión con Google desde la barra superior.
          </p>
          <div className="mt-4">
            <Link to="/" className="btn-secondary">Ir al inicio</Link>
          </div>
        </div>
      </div>
    );
  }

  const allowed = me.roles.some((r) => roles.includes(r as any));
  if (!allowed) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <div className="card border-red-200">
          <h2 className="text-lg font-semibold mb-1">403 – Acceso denegado</h2>
          <p className="text-sm text-gray-600">
            Tu usuario no tiene permisos para ingresar aquí. Contacta a un administrador.
          </p>
          <div className="mt-4">
            <Link to="/" className="btn-secondary">Volver</Link>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
