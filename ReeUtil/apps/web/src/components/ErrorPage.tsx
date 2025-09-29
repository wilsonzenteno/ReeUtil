// apps/web/src/components/ErrorPage.tsx
import { isRouteErrorResponse, Link, useRouteError } from "react-router-dom";

export default function ErrorPage() {
  const error = useRouteError();
  let title = "Algo salió mal";
  let message = "Intenta recargar la página.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "404 – No encontrado";
      message = "La página que intentas abrir no existe.";
    } else {
      title = `${error.status} – ${error.statusText}`;
      message = error.data || message;
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 py-16">
        <div className="card">
          <h1 className="text-2xl font-semibold mb-2">{title}</h1>
          <p className="text-sm text-gray-600">{String(message)}</p>
          <div className="mt-4">
            <Link to="/" className="btn-secondary">Volver al inicio</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
