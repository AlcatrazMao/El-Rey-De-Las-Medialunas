import React, { useState } from 'react';
import { AppProvider, useApp } from './AppContext';
import { MainHeadLayout } from './components/MainHeadLayout';
import { Dashboard } from './components/Dashboard';
import { POSView } from './components/POSView';
import { InventoryView } from './components/InventoryView';
import { SalesHistoryView } from './components/SalesHistoryView';
import { AccountingView } from './components/AccountingView';
import { IntegrationsView } from './components/IntegrationsView';
import { CajeroMermaView } from './components/CajeroMermaView';
import { PanaderoSupplyView } from './components/PanaderoSupplyView';
import { CashSessionView } from './components/CashSessionView';
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
  Menu
} from 'lucide-react';

function ERPLayout() {
  const { deviceMode, activeTab, setActiveTab, activeUser } = useApp();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Helper trigger to switch visual component frames
  const renderActiveView = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard />;
      case 'pos':
        return <POSView />;
      case 'caja':
        return <CashSessionView />;
      case 'inventory':
        return <InventoryView />;
      case 'history':
        return <SalesHistoryView />;
      case 'accounting':
        return <AccountingView />;
      case 'integrations':
        return <IntegrationsView />;
      case 'merma_requests':
        return <CajeroMermaView />;
      case 'supply_requests':
        return <PanaderoSupplyView />;
      default:
        // Safe fallback if tab is not in list for this role
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
          { id: 'pos', label: 'Nueva Venta (POS)', icon: <ShoppingCart className="h-4.5 w-4.5" /> },
          { id: 'caja', label: 'Apertura y Cierre de Caja', icon: <Wallet className="h-4.5 w-4.5" /> },
          { id: 'history', label: 'Historial de Caja', icon: <ReceiptText className="h-4.5 w-4.5" /> },
          { id: 'merma_requests', label: 'Solicitar Merma (Bajas)', icon: <X className="h-4.5 w-4.5 text-red-500 font-bold" /> }
        ];
      case 'panadero':
        return [
          { id: 'inventory', label: 'Inventario y Silos', icon: <Package className="h-4.5 w-4.5" /> },
          { id: 'supply_requests', label: 'Pedidos / Traslados', icon: <TrendingUp className="h-4.5 w-4.5 text-emerald-500 font-bold" /> }
        ];
      case 'admin':
      default:
        return [
          { id: 'dashboard', label: 'Tablero Analítico', icon: <LayoutDashboard className="h-4.5 w-4.5" /> },
          { id: 'pos', label: 'Nueva Venta (POS)', icon: <ShoppingCart className="h-4.5 w-4.5" /> },
          { id: 'caja', label: 'Acciones de Caja 🏦', icon: <Wallet className="h-4.5 w-4.5" /> },
          { id: 'inventory', label: 'Materia e Insumos', icon: <Package className="h-4.5 w-4.5" /> },
          { id: 'history', label: 'Historial de Caja', icon: <ReceiptText className="h-4.5 w-4.5" /> },
          { id: 'accounting', label: 'Egresos y Balance', icon: <HandCoins className="h-4.5 w-4.5" /> },
          { id: 'integrations', label: 'Pasarelas de Pago', icon: <Globe className="h-4.5 w-4.5" /> }
        ];
    }
  };

  const navItems = getNavItemsByRole();

  // Render unified responsive layout
  return (
    <div className="min-h-screen bg-gray-55 dark:bg-zinc-950 flex flex-col font-sans transition-colors duration-300">
      <MainHeadLayout />

      <main className="flex-1 max-w-7xl mx-auto w-full p-4 lg:p-6 flex flex-col gap-5">
        
        {/* DESKTOP/PC HORIZONTAL NAVBAR (unhidden starting at medium screens) */}
        <nav className="hidden md:flex items-center justify-between gap-4 py-2 px-3 border border-orange-100/40 dark:border-zinc-805 bg-white dark:bg-zinc-900 rounded-2xl shadow-xs select-none">
          <div className="flex items-center gap-2 flex-wrap">
            {navItems.map(item => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  id={`btn-nav-tab-${item.id}`}
                  onClick={() => {
                    setActiveTab(item.id);
                    setIsMobileMenuOpen(false);
                  }}
                  className={`flex items-center gap-2.5 px-4 py-3 text-xs font-extrabold rounded-xl transition-all duration-200 cursor-pointer ${
                    isActive
                      ? 'bg-amber-500 text-white shadow-sm scale-[1.02]'
                      : 'text-gray-550 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-zinc-100 hover:bg-gray-100/60 dark:hover:bg-zinc-800/40'
                  }`}
                >
                  <span className={isActive ? 'text-white' : 'text-amber-500 dark:text-amber-450'}>
                    {item.icon}
                  </span>
                  {item.label}
                </button>
              );
            })}
          </div>

          {/* Connected session indicator directly inside navbar */}
          <div className="flex items-center gap-2 text-xs py-2 px-3 bg-amber-500/5 dark:bg-amber-950/10 border border-amber-500/10 dark:border-zinc-800 rounded-xl">
            <span className="text-[10px] font-black text-amber-600 dark:text-amber-450 uppercase tracking-wider">Turno Asignado:</span>
            <span className="font-bold text-gray-700 dark:text-zinc-300 truncate max-w-[140px]">{activeUser.name.split(' ')[0]}</span>
            <span className="text-[8.5px] bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-md uppercase font-black tracking-wider">{activeUser.role}</span>
          </div>
        </nav>

        {/* MOBILE/CELU DROPDOWN HEADER BAR (visible only on mobile) */}
        <div className="md:hidden bg-white dark:bg-zinc-900 border border-orange-100/30 dark:border-zinc-800 p-3.5 rounded-2xl shadow-xs flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="p-2 bg-amber-500/10 text-amber-500 rounded-xl">
                {navItems.find(item => item.id === activeTab)?.icon || <LayoutDashboard className="h-4.5 w-4.5" />}
              </span>
              <div>
                <span className="text-[8px] font-black text-amber-500 uppercase tracking-widest block leading-none">Módulo Activo</span>
                <span className="text-xs font-black text-gray-800 dark:text-zinc-50">
                  {navItems.find(item => item.id === activeTab)?.label || 'Menú de Operaciones'}
                </span>
              </div>
            </div>

            <button
              id="btn-hamburger-toggle"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-2 bg-gray-50 hover:bg-gray-100 dark:bg-zinc-950 dark:hover:bg-zinc-800 border border-gray-200/50 dark:border-zinc-800 rounded-xl text-gray-655 dark:text-zinc-300 cursor-pointer flex items-center justify-center gap-1.5 transition-all active:scale-95"
            >
              <Menu className="h-4 w-4 text-amber-550" />
              <span className="text-[10px] font-black uppercase pr-1">Módulos</span>
            </button>
          </div>

          {/* List display matching desktop options when hamburger is clicked */}
          {isMobileMenuOpen && (
            <div className="border-t border-gray-100 dark:border-zinc-800 pt-3.5 mt-1 grid grid-cols-1 sm:grid-cols-2 gap-1.5 animate-fade-in select-none">
              {navItems.map(item => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    id={`btn-mobile-nav-${item.id}`}
                    onClick={() => {
                      setActiveTab(item.id);
                      setIsMobileMenuOpen(false);
                    }}
                    className={`flex items-center gap-3 px-3.5 py-3 text-xs font-extrabold rounded-xl text-left transition-all cursor-pointer ${
                      isActive
                        ? 'bg-amber-500 text-white shadow-xs'
                        : 'text-gray-655 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-950/50'
                    }`}
                  >
                    <span className={isActive ? 'text-white' : 'text-amber-500'}>
                      {item.icon}
                    </span>
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Dynamic subview display */}
        <section className="bg-white dark:bg-zinc-900 border border-orange-100/30 dark:border-zinc-850 rounded-3xl p-4 md:p-6 shadow-xs min-h-[520px] transition-all duration-350">
          {renderActiveView()}
        </section>

      </main>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <ERPLayout />
    </AppProvider>
  );
}
