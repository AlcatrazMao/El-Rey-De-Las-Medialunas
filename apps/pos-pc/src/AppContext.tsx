import type { User as FirebaseUser } from 'firebase/auth';
import { signOut } from 'firebase/auth';
import * as React from 'react'
import { createContext, useContext, useState, useEffect, useRef } from 'react';

import { auth } from './config/firebase';
import { addAutoNote } from './hooks/useStickyNotes';
import {
  INITIAL_INGREDIENTS,
  INITIAL_PRODUCTS,
  INITIAL_SALES,
  INITIAL_EXPENSES,
  USERS,
  INITIAL_NOTIFICATIONS,
  PAYMENT_GATEWAYS
} from './initialData';
import { syncSaleToD1, syncCustomerToD1, syncCashSessionToD1, syncCashSessionCloseToD1, fetchCustomersFromD1, syncExpenseToD1, syncSupplyRequestToD1, updateSupplyRequestStatusInD1 } from './services/d1-sync';
import type { Ingredient, Product, Sale, Expense, User, PushNotification, PaymentGateway, UserRole, ProductBatch, BatchWithdrawalRequest, SupplyRequest, CashSession, Customer } from './types';

interface AppContextType {
  ingredients: Ingredient[];
  products: Product[];
  sales: Sale[];
  expenses: Expense[];
  users: User[];
  notifications: PushNotification[];
  gateways: PaymentGateway[];
  activeUser: User;
  activeTab: string;
  batches: ProductBatch[];
  withdrawalRequests: BatchWithdrawalRequest[];
  supplyRequests: SupplyRequest[];
  currentCashSession: CashSession | null;
  cashSessionsHistory: CashSession[];
  customers: Customer[];
  setSales: React.Dispatch<React.SetStateAction<Sale[]>>;
  selectedSellerId: string;
  setSelectedSellerId: (id: string) => void;
  logout: () => void;
  setCustomers: React.Dispatch<React.SetStateAction<Customer[]>>;
  addCustomer: (c: Omit<Customer, 'id' | 'created_at' | 'updated_at' | 'timeline' | 'total_purchases' | 'last_purchase_date' | 'current_debt'>) => void;
  updateCustomer: (id: string, data: Partial<Customer>) => void;
  
  setActiveUserRole: (role: UserRole) => void;
  setActiveTab: (tab: string) => void;
  setBatches: React.Dispatch<React.SetStateAction<ProductBatch[]>>;
  
  // Actions
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
  
  // Batch Actions
  addBatch: (batch: Omit<ProductBatch, 'id' | 'status'>) => void;
  requestBatchWithdrawal: (batchId: string, quantity: number, reason: string) => void;
  approveWithdrawalRequest: (requestId: string, adminMemo: string) => void;
  rejectWithdrawalRequest: (requestId: string, adminMemo: string) => void;

  // Supply Actions
  requestSupply: (type: 'ingredient' | 'product', itemId: string, quantity: number, reason: string) => void;
  approveSupplyRequest: (requestId: string, adminMemo: string) => void;
  rejectSupplyRequest: (requestId: string, adminMemo: string) => void;

  // Cash Session Actions
  openCashSession: (initialAmount: number, note?: string) => void;
  closeCashSession: (realAmount: number, note?: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};

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

export const AppProvider: React.FC<{ children: React.ReactNode; firebaseUser: FirebaseUser; firestoreRole?: string | null }> = ({ children, firebaseUser, firestoreRole }) => {
  // Initialize state from local storage or defaults
  const [ingredients, setIngredients] = useState<Ingredient[]>(() => 
    safeParse('pan_erp_ingredients', INITIAL_INGREDIENTS)
  );

  const [products, setProducts] = useState<Product[]>(() => 
    safeParse('pan_erp_products', INITIAL_PRODUCTS)
  );

  const [sales, setSales] = useState<Sale[]>(() => 
    safeParse('pan_erp_sales', INITIAL_SALES)
  );

  const [expenses, setExpenses] = useState<Expense[]>(() => 
    safeParse('pan_erp_expenses', INITIAL_EXPENSES)
  );

  const [notifications, setNotifications] = useState<PushNotification[]>(() => 
    safeParse('pan_erp_notifications', INITIAL_NOTIFICATIONS)
  );

  const [gateways, setGateways] = useState<PaymentGateway[]>(() => 
    safeParse('pan_erp_gateways', PAYMENT_GATEWAYS)
  );

  const [batches, setBatches] = useState<ProductBatch[]>(() => {
    try {
      const saved = localStorage.getItem('pan_erp_batches');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error('Error parsing batches from localStorage:', e);
      localStorage.removeItem('pan_erp_batches');
    }
    
    const initialBatches: ProductBatch[] = [];
    
    INITIAL_PRODUCTS.forEach((prod, index) => {
      const durability = prod.durabilityDays || 3;
      const totalStock = prod.stock || 50;
      
      const freshQty = Math.floor(totalStock * 0.6);
      const nearQty = Math.floor(totalStock * 0.3);
      const expiredQty = totalStock - freshQty - nearQty;
      
      if (freshQty > 0) {
        const freshElab = new Date();
        const elabString = freshElab.toISOString().split('T')[0];
        const expString = new Date(freshElab.getTime() + durability * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        
        initialBatches.push({
          id: `batch_${prod.id}_fresh_${index}`,
          productId: prod.id,
          batchNumber: `L-${prod.name.slice(0, 3).toUpperCase()}-F-${String(index + 10).padStart(2, '0')}`,
          quantity: freshQty,
          stock: freshQty,
          elaborationDate: elabString,
          expiryDate: expString,
          status: 'active',
          withdrawalMode: 'manual'
        });
      }
      
      if (nearQty > 0) {
        const nearElab = new Date();
        nearElab.setDate(nearElab.getDate() - (durability - 1));
        const elabString = nearElab.toISOString().split('T')[0];
        const expString = new Date(nearElab.getTime() + durability * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        
        initialBatches.push({
          id: `batch_${prod.id}_near_${index}`,
          productId: prod.id,
          batchNumber: `L-${prod.name.slice(0, 3).toUpperCase()}-N-${String(index + 20).padStart(2, '0')}`,
          quantity: nearQty,
          stock: nearQty,
          elaborationDate: elabString,
          expiryDate: expString,
          status: 'active',
          withdrawalMode: 'manual'
        });
      }
      
      if (expiredQty > 0) {
        const expElab = new Date();
        expElab.setDate(expElab.getDate() - (durability + 1));
        const elabString = expElab.toISOString().split('T')[0];
        const expString = new Date(expElab.getTime() + durability * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        
        initialBatches.push({
          id: `batch_${prod.id}_expired_${index}`,
          productId: prod.id,
          batchNumber: `L-${prod.name.slice(0, 3).toUpperCase()}-E-${String(index + 30).padStart(2, '0')}`,
          quantity: expiredQty,
          stock: expiredQty,
          elaborationDate: elabString,
          expiryDate: expString,
          status: 'active',
          withdrawalMode: 'manual'
        });
      }
    });
    
    return initialBatches;
  });

  const [withdrawalRequests, setWithdrawalRequests] = useState<BatchWithdrawalRequest[]>(() => {
    try {
      const saved = localStorage.getItem('pan_erp_withdrawal_requests');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error('Error parsing withdrawal requests:', e);
      localStorage.removeItem('pan_erp_withdrawal_requests');
    }
    
    return [
      {
        id: 'req_1',
        batchId: 'batch_prod_pan_flauta_expired_0',
        productId: 'prod_pan_flauta',
        productName: 'Pan Flauta (Baguette)',
        batchNumber: 'L-PAN-E-10',
        quantity: 12,
        reason: 'Lote caducó hace 2 días, retirar rancio de góndola',
        requestedBy: 'Damián (Panadero)',
        status: 'pending',
        date: new Date(Date.now() - 3600000).toISOString()
      },
      {
        id: 'req_2',
        batchId: 'batch_prod_facturas_surtidas_expired_2',
        productId: 'prod_facturas_surtidas',
        productName: 'Facturas Surtidas',
        batchNumber: 'L-FAC-E-12',
        quantity: 5,
        reason: 'Medialunas secas no aptas para venta',
        requestedBy: 'Sofía (Cajero/a)',
        status: 'approved',
        date: new Date(Date.now() - 7200000 * 2).toISOString(),
        adminMemo: 'Confirmado retiro, de baja mermas.'
      }
    ];
  });

  const [supplyRequests, setSupplyRequests] = useState<SupplyRequest[]>(() => {
    try {
      const saved = localStorage.getItem('pan_erp_supply_requests');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error('Error parsing supply requests:', e);
      localStorage.removeItem('pan_erp_supply_requests');
    }
    
    return [
      {
        id: 'sup_req_1',
        type: 'ingredient',
        itemId: 'ing_harina',
        itemName: 'Harina de Trigo 0000',
        quantity: 50,
        unit: 'kg',
        reason: 'Reposición urgente para elaboración de pan del fin de semana.',
        requestedBy: 'Laura (Panadero)',
        status: 'pending',
        date: new Date(Date.now() - 5400000).toISOString()
      },
      {
        id: 'sup_req_2',
        type: 'product',
        itemId: 'prod_pan_flauta',
        itemName: 'Pan Flauta (Baguette)',
        quantity: 40,
        unit: 'unidades',
        reason: 'Lote fresco caliente listo para transferir a mostrador.',
        requestedBy: 'Laura (Panadero)',
        status: 'pending',
        date: new Date(Date.now() - 1800000).toISOString()
      }
    ];
  });

  const [activeUserId, setActiveUserId] = useState<string>(() => {
    return localStorage.getItem('pan_erp_active_user_id') || 'user_admin';
  });

  const [currentCashSession, setCurrentCashSession] = useState<CashSession | null>(() => {
    try {
      const saved = localStorage.getItem('pan_erp_current_cash_session');
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      console.error('Error parsing current cash session from localStorage:', e);
      localStorage.removeItem('pan_erp_current_cash_session');
      return null;
    }
  });

  const [cashSessionsHistory, setCashSessionsHistory] = useState<CashSession[]>(() => {
    try {
      const saved = localStorage.getItem('pan_erp_cash_sessions_history');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error('Error parsing cash sessions history from localStorage:', e);
      localStorage.removeItem('pan_erp_cash_sessions_history');
      return [];
    }
  });

  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [selectedSellerId, setSelectedSellerId] = useState<string>('');
  const invoiceSeqRef = useRef<number>(
    (() => { try { return parseInt(localStorage.getItem('pan_erp_invoice_seq') ?? '0', 10) || 0; } catch { return 0; } })()
  );
  const [customers, setCustomers] = useState<Customer[]>(() => {
    try { const saved = localStorage.getItem('pan_erp_customers'); return saved ? JSON.parse(saved) : []; }
    catch { return []; }
  });

  // User role from Firestore — NO email fallback
  const firebaseMappedUser: User = {
    id: firebaseUser.uid,
    name: firebaseUser.displayName || firebaseUser.email || 'Usuario',
    email: firebaseUser.email || '',
    role: (firestoreRole || 'panadero') as UserRole,
    avatar: firebaseUser.photoURL || '',
    customPanels: (firestoreRole === 'admin' || firestoreRole === 'owner')
      ? ['widget_facturacion', 'widget_inventario', 'widget_contabilidad', 'widget_alertas', 'widget_historico']
      : firestoreRole === 'cajero'
      ? ['widget_facturacion', 'widget_alertas']
      : ['widget_inventario', 'widget_alertas'],
  };

  const [users, setUsers] = useState<User[]>([firebaseMappedUser]);

  const logout = () => {
    signOut(auth);
  };

  const addCustomer = (data: Omit<Customer, 'id' | 'created_at' | 'updated_at' | 'timeline' | 'total_purchases' | 'last_purchase_date' | 'current_debt'>) => {
    const now = new Date().toISOString();
    const newCustomer: Customer = {
      ...data,
      id: `cust_${Date.now()}`,
      created_at: now, updated_at: now,
      timeline: [{ id: `tl_${Date.now()}`, date: now, type: 'status_change', description: 'Cliente creado', user: 'Sistema' }],
      total_purchases: 0, last_purchase_date: '', current_debt: 0
    };
    setCustomers(prev => [newCustomer, ...prev]);
    addSystemNotification('👤 Cliente Creado', `${newCustomer.name} fue registrado.`, 'success');
    syncCustomerToD1(newCustomer).catch((err: unknown) => {
      console.warn('[D1 sync] customer failed:', err instanceof Error ? err.message : err);
    });
  };

  const updateCustomer = (id: string, data: Partial<Customer>) => {
    setCustomers(prev => prev.map(c => c.id === id ? { ...c, ...data, updated_at: new Date().toISOString() } : c));
  };

  // Save changes to localStorage on any state update
  useEffect(() => {
    localStorage.setItem('pan_erp_ingredients', JSON.stringify(ingredients));
  }, [ingredients]);

  useEffect(() => {
    localStorage.setItem('pan_erp_products', JSON.stringify(products));
  }, [products]);

  useEffect(() => {
    localStorage.setItem('pan_erp_batches', JSON.stringify(batches));
  }, [batches]);

  useEffect(() => {
    localStorage.setItem('pan_erp_withdrawal_requests', JSON.stringify(withdrawalRequests));
  }, [withdrawalRequests]);

  useEffect(() => {
    localStorage.setItem('pan_erp_supply_requests', JSON.stringify(supplyRequests));
  }, [supplyRequests]);

  // Automatic verification of automatic-mode expired batches
  useEffect(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const todayTime = new Date(todayStr + 'T00:00:00').getTime();
    
    const expiredAutoBatches = batches.filter(b => 
      b.withdrawalMode === 'automatic' && 
      b.status === 'active' && 
      b.stock > 0 && 
      new Date(b.expiryDate + 'T00:00:00').getTime() < todayTime
    );
    
    if (expiredAutoBatches.length > 0) {
      let addedAny = false;
      
      setWithdrawalRequests(prev => {
        const updated = [...prev];
        expiredAutoBatches.forEach(b => {
          const exists = updated.some(r => r.batchId === b.id && r.status === 'pending');
          if (!exists) {
            const prodObj = products.find(p => p.id === b.productId);
            const reqId = `req_auto_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
            updated.unshift({
              id: reqId,
              batchId: b.id,
              productId: b.productId,
              productName: prodObj ? prodObj.name : 'Bakery Item',
              batchNumber: b.batchNumber,
              quantity: b.stock,
              reason: 'Baja automática generada por fecha límite de caducidad.',
              requestedBy: 'Chequeo Automatizado ERP',
              status: 'pending',
              date: new Date().toISOString()
            });
            addedAny = true;
            addSystemNotification(
              '⏳ Lote Expirado (Automático)',
              `El lote ${b.batchNumber} de "${prodObj?.name || 'Pan'}" ha expirado. Solicitud enviada a administración.`,
              'warning'
            );
          }
        });
        return addedAny ? updated : prev;
      });
    }
  }, [batches, products]);

  useEffect(() => {
    localStorage.setItem('pan_erp_sales', JSON.stringify(sales));
  }, [sales]);

  useEffect(() => {
    localStorage.setItem('pan_erp_expenses', JSON.stringify(expenses));
  }, [expenses]);

  useEffect(() => {
    localStorage.setItem('pan_erp_users', JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    localStorage.setItem('pan_erp_notifications', JSON.stringify(notifications));
  }, [notifications]);

  useEffect(() => {
    localStorage.setItem('pan_erp_gateways', JSON.stringify(gateways));
  }, [gateways]);

  useEffect(() => {
    if (currentCashSession) {
      localStorage.setItem('pan_erp_current_cash_session', JSON.stringify(currentCashSession));
    } else {
      localStorage.removeItem('pan_erp_current_cash_session');
    }
  }, [currentCashSession]);

  useEffect(() => {
    localStorage.setItem('pan_erp_cash_sessions_history', JSON.stringify(cashSessionsHistory));
  }, [cashSessionsHistory]);

  useEffect(() => {
    localStorage.setItem('pan_erp_active_user_id', activeUserId);
  }, [activeUserId]);

  useEffect(() => {
    localStorage.setItem('pan_erp_customers', JSON.stringify(customers));
  }, [customers]);

  // Load D1 data on startup (retry when token is ready)
  useEffect(() => {
    const loadFromD1 = () => {
      fetchCustomersFromD1().then(d1Customers => {
        if (d1Customers.length > 0) {
          setCustomers(prev => {
            const existing = new Set(prev.map(c => c.id));
            return [...prev, ...d1Customers.filter((c: { id: string }) => !existing.has(c.id))];
          });
        }
      }).catch(() => {});
    };
    // Try immediately (token might already be cached)
    loadFromD1();
    // Also listen for token-ready event (first login)
    window.addEventListener('firebase-token-ready', loadFromD1);
    return () => window.removeEventListener('firebase-token-ready', loadFromD1);
  }, []);

  // Use local user if selected via dropdown, otherwise Firebase-mapped user
  const activeUser = (users && users.length > 0 && activeUserId)
    ? (users.find(u => u.id === activeUserId) || firebaseMappedUser)
    : firebaseMappedUser;

  const setActiveUserRole = (role: UserRole) => {
    const found = users.find(u => u.role === role);
    if (found) {
      setActiveUserId(found.id);
      if (role === 'cajero') {
        setActiveTab('pos');
      } else if (role === 'panadero') {
        setActiveTab('inventory');
      } else {
        setActiveTab('dashboard');
      }
    }
  };

  // Trigger audio alert / browser notifications mock
  const playAlertSound = (type: PushNotification['type']) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- webkitAudioContext fallback for Safari
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      if (type === 'error') {
        // Red double beep
        osc.frequency.setValueAtTime(220, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.15);
        setTimeout(() => {
          const osc2 = audioCtx.createOscillator();
          const gain2 = audioCtx.createGain();
          osc2.connect(gain2);
          gain2.connect(audioCtx.destination);
          osc2.frequency.setValueAtTime(180, audioCtx.currentTime);
          gain2.gain.setValueAtTime(0.2, audioCtx.currentTime);
          osc2.start();
          osc2.stop(audioCtx.currentTime + 0.2);
        }, 200);
      } else if (type === 'warning') {
        // Flat warning beep
        osc.frequency.setValueAtTime(440, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.25);
      } else if (type === 'success') {
        // Upward pleasant notification chime
        osc.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        osc.stop(audioCtx.currentTime + 0.3);
        setTimeout(() => {
          const osc2 = audioCtx.createOscillator();
          const gain2 = audioCtx.createGain();
          osc2.connect(gain2);
          gain2.connect(audioCtx.destination);
          osc2.frequency.setValueAtTime(659.25, audioCtx.currentTime); // E5
          gain2.gain.setValueAtTime(0.1, audioCtx.currentTime);
          osc2.start();
          gain2.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
          osc2.stop(audioCtx.currentTime + 0.35);
        }, 120);
      } else {
        // Subtle informative click
        osc.frequency.setValueAtTime(600, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.05);
      }
      // Close AudioContext after sounds finish to prevent memory leak
      const maxDuration = type === 'error' ? 500 : type === 'success' ? 500 : 300;
      setTimeout(() => audioCtx.close(), maxDuration);
    } catch (e) {
      // Audio context issue (e.g. user hasn't interacted yet)
      // eslint-disable-next-line no-console -- expected when browser blocks audio
      console.log('Audio notification delayed due to browser interaction policies.');
    }
  };

  const addSystemNotification = (title: string, message: string, type: PushNotification['type']) => {
    const newNot: PushNotification = {
      id: `not_${Date.now()}`,
      title,
      message,
      type,
      timestamp: new Date().toISOString(),
      read: false
    };
    setNotifications(prev => [newNot, ...prev].slice(0, 50)); // cap at 50 logs
    playAlertSound(type);
  };

  // Actions
  const addSale = (
    cartItems: { productId: string; quantity: number }[],
    paymentMethod: Sale['paymentMethod'],
    customDoc?: string,
    customName?: string,
    customerId?: string,
    sellerId?: string,
    simulateFail: boolean = false
  ) => {
    if (cartItems.length === 0) {
      return { success: false, error: 'La venta está vacía.' };
    }

    // Check if the chosen payment gateway is active (if it is a gateway payment)
    if (paymentMethod === 'tarjeta' || paymentMethod === 'mercado_pago' || paymentMethod === 'paypal') {
      const gMap: Record<Sale['paymentMethod'], string> = {
        tarjeta: 'gate_stripe',
        mercado_pago: 'gate_mp',
        paypal: 'gate_paypal',
        efectivo: ''
      };
      const gateId = gMap[paymentMethod];
      const gate = gateways.find(g => g.id === gateId);
      if (gate && gate.status === 'inactive') {
        const errMsg = `La pasarela de pago para ${gate.name} está inactiva. Habilítala desde Configuración.`;
        addSystemNotification('❌ Error de Pago', errMsg, 'error');
        return { success: false, error: errMsg };
      }
    }

    // Check and deduct stock of final products and sub-ingredients
    const updatedProducts = [...products];
    const updatedIngredients = [...ingredients];
    const saleLineItems: Sale['items'] = [];
    const lowStockAlerts: string[] = [];

    if (simulateFail) {
      // Create a failed invoice record
      const invoiceNum = `FC-X-${Date.now().toString().slice(-4)}-${Math.floor(100000 + Math.random() * 900000)}`;
      const failedSalePayload: Sale = {
        id: `sale_fail_${Date.now()}`,
        invoiceNumber: invoiceNum,
        date: new Date().toISOString(),
        items: cartItems.map(cart => {
          const prod = products.find(p => p.id === cart.productId);
          return {
            productId: cart.productId,
            name: prod?.name || 'Producto Desconocido',
            quantity: cart.quantity,
            price: prod?.price || 0,
            subtotal: (prod?.price || 0) * cart.quantity
          };
        }),
        total: cartItems.reduce((acc, c) => acc + ((products.find(p => p.id === c.productId)?.price || 0) * c.quantity), 0),
        tax: cartItems.reduce((acc, c) => acc + ((products.find(p => p.id === c.productId)?.price || 0) * c.quantity), 0) * 0.21,
        paymentMethod,
        paymentStatus: 'failed',
        operatorRole: activeUser.role,
        operatorName: activeUser.name,
        customerName: customName || 'Cliente de Caja',
        customerDoc: customDoc
      };

      setSales(prev => [failedSalePayload, ...prev]);
      addSystemNotification('❌ Transacción Fallida', `Pago con ${paymentMethod.replace('_', ' ').toUpperCase()} rechazado por el banco. Importe: $${failedSalePayload.total.toFixed(2)}`, 'error');
      return { success: false, invoice: failedSalePayload, error: 'Transacción denegada por la pasarela de pagos.' };
    }

    // Evaluate stock pre-requisites
    for (const item of cartItems) {
      const prodIdx = updatedProducts.findIndex(p => p.id === item.productId);
      if (prodIdx === -1) return { success: false, error: `El producto ${item.productId} no existe.` };
      const product = updatedProducts[prodIdx];

      // Product stock check
      if (product.stock < item.quantity) {
        return { success: false, error: `Stock insuficiente para ${product.name}. Disponible: ${product.stock}, Solicitado: ${item.quantity}` };
      }

      // Ingredients check
      for (const recipeIng of product.ingredients) {
        const ingIdx = updatedIngredients.findIndex(i => i.id === recipeIng.ingredientId);
        if (ingIdx !== -1) {
          const ing = updatedIngredients[ingIdx];
          const totalIngNeeded = recipeIng.quantity * item.quantity;
          if (ing.stock < totalIngNeeded) {
            return {
              success: false,
              error: `Materia prima insuficiente para producir ${product.name}. Falta ${ing.name} (Necesitado: ${totalIngNeeded.toFixed(2)}${ing.unit}, Disponible: ${ing.stock.toFixed(2)}${ing.unit})`
            };
          }
        }
      }
    }

    // Process actual stock deductions
    for (const item of cartItems) {
      const prodIdx = updatedProducts.findIndex(p => p.id === item.productId);
      const product = updatedProducts[prodIdx];
      
      // Deduct product stock
      product.stock -= item.quantity;
      if (product.stock <= product.minStock) {
        lowStockAlerts.push(`Stock bajo de ${product.name}: quedan ${product.stock} unidades.`);
      }

      // Deduct recipe ingredients stock
      for (const recipeIng of product.ingredients) {
        const ingIdx = updatedIngredients.findIndex(i => i.id === recipeIng.ingredientId);
        if (ingIdx !== -1) {
          const ing = updatedIngredients[ingIdx];
          ing.stock -= recipeIng.quantity * item.quantity;
          if (ing.stock <= ing.minStock) {
            lowStockAlerts.push(`Peligro: Materia prima baja en "${ing.name}" (${ing.stock.toFixed(2)}${ing.unit} restante).`);
          }
        }
      }

      saleLineItems.push({
        productId: product.id,
        name: product.name,
        quantity: item.quantity,
        price: product.price,
        subtotal: product.price * item.quantity
      });
    }

    // Generate Invoice details
    const subtotalTotal = saleLineItems.reduce((acc, curr) => acc + curr.subtotal, 0);
    const calculatedTax = parseFloat((subtotalTotal * 0.21).toFixed(2)); // standard 21% IVA
    
    // Auto increment sequential invoice
    const dateToday = new Date();
    invoiceSeqRef.current = Math.max(invoiceSeqRef.current, sales.filter(s => s.paymentStatus === 'completed').length + 346) + 1;
    try { localStorage.setItem('pan_erp_invoice_seq', String(invoiceSeqRef.current)); } catch { /* storage full */ }
    const sequenceStr = String(invoiceSeqRef.current).padStart(7, '0');
    const invoiceNumber = `FC-A-001-${sequenceStr}`;

    // Determine operator: use selected seller, fallback to active user
    const seller = sellerId ? users.find(u => u.id === sellerId) : null;
    const operatorName = seller ? seller.name : activeUser.name;
    const operatorRole = seller ? seller.role : activeUser.role;

    const newSaleInstance: Sale = {
      id: `sale_${Date.now()}`,
      invoiceNumber,
      date: dateToday.toISOString(),
      items: saleLineItems,
      total: parseFloat(subtotalTotal.toFixed(2)),
      tax: calculatedTax,
      paymentMethod,
      paymentStatus: 'completed',
      operatorRole,
      operatorName,
      customerName: customName || 'Consumidor Final',
      customerDoc: customDoc,
      customerId: customerId || undefined
    };

    // Deduct available product batches using FIFO/FEFO
    setBatches(prevBatches => {
      const updatedBatches = [...prevBatches];
      for (const item of cartItems) {
        let qtyToDeduct = item.quantity;
        const eligible = updatedBatches
          .filter(b => b.productId === item.productId && b.status === 'active' && b.stock > 0)
          .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());

        for (const targetBatch of eligible) {
          if (qtyToDeduct <= 0) break;
          const batchIdx = updatedBatches.findIndex(b => b.id === targetBatch.id);
          if (batchIdx !== -1) {
            const b = updatedBatches[batchIdx];
            const deduct = Math.min(b.stock, qtyToDeduct);
            qtyToDeduct -= deduct;
            const nextStock = b.stock - deduct;
            updatedBatches[batchIdx] = {
              ...b,
              stock: nextStock,
              status: nextStock === 0 ? 'sold_out' as const : b.status
            };
          }
        }
      }
      return updatedBatches;
    });

    setProducts(updatedProducts);
    setIngredients(updatedIngredients);
    setSales(prev => [newSaleInstance, ...prev]);

    if (paymentMethod === 'efectivo' && currentCashSession) {
      setCurrentCashSession(prev => {
        if (!prev) return null;
        return {
          ...prev,
          expectedAmount: parseFloat((prev.expectedAmount + newSaleInstance.total).toFixed(2))
        };
      });
    }

    // Success notifications
    addSystemNotification(
      '💸 Nueva Venta Registrada',
      `Factura ${invoiceNumber} generada con éxito por $${newSaleInstance.total.toFixed(2)}`,
      'success'
    );
    
    // Auto-note for sales
    addAutoNote(`💸 Venta ${invoiceNumber}`, `Total: $${newSaleInstance.total.toFixed(2)}\nItems: ${saleLineItems.length}\nPago: ${paymentMethod}`, 'ventas', 'low');

    // Sync to D1 in background (non-blocking)
    syncSaleToD1(newSaleInstance).catch((err: unknown) => {
      console.warn('[D1 sync] sale failed:', err instanceof Error ? err.message : err);
    });

    // Alert about low stock elements
    lowStockAlerts.forEach(alertMessage => {
      addSystemNotification('⚠️ Alerta de Inventario', alertMessage, 'warning');
      addAutoNote('⚠️ Stock bajo', alertMessage, 'inventario', 'high');
    });

    return { success: true, invoice: newSaleInstance };
  };

  const addExpense = (newExp: Omit<Expense, 'id' | 'date'>) => {
    const expenseInstance: Expense = {
      ...newExp,
      id: `exp_${Date.now()}`,
      date: new Date().toISOString()
    };
    setExpenses(prev => [expenseInstance, ...prev]);
    syncExpenseToD1(expenseInstance).catch((err: unknown) => {
      console.warn('[D1 sync] expense failed:', err instanceof Error ? err.message : err);
    });
    addSystemNotification(
      '📉 Gasto Registrado',
      `Se registró un egreso por $${expenseInstance.amount.toFixed(2)} bajo el concepto: ${expenseInstance.concept}`,
      'info'
    );
  };

  const addIngredient = (newIng: Omit<Ingredient, 'id'>) => {
    const ingId = `ing_${newIng.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}`;
    const item: Ingredient = {
      ...newIng,
      id: ingId
    };
    setIngredients(prev => [...prev, item]);
    addSystemNotification('🌾 Nueva Materia Prima', `Se incorporó ${item.name} (${item.unitCost} $/unidad) al catálogo.`, 'success');
  };

  const updateIngredientStock = (id: string, newStock: number) => {
    setIngredients(prev =>
      prev.map(ing => {
        if (ing.id === id) {
          const diff = newStock - ing.stock;
          if (diff !== 0) {
            addSystemNotification(
              '🔄 Stock Actualizado',
              `Materia prima "${ing.name}" ajustada de ${ing.stock.toFixed(1)}${ing.unit} a ${newStock.toFixed(1)}${ing.unit}`,
              'info'
            );
          }
          return { ...ing, stock: newStock };
        }
        return ing;
      })
    );
  };

  const addProduct = (newProd: Omit<Product, 'id' | 'code'>) => {
    const prodId = `prod_${newProd.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}`;
    const code = `77912345${Math.floor(10000 + Math.random() * 90000)}`;
    const productInstance: Product = {
      elaborationDate: new Date().toISOString().split('T')[0],
      durabilityDays: 2,
      ...newProd,
      id: prodId,
      code
    };
    setProducts(prev => [...prev, productInstance]);
    addSystemNotification('🥐 Nuevo Producto', `Se agregó "${productInstance.name}" al catálogo de panadería.`, 'success');
  };

  const updateProductStock = (id: string, newStock: number) => {
    setProducts(prev =>
      prev.map(prod => {
        if (prod.id === id) {
          return { ...prod, stock: newStock };
        }
        return prod;
      })
    );
  };

  const toggleGateway = (id: string) => {
    setGateways(prev =>
      prev.map(gate => {
        if (gate.id === id) {
          const targetStatus = gate.status === 'active' ? 'inactive' : 'active';
          addSystemNotification(
            '🌐 Integración de Pagos',
            `Pasarela ${gate.name} ahora se encuentra: ${targetStatus.toUpperCase()}`,
            targetStatus === 'active' ? 'success' : 'warning'
          );
          return { ...gate, status: targetStatus };
        }
        return gate;
      })
    );
  };

  const updateUserWidgets = (updatedWidgets: string[]) => {
    setUsers(prev =>
      prev.map(u => {
        if (u.id === activeUser.id) {
          return { ...u, customPanels: updatedWidgets };
        }
        return u;
      })
    );
    addSystemNotification('📋 Tablero Personalizado', `Se guardó tu distribución preferida de analíticas para ${activeUser.name}.`, 'info');
  };

  const markNotificationAsRead = (id: string) => {
    setNotifications(prev =>
      prev.map(n => (n.id === id ? { ...n, read: true } : n))
    );
  };

  const clearNotifications = () => {
    setNotifications([]);
  };

  const resetAllData = () => {
    localStorage.removeItem('pan_erp_ingredients');
    localStorage.removeItem('pan_erp_products');
    localStorage.removeItem('pan_erp_sales');
    localStorage.removeItem('pan_erp_expenses');
    localStorage.removeItem('pan_erp_users');
    localStorage.removeItem('pan_erp_notifications');
    localStorage.removeItem('pan_erp_gateways');
    localStorage.removeItem('pan_erp_active_user_id');
    localStorage.removeItem('pan_erp_batches');
    localStorage.removeItem('pan_erp_withdrawal_requests');
    localStorage.removeItem('pan_erp_supply_requests');
    localStorage.removeItem('pan_erp_current_cash_session');
    localStorage.removeItem('pan_erp_cash_sessions_history');
    localStorage.removeItem('pan_erp_invoice_seq');

    setIngredients(INITIAL_INGREDIENTS);
    setProducts(INITIAL_PRODUCTS);
    setSales(INITIAL_SALES);
    setExpenses(INITIAL_EXPENSES);
    setUsers(USERS);
    setNotifications(INITIAL_NOTIFICATIONS);
    setGateways(PAYMENT_GATEWAYS);
    setActiveUserId('user_admin');
    setActiveTab('dashboard');
    invoiceSeqRef.current = 0;
    setBatches([]);
    setWithdrawalRequests([]);
    setCurrentCashSession(null);
    setCashSessionsHistory([]);
    setCustomers([]);
    setSupplyRequests([
      {
        id: 'sup_req_1',
        type: 'ingredient',
        itemId: 'ing_harina',
        itemName: 'Harina de Trigo 0000',
        quantity: 50,
        unit: 'kg',
        reason: 'Reposición urgente para elaboración de pan del fin de semana.',
        requestedBy: 'Laura (Panadero)',
        status: 'pending',
        date: new Date(Date.now() - 5400000).toISOString()
      },
      {
        id: 'sup_req_2',
        type: 'product',
        itemId: 'prod_pan_flauta',
        itemName: 'Pan Flauta (Baguette)',
        quantity: 40,
        unit: 'unidades',
        reason: 'Lote fresco caliente listo para transferir a mostrador.',
        requestedBy: 'Laura (Panadero)',
        status: 'pending',
        date: new Date(Date.now() - 1800000).toISOString()
      }
    ]);

    addSystemNotification('⚙️ Sistema Reiniciado', 'La base de datos original ha sido restablecida en tiempo real.', 'success');
  };

  const addBatch = (newBatch: Omit<ProductBatch, 'id' | 'status'>) => {
    const generatedId = `batch_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const batchInstance: ProductBatch = {
      ...newBatch,
      id: generatedId,
      status: 'active'
    };
    
    setBatches(prev => [...prev, batchInstance]);
    
    setProducts(prevProducts =>
      prevProducts.map(p => {
        if (p.id === newBatch.productId) {
          return { ...p, stock: p.stock + newBatch.quantity };
        }
        return p;
      })
    );
    
    const prodName = products.find(p => p.id === newBatch.productId)?.name || 'Producto';
    addSystemNotification(
      '📦 Nuevo Lote Registrado',
      `Se registró el lote ${newBatch.batchNumber} de "${prodName}" con ${newBatch.quantity} unidades.`,
      'success'
    );
  };

  const requestBatchWithdrawal = (batchId: string, quantity: number, reason: string) => {
    const batch = batches.find(b => b.id === batchId);
    if (!batch) return;
    
    const prod = products.find(p => p.id === batch.productId);
    const reqId = `req_${Date.now()}_${Math.floor(Math.random() * 105)}`;
    
    const request: BatchWithdrawalRequest = {
      id: reqId,
      batchId,
      productId: batch.productId,
      productName: prod ? prod.name : 'Artículo',
      batchNumber: batch.batchNumber,
      quantity,
      reason,
      requestedBy: `${activeUser.name} (${activeUser.role === 'admin' ? 'Administrador' : activeUser.role === 'cajero' ? 'Caja' : 'Panadero'})`,
      status: 'pending',
      date: new Date().toISOString()
    };
    
    setWithdrawalRequests(prev => [request, ...prev]);
    addSystemNotification(
      '🔔 Solicitud de Baja Registrada',
      `Se solicitó retirar ${quantity} u. del lote ${batch.batchNumber} de "${request.productName}".`,
      'info'
    );
  };

  const approveWithdrawalRequest = (requestId: string, adminMemo: string) => {
    setWithdrawalRequests(prev =>
      prev.map(r => {
        if (r.id === requestId) {
          if (r.status !== 'pending') return r;
          
          const req = { ...r, status: 'approved' as const, adminMemo };
          
          setBatches(currentBatches =>
            currentBatches.map(b => {
              if (b.id === req.batchId) {
                const nextStock = Math.max(0, b.stock - req.quantity);
                return {
                  ...b,
                  stock: nextStock,
                  status: nextStock === 0 ? 'withdrawn' as const : b.status
                };
              }
              return b;
            })
          );
          
          setProducts(currentProducts =>
            currentProducts.map(p => {
              if (p.id === req.productId) {
                return { ...p, stock: Math.max(0, p.stock - req.quantity) };
              }
              return p;
            })
          );
          
          addSystemNotification(
            '✅ Solicitud de Baja Aprobada',
            `Se aprobó retirar del local ${req.quantity} u. de "${req.productName}". Detalle: ${adminMemo}`,
            'success'
          );
          
          return req;
        }
        return r;
      })
    );
  };

  const rejectWithdrawalRequest = (requestId: string, adminMemo: string) => {
    setWithdrawalRequests(prev =>
      prev.map(r => {
        if (r.id === requestId) {
          if (r.status !== 'pending') return r;
          
          const req = { ...r, status: 'rejected' as const, adminMemo };
          addSystemNotification(
            '❌ Solicitud de Baja Rechazada',
            `Se rechazó dar de baja el lote ${req.batchNumber} de "${req.productName}". Detalle: ${adminMemo}`,
            'error'
          );
          return req;
        }
        return r;
      })
    );
  };

  const requestSupply = (type: 'ingredient' | 'product', itemId: string, quantity: number, reason: string) => {
    let itemName = '';
    let unit = '';
    if (type === 'ingredient') {
      const ing = ingredients.find(i => i.id === itemId);
      itemName = ing ? ing.name : 'Materia Prima';
      unit = ing ? ing.unit : 'kg';
    } else {
      const prod = products.find(p => p.id === itemId);
      itemName = prod ? prod.name : 'Producto';
      unit = 'unidades';
    }
    
    const reqId = `sup_req_${Date.now()}_${Math.floor(Math.random() * 100)}`;
    const request: SupplyRequest = {
      id: reqId,
      type,
      itemId,
      itemName,
      quantity,
      unit,
      reason,
      requestedBy: `${activeUser.name} (${activeUser.role === 'admin' ? 'Administración' : activeUser.role === 'cajero' ? 'Cajero' : 'Panadero'})`,
      status: 'pending',
      date: new Date().toISOString()
    };
    
    setSupplyRequests(prev => [request, ...prev]);
    syncSupplyRequestToD1({
      id: request.id,
      type: request.type,
      itemId: request.itemId,
      itemName: request.itemName,
      quantity: request.quantity,
      unit: request.unit,
      reason: request.reason,
      requestedBy: request.requestedBy,
    }).catch((err: unknown) => {
      console.warn('[D1 sync] supply request failed:', err instanceof Error ? err.message : err);
    });
    addSystemNotification(
      '🌾 Solicitud de Abastecimiento',
      `Nueva solicitud para ${quantity} ${unit} de "${itemName}": ${reason}`,
      'info'
    );
  };

  const approveSupplyRequest = (requestId: string, adminMemo: string) => {
    const req = supplyRequests.find(r => r.id === requestId);
    if (!req || req.status !== 'pending') return;

    const approved = { ...req, status: 'approved' as const, adminMemo };

    setSupplyRequests(prev => prev.map(r => r.id === requestId ? approved : r));
    updateSupplyRequestStatusInD1(requestId, 'approved', adminMemo).catch((err: unknown) => {
      console.warn('[D1 sync] supply approve failed:', err instanceof Error ? err.message : err);
    });

    if (approved.type === 'ingredient') {
      setIngredients(prev => prev.map(ing =>
        ing.id === approved.itemId ? { ...ing, stock: ing.stock + approved.quantity } : ing
      ));
    } else {
      setProducts(prev => prev.map(p =>
        p.id === approved.itemId ? { ...p, stock: p.stock + approved.quantity } : p
      ));
      const freshElab = new Date();
      setBatches(prev => [
        {
          id: `batch_supply_${Date.now()}_${Math.floor(Math.random() * 100)}`,
          productId: approved.itemId,
          batchNumber: `L-${approved.itemName.slice(0, 3).toUpperCase()}-R-${Math.floor(100 + Math.random() * 900)}`,
          quantity: approved.quantity,
          stock: approved.quantity,
          elaborationDate: freshElab.toISOString().split('T')[0],
          expiryDate: new Date(freshElab.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          status: 'active' as const,
          withdrawalMode: 'manual' as const
        },
        ...prev
      ]);
    }

    addSystemNotification(
      '✅ Abastecimiento Aprobado',
      `Se autorizó reposición de ${approved.quantity} ${approved.unit} para "${approved.itemName}". Detalle admin: ${adminMemo}`,
      'success'
    );
  };

  const rejectSupplyRequest = (requestId: string, adminMemo: string) => {
    setSupplyRequests(prev =>
      prev.map(r => {
        if (r.id === requestId) {
          if (r.status !== 'pending') return r;
          const req = { ...r, status: 'rejected' as const, adminMemo };
          addSystemNotification(
            '❌ Abastecimiento Desestimado',
            `Se rechazó la solicitud para "${req.itemName}". Comentario: ${adminMemo}`,
            'error'
          );
          return req;
        }
        return r;
      })
    );
    updateSupplyRequestStatusInD1(requestId, 'rejected', adminMemo).catch((err: unknown) => {
      console.warn('[D1 sync] supply reject failed:', err instanceof Error ? err.message : err);
    });
  };

  const openCashSession = (initialAmount: number, note?: string) => {
    const newSession: CashSession = {
      id: `cash_ses_${Date.now()}`,
      openedAt: new Date().toISOString(),
      openedBy: activeUser.name,
      initialAmount,
      expectedAmount: initialAmount,
      status: 'open',
      note: note || ''
    };
    setCurrentCashSession(newSession);
    addSystemNotification(
      '🏦 Apertura de Caja',
      `Se abrió la caja con un saldo inicial de $${initialAmount.toFixed(2)} por ${activeUser.name}.`,
      'success'
    );
    syncCashSessionToD1({
      id: newSession.id,
      branch_id: '00000000000000000000000000000001',
      opening_amount: initialAmount,
      status: 'open',
      opened_at: newSession.openedAt,
      notes: note ?? '',
    }).catch(() => {});
  };

  const closeCashSession = (realAmount: number, note?: string) => {
    if (!currentCashSession) return;
    
    const expected = currentCashSession.expectedAmount;
    const discrepancy = realAmount - expected;
    
    const finishedSession: CashSession = {
      ...currentCashSession,
      closedAt: new Date().toISOString(),
      closedBy: activeUser.name,
      realAmount,
      discrepancy,
      status: 'closed',
      note: note || currentCashSession.note
    };

    setCashSessionsHistory(prev => [finishedSession, ...prev]);
    setCurrentCashSession(null);

    addSystemNotification(
      '🏦 Cierre de Caja',
      `Caja cerrada. Esperado: $${expected.toFixed(2)}, Real: $${realAmount.toFixed(2)}, Discrepancia: $${discrepancy.toFixed(2)}`,
      Math.abs(discrepancy) < 0.01 ? 'success' : 'warning'
    );
    syncCashSessionCloseToD1(
      currentCashSession.id,
      realAmount,
      expected,
      note
    ).catch(() => {});
  };

  return (
    <AppContext.Provider
      value={{
        ingredients,
        products,
        sales,
        expenses,
        users,
        notifications,
        gateways,
        activeUser,
        activeTab,
        batches,
        withdrawalRequests,
        supplyRequests,
        currentCashSession,
        cashSessionsHistory,
        customers,
        setSales,
        selectedSellerId,
        setSelectedSellerId,
        logout,
        setCustomers,
        addCustomer,
        updateCustomer,
        setActiveUserRole,
        setActiveTab,
        setBatches,
        addSale,
        addExpense,
        addIngredient,
        updateIngredientStock,
        addProduct,
        updateProductStock,
        toggleGateway,
        updateUserWidgets,
        addSystemNotification,
        markNotificationAsRead,
        clearNotifications,
        resetAllData,
        addBatch,
        requestBatchWithdrawal,
        approveWithdrawalRequest,
        rejectWithdrawalRequest,
        requestSupply,
        approveSupplyRequest,
        rejectSupplyRequest,
        openCashSession,
        closeCashSession
      }}
    >
      {children}
    </AppContext.Provider>
  );
};
