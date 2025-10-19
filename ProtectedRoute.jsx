import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';

export default function ProtectedRoute({ children }) {
  const { currentUser, loading } = useAuth();
  if (loading) return null; // puedes renderizar un spinner si tienes uno
  return currentUser ? children : <Navigate to="/auth" replace />;
}
