import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';

/**
 * Uso:
 * <RoleRoute allow={['Moderador','Administrador']}>
 *   <ModerationPanel />
 * </RoleRoute>
 */
export default function RoleRoute({ children, allow = [] }) {
  const { currentUser, currentUserRole, loading } = useAuth();

  if (loading) return null;
  if (!currentUser) return <Navigate to="/auth" replace />;

  return allow.includes(currentUserRole)
    ? children
    : <Navigate to="/" replace />;
}
