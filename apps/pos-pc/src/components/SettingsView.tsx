import { Settings, Building2, Receipt, Wallet, Package, CreditCard, Printer, Check, Tag, Percent, RefreshCw, AlertCircle, ShieldAlert, AlertTriangle, Wrench, Keyboard, FileText, Layers } from 'lucide-react';
import * as React from 'react';
import { useState, useEffect } from 'react';

import { useSettings } from '../hooks/useSettings';
import type { BusinessSettings, FiscalSettings, CashSettings, InventorySettings, GatewayCredential, PriceList, Promotion, SyncSettings, PrinterSettings, PosSettings } from '../hooks/useSettings';
import { BusinessSettings as BusinessSettingsPanel } from '../settings/BusinessSettings';
import { CashSettings as CashSettingsPanel } from '../settings/CashSettings';
import { CategorySettings as CategorySettingsPanel } from '../settings/CategorySettings';
import { DangerZoneSettings as DangerZoneSettingsPanel } from '../settings/DangerZoneSettings';
import { DocumentTypesSettings as DocumentTypesSettingsPanel } from '../settings/DocumentTypesSettings';
import { FiscalSettings as FiscalSettingsPanel } from '../settings/FiscalSettings';
import { InventorySettings as InventorySettingsPanel } from '../settings/InventorySettings';
import { KeyboardSettings as KeyboardSettingsPanel } from '../settings/KeyboardSettings';
import { MaintenanceSettings as MaintenanceSettingsPanel } from '../settings/MaintenanceSettings';
import { PaymentSettings as PaymentSettingsPanel } from '../settings/PaymentSettings';
import { PriceListSettings as PriceListSettingsPanel } from '../settings/PriceListSettings';
import { PrinterSettings as PrinterSettingsPanel } from '../settings/PrinterSettings';
import { PromotionsSettings as PromotionsSettingsPanel } from '../settings/PromotionsSettings';
import { SyncSettings as SyncSettingsPanel } from '../settings/SyncSettings';

import { SyncErrorConsole } from './SyncErrorConsole';

type TabId = 'business' | 'fiscal' | 'cash' | 'inventory' | 'payment' | 'pricelists' | 'promotions' | 'categories' | 'documents' | 'printer' | 'keyboard' | 'sync' | 'sync_console' | 'danger' | 'maintenance';

interface TabItem {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const TABS: TabItem[] = [
  { id: 'business', label: 'Negocio', icon: <Building2 className="h-4 w-4" /> },
  { id: 'fiscal', label: 'Fiscal', icon: <Receipt className="h-4 w-4" /> },
  { id: 'cash', label: 'Caja', icon: <Wallet className="h-4 w-4" /> },
  { id: 'inventory', label: 'Inventario', icon: <Package className="h-4 w-4" /> },
  { id: 'payment', label: 'Pagos', icon: <CreditCard className="h-4 w-4" /> },
  { id: 'pricelists', label: 'Precios', icon: <Tag className="h-4 w-4" /> },
  { id: 'promotions', label: 'Promociones', icon: <Percent className="h-4 w-4" /> },
  { id: 'categories', label: 'Categorías', icon: <Layers className="h-4 w-4" /> },
  { id: 'documents', label: 'Comprobantes', icon: <FileText className="h-4 w-4" /> },
  { id: 'printer', label: 'Impresora', icon: <Printer className="h-4 w-4" /> },
  { id: 'keyboard', label: 'Teclado', icon: <Keyboard className="h-4 w-4" /> },
  { id: 'sync', label: 'Sincronización', icon: <RefreshCw className="h-4 w-4" /> },
  { id: 'sync_console', label: 'Errores Sync', icon: <AlertTriangle className="h-4 w-4" /> },
  { id: 'maintenance', label: 'Mantenimiento', icon: <Wrench className="h-4 w-4" /> },
  { id: 'danger', label: 'Sistema', icon: <ShieldAlert className="h-4 w-4" /> },
];

export const SettingsView: React.FC = () => {
  const { settings, updateSection, setGatewayCredentials, setPriceLists, setPromotions, setPaymentMethods, setDiscountConfig, setCategories, setInstallments } = useSettings();
  const [activeTab, setActiveTab] = useState<TabId>('business');
  const [savedToast, setSavedToast] = useState(false);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  const showSavedToast = () => setSavedToast(true);
  const showErrorToast = (msg: string) => setErrorToast(msg);

  useEffect(() => {
    if (!savedToast) return;
    const t = setTimeout(() => setSavedToast(false), 2500);
    return () => clearTimeout(t);
  }, [savedToast]);

  useEffect(() => {
    if (!errorToast) return;
    const t = setTimeout(() => setErrorToast(null), 4000);
    return () => clearTimeout(t);
  }, [errorToast]);

  const safeRun = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      const detail = e instanceof Error ? e.message : 'Error desconocido';
      showErrorToast(`No se pudo guardar la configuración: ${detail}`);
    }
  };

  const handleUpdateBusiness = (_section: 'business', values: Partial<BusinessSettings>) =>
    safeRun(() => updateSection('business', values));
  const handleUpdateFiscal = (_section: 'fiscal', values: Partial<FiscalSettings>) =>
    safeRun(() => updateSection('fiscal', values));
  const handleUpdateCash = (_section: 'cash', values: Partial<CashSettings>) =>
    safeRun(() => updateSection('cash', values));
  const handleUpdateInventory = (_section: 'inventory', values: Partial<InventorySettings>) =>
    safeRun(() => updateSection('inventory', values));
  const handleUpdateSync = (_section: 'sync', values: Partial<SyncSettings>) =>
    safeRun(() => updateSection('sync', values));
  const handleUpdatePrinter = (_section: 'printer', values: Partial<PrinterSettings>) =>
    safeRun(() => updateSection('printer', values));
  const handleUpdatePos = (_section: 'pos', values: Partial<PosSettings>) =>
    safeRun(() => updateSection('pos', values));
  const handleUpdatePayment = (credentials: GatewayCredential[]) =>
    safeRun(() => setGatewayCredentials(credentials));
  const handleUpdatePriceLists = (priceLists: PriceList[]) =>
    safeRun(() => setPriceLists(priceLists));
  const handleUpdatePromotions = (promotions: Promotion[]) =>
    safeRun(() => setPromotions(promotions));
  const handleSetPaymentMethods = (paymentMethods: Parameters<typeof setPaymentMethods>[0]) =>
    safeRun(() => setPaymentMethods(paymentMethods));
  const handleSetDiscountConfig = (discountConfig: Parameters<typeof setDiscountConfig>[0]) =>
    safeRun(() => setDiscountConfig(discountConfig));
  const handleSetCategories = (categories: Parameters<typeof setCategories>[0]) =>
    safeRun(() => setCategories(categories));
  const handleSetInstallments = (installments: Parameters<typeof setInstallments>[0]) =>
    safeRun(() => setInstallments(installments));

  const renderPanel = () => {
    switch (activeTab) {
      case 'business':
        return <BusinessSettingsPanel settings={settings} onUpdate={handleUpdateBusiness} onSaved={showSavedToast} />;
      case 'fiscal':
        return <FiscalSettingsPanel settings={settings} onUpdate={handleUpdateFiscal} onSaved={showSavedToast} />;
      case 'cash':
        return <CashSettingsPanel settings={settings} onUpdate={handleUpdateCash} onSaved={showSavedToast} />;
      case 'inventory':
        return <InventorySettingsPanel settings={settings} onUpdate={handleUpdateInventory} onSaved={showSavedToast} />;
      case 'payment':
        return (
          <PaymentSettingsPanel
            settings={settings}
            onUpdate={handleUpdatePayment}
            onSaved={showSavedToast}
            setPaymentMethods={handleSetPaymentMethods}
            setDiscountConfig={handleSetDiscountConfig}
            installments={settings.installments}
            onSaveInstallments={handleSetInstallments}
          />
        );
      case 'pricelists':
        return <PriceListSettingsPanel settings={settings} onUpdate={handleUpdatePriceLists} onSaved={showSavedToast} />;
      case 'promotions':
        return <PromotionsSettingsPanel settings={settings} onUpdate={handleUpdatePromotions} onSaved={showSavedToast} />;
      case 'categories':
        return <CategorySettingsPanel categories={settings.categories} onSave={handleSetCategories} onSaved={showSavedToast} />;
      case 'documents':
        return <DocumentTypesSettingsPanel />;
      case 'printer':
        return <PrinterSettingsPanel settings={settings} onUpdate={handleUpdatePrinter} onSaved={showSavedToast} />;
      case 'keyboard':
        return <KeyboardSettingsPanel settings={settings} onUpdate={handleUpdatePos} onSaved={showSavedToast} />;
      case 'sync':
        return <SyncSettingsPanel settings={settings} onUpdate={handleUpdateSync} onSaved={showSavedToast} />;
      case 'sync_console':
        return <SyncErrorConsole />;
      case 'maintenance':
        return <MaintenanceSettingsPanel />;
      case 'danger':
        return <DangerZoneSettingsPanel />;
    }
  };

  return (
    <div className="space-y-6 transition-all duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4 border-gray-100 dark:border-zinc-800">
        <div>
          <h2 className="text-xl font-extrabold text-gray-850 dark:text-zinc-50 flex items-center gap-2">
            <Settings className="h-5 w-5 text-amber-500" /> Configuración del Sistema
          </h2>
          <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
            Personalizá el comportamiento del ERP: datos fiscales, caja, inventario y pasarelas de pago.
          </p>
        </div>

        {savedToast && !errorToast && (
          <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 text-xs font-bold px-4 py-2.5 rounded-xl self-start sm:self-auto animate-fade-in">
            <Check className="h-3.5 w-3.5" />
            Configuración guardada
          </div>
        )}

        {errorToast && (
          <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-xs font-bold px-4 py-2.5 rounded-xl self-start sm:self-auto animate-fade-in">
            <AlertCircle className="h-3.5 w-3.5" />
            {errorToast}
          </div>
        )}
      </div>

      <div className="flex flex-col lg:flex-row gap-5">
        <aside className="lg:w-48 shrink-0">
          <nav className="flex lg:flex-col gap-1 flex-wrap overflow-x-auto scrollbar-none">
            {TABS.map(tab => {
              const isActive = activeTab === tab.id;
              const isDanger = tab.id === 'danger';
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-bold rounded-xl transition-all cursor-pointer text-left w-full ${
                    isActive
                      ? isDanger
                        ? 'bg-red-600 text-white shadow-sm'
                        : 'bg-amber-500 text-white shadow-sm'
                      : isDanger
                        ? 'text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50/60 dark:hover:bg-red-950/20'
                        : 'text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-zinc-100 hover:bg-gray-100/60 dark:hover:bg-zinc-800/40'
                  }`}
                >
                  <span className={isActive ? 'text-white' : isDanger ? 'text-red-500' : 'text-amber-500'}>{tab.icon}</span>
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="flex-1 bg-white dark:bg-zinc-900 border border-orange-100/40 dark:border-zinc-800 rounded-2xl p-5 md:p-6 shadow-xs min-h-[360px]">
          {renderPanel()}
        </div>
      </div>
    </div>
  );
};
