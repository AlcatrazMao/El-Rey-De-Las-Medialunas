import type { User as FirebaseUser } from 'firebase/auth';
import { signOut } from 'firebase/auth';
import { useState, useEffect, useRef } from 'react';
import { auth } from '../config/firebase';
import { safeSetItem } from '../utils/safeStorage';
import { syncUserPreferencesToD1 } from '../services/d1-sync';
import type { User, UserRole } from '../types';

type NotifyFn = (title: string, message: string, type: 'success' | 'error' | 'warning' | 'info') => void;

interface UseUsersParams {
  firebaseUser: FirebaseUser;
  firestoreRole?: string | null;
  serverPanels?: string[] | null;
  notify: NotifyFn;
}

const safeParse = <T,>(key: string, fallback: T): T => {
  try {
    const saved = localStorage.getItem(key);
    if (!saved) return fallback;
    const parsed = JSON.parse(saved);
    if (parsed === null || parsed === undefined) return fallback;
    return parsed as T;
  } catch (e) {
    console.error(`Error parsing localStorage key "${key}":`, e);
    localStorage.removeItem(key);
    return fallback;
  }
};

export function useUsers({ firebaseUser, firestoreRole, serverPanels, notify }: UseUsersParams) {
  const defaultPanels =
    firestoreRole === 'admin' || firestoreRole === 'owner'
      ? ['widget_facturacion', 'widget_inventario', 'widget_contabilidad', 'widget_alertas', 'widget_historico']
      : firestoreRole === 'cajero'
        ? ['widget_facturacion', 'widget_alertas']
        : ['widget_inventario', 'widget_alertas'];

  const persistedPanels = (() => {
    try {
      const raw = localStorage.getItem(`pan_erp_widgets_${firebaseUser.uid}`);
      if (raw) return JSON.parse(raw) as string[];
    } catch {
      /* ignore */
    }
    return null;
  })();

  const firebaseMappedUser: User = {
    id: firebaseUser.uid,
    name: firebaseUser.displayName || firebaseUser.email || 'Usuario',
    email: firebaseUser.email || '',
    role: (firestoreRole || 'panadero') as UserRole,
    avatar: firebaseUser.photoURL || '',
    customPanels: serverPanels ?? persistedPanels ?? defaultPanels,
  };

  const [users, setUsers] = useState<User[]>(() =>
    safeParse<User[]>('pan_erp_users', [firebaseMappedUser])
  );
  const [activeUserId, setActiveUserId] = useState<string>(
    () => localStorage.getItem('pan_erp_active_user_id') || 'user_admin'
  );
  const [activeTab, setActiveTab] = useState<string>('dashboard');
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
      else if (role === 'panadero') setActiveTab('inventory');
      else setActiveTab('dashboard');
    }
  };

  const logout = () => {
    signOut(auth);
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
