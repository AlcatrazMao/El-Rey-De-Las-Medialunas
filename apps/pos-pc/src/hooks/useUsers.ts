import type { User as FirebaseUser } from 'firebase/auth';
import { signOut } from 'firebase/auth';
import { useState, useEffect, useRef, useMemo } from 'react';

import { auth } from '../config/firebase';
import { API_URL } from '../services/api';
import { syncUserPreferencesToD1 } from '../services/d1-sync';
import type { User, UserRole } from '../types';
import { safeSetItem, safeParseLocalStorage } from '../utils/safeStorage';

type NotifyFn = (title: string, message: string, type: 'success' | 'error' | 'warning' | 'info') => void;

interface UseUsersParams {
  firebaseUser: FirebaseUser;
  firestoreRole?: string | null;
  serverPanels?: string[] | null;
  notify: NotifyFn;
}

export function useUsers({ firebaseUser, firestoreRole, serverPanels, notify }: UseUsersParams) {
  // Memoizado para que el array no cambie de identidad en cada render — antes
  // disparaba el warning react-hooks/exhaustive-deps en el useMemo de abajo.
  const defaultPanels = useMemo<string[]>(
    () =>
      firestoreRole === 'admin' || firestoreRole === 'owner'
        ? ['widget_facturacion', 'widget_inventario', 'widget_contabilidad', 'widget_alertas', 'widget_historico']
        : firestoreRole === 'cajero'
          ? ['widget_facturacion', 'widget_alertas']
          : firestoreRole === 'cocinero'
            ? ['widget_alertas']
            : ['widget_inventario', 'widget_alertas'],
    [firestoreRole],
  );

  // Memoizado por la misma razón. Sólo cambia cuando cambia el uid del usuario
  // de Firebase; la lectura de localStorage ya es idempotente.
  const persistedPanels = useMemo<string[] | null>(() => {
    try {
      const raw = localStorage.getItem(`pan_erp_widgets_${firebaseUser.uid}`);
      if (raw) return JSON.parse(raw) as string[];
    } catch {
      /* ignore */
    }
    return null;
  }, [firebaseUser.uid]);

  // Bug fix: memoizar para evitar que cada render genere un nuevo objeto que
  // dispara recálculos innecesarios en useState initializers (defensa) y en
  // cualquier consumidor que reciba `activeUser` como dep. Las deps cubren
  // todos los inputs reales del mapping; defaultPanels/persistedPanels se
  // recalculan en cada render por diseño (lectura de localStorage) pero el
  // objeto identidad solo cambia cuando alguna entrada relevante cambia.
  const firebaseMappedUser: User = useMemo<User>(() => ({
    id: firebaseUser.uid,
    name: firebaseUser.displayName || firebaseUser.email || 'Usuario',
    email: firebaseUser.email || '',
    role: (firestoreRole || 'panadero') as UserRole,
    avatar: firebaseUser.photoURL || '',
    customPanels: serverPanels ?? persistedPanels ?? defaultPanels,
  }), [
    firebaseUser.uid,
    firebaseUser.displayName,
    firebaseUser.email,
    firebaseUser.photoURL,
    firestoreRole,
    serverPanels,
    persistedPanels,
    defaultPanels,
  ]);

  const [users, setUsers] = useState<User[]>(() =>
    safeParseLocalStorage<User[]>('pan_erp_users', [firebaseMappedUser])
  );
  const [activeUserId, setActiveUserId] = useState<string>(
    () => localStorage.getItem('pan_erp_active_user_id') || firebaseUser.uid
  );
  const [activeTab, setActiveTab] = useState<string>(() => {
    const role = (firestoreRole || 'panadero') as UserRole;
    if (role === 'cajero') return 'pos';
    if (role === 'cocinero') return 'kitchen';
    if (role === 'repartidor') return 'requests';
    return 'dashboard';
  });
  const [selectedSellerId, setSelectedSellerId] = useState<string>('');

  const invoiceSeqRef = useRef<number>(
    (() => {
      const raw = localStorage.getItem('pan_erp_invoice_seq');
      const parsed = raw ? parseInt(raw, 10) : 0;
      return Number.isFinite(parsed) ? parsed : 0;
    })()
  );

  useEffect(() => {
    safeSetItem('pan_erp_users', JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    safeSetItem('pan_erp_active_user_id', activeUserId);
  }, [activeUserId]);

  const activeUser: User =
    users && users.length > 0 && activeUserId
      ? users.find(u => u.id === activeUserId) || firebaseMappedUser
      : firebaseMappedUser;

  const setActiveUserRole = (role: UserRole) => {
    const found = users.find(u => u.role === role);
    if (found) {
      setActiveUserId(found.id);
      if (role === 'cajero') setActiveTab('pos');
      else if (role === 'cocinero') setActiveTab('kitchen');
      else setActiveTab('dashboard');
    }
  };

  const logout = async () => {
    const refreshToken = localStorage.getItem('refresh_token');
    try {
      // Await the backend call FIRST so the server can invalidate the refresh
      // token. If the network is down or the request fails we still proceed
      // with local logout — we never block the user from logging out.
      await fetch(`${API_URL}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken ?? null }),
      });
    } catch {
      // Network failure → continue with local logout regardless.
    }
    sessionStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    void signOut(auth);
  };

  const updateUserWidgets = (updatedWidgets: string[]) => {
    setUsers(prev =>
      prev.map(u => (u.id === activeUser.id ? { ...u, customPanels: updatedWidgets } : u))
    );
    try {
      localStorage.setItem(`pan_erp_widgets_${activeUser.id}`, JSON.stringify(updatedWidgets));
    } catch {
      /* ignore */
    }
    syncUserPreferencesToD1(updatedWidgets).catch(() => {});
    notify(
      '📋 Tablero Personalizado',
      `Se guardó tu distribución preferida de analíticas para ${activeUser.name}.`,
      'info'
    );
  };

  return {
    users,
    setUsers,
    activeUserId,
    activeUser,
    activeTab,
    setActiveTab,
    selectedSellerId,
    setSelectedSellerId,
    invoiceSeqRef,
    setActiveUserRole,
    logout,
    updateUserWidgets,
  };
}
