import { useState } from 'react';

export interface BusinessSettings {
  businessName: string;
  cuit: string;
  address: string;
  phone: string;
  email: string;
  branchId: string;
}

export interface FiscalSettings {
  ivaRate: number;
  fiscalRegime: 'responsable_inscripto' | 'monotributista' | 'exento';
  currency: 'ARS' | 'USD';
}

export interface CashSettings {
  defaultOpeningAmount: number;
  defaultOpeningNote: string;
  defaultClosingNote: string;
}

export interface InventorySettings {
  expiryAlertDays: number;
  globalLowStockThreshold: number;
}

export interface GatewayCredential {
  gatewayId: string;
  publicKey: string;
}

export interface AppSettings {
  business: BusinessSettings;
  fiscal: FiscalSettings;
  cash: CashSettings;
  inventory: InventorySettings;
  gatewayCredentials: GatewayCredential[];
}

type ObjectSections = Omit<AppSettings, 'gatewayCredentials'>;

const SETTINGS_KEY = 'erp_settings';

const DEFAULT_SETTINGS: AppSettings = {
  business: {
    businessName: '',
    cuit: '',
    address: '',
    phone: '',
    email: '',
    branchId: '00000000000000000000000000000001',
  },
  fiscal: {
    ivaRate: 0.21,
    fiscalRegime: 'responsable_inscripto',
    currency: 'ARS',
  },
  cash: {
    defaultOpeningAmount: 15000,
    defaultOpeningNote: 'Saldo base inicial de cambio en caja chica.',
    defaultClosingNote: 'Cierre de caja de turno regular sin inconvenientes.',
  },
  inventory: {
    expiryAlertDays: 2,
    globalLowStockThreshold: 0,
  },
  gatewayCredentials: [],
};

export function getSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      business: { ...DEFAULT_SETTINGS.business, ...parsed.business },
      fiscal: { ...DEFAULT_SETTINGS.fiscal, ...parsed.fiscal },
      cash: { ...DEFAULT_SETTINGS.cash, ...parsed.cash },
      inventory: { ...DEFAULT_SETTINGS.inventory, ...parsed.inventory },
      gatewayCredentials: parsed.gatewayCredentials ?? DEFAULT_SETTINGS.gatewayCredentials,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persistSettings(s: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch { /* storage full or unavailable */ }
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => getSettings());

  function updateSection<K extends keyof ObjectSections>(
    section: K,
    partialValues: Partial<ObjectSections[K]>
  ): void {
    setSettings(prev => {
      const updated: AppSettings = {
        ...prev,
        [section]: { ...(prev[section] as object), ...(partialValues as object) },
      };
      persistSettings(updated);
      return updated;
    });
  }

  function setGatewayCredentials(credentials: GatewayCredential[]): void {
    setSettings(prev => {
      const updated: AppSettings = { ...prev, gatewayCredentials: credentials };
      persistSettings(updated);
      return updated;
    });
  }

  return { settings, updateSection, setGatewayCredentials };
}
