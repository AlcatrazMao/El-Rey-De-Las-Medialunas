import type { User as FirebaseUser } from 'firebase/auth';
import * as React from 'react';
import { createContext, useContext, useEffect } from 'react';

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
import { syncSaleToD1, updateSupplyRequestStatusInD1 } from './services/d1-sync';
import { formatCurrency } from './utils/format';
import type {
  Ingredient, Product, Sale, Expense, User, PushNotification, PaymentGateway,
  UserRole, ProductBatch, BatchWithdrawalRequest, SupplyRequest, CashSession, Customer,
} from './types';

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
  addSale: (items: { productId: string; quantity: number }[], paymentMethod: Sale['paymentMethod'], customDoc?: string, customName?: string, customerId?: string, sellerId?: string, simulateFail?: boolean) => { success: boolean; invoice?: Sale; error?: string };
  addExpense: (expense: Omit<Expense, 'id' | 'date'>) => void;
  addIngredient: (ingredient: Omit<Ingredient, 'id'>) => void;
  updateIngredientStock: (id: string, newStock: number) => void;
  addProduct: (product: Omit<Product, 'id' | 'code'>) => void;
  updateProductStock: (id: string, newStock: number) => void;
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
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
};

export const AppProvider: React.FC<{ children: React.ReactNode; firebaseUser: FirebaseUser; firestoreRole?: string | null; serverPanels?: string[] | null }> = ({ children, firebaseUser, firestoreRole, serverPanels }) => {
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

  const addSale = (cartItems: { productId: string; quantity: number }[], paymentMethod: Sale['paymentMethod'], customDoc?: string, customName?: string, customerId?: string, sellerId?: string, simulateFail: boolean = false) => {
    if (cartItems.length === 0) return { success: false, error: 'La venta está vacía.' };

    // Bug 8 fix: capture settings once — avoids repeated getSettings() calls throughout the function
    const settings = getSettings();
    const ivaRate = settings.fiscal.ivaRate;

    if (paymentMethod === 'tarjeta' || paymentMethod === 'mercado_pago' || paymentMethod === 'paypal') {
      const gMap: Record<Sale['paymentMethod'], string> = { tarjeta: 'gate_stripe', mercado_pago: 'gate_mp', paypal: 'gate_paypal', efectivo: '' };
      const gate = inv.gateways.find(g => g.id === gMap[paymentMethod]);
      if (gate && gate.status === 'inactive') {
        const errMsg = `La pasarela de pago para ${gate.name} está inactiva. Habilítala desde Configuración.`;
        notif.addSystemNotification('❌ Error de Pago', errMsg, 'error');
        return { success: false, error: errMsg };
      }
    }

    // Snapshot for validation and line-item building; actual state updates use functional setters below.
    const snapshotProducts = [...inv.products];
    const snapshotIngredients = [...inv.ingredients];
    const saleLineItems: Sale['items'] = [];
    const lowStockAlerts: string[] = [];

    if (simulateFail) {
      const totalFail = cartItems.reduce((acc, c) => acc + ((inv.products.find(p => p.id === c.productId)?.price || 0) * c.quantity), 0);
      const failNow = Date.now();
      const failedSalePayload: Sale = {
        id: `sale_fail_${failNow}`,
        invoiceNumber: `FC-X-${failNow.toString().slice(-4)}-${failNow.toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        date: new Date().toISOString(),
        items: cartItems.map(cart => {
          const prod = inv.products.find(p => p.id === cart.productId);
          return { productId: cart.productId, name: prod?.name || 'Producto Desconocido', quantity: cart.quantity, price: prod?.price || 0, subtotal: (prod?.price || 0) * cart.quantity };
        }),
        total: totalFail,
        tax: parseFloat((totalFail - totalFail / (1 + ivaRate)).toFixed(2)),
        paymentMethod, paymentStatus: 'failed',
        operatorRole: usr.activeUser.role, operatorName: usr.activeUser.name,
        customerName: customName || 'Cliente de Caja', customerDoc: customDoc,
      };
      sal.setSales(prev => [failedSalePayload, ...prev]);
      notif.addSystemNotification('❌ Transacción Fallida', `Pago con ${paymentMethod.replace('_', ' ').toUpperCase()} rechazado por el banco. Importe: ${formatCurrency(failedSalePayload.total)}`, 'error');
      return { success: false, invoice: failedSalePayload, error: 'Transacción denegada por la pasarela de pagos.' };
    }

    // Validation pass — uses snapshot (early-exit, no state mutation yet)
    for (const item of cartItems) {
      const product = snapshotProducts.find(p => p.id === item.productId);
      if (!product) return { success: false, error: `El producto ${item.productId} no existe.` };
      if (product.stock < item.quantity) return { success: false, error: `Stock insuficiente para ${product.name}. Disponible: ${product.stock}, Solicitado: ${item.quantity}` };
      for (const recipeIng of product.ingredients) {
        const ing = snapshotIngredients.find(i => i.id === recipeIng.ingredientId);
        if (!ing) continue;
        const needed = recipeIng.quantity * item.quantity;
        if (ing.stock < needed) return { success: false, error: `Materia prima insuficiente para producir ${product.name}. Falta ${ing.name} (Necesitado: ${needed.toFixed(2)}${ing.unit}, Disponible: ${ing.stock.toFixed(2)}${ing.unit})` };
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
      saleLineItems.push({ productId: product.id, name: product.name, quantity: item.quantity, price: product.price, subtotal: product.price * item.quantity, cost: product.cost });
    }

    const subtotalTotal = saleLineItems.reduce((acc, curr) => acc + curr.subtotal, 0);
    const calculatedTax = parseFloat((subtotalTotal - subtotalTotal / (1 + ivaRate)).toFixed(2));

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
      id: `sale_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, invoiceNumber, date: dateToday.toISOString(),
      items: saleLineItems, total: parseFloat(subtotalTotal.toFixed(2)), tax: calculatedTax,
      paymentMethod, paymentStatus: 'completed', operatorRole, operatorName,
      customerName: customName || 'Consumidor Final', customerDoc: customDoc,
      customerId: customerId || undefined,
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

    // Bug 6 fix: use functional updaters so concurrent calls (e.g. double-click)
    // each see the latest committed state, not a stale snapshot.
    inv.setProducts(prev => {
      const updated = [...prev];
      for (const item of cartItems) {
        const idx = updated.findIndex(p => p.id === item.productId);
        if (idx === -1) continue;
        updated[idx] = { ...updated[idx], stock: updated[idx].stock - item.quantity };
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

    syncEnqueueSale({
      id: newSaleInstance.id,
      items: newSaleInstance.items.map(i => ({
        product_id: i.productId,
        quantity: i.quantity,
        unit_price: i.price,
        tax_rate: ivaRate * 100,
        tax_amount: (i.subtotal - i.subtotal / (1 + ivaRate)),
      })),
      payments: [{ payment_method: paymentMethod === 'efectivo' ? 'cash' : paymentMethod, amount: newSaleInstance.total }],
      subtotal: parseFloat((newSaleInstance.total / (1 + ivaRate)).toFixed(2)),
      tax_total: newSaleInstance.tax,
      total: newSaleInstance.total,
      customer_id: newSaleInstance.customerId ?? null,
      notes: null,
      client_timestamp: newSaleInstance.date,
    }).catch(() => {});

    if (paymentMethod === 'efectivo' && cash.currentCashSession) {
      cash.setCurrentCashSession(prev => {
        if (!prev) return null;
        return { ...prev, expectedAmount: parseFloat((prev.expectedAmount + newSaleInstance.total).toFixed(2)) };
      });
    }

    notif.addSystemNotification('💸 Nueva Venta Registrada', `Factura ${invoiceNumber} generada con éxito por ${formatCurrency(newSaleInstance.total)}`, 'success');
    addAutoNote(`💸 Venta ${invoiceNumber}`, `Total: ${formatCurrency(newSaleInstance.total)}\nItems: ${saleLineItems.length}\nPago: ${paymentMethod}`, 'ventas', 'low');

    syncSaleToD1(newSaleInstance).catch((err: unknown) => {
      if (import.meta.env.DEV) console.warn('[D1 sync] sale failed:', err instanceof Error ? err.message : err);
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
  };

  const addBatch = (newBatch: Omit<ProductBatch, 'id' | 'status'>) => {
    const generatedId = `batch_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    const batchInstance: ProductBatch = { ...newBatch, id: generatedId, status: 'active' };
    bch.setBatches(prev => [...prev, batchInstance]);
    inv.setProducts(prev => prev.map(p => (p.id === newBatch.productId ? { ...p, stock: p.stock + newBatch.quantity } : p)));
    const prodName = inv.products.find(p => p.id === newBatch.productId)?.name || 'Producto';
    notif.addSystemNotification('📦 Nuevo Lote Registrado', `Se registró el lote ${newBatch.batchNumber} de "${prodName}" con ${newBatch.quantity} unidades.`, 'success');
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
    }
    notif.addSystemNotification('✅ Abastecimiento Aprobado', `Se autorizó reposición de ${approved.quantity} ${approved.unit} para "${approved.itemName}". Detalle admin: ${adminMemo}`, 'success');
  };

  const resetAllData = () => {
    ['pan_erp_ingredients', 'pan_erp_products', 'pan_erp_sales', 'pan_erp_expenses', 'pan_erp_users', 'pan_erp_notifications', 'pan_erp_gateways', 'pan_erp_active_user_id', 'pan_erp_batches', 'pan_erp_withdrawal_requests', 'pan_erp_supply_requests', 'pan_erp_current_cash_session', 'pan_erp_cash_sessions_history', 'pan_erp_invoice_seq'].forEach(k => localStorage.removeItem(k));
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

  const value: AppContextType = {
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
    toggleGateway: inv.toggleGateway, updateUserWidgets: usr.updateUserWidgets,
    addSystemNotification: notif.addSystemNotification,
    markNotificationAsRead: notif.markNotificationAsRead,
    clearNotifications: notif.clearNotifications, resetAllData,
    addBatch, requestBatchWithdrawal, approveWithdrawalRequest,
    rejectWithdrawalRequest: bch.rejectWithdrawalRequest,
    requestSupply: sup.requestSupply, approveSupplyRequest,
    rejectSupplyRequest: sup.rejectSupplyRequest,
    openCashSession: cash.openCashSession, closeCashSession: cash.closeCashSession,
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
