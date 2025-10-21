import { Link, NavLink, Outlet } from "react-router-dom";
import { LayoutGrid, Users, FileText, Tag, PackageCheck } from "lucide-react";

export default function AdminLayout() {
  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
      isActive
        ? "bg-black text-white"
        : "text-gray-700 hover:bg-gray-100"
    }`;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Topbar */}
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-xl font-semibold">ReeUtil</Link>
            <span className="text-gray-400">/</span>
            <span className="font-medium">Panel de administración</span>
          </div>
          {/* Acceso rápido a secciones (visible en desktop) */}
          <nav className="hidden gap-1 md:flex">
            <NavLink to="/admin" end className={linkCls}>
              <LayoutGrid className="h-4 w-4" />
              Resumen
            </NavLink>
            <NavLink to="/admin/users" className={linkCls}>
              <Users className="h-4 w-4" />
              Usuarios
            </NavLink>
            <NavLink to="/admin/forms" className={linkCls}>
              <FileText className="h-4 w-4" />
              Formularios
            </NavLink>
            <NavLink to="/admin/quotes" className={linkCls}>
              <Tag className="h-4 w-4" />
              Cotizaciones
            </NavLink>
            {/* NUEVO: Validación de envíos */}
            <NavLink to="/admin/shipments" className={linkCls}>
              <PackageCheck className="h-4 w-4" />
              Validación de envíos
            </NavLink>
          </nav>
        </div>
      </header>

      {/* Subnav (sticky + scrollable en mobile) */}
      <div className="sticky top-0 z-30 border-b bg-white md:hidden">
        <div className="mx-auto flex max-w-7xl snap-x gap-2 overflow-x-auto px-4 py-2">
          <NavLink to="/admin" end className={linkCls}>
            <LayoutGrid className="h-4 w-4" />
            Resumen
          </NavLink>
          <NavLink to="/admin/users" className={linkCls}>
            <Users className="h-4 w-4" />
            Usuarios
          </NavLink>
          <NavLink to="/admin/forms" className={linkCls}>
            <FileText className="h-4 w-4" />
            Formularios
          </NavLink>
          <NavLink to="/admin/quotes" className={linkCls}>
            <Tag className="h-4 w-4" />
            Cotizaciones
          </NavLink>
          <NavLink to="/admin/shipments" className={linkCls}>
            <PackageCheck className="h-4 w-4" />
            Validación de envíos
          </NavLink>
        </div>
      </div>

      {/* Contenido */}
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
