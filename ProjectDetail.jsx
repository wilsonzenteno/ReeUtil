// src/pages/ProjectDetail.jsx
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  doc,
  onSnapshot,
  collection,
  onSnapshot as onSnapCol,
} from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { useAuth } from '../AuthContext';
import { donarAProyecto, comentarYCalificar, getCommentsQuery } from '../services/firestore';

export default function ProjectDetail() {
  const { id } = useParams();
  const { currentUser } = useAuth();

  const [proyecto, setProyecto] = useState(null);
  const [loadingProyecto, setLoadingProyecto] = useState(true);

  const [comentarios, setComentarios] = useState([]);
  const [loadingComentarios, setLoadingComentarios] = useState(true);

  const [monto, setMonto] = useState('');
  const [rating, setRating] = useState(5);
  const [comentario, setComentario] = useState('');

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Carga proyecto (RT)
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'proyectos', id), (snap) => {
      setProyecto(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      setLoadingProyecto(false);
    });
    return unsub;
  }, [id]);

  // Carga comentarios (RT)
  useEffect(() => {
    const q = getCommentsQuery(id);
    const unsub = onSnapCol(q, (snap) => {
      setComentarios(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoadingComentarios(false);
    });
    return unsub;
  }, [id]);

  const handleDonar = async (e) => {
    e.preventDefault();
    setError('');
    if (!currentUser) return setError('Debes iniciar sesión para donar');
    if (!monto || Number(monto) <= 0) return setError('Ingresa un monto válido');

    setBusy(true);
    try {
      await donarAProyecto(currentUser.uid, id, Number(monto));
      setMonto('');
      alert('¡Donación realizada!');
    } catch (err) {
      setError(err.message || 'No se pudo completar la donación');
    } finally {
      setBusy(false);
    }
  };

  const handleComentar = async (e) => {
    e.preventDefault();
    setError('');
    if (!currentUser) return setError('Debes iniciar sesión para comentar');
    if (!rating) return setError('Selecciona una calificación');

    try {
      await comentarYCalificar(id, currentUser.uid, {
        rating,
        comment: comentario,
        userName: currentUser.email,
      });
      setComentario('');
    } catch (err) {
      setError(err.message || 'No se pudo publicar el comentario');
    }
  };

  if (loadingProyecto) return <div style={{ padding: 24 }}>Cargando proyecto…</div>;
  if (proyecto === null) return <div style={{ padding: 24 }}>Proyecto no encontrado.</div>;

  const porcentaje = proyecto.metaTotal
    ? Math.min(100, (proyecto.recaudado / proyecto.metaTotal) * 100)
    : 0;
  const completo = proyecto.estado === 'Completado';

  return (
    <div style={{ maxWidth: 1100, margin: '40px auto', padding: '0 16px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 24 }}>
        {/* Columna izquierda */}
        <div>
          {proyecto.imagenURL && (
            <img
              src={proyecto.imagenURL}
              alt={proyecto.titulo}
              style={{ width: '100%', borderRadius: 12, objectFit: 'cover' }}
            />
          )}
          <h1 style={{ marginTop: 16 }}>{proyecto.titulo}</h1>
          <p style={{ color: '#334155' }}>{proyecto.descripcion}</p>

          {/* Progreso */}
          <div style={{ margin: '16px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
              <span>{proyecto.recaudado} / {proyecto.metaTotal}</span>
              <span>{porcentaje.toFixed(0)}%</span>
            </div>
            <div style={{ height: 10, background: '#E2E8F0', borderRadius: 8, marginTop: 6 }}>
              <div
                style={{
                  width: `${porcentaje}%`,
                  height: '100%',
                  background: '#5B6CFF',
                  borderRadius: 8,
                  transition: 'width .3s',
                }}
              />
            </div>
          </div>

          {/* Brechas */}
          <h3>Brechas</h3>
          <ul style={{ paddingLeft: 18 }}>
            {(proyecto.brechas || []).map((b) => (
              <li key={b.id}>{b.title}: {Number(b.monto || 0)}</li>
            ))}
          </ul>

          {/* Comentarios */}
          <h3 style={{ marginTop: 24 }}>
            Comentarios ({proyecto.ratingCount || 0}) — Promedio {Number(proyecto.ratingAvg || 0).toFixed(1)}★
          </h3>

          <form onSubmit={handleComentar} style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0 16px' }}>
            <select value={rating} onChange={(e) => setRating(Number(e.target.value))}>
              {[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>{r}★</option>)}
            </select>
            <input
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              placeholder="Escribe un comentario"
              style={{ flex: 1, padding: '8px 10px' }}
            />
            <button type="submit">Enviar</button>
          </form>

          {loadingComentarios ? (
            <div>Cargando comentarios…</div>
          ) : (
            <ul style={{ display: 'grid', gap: 12 }}>
              {comentarios.map((c) => (
                <li key={c.id} style={{ border: '1px solid #E2E8F0', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontWeight: 600 }}>{c.userName} — {c.rating}★</div>
                  <div style={{ color: '#334155' }}>{c.comment}</div>
                </li>
              ))}
              {comentarios.length === 0 && (
                <li style={{ color: '#64748B' }}>Aún no hay comentarios. ¡Sé el primero!</li>
              )}
            </ul>
          )}
        </div>

        {/* Columna derecha (donar) */}
        <aside style={{ border: '1px solid #E2E8F0', borderRadius: 12, padding: 16 }}>
          {error && (
            <div style={{ color: '#b91c1c', background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 8, padding: 8, marginBottom: 10 }}>
              {error}
            </div>
          )}

          <h3>Apoyar este proyecto</h3>
          {completo ? (
            <div style={{ color: '#334155' }}>
              Este proyecto ya alcanzó el 100% y no acepta más donaciones.
            </div>
          ) : (
            <form onSubmit={handleDonar} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="number"
                min="1"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                placeholder="Monto a donar"
                style={{ flex: 1, padding: '8px 10px' }}
              />
              <button disabled={busy} type="submit">
                {busy ? 'Procesando…' : 'Donar'}
              </button>
            </form>
          )}
          <div style={{ fontSize: 12, color: '#64748B', marginTop: 8 }}>
            La donación descuenta tu saldo y se acredita al proyecto. (MVP simulado)
          </div>
        </aside>
      </div>
    </div>
  );
}
