import { useLocation } from 'react-router-dom';

function useQuery() {
  return new URLSearchParams(useLocation().search);
}

export default function SearchResults() {
  const q = useQuery().get('q') || '';
  return (
    <div style={{ padding: 24 }}>
      <h1>Resultados de Búsqueda</h1>
      <p>Buscaste: <b>{q}</b></p>
      <p>Placeholder: aquí se listarán proyectos/usuarios que coincidan.</p>
    </div>
  );
}
