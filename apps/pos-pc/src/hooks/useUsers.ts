import type { User as FirebaseUser } from 'firebase/auth';
import { signOut } from 'firebase/auth';
import { useState, useEffect, useRef, useMemo } from 'react';

import { auth } from '../config/firebase';
import { API_URL } from '../services/api';
import { syncUserPreferencesToD1 } from '../services/d1-sync';
import type { User, UserRole } from '../types';
import { safeSetItem, safeParseLocalStorage } from '../utils/safeStorage';

type NotifyFn = (title: string, message: string, type: 'success' | 'error' | 'warning' | 'info') => void;

// Roles que pueden operar sobre más de una sucursal a la vez (ven el selector).
// El resto de los roles queda fijo en su default_branch — ni el selector se
// muestra ni activeBranchId se puede mover, aunque branches[] tenga más de una
// entrada (no debería, pero no confiamos en eso del lado del cliente).
const MULTI_BRANCH_ROLES = new Set(['admin', 'owner', 'supervisor']);

interface UseUsersParams {
  firebaseUser: FirebaseUser;
  firestoreRole?: string | null;
  serverPanels?: string[] | null;
  /** Sucursales a las que el usuario tiene acceso (login response, fase 1/2 backend). */
  branches?: string[] | null;
  /** Sucursal primaria del usuario (login response, fase 1/2 backend). */
  defaultBranch?: string | null;
  notify: NotifyFn;
}

export function useUsers({ firebaseUser, firestoreRole, serverPanels, branches, defaultBranch, notify }: UseUsersParams) {
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

  // ── Multi-branch transfers (fase 3): activeBranchId ─────────────────────
  // Fuente de verdad de "qué sucursal está operando el usuario ahora". Se
  // deriva de default_branch (login) y, para roles elevados, puede moverse
  // dentro de branches[] vía el selector. Para el resto de los roles queda
  // fijo — no hay setter expuesto en la UI aunque el estado técnicamente
  // pudiera cambiar (defensivo: setActiveBranchId valida el rol igual).
  const [activeBranchIdState, setActiveBranchIdState] = useState<string | null>(defaultBranch ?? null);

  // Si el login todavía no había resuelto default_branch cuando este hook montó
  // (carrera con el fetch de App.tsx) o cambia (logout/login de otro usuario),
  // sincronizamos. No pisamos una selección manual ya hecha por un rol elevado
  // salvo que default_branch cambie a un valor distinto (nuevo login).
  const lastDefaultBranchRef = useRef<string | null | undefined>(defaultBranch);
  useEffect(() => {
    if (defaultBranch !== lastDefaultBranchRef.current) {
      lastDefaultBranchRef.current = defaultBranch;
      setActiveBranchIdState(defaultBranch ?? null);
    }
  }, [defaultBranch]);

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

  // canSelectBranch se recalcula acá (no arriba, junto al useState de
  // activeBranchIdState) porque depende de activeUser.role — la MISMA fuente
  // que el resto de la UI usa para decidir qué rol está operando ahora mismo
  // (ver App.tsx isPOSMode/getNavItemsByRole). Usar firestoreRole crudo podría
  // desalinearse si alguna vez el sistema de "sesiones locales" cambia de
  // usuario activo sin pasar por un nuevo login de Firebase.
  const canSelectBranchForActiveUser = MULTI_BRANCH_ROLES.has(activeUser.role as string);

  /** Sucursales disponibles para el selector (vacío para roles sin acceso multi-sucursal). */
  const availableBranches = useMemo<string[]>(
    () => (canSelectBranchForActiveUser ? (branches ?? []) : []),
    [canSelectBranchForActiveUser, branches],
  );

  /** Cambia la sucursal activa. No-op para roles sin selector o sucursales fuera de su membresía. */
  const setActiveBranchId = (branchId: string) => {
    if (!canSelectBranchForActiveUser) return;
    if (branches && !branches.includes(branchId)) return;
    setActiveBranchIdState(branchId);
  };

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
    // Multi-branch transfers (fase 3)
    activeBranchId: activeBranchIdState,
    setActiveBranchId,
    canSelectBranch: canSelectBranchForActiveUser,
    availableBranches,
  };
}
