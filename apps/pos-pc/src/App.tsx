import type { User } from 'firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';
import {
  LayoutDashboard, ShoppingCart, Package, ReceiptText,
  HandCoins, Globe, X, TrendingUp, Wallet, Menu,
  LogOut, User as UserIcon, Users, PlusCircle, Check, StickyNote, Settings, Tag
} from 'lucide-react';
import * as React from 'react'
import { useState, useEffect } from 'react';

import { AppProvider, useApp } from './AppContext';
import { AccountingView } from './components/AccountingView';
import { AdminUsersView } from './components/AdminUsersView';
import { CajeroMermaView } from './components/CajeroMermaView';
import { CashSessionView } from './components/CashSessionView';
import { CustomersView } from './components/CustomersView';
import { Dashboard } from './components/Dashboard';
import { IntegrationsView } from './components/IntegrationsView';
import { InventoryView } from './components/InventoryView';
import { LoginPage } from './components/LoginPage';
import { MainHeadLayout } from './components/MainHeadLayout';
import { OffersView } from './components/OffersView';
import { PanaderoSupplyView } from './components/PanaderoSupplyView';
import { POSView } from './components/POSView';
import { SalesHistoryView } from './components/SalesHistoryView';
import { SettingsView } from './components/SettingsView';
import { StickyNotesView } from './components/StickyNotesView';
import { SyncErrorConsole } from './components/SyncErrorConsole';
import { auth } from './config/firebase';
import { useSyncEngine } from './hooks/useSyncEngine';
import { useVersionCheck } from './hooks/useVersionCheck';
import { safeSetItem } from './utils/safeStorage';


interface SavedSession { email: string; name: string; role: string; }

function NetworkStatusBar({
  isOnline,
  isSyncing,
  lastSync,
  onSyncNow,
}: {
  isOnline: boolean;
  isSyncing: boolean;
  lastSync: Date | null;
  onSyncNow: () => void;
}) {
  if (isOnline && !isSyncing) return null;

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium shadow-lg transition-all ${
        isOnline
          ? "bg-emerald-600/90 text-white"
          : "bg-amber-600/90 text-white"
      }`}
    >
      {isSyncing ? (
        <>
          <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
          Sincronizando…
        </>
      ) : !isOnline ? (
        <>
          <span className="h-2 w-2 rounded-full bg-white" />
          Sin conexión
          {lastSync && (
            <span className="opacity-70">
              · últ. sync {lastSync.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            onClick={onSyncNow}
            className="ml-1 underline underline-offset-2 hover:no-underline"
          >
            Reintentar
          </button>
        </>
      ) : null}
    </div>
  );
}

function UpdateBanner() {
  const updateAvailable = useVersionCheck();
  if (!updateAvailable) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-xs font-bold text-white shadow-md">
      <span>Hay una versión nueva disponible.</span>
      <button
        onClick={() => window.location.reload()}
        className="underline underline-offset-2 hover:no-underline"
      >
        Actualizar ahora
      </button>
    </div>
  );
}

function ERPLayout() {
  const { activeTab, setActiveTab, activeUser, logout, batches } = useApp();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showSessionMenu, setShowSessionMenu] = useState(false);
  const [_showAddSession, setShowAddSession] = useState(false);

  // Load saved sessions from localStorage
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>(() => {
    try { return JSON.parse(localStorage.getItem('erp_sessions') || '[]'); }
    catch { return []; }
  });

  // Save current session when user changes (uses ref to avoid stale closure)
  const sessionsRef = React.useRef(savedSessions);
  sessionsRef.current = savedSessions;
  useEffect(() => {
    if (!activeUser?.email) return;
    const sessions = sessionsRef.current.filter(s => s.email !== activeUser.email);
    sessions.unshift({ email: activeUser.email, name: activeUser.name, role: activeUser.role });
    safeSetItem('erp_sessions', JSON.stringify(sessions));
    setSavedSessions(sessions);
  }, [activeUser?.email, activeUser?.name, activeUser?.role]);

  const switchSession = async (session: SavedSession) => {
    if (session.email === activeUser.email) return;
    await auth.signOut();
    setShowSessionMenu(false);
  };

  const removeSession = (email: string) => {
    const sessions = savedSessions.filter(s => s.email !== email);
    safeSetItem('erp_sessions', JSON.stringify(sessions));
    setSavedSessions(sessions);
  };

  const renderActiveView = () => {
    switch (activeTab) {
      case 'dashboard':
        if (activeUser.role === 'cajero') return <POSView />;
        return <Dashboard />;
      case 'pos': return <POSView />;
      case 'caja': return <CashSessionView />;
      case 'inventory': return <InventoryView />;
      case 'offers': return <OffersView batches={batches} />;
      case 'history': return <SalesHistoryView />;
      case 'accounting': return <AccountingView />;
      case 'integrations': return <IntegrationsView />;
      case 'merma_requests': return <CajeroMermaView />;
      case 'supply_requests': return <PanaderoSupplyView />;
      case 'customers': return <CustomersView />;
      case 'admin_users': return <AdminUsersView />;
      case 'notes': return <StickyNotesView />;
      case 'settings': return <SettingsView />;
      case 'sync_console': return <SyncErrorConsole />;
      default:
        if (activeUser.role === 'cajero') return <POSView />;
        if (activeUser.role === 'panadero') return <Dashboard />;
        return <Dashboard />;
    }
  };

  const getNavItemsByRole = () => {
    const role = activeUser?.role || 'admin';
    switch (role) {
      case 'cajero':
        return [
          { id: 'pos', label: 'Vender', icon: <ShoppingCart className="h-4 w-4" /> },
          { id: 'caja', label: 'Caja', icon: <Wallet className="h-4 w-4" /> },
          { id: 'history', label: 'Historial', icon: <ReceiptText className="h-4 w-4" /> },
          { id: 'merma_requests', label: 'Mermas', icon: <X className="h-4 w-4 text-red-500" /> }
        ];
      case 'panadero':
        return [
          { id: 'dashboard', label: 'Tablero', icon: <LayoutDashboard className="h-4 w-4" /> },
          { id: 'supply_requests', label: 'Producción', icon: <TrendingUp className="h-4 w-4 text-emerald-500" /> },
          { id: 'inventory', label: 'Inventario', icon: <Package className="h-4 w-4" /> },
          { id: 'notes', label: 'Notas', icon: <StickyNote className="h-4 w-4" /> }
        ];
      default:
        return [
          { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
          { id: 'pos', label: 'Vender', icon: <ShoppingCart className="h-4 w-4" /> },
          { id: 'caja', label: 'Caja', icon: <Wallet className="h-4 w-4" /> },
          { id: 'inventory', label: 'Inventario', icon: <Package className="h-4 w-4" /> },
          { id: 'offers', label: 'Ofertas', icon: <Tag className="h-4 w-4" /> },
          { id: 'history', label: 'Historial', icon: <ReceiptText className="h-4 w-4" /> },
          { id: 'accounting', label: 'Egresos', icon: <HandCoins className="h-4 w-4" /> },
          { id: 'integrations', label: 'Pagos', icon: <Globe className="h-4 w-4" /> },
          { id: 'customers', label: 'Clientes', icon: <Users className="h-4 w-4" /> },
          { id: 'notes', label: 'Notas', icon: <StickyNote className="h-4 w-4" /> },
          { id: 'admin_users', label: 'Usuarios', icon: <Users className="h-4 w-4" /> },
          { id: 'settings', label: 'Configuración', icon: <Settings className="h-4 w-4" /> }
        ];
    }
  };

  const navItems = getNavItemsByRole();

  return (
    <div className="min-h-screen bg-[#FDFBF7] dark:bg-zinc-950 flex flex-col font-sans transition-colors duration-300">
      <MainHeadLayout />
      <main className="flex-1 w-full max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 py-3 lg:py-6 flex flex-col gap-4">
        <nav className="hidden md:flex items-center justify-between gap-3 py-2 px-3 border border-orange-100/40 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-2xl shadow-sm select-none">
          <div className="flex items-center gap-1.5 flex-wrap">
            {navItems.map(item => {
              const isActive = activeTab === item.id;
              return (
                <button key={item.id} onClick={() => { setActiveTab(item.id); setIsMobileMenuOpen(false); }}
                  className={`flex items-center gap-2 px-3 py-2.5 text-xs font-bold rounded-xl transition-all duration-200 cursor-pointer ${
                    isActive ? 'bg-amber-500 text-white shadow-sm' : 'text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-zinc-100 hover:bg-gray-100/60 dark:hover:bg-zinc-800/40'}`}>
                  <span className={isActive ? 'text-white' : 'text-amber-500'}>{item.icon}</span>
                  <span className="hidden lg:inline">{item.label}</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            {/* Session switcher */}
            <div className="relative">
              <button onClick={() => setShowSessionMenu(!showSessionMenu)}
                className="flex items-center gap-2 text-xs py-1.5 px-3 bg-amber-500/5 dark:bg-amber-950/10 border border-amber-500/10 dark:border-zinc-800 rounded-xl">
                <UserIcon className="w-3.5 h-3.5 text-amber-500" />
                <span className="font-bold text-gray-700 dark:text-zinc-300 truncate max-w-[100px]">{activeUser.name.split(' ')[0]}</span>
                <span className="text-[8px] bg-amber-500/15 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-md uppercase font-black">{activeUser.role}</span>
              </button>
              {showSessionMenu && (
                <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-zinc-900 border rounded-xl shadow-lg z-50 p-2" onClick={e => e.stopPropagation()}>
                  <div className="text-[10px] font-bold text-gray-400 uppercase px-2 py-1">Sesiones</div>
                  {savedSessions.map(s => (
                    <div key={s.email} className={`flex items-center gap-2 px-2 py-2 rounded-lg text-xs ${s.email === activeUser.email ? 'bg-amber-500/10' : 'hover:bg-gray-50 dark:hover:bg-zinc-800'}`}>
                      <button onClick={() => switchSession(s)} className="flex-1 flex items-center gap-2 text-left">
                        <div className="w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-900/20 flex items-center justify-center text-[10px] font-bold text-amber-700">{s.name[0]}</div>
                        <div>
                          <div className="font-bold text-gray-700 dark:text-zinc-200">{s.name}</div>
                          <div className="text-[10px] text-gray-400">{s.role} · {s.email}</div>
                        </div>
                      </button>
                      {s.email === activeUser.email && <Check className="w-3.5 h-3.5 text-amber-500" />}
                      <button onClick={() => removeSession(s.email)} className="text-gray-400 hover:text-red-500 ml-1"><X className="w-3 h-3" /></button>
                    </div>
                  ))}
                  <button onClick={() => { setShowSessionMenu(false); logout(); setShowAddSession(true); }}
                    className="w-full flex items-center gap-2 px-2 py-2 mt-1 text-xs font-bold text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/20 rounded-lg border-t border-gray-100 dark:border-zinc-800">
                    <PlusCircle className="w-3.5 h-3.5" /> Agregar sesión
                  </button>
                </div>
              )}
            </div>
            <button onClick={logout} className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/20 rounded-lg text-gray-400 hover:text-red-500 transition-colors" title="Cerrar sesión">
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </nav>

        {/* Mobile nav */}
        <div className="md:hidden bg-white dark:bg-zinc-900 border border-orange-100/30 dark:border-zinc-800 p-3 rounded-2xl shadow-sm flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="p-2 bg-amber-500/10 text-amber-500 rounded-xl">{navItems.find(item => item.id === activeTab)?.icon || <LayoutDashboard className="w-4 h-4" />}</span>
              <div>
                <span className="text-[8px] font-black text-amber-500 uppercase tracking-widest block">Módulo</span>
                <span className="text-xs font-black text-gray-800 dark:text-zinc-50">{navItems.find(item => item.id === activeTab)?.label || 'Menú'}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-gray-500 dark:text-zinc-400">{activeUser.name.split(' ')[0]}</span>
              <button onClick={logout} className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/20 rounded-lg text-gray-400 hover:text-red-500"><LogOut className="w-3.5 h-3.5" /></button>
              <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2 bg-gray-50 hover:bg-gray-100 dark:bg-zinc-950 dark:hover:bg-zinc-800 border rounded-xl text-gray-600 dark:text-zinc-300 cursor-pointer flex items-center gap-1 transition-all active:scale-95">
                <Menu className="w-4 h-4 text-amber-500" />
              </button>
            </div>
          </div>
          {isMobileMenuOpen && (
            <div className="border-t border-gray-100 dark:border-zinc-800 pt-2.5 grid grid-cols-2 gap-1 animate-fade-in select-none">
              {navItems.map(item => {
                const isActive = activeTab === item.id;
                return (
                  <button key={item.id} onClick={() => { setActiveTab(item.id); setIsMobileMenuOpen(false); }}
                    className={`flex items-center gap-2.5 px-3 py-2.5 text-xs font-extrabold rounded-xl text-left transition-all cursor-pointer ${isActive ? 'bg-amber-500 text-white shadow-sm' : 'text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-950/50'}`}>
                    <span className={isActive ? 'text-white' : 'text-amber-500'}>{item.icon}</span>{item.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <section className="bg-white dark:bg-zinc-900 border border-orange-100/30 dark:border-zinc-800 rounded-3xl p-3 md:p-6 shadow-sm min-h-[520px] transition-all duration-350">
          {renderActiveView()}
        </section>
      </main>
    </div>
  );
}

export default function App() {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [accessError, setAccessError] = useState('');
  const [firestoreRole, setFirestoreRole] = useState<string | null>(null);
  const [fsCheckDone, setFsCheckDone] = useState(false);
  const [serverPanels, setServerPanels] = useState<string[] | null>(null);

  // Step 1: Firebase Auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      if (!user) {
        setAuthLoading(false);
        setFirestoreRole(null);
        setFsCheckDone(false);
      }
    });
    return () => unsub();
  }, []);

  // Step 2: Validate against D1 via API Worker
  useEffect(() => {
    if (!firebaseUser) return;
    let cancelled = false;
    const check = async () => {
      try {
        const idToken = await firebaseUser.getIdToken();
        const res = await fetch(`${import.meta.env.VITE_API_URL || 'https://el-rey-api-production.elprincipitodeargentina.workers.dev'}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        });
        const data = await res.json();
        if (data.success && data.data?.user) {
          if (data.data.tokens?.access_token) {
            sessionStorage.setItem('access_token', data.data.tokens.access_token);
          }
          if (data.data.tokens?.refresh_token) {
            localStorage.setItem('refresh_token', data.data.tokens.refresh_token);
          }
          if (!cancelled) {
            setFirestoreRole(data.data.user.role || null);
            setServerPanels(data.data.user.custom_panels ?? null);
            setFsCheckDone(true);
            setAuthLoading(false);
          }
        } else {
          if (!cancelled) {
            setAccessError(data.error?.message || 'Usuario no registrado.');
            setAuthLoading(false);
          }
        }
      } catch {
        if (!cancelled) {
          setAccessError('Error de conexión. Reintentá.');
          setAuthLoading(false);
        }
      }
    };
    check();
    return () => { cancelled = true; };
  }, [firebaseUser]);

  // Offline-first sync engine — starts when user is authenticated
  const { isOnline, isSyncing, lastSync, triggerSync, syncStatus, retryError, retryAllNetwork } = useSyncEngine(fsCheckDone && !!firebaseUser);

  // Notify consumers when backend tokens are ready — must be before any early returns
  useEffect(() => {
    if (!firebaseUser || !fsCheckDone) return;
    window.dispatchEvent(new Event('firebase-token-ready'));
  }, [firebaseUser, fsCheckDone]);

  // Loading: Firebase auth or Firestore check not done
  if (authLoading && !accessError && !fsCheckDone) {
    return <div className="min-h-screen flex items-center justify-center bg-[#FDFBF7] dark:bg-zinc-950"><div className="w-10 h-10 border-3 border-amber-500/30 border-t-amber-500 rounded-full animate-spin mx-auto" /></div>;
  }

  // Error
  if (accessError) {
    return <LoginPage onLogin={(user) => { setFirebaseUser(user); setAccessError(''); setAuthLoading(true); setFsCheckDone(false); }} accessError={accessError} />;
  }

  // Not logged in
  if (!firebaseUser || !fsCheckDone) {
    return <LoginPage onLogin={(user) => { setFirebaseUser(user); setAccessError(''); setAuthLoading(true); setFsCheckDone(false); }} />;
  }

  return (
    <AppProvider firebaseUser={firebaseUser} firestoreRole={firestoreRole} serverPanels={serverPanels} syncStatus={syncStatus} retryError={retryError} retryAllNetwork={retryAllNetwork}>
      <UpdateBanner />
      <NetworkStatusBar isOnline={isOnline} isSyncing={isSyncing} lastSync={lastSync} onSyncNow={triggerSync} />
      <ERPLayout />
    </AppProvider>
  );
}
