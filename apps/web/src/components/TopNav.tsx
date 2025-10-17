// apps/web/src/components/TopNav.tsx
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { GoogleLogin, CredentialResponse } from "@react-oauth/google";
import NotificationBell from "./NotificationBell";

export default function TopNav() {
  const { pathname } = useLocation();
  const { me, refresh, setMe } = useAuth();

  // Helper para links
  const link = (to: string, label: string) => {
    const active = pathname === to;
    return (
      <Link
        to={to}
        className={`px-2 py-1 rounded-md transition ${
          active ? "bg-black text-white" : "hover:bg-gray-100"
        }`}
      >
        {label}
      </Link>
    );
  };

  function onGoogleSuccess(cred: CredentialResponse) {
    const idToken = cred?.credential || "";
    if (!idToken) return;
    localStorage.setItem("idToken", idToken);
    refresh(); // consulta /api/auth/me
  }

  function onGoogleError() {
    console.warn("Google login error");
  }

  function logout() {
    localStorage.removeItem("idToken");
    setMe(null);
  }

  const canSeeAdmin = !!me && (me.roles.includes("admin") || me.roles.includes("staff"));

  return (
    <header className="sticky top-0 z-40 border-b bg-white/80 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-4">
        {/* Branding */}
        <Link to="/" className="text-xl font-semibold tracking-tight">
          ReeUtil
        </Link>

        {/* Nav principal */}
        <nav className="flex gap-1 text-sm">
          {link("/", "Inicio")}
          {link("/quote/new", "Nueva cotización")}
          {link("/quotes", "Mis cotizaciones")}
          {canSeeAdmin && link("/admin", "Admin")}
        </nav>

        {/* Spacer para empujar a la derecha */}
        <div className="flex-1" />

        {/* Acciones derecha */}
        <div className="flex items-center gap-3">
          {/* Campana sólo si hay sesión */}
          {me && <NotificationBell />}

          {!me ? (
            <GoogleLogin
              onSuccess={onGoogleSuccess}
              onError={onGoogleError}
              size="medium"
              theme="outline"
              shape="rectangular"
              text="signin_with"
            />
          ) : (
            <>
              <div className="flex items-center gap-2">
                {me.picture && <img src={me.picture} className="h-7 w-7 rounded-full" />}
                <div className="text-sm">
                  <div className="font-medium leading-4">{me.name || me.email || "Usuario"}</div>
                  <div className="text-xs text-gray-500">{me.roles.join(", ")}</div>
                </div>
              </div>
              <button className="btn-secondary" onClick={logout}>
                Salir
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
