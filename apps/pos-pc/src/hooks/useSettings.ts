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
  defaultOpeningMode: 'manual' | 'billetes';
  denominaciones: number[];
}

export interface InventorySettings {
  expiryAlertDays: number;
  globalLowStockThreshold: number;
  offerRecommendHours: number;
}

export interface SyncSettings {
  cleanupDays: number;
  autoSyncOnClose: boolean;
}

export interface GatewayCredential {
  gatewayId: string;
  publicKey: string;
}

export type CustomerTypeKey = 'consumidor_final' | 'frecuente' | 'mayorista' | 'empresa';

export interface PriceList {
  id: string;
  name: string;
  discountPercent: number;
  customerTypes: CustomerTypeKey[];
  isDefault: boolean;
}

export type PromotionType = 'quantity_discount' | 'fixed_discount';

export interface Promotion {
  id: string;
  name: string;
  type: PromotionType;
  minQuantity: number;
  discountPercent: number;
  applicableCategories: string[];
  active: boolean;
}

export type PaymentMethodId = 'efectivo' | 'qr' | 'tarjeta' | 'transferencia';

export type PaymentAdjustmentType = 'none' | 'recargo' | 'descuento';

export interface PaymentMethodConfig {
  id: string;
  label: string;
  icon: string;
  enabled: boolean;
  /**
   * Tipo de ajuste sobre el total que se aplica automáticamente cuando el
   * cajero elige este método de pago. 'none' = sin ajuste.
   */
  adjustmentType: PaymentAdjustmentType;
  /** Porcentaje del ajuste (0–99.99). Solo se usa si adjustmentType != 'none'. */
  adjustmentPercent: number;
  /**
   * Si está en false, las ventas con este método NO acumulan descuentos
   * adicionales (descuentos manuales o de lista de precios quedan en 0).
   */
  acumulaDescuentos: boolean;
  /** @deprecated reemplazado por adjustmentType + adjustmentPercent. */
  surchargePercent?: number;
  linkedPriceListId?: string;
  promotionsEnabled?: boolean;
}

export interface DiscountConfig {
  availablePercents: number[];
  allowManualDiscount: boolean;
  /** Cuando es true, los descuentos manuales/lista aplican también sobre ítems con precio de grupo. */
  allowDiscountsOnOffers: boolean;
  /** Sistema de descuentos automáticos activo. Solo uno puede estar activo a la vez. */
  activeDiscountSystem: 'none' | 'offers' | 'promotions';
}

export interface PosSettings {
  defaultPaymentMethod: PaymentMethodId;
  defaultViewMode: 'visual' | 'list';
}

export interface AppSettings {
  business: BusinessSettings;
  fiscal: FiscalSettings;
  cash: CashSettings;
  inventory: InventorySettings;
  gatewayCredentials: GatewayCredential[];
  priceLists: PriceList[];
  promotions: Promotion[];
  sync: SyncSettings;
  paymentMethods: PaymentMethodConfig[];
  discountConfig: DiscountConfig;
  pos: PosSettings;
}

type ObjectSections = Omit<AppSettings, 'gatewayCredentials' | 'priceLists' | 'promotions' | 'paymentMethods' | 'discountConfig'>;

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
    defaultOpeningMode: 'billetes' as const,
    denominaciones: [10, 20, 50, 100, 1000, 2000, 10000, 20000],
  },
  inventory: {
    expiryAlertDays: 2,
    globalLowStockThreshold: 0,
    offerRecommendHours: 24,
  },
  gatewayCredentials: [],
  priceLists: [
    { id: 'list_1', name: 'Mostrador', discountPercent: 0, customerTypes: ['consumidor_final', 'frecuente'], isDefault: true },
    { id: 'list_2', name: 'Mayorista', discountPercent: -15, customerTypes: ['mayorista', 'empresa'], isDefault: false },
  ],
  promotions: [],
  sync: {
    cleanupDays: 7,
    autoSyncOnClose: true,
  },
  paymentMethods: [
    { id: 'efectivo',       label: 'Efectivo',           icon: 'Banknote', enabled: true, adjustmentType: 'none', adjustmentPercent: 0, acumulaDescuentos: true },
    { id: 'qr',             label: 'QR / Transferencia', icon: 'QrCode',   enabled: true, adjustmentType: 'recargo', adjustmentPercent: 15, acumulaDescuentos: true },
    { id: 'tarjeta',        label: 'Tarjeta',            icon: '💳',       enabled: true, adjustmentType: 'recargo', adjustmentPercent: 15, acumulaDescuentos: false },
    { id: 'transferencia',  label: 'Transferencia',      icon: '🏦',       enabled: true, adjustmentType: 'none', adjustmentPercent: 0, acumulaDescuentos: false },
  ],
  discountConfig: {
    availablePercents: [5, 10, 15, 20, 25, 30],
    allowManualDiscount: false,
    allowDiscountsOnOffers: false,
    activeDiscountSystem: 'none',
  },
  pos: {
    defaultPaymentMethod: 'efectivo',
    defaultViewMode: 'visual',
  },
};

function migratePaymentMethods(stored: unknown): PaymentMethodConfig[] {
  if (!Array.isArray(stored)) return [...DEFAULT_SETTINGS.paymentMethods];
  const VALID: PaymentMethodId[] = ['efectivo', 'qr', 'tarjeta', 'transferencia'];
  const upgraded: PaymentMethodConfig[] = [];
  for (const pm of stored as Array<Record<string, unknown>>) {
    const id = pm?.id as string | undefined;
    if (!id) continue;
    if (VALID.includes(id as PaymentMethodId)) {
      const def = DEFAULT_SETTINGS.paymentMethods.find(p => p.id === id)!;
      const legacySurcharge = typeof pm.surchargePercent === 'number' ? (pm.surchargePercent as number) : 0;
      const storedAdjustmentType = (pm.adjustmentType as PaymentAdjustmentType | undefined)
        ?? (legacySurcharge > 0 ? 'recargo' : 'none');
      const storedAdjustmentPercent = typeof pm.adjustmentPercent === 'number'
        ? (pm.adjustmentPercent as number)
        : legacySurcharge;
      // Si el stored coincide con el default viejo (none/0), usar el default actual
      // para que upgrades de configuración lleguen a instalaciones existentes.
      const wasOldDefault = storedAdjustmentType === 'none' && storedAdjustmentPercent === 0;
      const adjustmentType = wasOldDefault ? def.adjustmentType : storedAdjustmentType;
      const adjustmentPercent = wasOldDefault ? def.adjustmentPercent : storedAdjustmentPercent;
      upgraded.push({
        id,
        label: typeof pm.label === 'string' ? (pm.label as string) : id,
        icon: typeof pm.icon === 'string' ? (pm.icon as string) : '💳',
        enabled: typeof pm.enabled === 'boolean' ? (pm.enabled as boolean) : true,
        adjustmentType,
        adjustmentPercent,
        acumulaDescuentos: typeof pm.acumulaDescuentos === 'boolean' ? (pm.acumulaDescuentos as boolean) : false,
        linkedPriceListId: typeof pm.linkedPriceListId === 'string' ? (pm.linkedPriceListId as string) : undefined,
      });
    } else if (id.startsWith('custom_') && typeof pm.label === 'string') {
      // Preservar métodos personalizados creados por el usuario
      upgraded.push({
        id,
        label: pm.label as string,
        icon: typeof pm.icon === 'string' ? (pm.icon as string) : '💳',
        enabled: typeof pm.enabled === 'boolean' ? (pm.enabled as boolean) : true,
        adjustmentType: (pm.adjustmentType as PaymentAdjustmentType | undefined) ?? 'none',
        adjustmentPercent: typeof pm.adjustmentPercent === 'number' ? (pm.adjustmentPercent as number) : 0,
        acumulaDescuentos: typeof pm.acumulaDescuentos === 'boolean' ? (pm.acumulaDescuentos as boolean) : false,
      });
    }
  }
  // Si faltó alguno de los métodos base, lo agregamos desde defaults.
  for (const id of VALID) {
    if (!upgraded.some(pm => pm.id === id)) {
      const def = DEFAULT_SETTINGS.paymentMethods.find(pm => pm.id === id);
      if (def) upgraded.push({ ...def });
    }
  }
  return upgraded;
}

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
      gatewayCredentials: parsed.gatewayCredentials ?? [...DEFAULT_SETTINGS.gatewayCredentials],
      priceLists: parsed.priceLists ?? [...DEFAULT_SETTINGS.priceLists],
      promotions: parsed.promotions ?? [...DEFAULT_SETTINGS.promotions],
      sync: { ...DEFAULT_SETTINGS.sync, ...parsed.sync },
      paymentMethods: migratePaymentMethods(parsed.paymentMethods),
      discountConfig: (() => {
        if (!parsed.discountConfig) {
          return { ...DEFAULT_SETTINGS.discountConfig, availablePercents: [...DEFAULT_SETTINGS.discountConfig.availablePercents] };
        }
        const validSystems = ['none', 'offers', 'promotions'] as const;
        const rawAds = parsed.discountConfig.activeDiscountSystem;
        const safeAds: 'none' | 'offers' | 'promotions' =
          validSystems.includes(rawAds as (typeof validSystems)[number]) ? (rawAds as (typeof validSystems)[number]) : 'none';
        return {
          ...DEFAULT_SETTINGS.discountConfig,
          ...parsed.discountConfig,
          availablePercents: parsed.discountConfig.availablePercents ?? [...DEFAULT_SETTINGS.discountConfig.availablePercents],
          activeDiscountSystem: safeAds,
        };
      })(),
      pos: { ...DEFAULT_SETTINGS.pos, ...(parsed.pos ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persistSettings(s: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch (e) {
    console.error('[Settings] Failed to persist settings to localStorage:', e);
    // Re-throw so callers can show user feedback
    throw e;
  }
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
      try {
        persistSettings(updated);
      } catch (e) {
        // localStorage lleno (QuotaExceededError): no commitear el state en memoria
        console.error('[settings] QuotaExceededError:', e);
        return prev; // devolvemos el estado anterior sin cambios
      }
      return updated;
    });
  }

  function setGatewayCredentials(credentials: GatewayCredential[]): void {
    setSettings(prev => {
      const updated: AppSettings = { ...prev, gatewayCredentials: credentials };
      try {
        persistSettings(updated);
      } catch (e) {
        console.error('[settings] QuotaExceededError:', e);
        return prev;
      }
      return updated;
    });
  }

  function setPriceLists(priceLists: PriceList[]): void {
    setSettings(prev => {
      const updated: AppSettings = { ...prev, priceLists };
      try {
        persistSettings(updated);
      } catch (e) {
        console.error('[settings] QuotaExceededError:', e);
        return prev;
      }
      return updated;
    });
  }

  function setPromotions(promotions: Promotion[]): void {
    setSettings(prev => {
      const updated: AppSettings = { ...prev, promotions };
      try {
        persistSettings(updated);
      } catch (e) {
        console.error('[settings] QuotaExceededError:', e);
        return prev;
      }
      return updated;
    });
  }

  function setPaymentMethods(paymentMethods: PaymentMethodConfig[]): void {
    setSettings(prev => {
      const updated: AppSettings = { ...prev, paymentMethods };
      try {
        persistSettings(updated);
      } catch (e) {
        console.error('[settings] QuotaExceededError:', e);
        return prev;
      }
      return updated;
    });
  }

  function setDiscountConfig(discountConfig: DiscountConfig): void {
    setSettings(prev => {
      const updated: AppSettings = { ...prev, discountConfig };
      try {
        persistSettings(updated);
      } catch (e) {
        console.error('[settings] QuotaExceededError:', e);
        return prev;
      }
      return updated;
    });
  }

  return { settings, updateSection, setGatewayCredentials, setPriceLists, setPromotions, setPaymentMethods, setDiscountConfig };
}
