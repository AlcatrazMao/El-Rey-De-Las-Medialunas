import type { User as FirebaseUser } from 'firebase/auth';
import * as React from 'react';
import { createContext, useContext, useEffect, useMemo, useRef } from 'react';

import { useBatches } from './hooks/useBatches';
import { useCashSession } from './hooks/useCashSession';
import { useCustomers } from './hooks/useCustomers';
import { useExpenses } from './hooks/useExpenses';
import { useInventory } from './hooks/useInventory';
import { useNotifications } from './hooks/useNotifications';
import { useSales } from './hooks/useSales';
import { getSettings } from './hooks/useSettings';
import { addAutoNote } from './hooks/useStickyNotes';
import { useSupplyRequests } from './hooks/useSupplyRequests';
import { enqueueSale as syncEnqueueSale, syncOnCashClose as syncOnCashCloseFn } from './hooks/useSyncEngine';
import { useUsers } from './hooks/useUsers';
import {
  INITIAL_INGREDIENTS,
  INITIAL_PRODUCTS,
  INITIAL_SALES,
  INITIAL_EXPENSES,
  USERS,
  INITIAL_NOTIFICATIONS,
  PAYMENT_GATEWAYS,
} from './initialData';
import { syncSaleToD1, buildSalePayload, updateSupplyRequestStatusInD1, syncStockMovementToD1, syncBatchToD1 } from './services/d1-sync';
import type {
  Ingredient, Product, ProductGroup, Sale, Expense, User, PushNotification, PaymentGateway,
  UserRole, ProductBatch, BatchWithdrawalRequest, SupplyRequest, CashSession, Customer,
  SyncStatus,
} from './types';
import { formatCurrency } from './utils/format';

interface AppContextType {
  ingredients: Ingredient[]; products: Product[]; sales: Sale[]; expenses: Expense[];
  users: User[]; notifications: PushNotification[]; gateways: PaymentGateway[];
  activeUser: User; activeTab: string; batches: ProductBatch[];
  withdrawalRequests: BatchWithdrawalRequest[]; supplyRequests: SupplyRequest[];
  currentCashSession: CashSession | null; cashSessionsHistory: CashSession[]; customers: Customer[];
  setSales: React.Dispatch<React.SetStateAction<Sale[]>>;
  selectedSellerId: string; setSelectedSellerId: (id: string) => void;
  logout: () => void;
  setCustomers: React.Dispatch<React.SetStateAction<Customer[]>>;
  addCustomer: (c: Omit<Customer, 'id' | 'created_at' | 'updated_at' | 'timeline' | 'total_purchases' | 'last_purchase_date' | 'current_debt'>) => string;
  updateCustomer: (id: string, data: Partial<Customer>) => void;
  setActiveUserRole: (role: UserRole) => void;
  setActiveTab: (tab: string) => void;
  setBatches: React.Dispatch<React.SetStateAction<ProductBatch[]>>;
  addSale: (items: { productId: string; quantity: number; unitPrice?: number; presentation?: string; admite_acum_desc?: 0 | 1 }[], paymentMethod: Sale['paymentMethod'], customDoc?: string, customName?: string, customerId?: string, sellerId?: string, discountPercent?: number, priceListDiscountPercent?: number, idempotencyKey?: string) => { success: boolean; invoice?: Sale; error?: { code: string; message: string } };
  addExpense: (expense: Omit<Expense, 'id' | 'date'>) => void;
  addIngredient: (ingredient: Omit<Ingredient, 'id'>) => void;
  updateIngredientStock: (id: string, newStock: number) => void;
  addProduct: (product: Omit<Product, 'id' | 'code'>) => void;
  updateProductStock: (id: string, newStock: number) => void;
  updateProductGroups: (id: string, groups: ProductGroup[]) => void;
  toggleGateway: (id: string) => void;
  updateUserWidgets: (widgets: string[]) => void;
  addSystemNotification: (title: string, message: string, type: PushNotification['type']) => void;
  markNotificationAsRead: (id: string) => void;
  clearNotifications: () => void;
  resetAllData: () => void;
  addBatch: (batch: Omit<ProductBatch, 'id' | 'status'>) => void;
  requestBatchWithdrawal: (batchId: string, quantity: number, reason: string) => void;
  approveWithdrawalRequest: (requestId: string, adminMemo: string) => void;
  rejectWithdrawalRequest: (requestId: string, adminMemo: string) => void;
  requestSupply: (type: 'ingredient' | 'product', itemId: string, quantity: number, reason: string) => void;
  approveSupplyRequest: (requestId: string, adminMemo: string) => void;
  rejectSupplyRequest: (requestId: string, adminMemo: string) => void;
  openCashSession: (initialAmount: number, note?: string) => void;
  closeCashSession: (realAmount: number, note?: string) => void;
  closeHistoricalSession: (sessionId: string, realAmount: number, note?: string) => void;
  loadMoreSessions: () => void;
  hasMoreSessions: boolean;
  // sync-error-console: estado del LED + handlers para consola admin
  syncStatus: SyncStatus;
  retryError: (errorId: number) => Promise<void>;
  retryAllNetwork: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
};

export const AppProvider: React.FC<{
  children: React.ReactNode;
  firebaseUser: FirebaseUser;
  firestoreRole?: string | null;
  serverPanels?: string[] | null;
  syncStatus: SyncStatus;
  retryError: (errorId: number) => Promise<void>;
  retryAllNetwork: () => Promise<void>;
}> = ({ children, firebaseUser, firestoreRole, serverPanels, syncStatus, retryError, retryAllNetwork }) => {
  const notif = useNotifications();
  const inv = useInventory(notif.addSystemNotification);
  const cust = useCustomers(notif.addSystemNotification);
  const exp = useExpenses(notif.addSystemNotification);
  const usr = useUsers({ firebaseUser, firestoreRole, serverPanels, notify: notif.addSystemNotification });
  const bch = useBatches({ notify: notif.addSystemNotification, products: inv.products });
  const cash = useCashSession({
    notify: notif.addSystemNotification,
    getActiveUser: () => usr.activeUser,
    onCashClose: () => { void syncOnCashCloseFn(); },
  });
  const sup = useSupplyRequests({ notify: notif.addSystemNotification, getActiveUser: () => usr.activeUser, ingredients: inv.ingredients, products: inv.products });
  const sal = useSales();

  // Fix 2: lock against concurrent addSale calls (double-click / rapid scanner).
  // A boolean ref is the correct primitive here — it's synchronous (no async gap
  // between read and write), unlike a state variable that would need a re-render.
  const isProcessingSaleRef = useRef(false);

  useEffect(() => {
    const loadFromD1 = () => {
      cust.loadCustomersFromD1();
      inv.refreshProductsFromD1(getSettings().business.branchId);
    };
    loadFromD1();
    window.addEventListener('firebase-token-ready', loadFromD1);
    return () => window.removeEventListener('firebase-token-ready', loadFromD1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only effect; hook refs are stable
  }, []);

  const addSale = (cartItems: { productId: string; quantity: number; unitPrice?: number; presentation?: string; admite_acum_desc?: 0 | 1 }[], paymentMethod: Sale['paymentMethod'], customDoc?: string, customName?: string, customerId?: string, sellerId?: string, discountPercent = 0, priceListDiscountPercent = 0, idempotencyKey?: string) => {
    // Fix 2: prevent double-click / rapid-scanner from creating duplicate invoices.
    // The lock is synchronous: set before any async work, cleared in a finally-equivalent
    // position after all side-effects complete (or on early-exit).
    if (isProcessingSaleRef.current) {
      return { success: false, error: { code: 'SALE_IN_PROGRESS', message: 'Ya se está procesando una venta. Esperá un momento.' } };
    }
    isProcessingSaleRef.current = true;

    try {

    if (cartItems.length === 0) {
      return { success: false, error: { code: 'EMPTY_CART', message: 'La venta está vacía.' } };
    }

    // Bug 8 fix: capture settings once — avoids repeated getSettings() calls throughout the function
    const settings = getSettings();
    const ivaRate = settings.fiscal.ivaRate;

    // Idempotency: si el caller no mandó key, generamos una. Idealmente la genera
    // el POSView al iniciar el cobro y la pasa acá.
    const finalIdempotencyKey = idempotencyKey ?? (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `idem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);

    // Snapshot for validation and line-item building; actual state updates use functional setters below.
    const snapshotProducts = [...inv.products];
    const snapshotIngredients = [...inv.ingredients];
    const saleLineItems: Sale['items'] = [];
    const lowStockAlerts: string[] = [];
    const stockWarnings: string[] = [];

    // Validation pass — uses snapshot (early-exit, no state mutation yet)
    for (const item of cartItems) {
      const product = snapshotProducts.find(p => p.id === item.productId);
      if (!product) {
        return { success: false, error: { code: 'PRODUCT_NOT_FOUND', message: `El producto ${item.productId} no existe.` } };
      }
    }

    // Stock se VERIFICA pero nunca BLOQUEA — filosofía offline-first.
    // Si el stock disponible no alcanza, registramos un warning para mostrar
    // al cajero pero la venta procede normalmente.
    const totalByProduct = new Map<string, number>();
    for (const item of cartItems) {
      totalByProduct.set(item.productId, (totalByProduct.get(item.productId) ?? 0) + item.quantity);
    }
    for (const [productId, totalQty] of totalByProduct.entries()) {
      const product = snapshotProducts.find(p => p.id === productId);
      if (!product) continue;
      if (product.stock < totalQty) {
        stockWarnings.push(`⚠️ ${product.name}: stock reportado ${product.stock} < pedido ${totalQty}. Venta procesada igual.`);
      }
    }

    // Build line items from snapshot (for sale record and low-stock alerts)
    const updatedSnapshot = [...snapshotProducts];
    const updatedIngSnapshot = [...snapshotIngredients];
    for (const item of cartItems) {
      const productIdx = updatedSnapshot.findIndex(p => p.id === item.productId);
      if (productIdx === -1) continue;
      updatedSnapshot[productIdx] = {
        ...updatedSnapshot[productIdx],
        stock: updatedSnapshot[productIdx].stock - item.quantity,
      };
      const product = updatedSnapshot[productIdx];
      if (product.stock <= product.minStock) lowStockAlerts.push(`Stock bajo de ${product.name}: quedan ${product.stock} unidades.`);
      for (const recipeIng of product.ingredients) {
        const ingIdx = updatedIngSnapshot.findIndex(i => i.id === recipeIng.ingredientId);
        if (ingIdx === -1) continue;
        updatedIngSnapshot[ingIdx] = {
          ...updatedIngSnapshot[ingIdx],
          stock: updatedIngSnapshot[ingIdx].stock - recipeIng.quantity * item.quantity,
        };
        const ing = updatedIngSnapshot[ingIdx];
        if (ing.stock <= ing.minStock) lowStockAlerts.push(`Peligro: Materia prima baja en "${ing.name}" (${ing.stock.toFixed(2)}${ing.unit} restante).`);
      }
      const linePrice = item.unitPrice ?? product.price;
      saleLineItems.push({
        productId: product.id,
        name: product.name,
        quantity: item.quantity,
        price: linePrice,
        subtotal: parseFloat((linePrice * item.quantity).toFixed(2)),
        cost: product.cost,
        presentation: item.presentation,
        admite_acum_desc: item.admite_acum_desc,
      });
    }

    // ── Cálculo de los 3 campos canónicos ───────────────────────────────────
    // subtotal_bruto = suma(unit_price × quantity) sin ningún descuento
    // total_final    = lo que se cobra (subtotal − descuentos + ajuste método)
    // discount_total = subtotal_bruto − total_final (SIEMPRE derivado)
    const subtotalBruto = parseFloat(
      saleLineItems.reduce((acc, curr) => acc + curr.subtotal, 0).toFixed(2)
    );

    const pmConfig = settings.paymentMethods?.find(m => m.id === paymentMethod);
    const acumulaDescuentos = pmConfig?.acumulaDescuentos ?? false;
    // Si el método de pago NO acumula descuentos, anulamos descuento manual + lista.
    const effectiveDiscountPercent = acumulaDescuentos ? discountPercent : 0;
    const effectivePriceListPercent = acumulaDescuentos ? priceListDiscountPercent : 0;

    // El descuento manual solo se aplica sobre las líneas elegibles
    const eligibleSubtotal = saleLineItems.reduce((acc, curr) => {
      const admits = !curr.presentation || curr.admite_acum_desc === 1;
      return admits ? acc + curr.subtotal : acc;
    }, 0);
    const discountAmount = effectiveDiscountPercent > 0
      ? parseFloat((eligibleSubtotal * effectiveDiscountPercent / 100).toFixed(2))
      : 0;
    const afterDiscountTotal = parseFloat((subtotalBruto - discountAmount).toFixed(2));
    // Lista de precios: positivo = descuento, negativo = recargo
    const priceListAdjustmentAmount = effectivePriceListPercent !== 0
      ? parseFloat((afterDiscountTotal * effectivePriceListPercent / 100).toFixed(2))
      : 0;
    const afterPriceListTotal = parseFloat((afterDiscountTotal - priceListAdjustmentAmount).toFixed(2));

    // Ajuste por método de pago (nuevo modelo: recargo | descuento | ninguno)
    const adjustmentType = pmConfig?.adjustmentType ?? 'none';
    const adjustmentPercent = pmConfig?.adjustmentPercent ?? 0;
    let paymentAdjustmentAmount = 0;
    if (adjustmentType === 'recargo' && adjustmentPercent > 0) {
      paymentAdjustmentAmount = parseFloat((afterPriceListTotal * adjustmentPercent / 100).toFixed(2));
    } else if (adjustmentType === 'descuento' && adjustmentPercent > 0) {
      paymentAdjustmentAmount = -parseFloat((afterPriceListTotal * adjustmentPercent / 100).toFixed(2));
    }

    const totalFinal = parseFloat((afterPriceListTotal + paymentAdjustmentAmount).toFixed(2));
    // discount_total SIEMPRE derivado de la identidad contable.
    const discountTotal = parseFloat((subtotalBruto - totalFinal).toFixed(2));
    const finalTax = parseFloat((totalFinal - totalFinal / (1 + ivaRate)).toFixed(2));

    const dateToday = new Date();

    // Bug 7 fix: compute the NEXT sequence number but don't commit it yet —
    // the increment and localStorage write happen just before the success return.
    const nextSeq = usr.invoiceSeqRef.current + 1;
    const sequenceStr = String(nextSeq).padStart(7, '0');
    const invoiceNumber = `FC-A-001-${sequenceStr}`;

    const seller = sellerId ? usr.users.find(u => u.id === sellerId) : null;
    const operatorName = seller ? seller.name : usr.activeUser.name;
    const operatorRole = seller ? seller.role : usr.activeUser.role;

    const newSaleInstance: Sale = {
      id: `sale_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      invoiceNumber,
      date: dateToday.toISOString(),
      items: saleLineItems,
      // Source of truth contable — los 3 campos canónicos
      subtotal_bruto: subtotalBruto,
      discount_total: discountTotal,
      total_final: totalFinal,
      total: totalFinal,
      tax: finalTax,
      idempotencyKey: finalIdempotencyKey,
      paymentMethod,
      paymentStatus: 'completed',
      operatorRole,
      operatorName,
      customerName: customName || 'Consumidor Final',
      customerDoc: customDoc,
      customerId: customerId || undefined,
      discountPercent: effectiveDiscountPercent > 0 ? effectiveDiscountPercent : undefined,
      discountAmount: discountAmount > 0 ? discountAmount : undefined,
      paymentAdjustmentType: adjustmentType !== 'none' && adjustmentPercent > 0 ? adjustmentType : undefined,
      paymentAdjustmentPercent: adjustmentType !== 'none' && adjustmentPercent > 0 ? adjustmentPercent : undefined,
      paymentAdjustmentAmount: paymentAdjustmentAmount !== 0 ? paymentAdjustmentAmount : undefined,
    };

    bch.setBatches(prevBatches => {
      const updatedBatches = [...prevBatches];
      for (const item of cartItems) {
        let qtyToDeduct = item.quantity;
        const eligible = updatedBatches.filter(b => b.productId === item.productId && b.status === 'active' && b.stock > 0).sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
        for (const targetBatch of eligible) {
          if (qtyToDeduct <= 0) break;
          const idx = updatedBatches.findIndex(b => b.id === targetBatch.id);
          if (idx === -1) continue;
          const b = updatedBatches[idx];
          const deduct = Math.min(b.stock, qtyToDeduct);
          qtyToDeduct -= deduct;
          const nextStock = b.stock - deduct;
          updatedBatches[idx] = { ...b, stock: nextStock, status: nextStock === 0 ? ('sold_out' as const) : b.status };
        }
      }
      return updatedBatches;
    });

    // Bug 6 fix: use functional updaters so concurrent calls each see the latest
    // committed state, not a stale snapshot.
    // Fix 1: Math.max(0, ...) guarantees stock never goes negative, even when two
    // concurrent reads arrived with the same pre-decrement snapshot.
    inv.setProducts(prev => {
      const updated = [...prev];
      for (const item of cartItems) {
        const idx = updated.findIndex(p => p.id === item.productId);
        if (idx === -1) continue;
        updated[idx] = { ...updated[idx], stock: Math.max(0, (updated[idx].stock ?? 0) - item.quantity) };
      }
      return updated;
    });

    inv.setIngredients(prev => {
      const updated = [...prev];
      for (const item of cartItems) {
        const product = snapshotProducts.find(p => p.id === item.productId);
        if (!product) continue;
        for (const recipeIng of product.ingredients) {
          const ingIdx = updated.findIndex(i => i.id === recipeIng.ingredientId);
          if (ingIdx === -1) continue;
          updated[ingIdx] = {
            ...updated[ingIdx],
            stock: updated[ingIdx].stock - recipeIng.quantity * item.quantity,
          };
        }
      }
      return updated;
    });

    sal.setSales(prev => [newSaleInstance, ...prev]);

    notif.addSystemNotification('💸 Nueva Venta Registrada', `Factura ${invoiceNumber} generada con éxito por ${formatCurrency(newSaleInstance.total)}`, 'success');
    addAutoNote(`💸 Venta ${invoiceNumber}`, `Total: ${formatCurrency(newSaleInstance.total)}\nItems: ${saleLineItems.length}\nPago: ${paymentMethod}`, 'ventas', 'low');

    // ── SYNC UNIFICADO ──────────────────────────────────────────────────────
    // Un solo path al backend con los 3 campos canónicos + idempotency_key.
    // Si falla (red caída, backend rechaza), encolamos en Dexie para reintento
    // y avisamos al cajero sin bloquear.
    syncSaleToD1(newSaleInstance).catch(async (err: unknown) => {
      if (import.meta.env.DEV) console.warn('[D1 sync] sale failed:', err instanceof Error ? err.message : err);
      // Marcamos la venta como no sincronizada para reflejarlo en UI/historial.
      sal.setSales(prev => prev.map(s => s.id === newSaleInstance.id ? { ...s, syncFailed: true } : s));
      // Fix 3: si syncEnqueueSale también falla (IDB lleno/corrupto), la venta
      // no puede quedar silenciosamente perdida. Mostramos una notificación
      // diferente que advierte al cajero que DEBE contactar soporte.
      let enqueued = false;
      try {
        await syncEnqueueSale(buildSalePayload(newSaleInstance, ivaRate) as unknown as Record<string, unknown>);
        enqueued = true;
      } catch { /* indexeddb lleno o no disponible */ }
      if (enqueued) {
        notif.addSystemNotification(
          '⚠️ Venta no sincronizada',
          'Esta venta no pudo sincronizarse con el servidor. Se reintentará automáticamente.',
          'warning',
        );
      } else {
        notif.addSystemNotification(
          '🚨 VENTA NO GUARDADA EN SERVIDOR',
          `La venta ${invoiceNumber} quedó solo en este dispositivo y NO pudo encolarse para reintento. Anotá el número de factura y contactá soporte.`,
          'error',
        );
      }
    });

    // Stock warnings (no bloqueantes) — la venta procede igual
    stockWarnings.forEach(warning => {
      notif.addSystemNotification('⚠️ Stock advertido', warning, 'warning');
    });

    // Low-stock alerts were computed from the snapshot before functional setters ran —
    // safe to process here since they're derived from the same cart items.
    lowStockAlerts.forEach(alertMessage => {
      notif.addSystemNotification('⚠️ Alerta de Inventario', alertMessage, 'warning');
      addAutoNote('⚠️ Stock bajo', alertMessage, 'inventario', 'high');
    });

    // Bug 7 fix: commit invoice sequence only after all side-effects succeed
    usr.invoiceSeqRef.current = nextSeq;
    try { localStorage.setItem('pan_erp_invoice_seq', String(nextSeq)); } catch { /* storage full */ }

    return { success: true, invoice: newSaleInstance };

    } finally {
      // Fix 2: always release the lock — even if an unexpected error is thrown
      // mid-function. Without finally, a thrown exception would leave the POS
      // permanently locked until the next page reload.
      isProcessingSaleRef.current = false;
    }
  };

  const addBatch = (newBatch: Omit<ProductBatch, 'id' | 'status'>) => {
    const generatedId = `batch_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    const batchInstance: ProductBatch = { ...newBatch, id: generatedId, status: 'active' };
    bch.setBatches(prev => [...prev, batchInstance]);
    inv.setProducts(prev => prev.map(p => (p.id === newBatch.productId ? { ...p, stock: p.stock + newBatch.quantity } : p)));
    const product = inv.products.find(p => p.id === newBatch.productId);
    const prodName = product?.name || 'Producto';
    notif.addSystemNotification('📦 Nuevo Lote Registrado', `Se registró el lote ${newBatch.batchNumber} de "${prodName}" con ${newBatch.quantity} unidades.`, 'success');

    // Sync to D1 — fire-and-forget. Si la red falla el POS no debe romperse.
    syncBatchToD1({
      product_id: batchInstance.productId,
      branch_id: getSettings().business.branchId,
      batch_number: batchInstance.batchNumber,
      entry_date: batchInstance.elaborationDate ?? new Date().toISOString().slice(0, 10),
      expiry_date: batchInstance.expiryDate,
      cost_per_unit: product?.cost ?? 0,
      initial_quantity: batchInstance.quantity,
    }).catch(() => {});
  };

  const approveWithdrawalRequest = (requestId: string, adminMemo: string) => {
    const target = bch.withdrawalRequests.find(r => r.id === requestId);
    if (!target || target.status !== 'pending') return;

    const req = { ...target, status: 'approved' as const, adminMemo };

    const updatedRequests = bch.withdrawalRequests.map(r => (r.id === requestId ? req : r));

    const updatedBatches = bch.batches.map(b => {
      if (b.id !== req.batchId) return b;
      const nextStock = Math.max(0, b.stock - req.quantity);
      return { ...b, stock: nextStock, status: nextStock === 0 ? ('withdrawn' as const) : b.status };
    });

    const updatedProducts = inv.products.map(p =>
      p.id === req.productId ? { ...p, stock: Math.max(0, p.stock - req.quantity) } : p
    );

    bch.setWithdrawalRequests(updatedRequests);
    bch.setBatches(updatedBatches);
    inv.setProducts(updatedProducts);

    // sync product stock update and batch withdrawal to D1
    // FIX A2: 'withdrawal' no está en la whitelist del backend — una baja de
    // lote es desperdicio/merma → 'waste_out'. La cantidad debe ser positiva:
    // el backend calcula el signo a partir del sufijo _in/_out.
    syncStockMovementToD1({
      product_id: req.productId,
      branch_id: getSettings().business.branchId,
      movement_type: 'waste_out',
      quantity: req.quantity,
      reason: `Baja aprobada: ${req.reason}`,
    }).catch(() => {});

    notif.addSystemNotification('✅ Solicitud de Baja Aprobada', `Se aprobó retirar del local ${req.quantity} u. de "${req.productName}". Detalle: ${adminMemo}`, 'success');
  };

  const approveSupplyRequest = (requestId: string, adminMemo: string) => {
    const req = sup.supplyRequests.find(r => r.id === requestId);
    if (!req || req.status !== 'pending') return;
    const approved = { ...req, status: 'approved' as const, adminMemo };
    sup.setSupplyRequests(prev => prev.map(r => (r.id === requestId ? approved : r)));
    updateSupplyRequestStatusInD1(requestId, 'approved', adminMemo).catch((err: unknown) => {
      if (import.meta.env.DEV) console.warn('[D1 sync] supply approve failed:', err instanceof Error ? err.message : err);
    });
    if (approved.type === 'ingredient') {
      inv.setIngredients(prev => prev.map(ing => (ing.id === approved.itemId ? { ...ing, stock: ing.stock + approved.quantity } : ing)));
    } else {
      inv.setProducts(prev => prev.map(p => (p.id === approved.itemId ? { ...p, stock: p.stock + approved.quantity } : p)));
      const freshElab = new Date();
      bch.setBatches(prev => [{
        id: `batch_supply_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`,
        productId: approved.itemId,
        batchNumber: `L-${approved.itemName.slice(0, 3).toUpperCase()}-R-${Date.now().toString(36).slice(-3).toUpperCase()}`,
        quantity: approved.quantity, stock: approved.quantity,
        elaborationDate: freshElab.toISOString().split('T')[0],
        expiryDate: new Date(freshElab.getTime() + 3 * 86400000).toISOString().split('T')[0],
        status: 'active' as const, withdrawalMode: 'manual' as const,
      }, ...prev]);

      // sync the new batch to D1 as a stock movement (inbound)
      // FIX A2: backend whitelist no acepta 'purchase' — usar 'purchase_in'.
      // Whitelist real (workers/api/src/routes/inventory.ts):
      //   purchase_in | production_in | transfer_in | adjustment_in | return_in |
      //   sale_out | transfer_out | waste_out | adjustment_out | production_out
      syncStockMovementToD1({
        product_id: req.itemId,
        branch_id: getSettings().business.branchId,
        movement_type: 'purchase_in',
        quantity: req.quantity,
        reason: `Pedido aprobado: ${req.reason}`,
      }).catch(() => {});
    }
    notif.addSystemNotification('✅ Abastecimiento Aprobado', `Se autorizó reposición de ${approved.quantity} ${approved.unit} para "${approved.itemName}". Detalle admin: ${adminMemo}`, 'success');
  };

  const resetAllData = () => {
    // Fix 4: instead of a hard-coded list (which inevitably goes stale as new
    // keys are added), sweep everything with a pan_erp_* or erp_* prefix.
    // pan_erp_settings and pan_erp_widgets_* are intentionally preserved so the
    // user doesn't lose their layout/config after a data reset (mirrors the
    // DangerZoneSettings wipeLocalStorage logic).
    const PRESERVED_PREFIXES = ['pan_erp_settings', 'pan_erp_widgets_'];
    const isPreserved = (k: string) => PRESERVED_PREFIXES.some(p => k.startsWith(p));
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('pan_erp_') || k.startsWith('erp_')) && !isPreserved(k)) {
        toRemove.push(k);
      }
    }
    toRemove.forEach(k => localStorage.removeItem(k));
    inv.setIngredients(INITIAL_INGREDIENTS); inv.setProducts(INITIAL_PRODUCTS); inv.setGateways(PAYMENT_GATEWAYS);
    sal.setSales(INITIAL_SALES); exp.setExpenses(INITIAL_EXPENSES); usr.setUsers(USERS);
    usr.setActiveTab('dashboard'); usr.invoiceSeqRef.current = 0;
    bch.setBatches([]); bch.setWithdrawalRequests([]);
    cash.setCurrentCashSession(null); cash.setCashSessionsHistory([]);
    cust.setCustomers([]);
    sup.setSupplyRequests([
      { id: 'sup_req_1', type: 'ingredient', itemId: 'ing_harina', itemName: 'Harina de Trigo 0000', quantity: 50, unit: 'kg', reason: 'Reposición urgente para elaboración de pan del fin de semana.', requestedBy: 'Laura (Panadero)', status: 'pending', date: new Date(Date.now() - 5400000).toISOString() },
      { id: 'sup_req_2', type: 'product', itemId: 'prod_pan_flauta', itemName: 'Pan Flauta (Baguette)', quantity: 40, unit: 'unidades', reason: 'Lote fresco caliente listo para transferir a mostrador.', requestedBy: 'Laura (Panadero)', status: 'pending', date: new Date(Date.now() - 1800000).toISOString() },
    ]);
    // NOTE: notifications reset via clearNotifications + replay since the hook owns state
    notif.clearNotifications();
    INITIAL_NOTIFICATIONS.forEach(n => notif.addSystemNotification(n.title, n.message, n.type));
    notif.addSystemNotification('⚙️ Sistema Reiniciado', 'La base de datos original ha sido restablecida en tiempo real.', 'success');
  };

  const requestBatchWithdrawal = (batchId: string, quantity: number, reason: string) => {
    bch.requestBatchWithdrawal(batchId, quantity, reason, usr.activeUser.name, usr.activeUser.role);
  };

  // MOD-2: memoise the context value so every render of AppProvider doesn't
  // produce a fresh object reference and force every consumer to re-render.
  // The dependency array tracks all primitive/state values that actually go
  // into `value`; the method references coming from hooks are stable enough
  // for practical purposes (they're recreated only when their owning hooks
  // re-render, which is already in this dep array via the underlying state).
  const value: AppContextType = useMemo(() => ({
    ingredients: inv.ingredients, products: inv.products, sales: sal.sales, expenses: exp.expenses,
    users: usr.users, notifications: notif.notifications, gateways: inv.gateways,
    activeUser: usr.activeUser, activeTab: usr.activeTab, batches: bch.batches,
    withdrawalRequests: bch.withdrawalRequests, supplyRequests: sup.supplyRequests,
    currentCashSession: cash.currentCashSession, cashSessionsHistory: cash.cashSessionsHistory,
    customers: cust.customers, setSales: sal.setSales,
    selectedSellerId: usr.selectedSellerId, setSelectedSellerId: usr.setSelectedSellerId,
    logout: usr.logout, setCustomers: cust.setCustomers,
    addCustomer: cust.addCustomer, updateCustomer: cust.updateCustomer,
    setActiveUserRole: usr.setActiveUserRole, setActiveTab: usr.setActiveTab,
    setBatches: bch.setBatches, addSale, addExpense: exp.addExpense,
    addIngredient: inv.addIngredient, updateIngredientStock: inv.updateIngredientStock,
    addProduct: inv.addProduct, updateProductStock: inv.updateProductStock,
    updateProductGroups: inv.updateProductGroups,
    toggleGateway: inv.toggleGateway, updateUserWidgets: usr.updateUserWidgets,
    addSystemNotification: notif.addSystemNotification,
    markNotificationAsRead: notif.markNotificationAsRead,
    clearNotifications: notif.clearNotifications, resetAllData,
    addBatch, requestBatchWithdrawal, approveWithdrawalRequest,
    rejectWithdrawalRequest: bch.rejectWithdrawalRequest,
    requestSupply: sup.requestSupply, approveSupplyRequest,
    rejectSupplyRequest: sup.rejectSupplyRequest,
    openCashSession: cash.openCashSession, closeCashSession: cash.closeCashSession,
    closeHistoricalSession: cash.closeHistoricalSession,
    loadMoreSessions: cash.loadMoreSessions, hasMoreSessions: cash.hasMoreSessions,
    syncStatus, retryError, retryAllNetwork,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hook return refs (addSale, addBatch, etc) are stable per-render of their owning hooks; tracking state slices is sufficient
  }), [
    inv.ingredients, inv.products, inv.gateways,
    sal.sales,
    exp.expenses,
    usr.users, usr.activeUser, usr.activeTab, usr.selectedSellerId,
    notif.notifications,
    bch.batches, bch.withdrawalRequests,
    sup.supplyRequests,
    cash.currentCashSession, cash.cashSessionsHistory, cash.hasMoreSessions,
    cust.customers,
    syncStatus, retryError, retryAllNetwork,
  ]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
