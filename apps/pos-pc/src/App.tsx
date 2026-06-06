import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { auth } from './config/firebase';
import { AppProvider, useApp } from './AppContext';
import { MainHeadLayout } from './components/MainHeadLayout';
import { LoginPage } from './components/LoginPage';
import { Dashboard } from './components/Dashboard';
import { POSView } from './components/POSView';
import { InventoryView } from './components/InventoryView';
import { SalesHistoryView } from './components/SalesHistoryView';
import { AccountingView } from './components/AccountingView';
import { IntegrationsView } from './components/IntegrationsView';
import { CajeroMermaView } from './components/CajeroMermaView';
import { PanaderoSupplyView } from './components/PanaderoSupplyView';
import { CashSessionView } from './components/CashSessionView';
import { CustomersView } from './components/CustomersView';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  ReceiptText,
  HandCoins,
  Globe,
  X,
  TrendingUp,
  Wallet,
  Menu,
  LogOut,
  User as UserIcon,
  Users
} from 'lucide-react';

function ERPLayout() {
  const { activeTab, setActiveTab, activeUser, logout } = useApp();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const renderActiveView = () => {
    switch (activeTab) {
      case 'dashboard': return <Dashboard />;
      case 'pos': return <POSView />;
      case 'caja': return <CashSessionView />;
      case 'inventory': return <InventoryView />;
      case 'history': return <SalesHistoryView />;
      case 'accounting': return <AccountingView />;
      case 'integrations': return <IntegrationsView />;
      case 'merma_requests': return <CajeroMermaView />;
      case 'supply_requests': return <PanaderoSupplyView />;
      case 'customers': return <CustomersView />;
      default:
        if (activeUser.role === 'cajero') return <POSView />;
        if (activeUser.role === 'panadero') return <InventoryView />;
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
          { id: 'inventory', label: 'Inventario', icon: <Package className="h-4 w-4" /> },
          { id: 'supply_requests', label: 'Pedidos', icon: <TrendingUp className="h-4 w-4 text-emerald-500" /> }
        ];
      default:
        return [
          { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
          { id: 'pos', label: 'Vender', icon: <ShoppingCart className="h-4 w-4" /> },
          { id: 'caja', label: 'Caja', icon: <Wallet className="h-4 w-4" /> },
          { id: 'inventory', label: 'Inventario', icon: <Package className="h-4 w-4" /> },
          { id: 'history', label: 'Historial', icon: <ReceiptText className="h-4 w-4" /> },
          { id: 'accounting', label: 'Egresos', icon: <HandCoins className="h-4 w-4" /> },
          { id: 'integrations', label: 'Pagos', icon: <Globe className="h-4 w-4" /> },
          { id: 'customers', label: 'Clientes', icon: <Users className="h-4 w-4" /> }
        ];
    }
  };

  const navItems = getNavItemsByRole();

  return (
    <div className="min-h-screen bg-[#FDFBF7] dark:bg-zinc-950 flex flex-col font-sans transition-colors duration-300">
      <MainHeadLayout />

      <main className="flex-1 w-full max-w-7xl mx-auto px-3 sm:px-4 lg:px-6 py-3 lg:py-6 flex flex-col gap-4">
        {/* Desktop nav */}
        <nav className="hidden md:flex items-center justify-between gap-3 py-2 px-3 border border-orange-100/40 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-2xl shadow-sm select-none">
          <div className="flex items-center gap-1.5 flex-wrap">
            {navItems.map(item => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => { setActiveTab(item.id); setIsMobileMenuOpen(false); }}
                  className={`flex items-center gap-2 px-3 py-2.5 text-xs font-bold rounded-xl transition-all duration-200 cursor-pointer ${
                    isActive
                      ? 'bg-amber-500 text-white shadow-sm'
                      : 'text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-zinc-100 hover:bg-gray-100/60 dark:hover:bg-zinc-800/40'
                  }`}
                >
                  <span className={isActive ? 'text-white' : 'text-amber-500'}>{item.icon}</span>
                  <span className="hidden lg:inline">{item.label}</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2 text-xs py-1.5 px-3 bg-amber-500/5 dark:bg-amber-950/10 border border-amber-500/10 dark:border-zinc-800 rounded-xl">
            <UserIcon className="w-3.5 h-3.5 text-amber-500" />
            <span className="font-bold text-gray-700 dark:text-zinc-300 truncate max-w-[120px]">{activeUser.name.split(' ')[0]}</span>
            <span className="text-[8px] bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded-md uppercase font-black tracking-wider">{activeUser.role}</span>
            <button onClick={logout} className="ml-1 p-1 hover:bg-red-100 dark:hover:bg-red-900/20 rounded-lg text-gray-400 hover:text-red-500 transition-colors" title="Cerrar sesión">
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </nav>

        {/* Mobile nav */}
        <div className="md:hidden bg-white dark:bg-zinc-900 border border-orange-100/30 dark:border-zinc-800 p-3 rounded-2xl shadow-sm flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="p-2 bg-amber-500/10 text-amber-500 rounded-xl">
                {navItems.find(item => item.id === activeTab)?.icon || <LayoutDashboard className="w-4 h-4" />}
              </span>
              <div>
                <span className="text-[8px] font-black text-amber-500 uppercase tracking-widest block leading-none">Módulo</span>
                <span className="text-xs font-black text-gray-800 dark:text-zinc-50">
                  {navItems.find(item => item.id === activeTab)?.label || 'Menú'}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-gray-500 dark:text-zinc-400">{activeUser.name.split(' ')[0]}</span>
              <button onClick={logout} className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/20 rounded-lg text-gray-400 hover:text-red-500 transition-colors">
                <LogOut className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="p-2 bg-gray-50 hover:bg-gray-100 dark:bg-zinc-950 dark:hover:bg-zinc-800 border border-gray-200/50 dark:border-zinc-800 rounded-xl text-gray-600 dark:text-zinc-300 cursor-pointer flex items-center justify-center gap-1 transition-all active:scale-95"
              >
                <Menu className="w-4 h-4 text-amber-500" />
              </button>
            </div>
          </div>

          {isMobileMenuOpen && (
            <div className="border-t border-gray-100 dark:border-zinc-800 pt-2.5 grid grid-cols-2 gap-1 animate-fade-in select-none">
              {navItems.map(item => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => { setActiveTab(item.id); setIsMobileMenuOpen(false); }}
                    className={`flex items-center gap-2.5 px-3 py-2.5 text-xs font-extrabold rounded-xl text-left transition-all cursor-pointer ${
                      isActive
                        ? 'bg-amber-500 text-white shadow-sm'
                        : 'text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-950/50'
                    }`}
                  >
                    <span className={isActive ? 'text-white' : 'text-amber-500'}>{item.icon}</span>
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Content */}
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

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FDFBF7] dark:bg-zinc-950">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-amber-500/30 border-t-amber-500 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-gray-500 dark:text-zinc-400">Cargando...</p>
        </div>
      </div>
    );
  }

  if (!firebaseUser) {
    return <LoginPage onLogin={(user) => setFirebaseUser(user)} />;
  }

  return (
    <AppProvider firebaseUser={firebaseUser}>
      <ERPLayout />
    </AppProvider>
  );
}
