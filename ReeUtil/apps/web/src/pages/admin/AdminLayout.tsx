import { Link, NavLink, Outlet } from "react-router-dom";

export default function AdminLayout() {
  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 rounded-lg text-sm ${
      isActive ? "bg-black text-white" : "hover:bg-gray-100"
    }`;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-xl font-semibold">ReeUtil</Link>
            <span className="text-gray-400">/</span>
            <span className="font-medium">Panel de administración</span>
          </div>
          <nav className="flex gap-1">
            <NavLink to="/admin" end className={linkCls}>Resumen</NavLink>
            <NavLink to="/admin/users" className={linkCls}>Usuarios</NavLink>
            <NavLink to="/admin/forms" className={linkCls}>Formularios</NavLink>
            <NavLink to="/admin/quotes" className={linkCls}>Cotizaciones</NavLink>
          </nav>
        </div>
      </header>

      <main>
        <Outlet />
      </main>
    </div>
  );
}
